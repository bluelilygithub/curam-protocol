"""
Phase 1 pipeline: fetch -> license check -> inspect -> (freeze if variable).

Entry point for this phase: `run(family, axis_values=None)` returns a
Phase1Result with the static font bytes ready for the next phase, plus a
metadata report. No UI, no server wiring — this module is meant to be
called directly or from tests.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from .font_inspect import AxisInfo, InspectionReport, inspect_font_bytes
from .freeze import freeze_to_static
from .google_fonts_repo import choose_font_file, download_file, find_family


@dataclass
class Phase1Result:
    family: str
    slug: str
    license: str
    source_file: str
    was_variable: bool
    original_axes: list[AxisInfo]
    frozen_axis_values: dict[str, float] | None
    static_font_bytes: bytes

    def metadata_report(self) -> dict:
        """JSON-serializable report (excludes the raw font bytes)."""
        return {
            "family": self.family,
            "slug": self.slug,
            "license": self.license,
            "source_file": self.source_file,
            "was_variable": self.was_variable,
            "original_axes": [asdict(a) for a in self.original_axes],
            "frozen_axis_values": self.frozen_axis_values,
        }


def run(family: str, axis_values: dict[str, float] | None = None) -> Phase1Result:
    """
    Run the full phase-1 pipeline for `family`.

    `axis_values`: optional tag->value overrides for freezing a variable font
    (e.g. {"wght": 700, "wdth": 100}). Ignored if the font is static.
    Unspecified axes freeze at their own default.

    Raises LicenseNotAllowedError / FontNotFoundError from google_fonts_repo
    on license/lookup failure — callers should let these halt, per spec.
    """
    lookup = find_family(family)  # raises on non-OFL or not-found
    repo_file = choose_font_file(lookup.files)
    raw_bytes = download_file(repo_file)

    report: InspectionReport = inspect_font_bytes(raw_bytes)

    if report.is_variable:
        static_bytes = freeze_to_static(raw_bytes, axis_values)
        frozen_values = axis_values if axis_values else {
            a.tag: a.default_value for a in report.axes
        }
    else:
        static_bytes = raw_bytes
        frozen_values = None

    return Phase1Result(
        family=lookup.family,
        slug=lookup.slug,
        license=lookup.license,
        source_file=repo_file.name,
        was_variable=report.is_variable,
        original_axes=report.axes,
        frozen_axis_values=frozen_values,
        static_font_bytes=static_bytes,
    )
