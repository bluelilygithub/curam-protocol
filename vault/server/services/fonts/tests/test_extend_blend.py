"""
Regression test for a real user report: at Extend Ascenders/Descenders=57
combined with other settings on Roboto, the descender loop of 'g' visibly
detached from the bowl in the rendered preview.

Root cause: Roboto's 'g' draws its descender tail as a SEPARATE contour
from the bowl (both same-winding "outer" contours whose overlap forms the
visible shape) that straddles the baseline. The old hard-threshold warp
(no change above the baseline, `factor * distance` below it) has a slope
DISCONTINUITY exactly at that line — invisible for a single simple
outline, but it pulled the two straddling contours apart since their
points land on different sides of the kink. Fixed via a smoothed (C1-
continuous) transition (`geometry._smooth_ramp`).
"""

from functools import lru_cache
from io import BytesIO

import pytest
import requests
from fontTools.ttLib import TTFont

from ..freeze import freeze_to_static
from ..structural import apply_transform_recipe
from ..transforms import geometry as geo
from ..transforms import glyph_edit

ROBOTO_VARIABLE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto[wdth,wght].ttf"

# The exact recipe from the report.
RECIPE = {"transforms": {"stemThickness": 0, "proportionalWidth": 66, "extendAscDesc": 57, "counterWidth": -34}}


@lru_cache(maxsize=None)
def _roboto_static_bytes() -> bytes:
    resp = requests.get(ROBOTO_VARIABLE_URL, timeout=30)
    resp.raise_for_status()
    return freeze_to_static(resp.content)


def _load_font():
    return TTFont(BytesIO(_roboto_static_bytes()))


@pytest.mark.network
def test_g_descender_tail_stays_proportionate_to_bowl():
    font = _load_font()
    glyf = font["glyf"]
    glyph = glyf["g"]

    before = glyph_edit.get_glyph_contours(glyph, glyf)
    roles = glyph_edit.classify_outer_vs_counter(before)
    outer_indices = [i for i, r in enumerate(roles) if r == "outer"]
    assert len(outer_indices) >= 2, "test fixture assumption broken: 'g' should have multiple outer contours (bowl + tail)"

    before_bounds = [geo.bounds(before[i]) for i in outer_indices]
    # The tail is whichever outer contour reaches furthest below baseline.
    tail_idx = min(outer_indices, key=lambda i: geo.bounds(before[i])[1])
    bowl_idx = next(i for i in outer_indices if i != tail_idx)
    tail_before_bottom = geo.bounds(before[tail_idx])[1]
    bowl_before_bottom = geo.bounds(before[bowl_idx])[1]

    sreport = apply_transform_recipe(font, RECIPE, glyph_names=["g"])
    assert sreport.validation_issues == [], f"unexpected validation issues: {sreport.validation_issues}"
    assert sreport.glyphs_skipped == []

    after = glyph_edit.get_glyph_contours(glyf["g"], glyf)
    tail_after_bottom = geo.bounds(after[tail_idx])[1]
    bowl_after_bottom = geo.bounds(after[bowl_idx])[1]

    tail_growth = tail_before_bottom - tail_after_bottom  # more negative = grew further down
    bowl_growth = bowl_before_bottom - bowl_after_bottom

    # A ratio is unstable here (the bowl's own growth can be near zero),
    # so measure what actually determines whether they look detached: the
    # ABSOLUTE gap between how far each contour moved, converted to px at
    # a representative preview size. Before any fix (hard threshold):
    # ~19px. Smoothing the seam alone: still ~17.5px (the kink wasn't the
    # dominant factor). With the depth cap too: ~4.7px — a real,
    # substantial reduction, not a full elimination (an inherent
    # limitation of independently-warped overlapping contours), but no
    # longer the same failure mode as the reported bug.
    upm = 2048  # Roboto's unitsPerEm
    preview_px = 56
    gap_px = (tail_growth - bowl_growth) / upm * preview_px
    assert gap_px < 8, f"tail vs bowl growth differs by {gap_px:.1f}px at {preview_px}px preview — looks detached, same failure mode as the reported bug"


@pytest.mark.network
def test_extend_still_has_a_real_visible_effect_after_smoothing():
    """The smoothing fix must not defang the control — a tall ascender
    should still stretch substantially, just without the kink."""
    font = _load_font()
    glyf = font["glyf"]
    cmap = font.getBestCmap()
    b_name = cmap[ord('b')]

    before = glyph_edit.get_glyph_contours(glyf[b_name], glyf)
    before_top = max(p.y for c in before for p in c)

    apply_transform_recipe(
        font,
        {"transforms": {"stemThickness": 0, "proportionalWidth": 100, "extendAscDesc": 60, "counterWidth": 0}},
        glyph_names=[b_name],
    )
    after = glyph_edit.get_glyph_contours(glyf[b_name], glyf)
    after_top = max(p.y for c in after for p in c)

    assert after_top > before_top + 5, "extendAscDesc should still produce a clearly measurable stretch after smoothing"
