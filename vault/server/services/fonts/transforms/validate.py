"""
Post-transform contour integrity checks. Structural edits must never
silently corrupt a glyph — this runs after every transform and reports
problems rather than crashing the whole pipeline, so callers can decide
whether to reject or accept individual glyphs.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import geometry as geo


@dataclass
class ValidationIssue:
    glyph_name: str
    contour_index: int | None
    kind: str  # 'contour_count_changed' | 'degenerate_contour' | 'winding_flipped'
    detail: str


def validate_glyph_contours(
    glyph_name: str,
    original_contours: list[list[geo.Point]],
    new_contours: list[list[geo.Point]],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    if len(original_contours) != len(new_contours):
        issues.append(ValidationIssue(
            glyph_name, None, 'contour_count_changed',
            f"{len(original_contours)} -> {len(new_contours)}",
        ))
        return issues  # nothing paired-up to compare further

    for i, (orig, new) in enumerate(zip(original_contours, new_contours)):
        if len(new) < 3:
            issues.append(ValidationIssue(glyph_name, i, 'degenerate_contour', f"{len(new)} points"))
            continue

        new_area = geo.signed_area(new)
        if abs(new_area) < 1e-6:
            issues.append(ValidationIssue(glyph_name, i, 'degenerate_contour', 'zero area'))
            continue

        orig_area = geo.signed_area(orig)
        if (orig_area >= 0) != (new_area >= 0):
            issues.append(ValidationIssue(
                glyph_name, i, 'winding_flipped',
                f"orig area {orig_area:.1f} -> new area {new_area:.1f} — outline likely self-intersected",
            ))

    return issues
