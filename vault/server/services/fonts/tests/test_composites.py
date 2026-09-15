"""
Composite-glyph gap fix (following commit 940fe82): accented letters must
be decomposed, transformed identically to their base component, reassembled
as a real simple glyph, and pass the same sidebearing/validation treatment
as any other edited glyph — not skipped.

PT Serif covers acute/grave/umlaut/tilde as composites; Crimson Text's
ccedilla is composite there (it's a simple glyph in PT Serif), covering
cedilla too.
"""

from functools import lru_cache
from io import BytesIO

import pytest
import requests
from fontTools.ttLib import TTFont

from ..structural import apply_transform_recipe, transform_contours, _cap_height_units
from ..transforms import glyph_edit

RECIPE = {"transforms": {"stemThickness": 30, "proportionalWidth": 115, "extendAscDesc": 40, "counterWidth": -10}}

# (family, char, expected base char, diacritic type). Known-static filenames
# (from Phase 1 exploration) fetched directly via raw.githubusercontent.com
# and cached per-family — sidesteps api.github.com's unauthenticated 60/hr
# rate limit, which the license-check lookup in google_fonts_repo.py (used
# by production code, exercised separately in test_pipeline.py) can hit
# hard during a dev session with many test runs in a short window.
RAW_FONT_URLS = {
    "PT Serif": "https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PT_Serif-Web-Regular.ttf",
    "Crimson Text": "https://raw.githubusercontent.com/google/fonts/main/ofl/crimsontext/CrimsonText-Regular.ttf",
}

ACCENTED_CASES = [
    ("PT Serif", "á", "a", "acute"),
    ("PT Serif", "à", "a", "grave"),
    ("PT Serif", "ä", "a", "umlaut"),
    ("PT Serif", "ñ", "n", "tilde"),
    ("Crimson Text", "ç", "c", "cedilla"),
]


@lru_cache(maxsize=None)
def _fetch_bytes(family: str) -> bytes:
    resp = requests.get(RAW_FONT_URLS[family], timeout=30)
    resp.raise_for_status()
    return resp.content


def _load_font(family):
    return TTFont(BytesIO(_fetch_bytes(family)))


@pytest.mark.network
@pytest.mark.parametrize("family,accented_char,base_char,diacritic", ACCENTED_CASES)
def test_composite_glyph_is_decomposed_transformed_and_reassembled(family, accented_char, base_char, diacritic):
    font = _load_font(family)
    glyf = font['glyf']
    cmap = font.getBestCmap()
    accented_name = cmap[ord(accented_char)]

    assert glyph_edit.is_composite(glyf[accented_name]), f"test fixture assumption broken: {accented_char} not composite in {family}"

    report = apply_transform_recipe(font, RECIPE, glyph_names=[accented_name])

    # 7. Reported as transformed, not skipped.
    assert accented_name in report.glyphs_edited, f"{diacritic}: not in glyphs_edited"
    assert accented_name in report.composite_glyphs_reassembled, f"{diacritic}: not in composite_glyphs_reassembled"
    assert not any(name == accented_name for name, _ in report.glyphs_skipped), f"{diacritic}: was skipped"

    # 4. No longer a live composite reference.
    assert glyf[accented_name].isComposite() is False, f"{diacritic}: still composite after transform"

    # 6. Same validation as simple glyphs — no winding flips / degenerate
    #    contours for this modest recipe.
    own_issues = [i for i in report.validation_issues if i.glyph_name == accented_name]
    assert own_issues == [], f"{diacritic}: unexpected validation issues: {own_issues}"

    # 5. Sidebearings recalculated (hmtx entry must exist and be sane).
    advance, lsb = font['hmtx'][accented_name]
    assert advance > 0


