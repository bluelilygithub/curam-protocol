"""
Fetch a font family from the google/fonts GitHub repo and verify its license.

The repo (github.com/google/fonts) splits families by license into three
top-level directories: ofl/, apache/, ufl/. A family's presence under ofl/
IS the license proof for this project's purposes — no separate metadata
parsing is needed to confirm OFL. If a requested family exists only under
apache/ or ufl/, we halt and report which license it actually has (per the
project's "OFL only" non-negotiable).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

import requests

GITHUB_API = "https://api.github.com/repos/google/fonts/contents"
RAW_BASE = "https://raw.githubusercontent.com/google/fonts/main"


def _api_headers() -> dict:
    """
    Unauthenticated api.github.com calls are capped at 60/hr, which a dev
    session running this pipeline's tests repeatedly can burn through fast
    (raw.githubusercontent.com, used for the actual font bytes, has no such
    limit). Set GITHUB_TOKEN (any scope — this only reads a public repo) to
    raise that to 5000/hr.
    """
    token = os.environ.get('GITHUB_TOKEN')
    return {'Authorization': f'Bearer {token}'} if token else {}

LICENSE_DIRS = {
    "ofl": "OFL",
    "apache": "Apache-2.0",
    "ufl": "UFL",
}


class FontNotFoundError(Exception):
    """Family not found under any license directory in google/fonts."""


class LicenseNotAllowedError(Exception):
    """Family found, but licensed under something other than OFL. Halts the pipeline."""

    def __init__(self, family: str, slug: str, license_name: str):
        self.family = family
        self.slug = slug
        self.license_name = license_name
        super().__init__(
            f"'{family}' (slug '{slug}') is licensed under {license_name}, not OFL. "
            f"This tool only processes OFL-licensed fonts — halting."
        )


@dataclass
class RepoFile:
    name: str
    download_url: str


@dataclass
class FamilyLookup:
    family: str
    slug: str
    license: str  # always "OFL" if this object was returned successfully
    license_dir: str  # "ofl"
    files: list[RepoFile] = field(default_factory=list)


def family_to_slug(family: str) -> str:
    """google/fonts directory naming: lowercase, strip everything but a-z0-9."""
    return re.sub(r"[^a-z0-9]", "", family.lower())


def _list_dir(path: str) -> list[dict] | None:
    resp = requests.get(f"{GITHUB_API}/{path}", headers=_api_headers(), timeout=20)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def find_family(family: str) -> FamilyLookup:
    """
    Look up `family` in google/fonts. Returns a FamilyLookup (license == "OFL")
    on success. Raises LicenseNotAllowedError if the family exists under a
    non-OFL directory, or FontNotFoundError if it isn't in the repo at all.
    """
    slug = family_to_slug(family)

    ofl_listing = _list_dir(f"ofl/{slug}")
    if ofl_listing is not None:
        files = [
            RepoFile(name=item["name"], download_url=item["download_url"])
            for item in ofl_listing
            if item["type"] == "file"
        ]
        return FamilyLookup(family=family, slug=slug, license="OFL", license_dir="ofl", files=files)

    # Not OFL — check the other two dirs so we can report the real license
    # and halt clearly, instead of a bare "not found".
    for other_dir, license_name in (("apache", "Apache-2.0"), ("ufl", "UFL")):
        listing = _list_dir(f"{other_dir}/{slug}")
        if listing is not None:
            raise LicenseNotAllowedError(family, slug, license_name)

    raise FontNotFoundError(
        f"'{family}' (slug '{slug}') was not found under ofl/, apache/, or ufl/ in google/fonts."
    )


def choose_font_file(files: list[RepoFile]) -> RepoFile:
    """
    Pick the single most representative font file for phase-1 inspection/freeze:
    1. A variable font file (bracket axis-tag suffix, e.g. RobotoFlex[GRAD,...].ttf),
       preferring the non-italic one.
    2. Else the static Regular weight (Family-Regular.ttf).
    3. Else the first .ttf/.otf found.
    """
    font_files = [f for f in files if f.name.lower().endswith((".ttf", ".otf"))]
    if not font_files:
        raise FontNotFoundError("No .ttf/.otf files found in this family's repo directory.")

    variable_files = [f for f in font_files if "[" in f.name]
    if variable_files:
        non_italic = [f for f in variable_files if "italic" not in f.name.lower()]
        return (non_italic or variable_files)[0]

    regular = [f for f in font_files if "-regular." in f.name.lower()]
    if regular:
        return regular[0]

    return font_files[0]


def download_file(repo_file: RepoFile) -> bytes:
    resp = requests.get(repo_file.download_url, timeout=30)
    resp.raise_for_status()
    return resp.content


def list_ofl_family_slugs() -> set[str]:
    """
    Every family slug currently under ofl/ in google/fonts, in one request
    via the Git Trees API (recursive, single call — the per-family Contents
    API `find_family()` uses would take ~2000 requests to enumerate the
    whole catalog, which is not the same problem `find_family()` solves).

    This is the SAME rule `find_family()` uses (presence under ofl/ is the
    license proof) applied to the whole repo at once — the catalog picker
    (cli_catalog.py) uses this only to pre-filter what's *searchable*; the
    real, authoritative check still runs per-family via `find_family()` at
    selection time (the repo can change between a cache build and a pick).
    """
    resp = requests.get(
        "https://api.github.com/repos/google/fonts/git/trees/main",
        params={"recursive": "1"},
        headers=_api_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("truncated"):
        raise RuntimeError(
            "google/fonts git tree response was truncated — the catalog would be incomplete. "
            "GitHub's tree API has a size cap; this repo may have grown past it."
        )

    slugs: set[str] = set()
    for entry in data.get("tree", []):
        path = entry.get("path", "")
        if entry.get("type") == "tree" and path.startswith("ofl/") and path.count("/") == 1:
            slugs.add(path.split("/", 1)[1])
    return slugs
