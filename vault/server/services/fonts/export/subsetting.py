"""
Subset the font to a specified character set via fontTools.subset —
deliberately a thin wrapper, not a reimplementation. `Subsetter.populate()`
+ `.subset()` resolve which glyphs to keep by walking cmap -> glyph ->
(for composites) component references using fontTools' own glyf-aware
closure algorithm. That's the audit point the brief calls out: nothing in
this module (or anywhere else in the export path) filters glyphs by
`numberOfContours`, which is exactly the kind of assumption that broke
composite-glyph sidebearing recalculation before (see transforms/
sidebearings.py's fix in the Phase 3.5 commit) — subsetting delegates
glyph selection entirely to the library, so a composite's base + mark
components are always pulled in together correctly.
"""

from __future__ import annotations

from dataclasses import dataclass

from fontTools import subset

UNICODE_RANGES = {
    'basic-latin': (0x0020, 0x007E),
    'latin-1-supplement': (0x00A0, 0x00FF),
    'latin-extended-a': (0x0100, 0x017F),
}

DEFAULT_RANGE_IDS = ('basic-latin',)


@dataclass
class SubsetReport:
    range_ids: list[str]
    codepoints_requested: int
    glyphs_before: int
    glyphs_after: int


def build_unicode_set(range_ids) -> set[int]:
    codepoints: set[int] = set()
    for rid in range_ids:
        bounds = UNICODE_RANGES.get(rid)
        if not bounds:
            continue
        lo, hi = bounds
        codepoints.update(range(lo, hi + 1))
    return codepoints


def subset_font(font, range_ids=DEFAULT_RANGE_IDS) -> SubsetReport:
    glyphs_before = len(font.getGlyphOrder())
    unicodes = build_unicode_set(range_ids)

    options = subset.Options()
    options.name_IDs = ['*']       # keep the name records rename.py curated
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    options.layout_features = ['*']  # keep the GPOS "kern" feature compiled in Phase 3
    options.glyph_names = True

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    return SubsetReport(
        range_ids=list(range_ids),
        codepoints_requested=len(unicodes),
        glyphs_before=glyphs_before,
        glyphs_after=len(font.getGlyphOrder()),
    )
