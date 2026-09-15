"""
Best-effort TrueType (glyf, quadratic) -> OpenType-CFF (.otf, cubic)
conversion, so the same customized font can ship as .otf alongside the
native .ttf/.woff2. Every font this pipeline touches originates as a
Google Fonts TTF, so producing a genuine (not renamed-in-place) .otf means
actually converting the outlines, not relabeling a .ttf.

Approach (the standard fontTools-ecosystem technique, same idea used by
tools like `fonttools ttf2otf` snippets): draw each glyph's quadratic
outline through `Qu2CuPen`, which forwards cubic curves to a
`T2CharStringPen`, and assemble a `CFF ` table via `FontBuilder.setupCFF`.
cmap/hmtx/hhea/name/OS2/post are re-derived from the source TTFont's own
values; GPOS/GDEF (our Phase 3 kerning) are copied over directly since
glyph names/order are identical between the two.

Documented limitation: this re-derives the "important" OS/2/post/hhea
fields rather than exhaustively mapping every one — a handful of rarely-
used metadata fields may fall back to FontBuilder's defaults rather than
the source font's exact original value. Not a silent gap: noted here and
in the export report's `otf_conversion_notes`.
"""

from __future__ import annotations

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.qu2cuPen import Qu2CuPen
from fontTools.pens.t2CharStringPen import T2CharStringPen


def _name_strings_from(font) -> dict:
    n = font['name']
    return {
        'copyright': n.getDebugName(0) or '',
        'familyName': n.getDebugName(1) or 'CustomFont',
        'styleName': n.getDebugName(2) or 'Regular',
        'uniqueFontIdentifier': n.getDebugName(3) or (n.getDebugName(1) or 'CustomFont'),
        'fullName': n.getDebugName(4) or (n.getDebugName(1) or 'CustomFont'),
        'version': n.getDebugName(5) or 'Version 1.0',
        'psName': n.getDebugName(6) or 'CustomFont',
        'trademark': n.getDebugName(7) or '',
    }


def convert_ttf_to_otf(font):
    """
    Returns a NEW TTFont with 'CFF ' outlines instead of 'glyf'/'loca'.
    Does not mutate the input font (the caller keeps using the original
    for .ttf/.woff2 output).
    """
    if 'CFF ' in font:
        return font  # already CFF-flavored — shouldn't happen from this pipeline, but a safe no-op

    glyph_order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    hmtx = font['hmtx']

    charstrings = {}
    for name in glyph_order:
        width, _lsb = hmtx[name]
        t2_pen = T2CharStringPen(width, glyph_set)
        conv_pen = Qu2CuPen(t2_pen, max_err=1.0, all_cubic=True)
        glyph_set[name].draw(conv_pen)
        charstrings[name] = t2_pen.getCharString()

    upm = font['head'].unitsPerEm
    fb = FontBuilder(upm, isTTF=False)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(font.getBestCmap())

    names = _name_strings_from(font)
    fb.setupCFF(
        names['psName'],
        {'FullName': names['fullName'], 'FamilyName': names['familyName'], 'Weight': names['styleName']},
        charstrings,
        {},
    )
    fb.setupNameTable(names)

    hmtx_dict = {name: hmtx[name] for name in glyph_order}
    fb.setupHorizontalMetrics(hmtx_dict)

    hhea = font['hhea']
    fb.setupHorizontalHeader(ascent=hhea.ascender, descent=hhea.descender, lineGap=hhea.lineGap)

    if 'OS/2' in font:
        os2 = font['OS/2']
        fb.setupOS2(
            sTypoAscender=getattr(os2, 'sTypoAscender', hhea.ascender),
            sTypoDescender=getattr(os2, 'sTypoDescender', hhea.descender),
            sTypoLineGap=getattr(os2, 'sTypoLineGap', hhea.lineGap),
            usWinAscent=getattr(os2, 'usWinAscent', hhea.ascender),
            usWinDescent=getattr(os2, 'usWinDescent', abs(hhea.descender)),
            sxHeight=getattr(os2, 'sxHeight', 0),
            sCapHeight=getattr(os2, 'sCapHeight', 0),
            achVendID=getattr(os2, 'achVendID', 'NONE'),
        )
    else:
        fb.setupOS2()

    fb.setupPost()

    # Carry over Phase 3's compiled kerning (and any GDEF) unchanged —
    # glyph names/order match exactly, so these tables remain valid.
    for tag in ('GDEF', 'GPOS', 'GSUB'):
        if tag in font:
            fb.font[tag] = font[tag]

    return fb.font
