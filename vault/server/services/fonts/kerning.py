"""
Real GPOS class-kerning, compiled via fontTools.feaLib — not a pass-through
of Phase 2's curated preview pair list. Phase 2's UI groups (diagonal caps,
cap-before-round-lowercase, etc.) exist here too, but each is backed by an
actual OpenType glyph class with real membership (including diacritic
variants present in the font), compiled into `PairPos` class rules.

Accepts the same recipe shape Phase 2 saves as a "Parametric Stylesheet"
kerning block: `{ enabledGroupIds: [...], balance: number, advancedPairs:
{ "AV": number, ... } }`. Advanced pair values are treated as design units
scaled to a nominal 1000-UPM font (i.e. multiplied by unitsPerEm/1000 for
the actual font) — see server/services/fonts/README.md for why this
assumption exists and its limitation.
"""

from __future__ import annotations

from dataclasses import dataclass

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

# Real glyph-class membership (by character) per semantic group. Mirrors
# Phase 2's group intent, but as OpenType classes, not literal pair strings.
KERNING_CLASSES = {
    'diagonal-caps': {
        'left': ['A', 'Á', 'À', 'Â', 'Ä', 'Ã', 'Å'],
        'right': ['V', 'W', 'Y', 'T'],
        'multiplier': 1.0,
    },
    'cap-round-lower': {
        'left': ['T', 'F', 'P'],
        'right': ['o', 'ó', 'ò', 'ô', 'ö', 'õ', 'e', 'é', 'è', 'ê', 'ë', 'a', 'á', 'à', 'â', 'ä', 'ã', 'c', 'ç'],
        'multiplier': 0.8,
    },
    'round-pairs': {
        'left': ['o', 'e', 'c', 'a'],
        'right': ['o', 'e', 'c', 'a'],
        'multiplier': 0.6,
    },
    'punctuation': {
        'left': ['A', 'V', 'W', 'Y'],
        'right': ['comma', 'period', 'quotedbl', 'quotesingle'],
        'multiplier': 1.0,
    },
}

BASE_KERN_UNITS_PER_1000UPM = 24


@dataclass
class KerningBuildReport:
    classes_used: list[str]
    class_rules_written: int
    pair_rules_written: int
    skipped_missing_glyphs: list[str]


def _char_to_glyph_name(cmap: dict, char_or_name: str) -> str | None:
    """Resolve either a literal character or a glyph name (e.g. 'comma') to a glyph name present in the font."""
    if len(char_or_name) == 1:
        return cmap.get(ord(char_or_name))
    return char_or_name  # already a glyph name (e.g. punctuation entries above)


def build_kern_feature_source(font, enabled_group_ids: list[str], balance: float, advanced_pairs: dict[str, float]) -> tuple[str, KerningBuildReport]:
    cmap = font.getBestCmap()
    upm = font['head'].unitsPerEm
    skipped = []
    lines = []

    # 1. Specific-pair overrides FIRST — within one feaLib feature block,
    #    a specific (format1) pair match takes precedence over a class
    #    (format2) rule for the same glyph pair, which is exactly the
    #    "layered on top of class rules" override behavior required.
    pair_rules_written = 0
    for pair, value in (advanced_pairs or {}).items():
        if len(pair) != 2:
            skipped.append(pair)
            continue
        left_name = cmap.get(ord(pair[0]))
        right_name = cmap.get(ord(pair[1]))
        if not left_name or not right_name:
            skipped.append(pair)
            continue
        units = round(value * (upm / 1000))
        lines.append(f"    pos {left_name} {right_name} {units};")
        pair_rules_written += 1

    # 2. Class-based group rules.
    classes_used = []
    class_rules_written = 0
    class_defs = []
    for group_id in enabled_group_ids:
        group = KERNING_CLASSES.get(group_id)
        if not group:
            continue
        left_glyphs = [g for g in (_char_to_glyph_name(cmap, c) for c in group['left']) if g]
        right_glyphs = [g for g in (_char_to_glyph_name(cmap, c) for c in group['right']) if g]
        if not left_glyphs or not right_glyphs:
            continue

        left_class = f"@{group_id.replace('-', '_')}_L"
        right_class = f"@{group_id.replace('-', '_')}_R"
        class_defs.append(f"    {left_class} = [{' '.join(left_glyphs)}];")
        class_defs.append(f"    {right_class} = [{' '.join(right_glyphs)}];")

        units = round((balance / 100) * (BASE_KERN_UNITS_PER_1000UPM / 1000) * upm * group['multiplier'])
        lines.append(f"    pos {left_class} {right_class} {units};")
        classes_used.append(group_id)
        class_rules_written += 1

    body = "\n".join(class_defs + lines)
    fea = f"feature kern {{\n{body}\n}} kern;\n" if body.strip() else ""

    return fea, KerningBuildReport(
        classes_used=classes_used,
        class_rules_written=class_rules_written,
        pair_rules_written=pair_rules_written,
        skipped_missing_glyphs=skipped,
    )


def apply_kerning_recipe(font, kerning_recipe: dict) -> KerningBuildReport:
    """
    Compiles GPOS kerning into `font` in place from a Phase-2-shaped
    recipe: { enabledGroupIds, balance, advancedPairs }. No-op (returns an
    empty report) if there's nothing to write.
    """
    enabled_group_ids = kerning_recipe.get('enabledGroupIds', [])
    balance = kerning_recipe.get('balance', 0)
    advanced_pairs = kerning_recipe.get('advancedPairs', {})

    fea, report = build_kern_feature_source(font, enabled_group_ids, balance, advanced_pairs)
    if fea:
        addOpenTypeFeaturesFromString(font, fea)
    return report
