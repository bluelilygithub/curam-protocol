"""
Full pipeline test: Phase 1 fetch -> Phase 3/3.5 transform -> Phase 4
export. Uses the same raw.githubusercontent.com + in-process cache
approach as test_composites.py to avoid GitHub's unauthenticated API
rate limit.
"""

from functools import lru_cache
from io import BytesIO

import pytest
import requests
from fontTools.ttLib import TTFont

from ..export.pipeline import export_font
from ..export.rename import OFLComplianceError
from ..freeze import freeze_to_static
from ..structural import apply_transform_recipe

RAW_FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PT_Serif-Web-Regular.ttf"
# Roboto ships `post` format 3.0 (no glyph names in the binary at all) —
# the real-world case that broke browser-side coverage checking when it
# matched by glyph name instead of Unicode codepoint. PT Serif's post
# format 2.0 (has names) is why that bug went unnoticed until a real user
# picked Roboto specifically.
ROBOTO_VARIABLE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto[wdth,wght].ttf"

RECIPE = {
    "transforms": {"stemThickness": 20, "proportionalWidth": 110, "extendAscDesc": 10, "counterWidth": -5},
    "kerning": {"enabledGroupIds": ["diagonal-caps", "round-pairs"], "balance": -30, "advancedPairs": {"AV": -20}},
}


@lru_cache(maxsize=None)
def _fetch_bytes() -> bytes:
    resp = requests.get(RAW_FONT_URL, timeout=30)
    resp.raise_for_status()
    return resp.content


def _load_transformed_font():
    font = TTFont(BytesIO(_fetch_bytes()))
    structural_report = apply_transform_recipe(font, RECIPE)
    return font, structural_report


@pytest.mark.network
def test_export_blocks_on_unchanged_family_name():
    font, structural_report = _load_transformed_font()
    with pytest.raises(OFLComplianceError):
        export_font(font, "PT Serif", structural_report=structural_report)


@pytest.mark.network
def test_export_blocks_on_empty_family_name():
    font, structural_report = _load_transformed_font()
    with pytest.raises(OFLComplianceError):
        export_font(font, "   ", structural_report=structural_report)


@pytest.mark.network
def test_full_pipeline_fetch_transform_export():
    font, structural_report = _load_transformed_font()

    outputs, report = export_font(
        font,
        "My Custom Serif",
        range_ids=("basic-latin", "latin-1-supplement"),
        structural_report=structural_report,
    )

    # Formats produced.
    assert set(outputs.keys()) == {"ttf", "woff2", "otf"}
    for fmt, data in outputs.items():
        assert len(data) > 0, f"{fmt} output is empty"

    # OFL fields correctly rewritten.
    assert report.rename.original_family == "PT Serif"
    assert report.rename.new_family == "My Custom Serif"
    assert "Custom Serif" in report.rename.full_name
    assert report.rename.postscript_name == "MyCustomSerif"
    assert "SIL Open Font License" in report.rename.copyright
    assert report.rename.trademark

    reloaded = {fmt: TTFont(BytesIO(data)) for fmt, data in outputs.items()}
    for fmt, f in reloaded.items():
        assert f["name"].getDebugName(1) == "My Custom Serif", f"{fmt}: family name not rewritten"
        assert f["name"].getDebugName(6) == "MyCustomSerif", f"{fmt}: PostScript name not rewritten"
        assert f["name"].getDebugName(0) == report.rename.copyright, f"{fmt}: copyright not written"

    # Correct sfnt flavors.
    assert reloaded["otf"].sfntVersion == "OTTO"
    assert reloaded["ttf"].sfntVersion != "OTTO"

    # File size reduced after subsetting (both plain-sfnt ttf saves, apples to apples).
    assert report.size_before_bytes > report.size_after_bytes["ttf"]

    # Subsetting actually reduced glyph count.
    assert report.subset.glyphs_after < report.subset.glyphs_before

    # Composite glyphs survive subsetting: Aacute (composite, reassembled by
    # Phase 3.5) must still be present and simple (not dropped, not still composite).
    for fmt, f in reloaded.items():
        if 'glyf' not in f:
            continue  # otf has no glyf table by design
        cmap = f.getBestCmap()
        aacute_name = cmap.get(ord('Á'))
        assert aacute_name is not None, f"{fmt}: composite glyph Á dropped by subsetting"
        assert f['glyf'][aacute_name].isComposite() is False, f"{fmt}: Á still composite after Phase 3.5 + subsetting"

    # Kerning (GPOS) survived subsetting in both ttf and otf.
    assert 'GPOS' in reloaded["ttf"]
    assert 'GPOS' in reloaded["otf"]

    # Coverage/structural report carried through, not rebuilt.
    assert report.structural is structural_report
    summary = report.summary()
    assert summary["structural_transforms_applied"]["glyphs_edited"]
    assert summary["structural_transforms_applied"]["composite_glyphs_reassembled"]
    assert summary["structural_transforms_applied"]["kerning"]["classes_used"]

    # No skipped/failed glyphs for this recipe -> not marked incomplete.
    assert report.incomplete is False


