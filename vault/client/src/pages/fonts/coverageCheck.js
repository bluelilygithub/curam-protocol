/**
 * Cross-references preview/output text against Phase 4's export coverage
 * report (ExportReport.summary()) so a designer never silently gets a
 * .notdef box or an invisible system-font substitution for a character
 * that was actually skipped/failed during export.
 *
 * Reading the exported font's cmap here (via opentype.js) is metadata
 * inspection only, not rendering — the visual preview itself always uses
 * the real @font-face, per spec. Takes the already-parsed `Font` object
 * (the same one FontEffectsPanel loaded for the live preview / SVG
 * export) rather than re-parsing the bytes a second time — one source of
 * truth, so this check can never disagree with what's actually rendered.
 *
 * Matches by Unicode codepoint, never by glyph name: many production
 * webfonts (this one included, found via a real user report on Roboto)
 * ship a `post` table format with no glyph names baked into the binary at
 * all (a standard size optimization) — opentype.js then reports
 * `glyph.name` as `undefined` for every glyph, which would misclassify
 * every real, present glyph as missing if this checked names. Glyph
 * *existence* is checked via `glyph.index` (0 is always `.notdef` per the
 * OpenType spec, regardless of post table format); the *skipped-at-export*
 * cross-reference uses `glyphs_skipped_chars` (server/services/fonts/
 * export/pipeline.py's `ExportReport.summary()`), which carries the
 * actual character(s) alongside each skip, not just a glyph name.
 */

/**
 * @param {import('opentype.js').Font | null} font - already-parsed exported font
 * @param {object} coverageReport - ExportReport.summary() JSON
 * @param {string} text - the designer's preview/output text
 * @returns {{ char: string, reason: 'skipped_at_export' | 'not_in_font', detail?: string }[]}
 */
export function findUncoveredChars(font, coverageReport, text) {
  if (!font) return []; // no font loaded yet — caller is already showing that state separately

  const skippedCharReason = new Map();
  for (const entry of coverageReport?.structural_transforms_applied?.glyphs_skipped_chars || []) {
    for (const ch of entry.chars || []) {
      skippedCharReason.set(ch, entry.reason);
    }
  }

  const issues = [];
  const seen = new Set();
  for (const ch of Array.from(text)) {
    if (seen.has(ch) || ch.trim() === '') continue;
    seen.add(ch);

    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.index === 0) {
      issues.push({ char: ch, reason: 'not_in_font' });
      continue;
    }
    if (skippedCharReason.has(ch)) {
      issues.push({ char: ch, reason: 'skipped_at_export', detail: skippedCharReason.get(ch) });
    }
  }
  return issues;
}
