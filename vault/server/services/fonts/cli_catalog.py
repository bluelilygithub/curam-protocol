"""
Builds the searchable Google Fonts catalog for the /fonts picker UI:
family name, category, and whether it's variable (+ axis tags) — filtered
to OFL-licensed families ONLY, using the exact same rule
(google_fonts_repo.list_ofl_family_slugs(), presence under ofl/) that
Phase 1's find_family() uses for the real per-family check. One source of
truth for "is this OFL," not two implementations that could disagree.

Metadata (family/category/axes) comes from Google's own public font
picker data endpoint (fonts.google.com/metadata/fonts — no API key
needed, the "webfonts.json equivalent" this phase's brief allows). This
cache is a SEARCH CONVENIENCE ONLY: the repo can change between a cache
build and a designer's selection (see the Merriweather/Roboto Slab
findings from Phase 1), so cli_export.py's own fetch_and_freeze() always
re-runs the real, authoritative fetch/license-check at selection time
regardless of what this cache says.

Usage:
    python -m fonts.cli_catalog --output-dir <dir>

Writes <output-dir>/catalog.json:
[
  {"family": "PT Serif", "slug": "ptserif", "category": "Serif", "isVariable": false, "axisTags": []},
  {"family": "Roboto Flex", "slug": "robotoflex", "category": "Sans Serif", "isVariable": true, "axisTags": ["GRAD","XOPQ",...]},
  ...
]
Stdout: one JSON status line, same contract as cli_export.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

from .google_fonts_repo import family_to_slug, list_ofl_family_slugs

GOOGLE_METADATA_URL = "https://fonts.google.com/metadata/fonts"


def _emit(payload: dict) -> None:
    print(json.dumps(payload))


def build_catalog() -> list[dict]:
    ofl_slugs = list_ofl_family_slugs()  # the one source of truth for OFL, shared with find_family()

    resp = requests.get(GOOGLE_METADATA_URL, timeout=30)
    resp.raise_for_status()
    metadata = resp.json()

    catalog = []
    for entry in metadata.get("familyMetadataList", []):
        family = entry.get("family")
        if not family:
            continue
        slug = family_to_slug(family)
        if slug not in ofl_slugs:
            continue  # non-OFL (or repo/metadata slug mismatch) — excluded before it ever reaches the UI

        axes = entry.get("axes") or []
        catalog.append({
            "family": family,
            "slug": slug,
            "category": entry.get("category") or "Unknown",
            "isVariable": len(axes) > 0,
            "axisTags": [a.get("tag") for a in axes if a.get("tag")],
        })

    catalog.sort(key=lambda f: f["family"].lower())
    return catalog


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        catalog = build_catalog()
        (output_dir / 'catalog.json').write_text(json.dumps(catalog), encoding='utf-8')
        _emit({'ok': True, 'count': len(catalog)})
        return 0
    except Exception as exc:  # noqa: BLE001 — CLI boundary, must always emit JSON
        _emit({'ok': False, 'error_type': type(exc).__name__, 'error': str(exc)})
        return 1


if __name__ == '__main__':  # pragma: no cover — invoked via `python -m fonts.cli_catalog`
    sys.exit(main())
