// PDF → HTML, browser side: how a page is cut into slices for the model, and its text put into reading order per slice.
// Pure functions (no DOM, no pdfjs) so they can be tested with node:   node client/src/pages/pdf/pdfToHtmlLayout.test.mjs
//
// Why: a website mock-up exported as ONE tall PDF page (612 × 4535 pt) was sent as one picture and shrunk to about 210 px wide, so the
// model could read nothing; and the PDF's text came out of order (headings at the end, two rows of an org chart on one line).

export const MAX_SLICES = 14; // matches server/services/pdfToHtml.js
export const RENDER_WIDTH = 1400; // px a page is rendered at
export const SLICE_OVERLAP = 40; // px each slice repeats from the next one, so nothing is cut in half at a seam
const TALL = 1.6; // a page taller than 1.6 × its width is cut into slices (A4 portrait is 1.41, so normal pages stay whole)
const MAX_CANVAS_HEIGHT = 16000; // stay well inside browsers' canvas limits

/** The render scale for a page of base size w × h (PDF points): about RENDER_WIDTH px wide, never taller than the canvas limit. */
export function renderScale(w, h) {
  return Math.max(0.1, Math.min(2.5, RENDER_WIDTH / w, MAX_CANVAS_HEIGHT / h));
}

/**
 * Cut a rendered page (width × height px) into slices, top to bottom. `budget` = slices this page may use.
 * @returns {{ top: number, bottom: number }[]} content bands that do not overlap (the overlap is added when the slice is drawn)
 */
export function planSlices(width, height, budget = MAX_SLICES) {
  const max = Math.max(1, Math.floor(budget));
  if (height <= width * TALL || max === 1) return [{ top: 0, bottom: height }];
  let n = Math.ceil(height / width); // square-ish slices, about RENDER_WIDTH × RENDER_WIDTH
  if (n > max) n = max;
  const step = Math.ceil(height / n);
  const out = [];
  for (let top = 0; top < height; top += step) out.push({ top, bottom: Math.min(height, top + step) });
  return out;
}

/** Slices left for each page so every remaining page still gets at least one. */
export function sliceBudget(used, pagesLeft) {
  return Math.max(1, MAX_SLICES - used - Math.max(0, pagesLeft - 1));
}

/**
 * Text items in canvas pixels (top-left origin) → lines in reading position, top to bottom.
 * items: [{ str, x, y (baseline), w, h (font height) }]. Items on one baseline join into one line, left to right; a wide gap between
 * them (side-by-side columns or boxes) becomes " │ " so two columns are not read as one sentence.
 * @returns {{ y: number, text: string }[]}
 */
export function textLines(items) {
  const clean = (items || []).filter((it) => it && String(it.str || '').trim() !== '' && Number.isFinite(it.x) && Number.isFinite(it.y))
    .map((it) => ({ str: String(it.str), x: it.x, y: it.y, w: Math.max(0, Number(it.w) || 0), h: Math.max(1, Number(it.h) || 10) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of clean) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * 0.45));
    if (line) { line.items.push(it); line.h = Math.max(line.h, it.h); } else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  return lines.sort((a, b) => a.y - b.y).map((l) => {
    const parts = l.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const p of parts) {
      if (end !== null) {
        const gap = p.x - end;
        if (gap > l.h * 2.5) text += ' │ ';
        else if (gap > l.h * 0.12 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' ';
      }
      text += p.str;
      end = p.x + p.w;
    }
    return { y: l.y, text: text.replace(/\s+/g, ' ').replace(/ │ $/, '').trim() };
  }).filter((l) => l.text);
}

/** Lines → one text block per slice (a line belongs to the slice its baseline falls in). */
export function linesPerSlice(lines, slices) {
  return slices.map((s, i) => lines
    .filter((l) => l.y >= s.top && (l.y < s.bottom || (i === slices.length - 1 && l.y <= s.bottom + 4)))
    .map((l) => l.text).join('\n'));
}
