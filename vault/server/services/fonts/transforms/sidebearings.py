"""
Recalculate left/right sidebearings for a glyph after its outline changed,
so a widened/thinned/extended letter doesn't collide with or gap away from
its unmodified neighbours.

Policy: preserve the glyph's original right sidebearing (RSB) as a fixed
value (typographically, that's "the breathing room this letter was drawn
with"), recompute the left sidebearing from the new bounding box (LSB is
conventionally kept equal to xMin), and derive the new advance width from
those two: advance = new_xMax + original_rsb.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SidebearingUpdate:
    glyph_name: str
    old_advance: int
    old_lsb: int
    new_advance: int
    new_lsb: int


def capture_original_rsb(font, glyph_name: str) -> int | None:
    """Call BEFORE transforming the glyph's outline."""
    glyf = font['glyf']
    hmtx = font['hmtx']
    glyph = glyf[glyph_name]
    if glyph.numberOfContours <= 0:
        return None
    advance, _lsb = hmtx[glyph_name]
    return advance - glyph.xMax


def recalc_sidebearings_with_rsb(font, glyph_name: str, original_rsb: int) -> SidebearingUpdate | None:
    """Call AFTER transforming the glyph's outline and calling glyph.recalcBounds()."""
    glyf = font['glyf']
    hmtx = font['hmtx']
    glyph = glyf[glyph_name]
    if glyph.numberOfContours <= 0:
        return None

    old_advance, old_lsb = hmtx[glyph_name]
    new_lsb = glyph.xMin
    new_advance = glyph.xMax + original_rsb
    hmtx[glyph_name] = (max(0, round(new_advance)), round(new_lsb))

    return SidebearingUpdate(
        glyph_name=glyph_name,
        old_advance=old_advance,
        old_lsb=old_lsb,
        new_advance=hmtx[glyph_name][0],
        new_lsb=hmtx[glyph_name][1],
    )