@pytest.mark.network
def test_export_surfaces_incomplete_when_glyphs_skipped():
    font, structural_report = _load_transformed_font()
    # Simulate an unresolved-component failure Phase 3.5 would report.
    structural_report.glyphs_skipped.append(("someglyph", "decompose_failed: missing component"))

    _outputs, report = export_font(font, "My Custom Serif", structural_report=structural_report)

    assert report.incomplete is True
    assert report.summary()["incomplete"] is True
    assert ("someglyph", "decompose_failed: missing component") in report.summary()["structural_transforms_applied"]["glyphs_skipped"]


@pytest.mark.network
def test_glyphs_skipped_chars_enriches_name_based_skip_list_with_real_characters():
    """
    Regression test for a real user report: Roboto's `post` table format
    3.0 carries no glyph names at all, so a browser-side check matching
    skipped glyphs by name (opentype.js's `glyph.name`) silently misfires —
    every glyph looked "not in font" since names came back undefined.
    `glyphs_skipped_chars` must give a codepoint-based alternative that
    doesn't depend on the post table having names.
    """
    resp = requests.get(ROBOTO_VARIABLE_URL, timeout=30)
    resp.raise_for_status()
    font = TTFont(BytesIO(freeze_to_static(resp.content)))

    assert font['post'].formatType == 3.0, "test fixture assumption broken: Roboto no longer ships post format 3.0"

    structural_report = apply_transform_recipe(font, RECIPE)
    assert structural_report.glyphs_skipped == [], "expected a clean transform for this assertion to be meaningful"

    # Force a skip entry the way Phase 3.5 would for a real failure, keyed
    # by a glyph name we know maps to a real character in this font.
    cmap = font.getBestCmap()
    h_glyph_name = cmap[ord('H')]
    structural_report.glyphs_skipped.append((h_glyph_name, "decompose_failed: forced for this test"))

    _outputs, report = export_font(font, "Curam Roboto Test", structural_report=structural_report)
    summary = report.summary()

    skipped_chars = summary["structural_transforms_applied"]["glyphs_skipped_chars"]
    assert any(entry["glyph"] == h_glyph_name and 'H' in entry["chars"] for entry in skipped_chars), (
        f"'H' should be recoverable from glyphs_skipped_chars even though post format 3.0 has no names: {skipped_chars}"
    )


def test_rename_blocks_case_insensitive_match():
    from ..export.rename import rename_for_ofl

    class FakeNameTable:
        def __init__(self):
            self._names = {1: "PT Serif"}

        def getDebugName(self, name_id):
            return self._names.get(name_id)

        def setName(self, *args, **kwargs):
            pass

    class FakeFont(dict):
        pass

    font = FakeFont()
    font['name'] = FakeNameTable()

    with pytest.raises(OFLComplianceError):
        rename_for_ofl(font, "pt serif")  # case-insensitive match to original — still blocked
