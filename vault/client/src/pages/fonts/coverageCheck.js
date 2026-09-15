/**
 * Cross-references preview/output text against Phase 4's export coverage
 * report (ExportReport.summary()) so a designer never silently gets a
 * .notdef box or an invisible system-font substitution for a character
 * that was actually skipped/failed during export.
 *
 * Reading the exported font's cmap here (via opentype.js) is metadata
 * inspection only, not rendering — the visual preview itself always uses
 * the real @font-face, per spec.
 */
import * as opentype from 'opentype.js';

/**
 * @param {ArrayBuffer} fontBuffer - the exported .woff2/.ttf/.otf bytes
 * @param {object} coverageReport - ExportReport.summary() JSON
 * @param {string} text - the designer's preview/output text
 * @returns {{ char: string, reason: 'skipped_at_export' | 'not_in_font', detail?: string }[]}
 */
export function findUncoveredChars(fontBuffer, coverageReport, text) {
  let font;
  try {
    font = opentype.parse(fontBuffer);
  } catch {
    return []; // can't inspect — caller should already be surfacing a load error separately
  }

  const skippedByReason = new Map(
    (coverageReport?.structural_transforms_applied?.glyphs_skipped || []).map(([name, reason]) => [name, reason])
  );

  const issues = [];
  const seen = new Set();
  for (const ch of Array.from(text)) {
    if (seen.has(ch) || ch.trim() === '') continue;
    seen.add(ch);

    const glyph = font.charToGlyph(ch);
    const glyphName = glyph?.name;

    if (!glyph || !glyphName || glyphName === '.notdef') {
      issues.push({ char: ch, reason: 'not_in_font' });
      continue;
    }
    if (skippedByReason.has(glyphName)) {
      issues.push({ char: ch, reason: 'skipped_at_export', detail: skippedByReason.get(glyphName) });
    }
  }
  return issues;
}
