"""
Regression test for a real user report: at Counter Width ~29% on Roboto,
the bowl of 'b'/'p'/'d'/'q' visually detached from the stem in the
rendered preview. Root cause: apply_counter_width() scaled a counter
(hole) contour around its own centroid with no check against the outer
contour that actually encloses it — for a multi-contour glyph like 'b'
(a separate stem rectangle + bowl shape, each classified 'outer'), the
counter could grow past the narrow bowl-to-stem junction, corrupting the
letterform. Fixed by clamping counter growth to stay within the specific
outer contour that encloses it (not the loose union of all outer
contours, which for 'b' includes the tall unrelated stem and would not
have caught this).
"""

from functools import lru_cache
from io import BytesIO

import pytest
import requests
from fontTools.ttLib import TTFont

from ..freeze import freeze_to_static
from ..transforms import geometry as geo
from ..transforms import glyph_edit

ROBOTO_VARIABLE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto[wdth,wght].ttf"


@lru_cache(maxsize=None)
def _roboto_static_bytes() -> bytes:
    resp = requests.get(ROBOTO_VARIABLE_URL, timeout=30)
    resp.raise_for_status()
    return freeze_to_static(resp.content)


def _load_font():
    return TTFont(BytesIO(_roboto_static_bytes()))


@pytest.mark.network
@pytest.mark.parametrize("glyph_name", ["b", "p", "d", "q"])
def test_counter_width_does_not_overflow_into_stem_junction(glyph_name):
    font = _load_font()
    glyf = font["glyf"]
    glyph = glyf[glyph_name]

    contours = glyph_edit.get_glyph_contours(glyph, glyf)
    roles = glyph_edit.classify_outer_vs_counter(contours)
    assert "counter" in roles, f"test fixture assumption broken: {glyph_name} should have a counter contour"

    # The exact value from the real report.
    new_contours = glyph_edit.apply_counter_width(contours, 29)
    outer_contours = [c for c, r in zip(contours, roles) if r == "outer"]

    for original, transformed, role in zip(contours, new_contours, roles):
        if role != "counter":
            continue
        enclosing = glyph_edit._find_enclosing_outer_bounds(geo.bounds(original), outer_contours)
        assert enclosing is not None, f"{glyph_name}: counter has no enclosing outer contour to clamp against"

        cb = geo.bounds(transformed)
        ox0, oy0, ox1, oy1 = enclosing
        tolerance = 0.5  # sub-unit float slop only
        assert cb[0] >= ox0 - tolerance, f"{glyph_name}: counter left edge overflowed its enclosing outer contour"
        assert cb[1] >= oy0 - tolerance, f"{glyph_name}: counter bottom edge overflowed its enclosing outer contour"
        assert cb[2] <= ox1 + tolerance, f"{glyph_name}: counter right edge overflowed its enclosing outer contour"
        assert cb[3] <= oy1 + tolerance, f"{glyph_name}: counter top edge overflowed its enclosing outer contour"


@pytest.mark.network
def test_counter_width_shrinking_is_never_clamped():
    """Shrinking a counter (negative factor) can't collide with the outer boundary — must apply the full requested amount."""
    font = _load_font()
    glyf = font["glyf"]
    glyph = glyf["o"]
    contours = glyph_edit.get_glyph_contours(glyph, glyf)
    roles = glyph_edit.classify_outer_vs_counter(contours)

    new_contours = glyph_edit.apply_counter_width(contours, -30)
    for original, transformed, role in zip(contours, new_contours, roles):
        if role != "counter":
            continue
        orig_area = abs(geo.signed_area(original))
        new_area = abs(geo.signed_area(transformed))
        assert new_area < orig_area * 0.6, "a -30% counter width should shrink the counter substantially, unclamped"
