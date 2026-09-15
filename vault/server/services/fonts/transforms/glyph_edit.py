"""
Bridge between fontTools' glyf coordinate storage and the plain-point
geometry helpers in geometry.py, plus the four structural transforms
themselves.

Composite glyphs (accented letters built from a base + mark component,
e.g. 'e' + 'acute' -> 'é') are decomposed via `Glyph.getCoordinates()`,
which fontTools already resolves recursively into absolute, glyph-space
coordinates (each component's own outline placed at its stored offset).
Because every transform in this module already operates in that same
absolute coordinate space (width scale around x=0, ascender/descender warp
around the font's shared baseline/cap-height, counter classification by
winding across ALL contours, stem offset per contour), applying them to
the flattened composite is not a special case — it's the same function
call as for a simple glyph, and the accent mark comes along for the ride
already correctly positioned relative to the transformed base: the same
width scale moves it proportionally, the same y-warp stretches it if it
sits above cap-height, the same per-contour stem offset weights it, and
counter-hole detection runs across the true combined contour set (so a
counter belonging to the base, e.g. the bowl of 'e', is still found
correctly even with the accent's contour(s) mixed in).

The glyph is reassembled as a plain simple glyph afterward — see
`set_glyph_contours` — since a transformed outline can no longer be
described as unmodified components at fixed offsets.
"""

from __future__ import annotations

from dataclasses import dataclass

from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from fontTools.ttLib.tables.ttProgram import Program

from . import geometry as geo


@dataclass
class GlyphEditResult:
    glyph_name: str
    edited: bool
    skip_reason: str | None = None
    contour_count_before: int = 0
    contour_count_after: int = 0


def _split_contours(coords, flags, end_pts) -> list[list[geo.Point]]:
    contours = []
    start = 0
    for end in end_pts:
        pts = [geo.Point(float(coords[i][0]), float(coords[i][1]), bool(flags[i] & 0x01)) for i in range(start, end + 1)]
        contours.append(pts)
        start = end + 1
    return contours


def _flatten_contours(contours: list[list[geo.Point]]):
    coords = []
    flags = []
    end_pts = []
    idx = -1
    for contour in contours:
        for p in contour:
            coords.append((p.x, p.y))
            flags.append(1 if p.on_curve else 0)
            idx += 1
        end_pts.append(idx)
    return coords, flags, end_pts


def is_composite(glyph: Glyph) -> bool:
    return glyph.isComposite()


def get_glyph_contours(glyph: Glyph, glyf_table) -> list[list[geo.Point]] | None:
    """
    Returns None (caller should skip and report why) only for a genuinely
    empty glyph (e.g. space, numberOfContours == 0). Composite glyphs are
    flattened to their absolute-coordinate contours via
    `Glyph.getCoordinates()`, which fontTools resolves recursively —
    nested composites (component-of-a-component) come out flat too.
    """
    if glyph.numberOfContours == 0:
        return None  # empty glyph, e.g. space — nothing to transform
    coords, end_pts, flags = glyph.getCoordinates(glyf_table)
    if not end_pts:
        return None
    return _split_contours(coords, flags, end_pts)


def set_glyph_contours(glyph: Glyph, glyf_table, contours: list[list[geo.Point]]) -> None:
    """
    Writes `contours` back as a plain SIMPLE glyph. If `glyph` was a
    composite, this is where it gets reassembled into one real outline —
    a transformed glyph can't stay described as untouched components at
    fixed offsets, since the components no longer match the font's
    unmodified originals (requirement: composites must not remain "live"
    references after a transform).
    """
    coords, flags, end_pts = _flatten_contours(contours)
    if hasattr(glyph, 'components'):
        del glyph.components
    # Any prior hinting bytecode is invalid against the new outline. A simple
    # TrueType glyph's compile() path requires `.program` to exist (glyf
    # unconditionally calls program.getBytecode()) — an empty Program is the
    # correct "no hinting" state, not deleting the attribute entirely.
    glyph.program = Program()
    glyph.numberOfContours = len(end_pts)
    glyph.coordinates = GlyphCoordinates(coords)
    glyph.flags = bytearray(flags)
    glyph.endPtsOfContours = end_pts
    glyph.recalcBounds(glyf_table)


def classify_outer_vs_counter(contours: list[list[geo.Point]]) -> list[str]:
    """
    'outer' or 'counter' per contour, via signed-area winding-direction —
    the dominant sign (by total absolute area) is treated as the outer
    shape's orientation; any contour with the opposite sign is a counter.
    Multiple same-signed contours (e.g. the two strokes of 'i' — dot and
    stem) are correctly both classified as outer, not one guessed as a
    "hole" by size the way an area-only heuristic would risk doing.
    """
    areas = [geo.signed_area(c) for c in contours]
    if not areas:
        return []
    outer_sign = 1.0 if sum(a for a in areas if a != 0) >= 0 else -1.0
    # Tie-break using the largest-magnitude contour if the sum is ambiguous (near zero).
    if abs(sum(areas)) < 1e-6 and areas:
        dominant = max(areas, key=abs)
        outer_sign = 1.0 if dominant >= 0 else -1.0
    return ['outer' if (a >= 0) == (outer_sign >= 0) else 'counter' for a in areas]


def apply_stem_thickness(contours: list[list[geo.Point]], delta_units: float) -> list[list[geo.Point]]:
    """Offsets every contour's outline by delta_units (+thicken / -thin). Real outline offset, both directions."""
    if delta_units == 0:
        return contours
    return [geo.offset_contour(c, delta_units) for c in contours]


def apply_proportional_width(contours: list[list[geo.Point]], scale_factor: float) -> list[list[geo.Point]]:
    if scale_factor == 1.0:
        return contours
    return [geo.scale_x(c, scale_factor, origin_x=0.0) for c in contours]


def apply_extend_ascender_descender(contours: list[list[geo.Point]], baseline_y: float, cap_height_y: float, factor: float) -> list[list[geo.Point]]:
    if factor == 0:
        return contours
    return [geo.warp_y_ascender_descender(c, baseline_y, cap_height_y, factor) for c in contours]


def apply_counter_width(contours: list[list[geo.Point]], factor: float) -> list[list[geo.Point]]:
    if factor == 0 or len(contours) < 2:
        return contours
    roles = classify_outer_vs_counter(contours)
    out = []
    for contour, role in zip(contours, roles):
        if role == 'outer':
            out.append(contour)
            continue
        cx, cy = geo.centroid(contour)
        out.append(geo.scale_around(contour, cx, cy, 1 + factor / 100))
    return out
