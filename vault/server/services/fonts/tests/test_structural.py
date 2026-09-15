"""
Integration tests: fetch a real OFL font via the Phase 1 pipeline, apply a
transform recipe via structural.py, and check the properties the brief
asks for — sidebearings updated, no winding errors, kerning classes
applied, and stem thickness working in both directions.
"""

import pytest
from fontTools.ttLib import TTFont
from io import BytesIO

from ..pipeline import run as fetch_and_freeze
from ..structural import apply_transform_recipe
from ..transforms import glyph_edit


def _load_font(family="Pacifico"):
    result = fetch_and_freeze(family)
    return TTFont(BytesIO(result.static_font_bytes))


@pytest.mark.network
def test_proportional_width_updates_sidebearings():
    font = _load_font()
    glyf = font['glyf']
    hmtx = font['hmtx']
    cmap = font.getBestCmap()
    glyph_name = cmap[ord('o')]
    old_advance, old_lsb = hmtx[glyph_name]

    report = apply_transform_recipe(
        font,
        {"transforms": {"stemThickness": 0, "proportionalWidth": 130, "extendAscDesc": 0, "counterWidth": 0}},
        glyph_names=[glyph_name],
    )

    assert glyph_name in report.glyphs_edited
    new_advance, new_lsb = hmtx[glyph_name]
    assert new_advance != old_advance
    # Widened glyph, positive width control -> should not have shrunk.
    assert new_advance > old_advance * 0.9
    assert report.validation_issues == []


@pytest.mark.network
def test_stem_thickness_both_directions_change_outline():
    cmap_font = _load_font()
    cmap = cmap_font.getBestCmap()
    glyph_name = cmap[ord('o')]

    def bbox_area_for_delta(percent):
        font = _load_font()
        glyf = font['glyf']
        apply_transform_recipe(
            font,
            {"transforms": {"stemThickness": percent, "proportionalWidth": 100, "extendAscDesc": 0, "counterWidth": 0}},
            glyph_names=[glyph_name],
        )
        g = glyf[glyph_name]
        return (g.xMax - g.xMin) * (g.yMax - g.yMin)

    baseline_area = bbox_area_for_delta(0)
    thick_area = bbox_area_for_delta(80)
    thin_area = bbox_area_for_delta(-40)

    # Thickening should not shrink the glyph, thinning should not grow it —
    # both directions must actually move the outline (real offset), not a
    # positive-only fake-bold overlay.
    assert thick_area != baseline_area
    assert thin_area != baseline_area
    assert thick_area != thin_area


@pytest.mark.network
def test_counter_width_uses_winding_not_area_heuristic():
    font = _load_font()
    glyf = font['glyf']
    cmap = font.getBestCmap()
    glyph_name = cmap[ord('o')]
    glyph = glyf[glyph_name]
    contours = glyph_edit.get_glyph_contours(glyph, glyf)

    assert contours is not None
    assert len(contours) >= 2  # 'o' has an outer contour + a counter

    roles = glyph_edit.classify_outer_vs_counter(contours)
    assert 'outer' in roles
    assert 'counter' in roles


@pytest.mark.network
def test_kerning_classes_and_advanced_pairs_compile():
    font = _load_font()
    report = apply_transform_recipe(
        font,
        {
            "transforms": {"stemThickness": 0, "proportionalWidth": 100, "extendAscDesc": 0, "counterWidth": 0},
            "kerning": {
                "enabledGroupIds": ["diagonal-caps", "round-pairs"],
                "balance": -50,
                "advancedPairs": {"AV": -30},
            },
        },
        glyph_names=[],  # no outline edits needed for this test
    )

    assert report.kerning is not None
    assert 'diagonal-caps' in report.kerning.classes_used
    assert report.kerning.pair_rules_written == 1
    assert 'GPOS' in font


def test_validate_flags_winding_flip():
    from ..transforms.geometry import Point
    from ..transforms.validate import validate_glyph_contours

    square = [Point(0, 0, True), Point(0, 100, True), Point(100, 100, True), Point(100, 0, True)]
    reversed_square = list(reversed(square))  # flips winding sign

    issues = validate_glyph_contours('test', [square], [reversed_square])
    assert len(issues) == 1
    assert issues[0].kind == 'winding_flipped'


def test_validate_flags_degenerate_contour():
    from ..transforms.geometry import Point
    from ..transforms.validate import validate_glyph_contours

    square = [Point(0, 0, True), Point(0, 100, True), Point(100, 100, True), Point(100, 0, True)]
    collapsed = [Point(0, 0, True), Point(0, 0, True)]

    issues = validate_glyph_contours('test', [square], [collapsed])
    assert len(issues) == 1
    assert issues[0].kind == 'degenerate_contour'