@pytest.mark.network
def test_base_component_transforms_identically_to_standalone_glyph():
    """
    Requirement 3: the 'e' portion of 'é' must receive exactly the same
    transform as the standalone 'e' glyph. PT Serif's 'é' composite is
    [e-component at (0,0), acute-component at (145,0)] — verified in
    exploration — so 'e's two contours are the first two contours of the
    flattened 'é'.
    """
    font = _load_font("PT Serif")
    glyf = font['glyf']
    cmap = font.getBestCmap()

    e_name = cmap[ord('e')]
    eacute_name = cmap[ord('é')]
    assert glyph_edit.is_composite(glyf[eacute_name])

    e_glyph = glyf[e_name]
    eacute_glyph = glyf[eacute_name]

    e_contours = glyph_edit.get_glyph_contours(e_glyph, glyf)
    eacute_contours = glyph_edit.get_glyph_contours(eacute_glyph, glyf)
    assert len(eacute_contours) == len(e_contours) + 1  # e's contours + the accent's own

    baseline_y = 0.0
    cap_height_y = _cap_height_units(font)
    width_factor, extend_factor, counter_percent, stem_delta = 1.2, 0.3, -15, 40.0

    e_transformed = transform_contours(e_contours, width_factor, baseline_y, cap_height_y, extend_factor, counter_percent, stem_delta)
    eacute_transformed = transform_contours(eacute_contours, width_factor, baseline_y, cap_height_y, extend_factor, counter_percent, stem_delta)

    # The first len(e_contours) contours of the transformed é must exactly
    # match the standalone-e transform, point for point.
    base_slice = eacute_transformed[:len(e_contours)]
    for contour_idx, (e_c, base_c) in enumerate(zip(e_transformed, base_slice)):
        assert len(e_c) == len(base_c), f"contour {contour_idx} point count mismatch"
        for p_idx, (pe, pb) in enumerate(zip(e_c, base_c)):
            assert pe.x == pytest.approx(pb.x, abs=0.01), f"contour {contour_idx} point {p_idx} x mismatch"
            assert pe.y == pytest.approx(pb.y, abs=0.01), f"contour {contour_idx} point {p_idx} y mismatch"


@pytest.mark.network
def test_accent_mark_moves_with_extended_ascender():
    """
    Requirement 3: the accent shouldn't stay floating at its original
    position if the base's proportions changed — specifically, a positive
    Extend Ascenders/Descenders should push a mark that sits above
    cap-height even higher (same warp function, applied consistently).
    """
    font = _load_font("PT Serif")
    glyf = font['glyf']
    cmap = font.getBestCmap()
    eacute_name = cmap[ord('é')]

    original_contours = glyph_edit.get_glyph_contours(glyf[eacute_name], glyf)
    original_top = max(p.y for contour in original_contours for p in contour)

    report = apply_transform_recipe(
        font,
        {"transforms": {"stemThickness": 0, "proportionalWidth": 100, "extendAscDesc": 60, "counterWidth": 0}},
        glyph_names=[eacute_name],
    )
    assert eacute_name in report.glyphs_edited

    new_contours = glyph_edit.get_glyph_contours(glyf[eacute_name], glyf)
    new_top = max(p.y for contour in new_contours for p in contour)

    assert new_top > original_top, "accent mark did not move higher with a positive ascender extension"


@pytest.mark.network
def test_missing_component_glyph_is_reported_not_silently_dropped():
    """A composite referencing a component name absent from glyf must be
    skipped with a clear reason, never silently ignored."""
    font = _load_font("PT Serif")
    glyf = font['glyf']
    cmap = font.getBestCmap()
    eacute_name = cmap[ord('é')]

    # Corrupt one component's reference to simulate a broken font.
    glyf[eacute_name].components[0].glyphName = 'this_glyph_name_does_not_exist'

    report = apply_transform_recipe(font, RECIPE, glyph_names=[eacute_name])

    assert eacute_name not in report.glyphs_edited
    skip_reasons = dict(report.glyphs_skipped)
    assert eacute_name in skip_reasons
    assert 'decompose_failed' in skip_reasons[eacute_name]
