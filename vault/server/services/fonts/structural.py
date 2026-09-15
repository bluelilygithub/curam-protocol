"""
Phase 3 orchestrator: applies a Phase-2-shaped transform recipe to a set of
glyphs using real fontTools outline editing (transforms/), recalculates
sidebearings for every touched glyph, validates contour integrity, and
compiles GPOS class-kerning (kerning.py). Nothing here replicates Phase 2's
preview shortcuts — see transforms/glyph_edit.py and kerning.py docstrings.

Recipe shape (identical to what Phase 2's "Parametric Stylesheet" presets
save — only the technique differs, per spec):

    {
      "transforms": {
        "stemThickness": 0,      # -50..100 (%), + thickens / - thins, BOTH directions really offset the outline
        "proportionalWidth": 100, # 60..140 (%)
        "extendAscDesc": 0,       # -50..100 (%)
        "counterWidth": 0,        # -50..50 (%)
      },
      "kerning": {
        "enabledGroupIds": [...],
        "balance": 0,
        "advancedPairs": {"AV": -20, ...},
      },
    }
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .kerning import KerningBuildReport, apply_kerning_recipe
from .transforms import glyph_edit
from .transforms.sidebearings import capture_original_rsb, recalc_sidebearings_with_rsb
from .transforms.validate import ValidationIssue, validate_glyph_contours

# Default glyph target set: base Latin letters + digits, plus the common
# accented Latin-1/Latin Extended-A letters (café, résumé, naïve, ñoño) —
# most of these are composite glyphs in a typical Google Fonts TTF and are
# fully transformed (not skipped), see glyph_edit.py.
DEFAULT_GLYPH_CHARS = [chr(c) for c in range(ord('A'), ord('Z') + 1)] \
    + [chr(c) for c in range(ord('a'), ord('z') + 1)] \
    + [chr(c) for c in range(ord('0'), ord('9') + 1)] \
    + list('ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç')

NOMINAL_STEM_UNITS_FRACTION = 0.15  # of unitsPerEm, per 100% of the stemThickness control
# Recalibrated from 0.04: at the original value, stemThickness=15 (a
# realistic slider setting) offset each side of a stem by ~12 units out of
# a 2048 UPM em — well under a pixel at typical preview sizes (48-72px),
# so the control was technically real but visually undetectable. 0.15
# puts a 15% setting at ~46 units/side, ~1-2px at those sizes.
EXTEND_ASCDESC_BOOST = 3.0  # multiplies extendAscDesc's effective factor before warping
# extendAscDesc only stretches the small "overshoot" sliver of a glyph
# that already sits above cap-height (e.g. a lowercase ascender's natural
# overshoot, typically <100 units) — even a correctly-applied 27% stretch
# of an ~80-unit sliver is only ~22 units, sub-pixel on screen. Boosting
# the effective factor keeps the same UI slider range meaningful without
# changing what portion of the glyph is affected.


@dataclass
class StructuralEditReport:
    glyphs_edited: list[str] = field(default_factory=list)
    composite_glyphs_reassembled: list[str] = field(default_factory=list)  # subset of glyphs_edited that were composite
    glyphs_skipped: list[tuple[str, str]] = field(default_factory=list)  # (glyph_name, reason) — never silent
    validation_issues: list[ValidationIssue] = field(default_factory=list)
    kerning: KerningBuildReport | None = None


def transform_contours(contours, width_factor, baseline_y, cap_height_y, extend_factor, counter_percent, stem_delta_units):
    """The actual per-glyph transform pipeline, factored out so it can be
    called identically for a standalone glyph's contours and for one
    component's slice of a decomposed composite glyph's contours (tests
    use this to verify the two produce identical results)."""
    contours = glyph_edit.apply_proportional_width(contours, width_factor)
    contours = glyph_edit.apply_extend_ascender_descender(contours, baseline_y, cap_height_y, extend_factor)
    contours = glyph_edit.apply_counter_width(contours, counter_percent)
    contours = glyph_edit.apply_stem_thickness(contours, stem_delta_units)
    return contours


def _cap_height_units(font) -> float:
    if 'OS/2' in font:
        sCapHeight = getattr(font['OS/2'], 'sCapHeight', 0)
        if sCapHeight:
            return float(sCapHeight)
    return float(font['hhea'].ascender) * 0.7


def apply_transform_recipe(font, recipe: dict, glyph_names: list[str] | None = None) -> StructuralEditReport:
    """
    Mutates `font` in place. Returns a report of what was edited, skipped,
    or flagged by validation. Caller decides what to do with issues (e.g.
    reject the export, or accept with a warning) — this never silently
    drops a bad glyph without saying so.
    """
    transforms = recipe.get('transforms', {})
    kerning_recipe = recipe.get('kerning')

    stem_percent = transforms.get('stemThickness', 0)
    width_percent = transforms.get('proportionalWidth', 100)
    extend_percent = transforms.get('extendAscDesc', 0)
    counter_percent = transforms.get('counterWidth', 0)

    glyf = font['glyf']
    hmtx = font['hmtx']
    cmap = font.getBestCmap()
    upm = font['head'].unitsPerEm
    baseline_y = 0.0
    cap_height_y = _cap_height_units(font)

    stem_delta_units = (stem_percent / 100) * upm * NOMINAL_STEM_UNITS_FRACTION
    width_factor = width_percent / 100
    extend_factor = (extend_percent / 100) * EXTEND_ASCDESC_BOOST

    if glyph_names is None:
        glyph_names = [cmap[ord(ch)] for ch in DEFAULT_GLYPH_CHARS if ord(ch) in cmap]

    report = StructuralEditReport()

    no_op = stem_delta_units == 0 and width_factor == 1.0 and extend_factor == 0 and counter_percent == 0
    if not no_op:
        for glyph_name in glyph_names:
            if glyph_name not in glyf.keys():
                report.glyphs_skipped.append((glyph_name, 'not_in_font'))
                continue

            glyph = glyf[glyph_name]
            was_composite = glyph_edit.is_composite(glyph)

            try:
                original_contours = glyph_edit.get_glyph_contours(glyph, glyf)
            except Exception as exc:  # e.g. a component referencing a missing glyph name
                report.glyphs_skipped.append((glyph_name, f'decompose_failed: {exc}'))
                continue

            if original_contours is None:
                report.glyphs_skipped.append((glyph_name, 'empty_glyph'))
                continue

            original_rsb = capture_original_rsb(font, glyph_name)

            contours = transform_contours(
                original_contours, width_factor, baseline_y, cap_height_y, extend_factor, counter_percent, stem_delta_units
            )

            issues = validate_glyph_contours(glyph_name, original_contours, contours)
            report.validation_issues.extend(issues)

            glyph_edit.set_glyph_contours(glyph, glyf, contours)
            recalc_sidebearings_with_rsb(font, glyph_name, original_rsb)
            report.glyphs_edited.append(glyph_name)
            if was_composite:
                report.composite_glyphs_reassembled.append(glyph_name)

    if kerning_recipe:
        report.kerning = apply_kerning_recipe(font, kerning_recipe)

    return report
