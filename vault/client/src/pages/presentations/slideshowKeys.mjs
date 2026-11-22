// The full-screen slideshow's logic, kept out of the component so it can be tested in node:
//   node client/src/pages/presentations/slideshowKeys.test.mjs
// Keys work like PowerPoint's slide show: → Space PageDown Enter next, ← Backspace PageUp back, Home End, a number then Enter jumps,
// Escape leaves.

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'n', 'N']);
const PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P']);

export const clampSlide = (index, count) => Math.max(0, Math.min(Math.max(count - 1, 0), Number(index) || 0));

/**
 * One key press → { index, digits, exit }. `digits` is what has been typed towards a jump ("12" then Enter goes to slide 12).
 * Unknown keys change nothing.
 */
export function keyStep(key, { index, count, digits = '' }) {
  if (/^[0-9]$/.test(key)) return { index, digits: (digits + key).slice(-3), exit: false };
  if (key === 'Enter' && digits) return { index: clampSlide(Number(digits) - 1, count), digits: '', exit: false };
  if (key === 'Escape') return { index, digits: '', exit: true };
  if (NEXT.has(key) || key === 'Enter') return { index: clampSlide(index + 1, count), digits: '', exit: false };
  if (PREV.has(key)) return { index: clampSlide(index - 1, count), digits: '', exit: false };
  if (key === 'Home') return { index: 0, digits: '', exit: false };
  if (key === 'End') return { index: clampSlide(count - 1, count), digits: '', exit: false };
  return { index, digits, exit: false };
}

/** The scale that fits a slide of w×h inside a box of boxW×boxH without cropping. */
export const fitScale = (w, h, boxW, boxH) => (w > 0 && h > 0 ? Math.max(0.05, Math.min(boxW / w, boxH / h)) : 1);

/**
 * Split the renderer's HTML (render.js: one <style>, one <section class="slide …"> per slide) into a standalone page per slide,
 * so the show can put each slide in its own frame and animate between them. `parse` is DOMParser in the browser.
 */
export function slidePages(html, parse) {
  const doc = parse(String(html || ''));
  const style = Array.from(doc.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const extra = 'html,body{margin:0;overflow:hidden;background:transparent}.slide{break-after:auto;page-break-after:auto}';
  return Array.from(doc.querySelectorAll('section.slide')).map((section) => (
    `<!doctype html><html><head><meta charset="utf-8"><style>${style}\n${extra}</style></head><body>${section.outerHTML}</body></html>`
  ));
}
