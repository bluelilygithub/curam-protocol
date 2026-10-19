// Accessibility checks for the CSS tool, run on the preview while editing: can the text be read against its background, do pictures have
// a description, is any text tiny. The maths is the WCAG 2 contrast ratio. Tested in server/services/restyle/restyleEdits.test.js.

/** Parses a computed colour (rgb()/rgba(), #hex, transparent) into { r, g, b, a }, or null. */
export function parseColor(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A colour with transparency laid over an opaque one. */
export function over(fg, bg) {
  const a = fg.a;
  return { r: Math.round(fg.r * a + bg.r * (1 - a)), g: Math.round(fg.g * a + bg.g * (1 - a)), b: Math.round(fg.b * a + bg.b * (1 - a)), a: 1 };
}

export const toHexString = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** What is behind an element: the first opaque background going up, with any see-through ones laid over it. White if nothing sets one. */
export function effectiveBackground(el, win) {
  const layers = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const c = parseColor(win.getComputedStyle(node).backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  let base = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i -= 1) base = layers[i].a >= 1 ? layers[i] : over(layers[i], base);
  return base;
}

/** WCAG's "large text": 24px and over, or 18.66px and over when bold. Large text needs 3:1, other text 4.5:1. */
export const isLargeText = (sizePx, weight) => sizePx >= 24 || (sizePx >= 18.66 && Number(weight) >= 700);

/**
 * Contrast of an element's text against what is behind it.
 * @returns {{ratio:number, required:number, passes:boolean, large:boolean, fg:string, bg:string} | null}  null when the colours cannot be read
 */
export function checkTextContrast(el, win) {
  const cs = win.getComputedStyle(el);
  const fgRaw = parseColor(cs.color);
  if (!fgRaw) return null;
  const bg = effectiveBackground(el, win);
  const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
  const size = parseFloat(cs.fontSize) || 16;
  const large = isLargeText(size, cs.fontWeight === 'bold' ? 700 : cs.fontWeight);
  const required = large ? 3 : 4.5;
  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
  return { ratio, required, passes: ratio >= required, large, fg: toHexString(fg), bg: toHexString(bg) };
}

const hasOwnText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
const snippet = (el) => {
  const t = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
};

const MAX_ELEMENTS = 4000;
const MAX_ISSUES = 100;
const SMALL_TEXT_PX = 12;
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'head', 'title', 'meta', 'link', 'template']);

/**
 * Looks over a whole page. Issues are { kind: 'contrast' | 'alt' | 'small', el, message }, in page order, at most 100.
 * @returns {{ issues: Array, checked: number }}
 */
export function scanDocument(doc) {
  const win = doc.defaultView;
  const issues = [];
  let checked = 0;
  const all = Array.from(doc.body ? doc.body.querySelectorAll('*') : []).slice(0, MAX_ELEMENTS);
  for (const el of all) {
    if (issues.length >= MAX_ISSUES) break;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'img' && !el.hasAttribute('alt')) {
      issues.push({ kind: 'alt', el, message: 'A picture has no description (alt text), so a screen reader cannot tell what it shows.' });
      continue;
    }
    if (!hasOwnText(el)) continue;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    checked += 1;
    const result = checkTextContrast(el, win);
    if (result && !result.passes) {
      issues.push({ kind: 'contrast', el, message: `“${snippet(el)}” is hard to read: contrast ${result.ratio} to 1, it needs ${result.required} to 1.` });
    }
    const size = parseFloat(cs.fontSize);
    if (size && size < SMALL_TEXT_PX) issues.push({ kind: 'small', el, message: `“${snippet(el)}” is very small (${Math.round(size * 10) / 10}px).` });
  }
  return { issues: issues.slice(0, MAX_ISSUES), checked };
}
