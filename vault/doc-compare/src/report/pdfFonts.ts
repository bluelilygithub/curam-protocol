import { jsPDF } from 'jspdf';
import coverage from './fonts/coverage.json';

/**
 * Unicode fonts for the exported PDFs (jsPDF's built-in Helvetica is Latin-1 only). Liberation Sans has Helvetica's metrics, so line breaks
 * and the look stay as they were; Droid Sans Fallback covers Chinese, Japanese and Korean. Both are bundled (src/report/fonts, licences
 * beside them) and loaded as lazy chunks of the app itself, never from another site; the CJK font only when the text needs it.
 * The pdf's text calls are wrapped so each run of characters Liberation lacks is drawn in the fallback font: existing setFont('helvetica')
 * calls, splitTextToSize and jspdf-autotable all work unchanged.
 */

const SANS = 'DCSans', CJK = 'DCFallback';
const ranges = coverage as [number, number][];
const inSans = (cp: number) => {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cp < ranges[m][0]) hi = m - 1; else if (cp > ranges[m][1]) lo = m + 1; else return true; }
  return cp < 0x20; // tabs and newlines
};
/** True when some character of the text needs the fallback font. */
export const needsFallback = (s: string) => { for (const ch of s) if (!inSans(ch.codePointAt(0)!)) return true; return false; };
const CJK_CHAR = '[\\u2E80-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFF00-\\uFFEF]';
const MARK = '\uFEFF'; // a CJK line-break point; JavaScript's \s matches it, so word splitting (ours and jspdf-autotable's) breaks there
const BREAK = /\uFEFF/g;
const CJK_PAIR = new RegExp(`(${CJK_CHAR})(?=${CJK_CHAR})`, 'g');
const WORD = new RegExp(`\\s+|${CJK_CHAR}|[^\\s${CJK_CHAR.slice(1, -1)}]+`, 'g');
/** Words, runs of spaces, and each CJK character on its own (CJK text can break between any two characters). */
export const words = (s: string) => s.match(WORD) ?? [];
const runs = (s: string) => {
  const out: { text: string; cjk: boolean }[] = [];
  for (const ch of s) {
    const cjk = !inSans(ch.codePointAt(0)!);
    if (out.length && out[out.length - 1].cjk === cjk) out[out.length - 1].text += ch; else out.push({ text: ch, cjk });
  }
  return out;
};

const base64 = (m: { default: string }) => m.default.slice(m.default.indexOf(',') + 1);
let sansFonts: Promise<string[]> | undefined;
let cjkFont: Promise<string> | undefined;
const loadSans = () => (sansFonts ??= Promise.all([
  import('./fonts/LiberationSans-Regular.ttf?inline'), import('./fonts/LiberationSans-Bold.ttf?inline'), import('./fonts/LiberationSans-Italic.ttf?inline'),
]).then((m) => m.map(base64)));
const loadCjk = () => (cjkFont ??= import('./fonts/DroidSansFallback.ttf?inline').then(base64));

/** A new A4 pdf with the Unicode fonts; `sample` is all the text that may be printed, to decide whether the CJK font is needed. */
export async function newPdf(sample: string): Promise<jsPDF> {
  const [sans, cjk] = await Promise.all([loadSans(), needsFallback(sample) ? loadCjk() : undefined]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  (['normal', 'bold', 'italic'] as const).forEach((style, i) => { doc.addFileToVFS(`${SANS}-${style}.ttf`, sans[i]); doc.addFont(`${SANS}-${style}.ttf`, SANS, style); });
  if (cjk) { doc.addFileToVFS(`${CJK}.ttf`, cjk); doc.addFont(`${CJK}.ttf`, CJK, 'normal'); }

  const d = doc as unknown as Record<string, (...a: never[]) => unknown>;
  const orig = { setFont: doc.setFont.bind(doc), text: doc.text.bind(doc), unitWidth: doc.getStringUnitWidth.bind(doc), split: doc.splitTextToSize.bind(doc) };
  const sizeK = () => doc.getFontSize() / doc.internal.scaleFactor;
  // run in the fallback font, then back to the current one (the CJK font has one weight)
  const inCjk = <T>(fn: () => T): T => { const f = doc.getFont(); orig.setFont(CJK, 'normal'); try { return fn(); } finally { orig.setFont(f.fontName, f.fontStyle); } };
  const unitWidth = (s: string) => runs(s.replace(BREAK, '')).reduce((w, r) => w + (r.cjk && cjk ? inCjk(() => orig.unitWidth(r.text)) : orig.unitWidth(r.text)), 0);
  // jspdf-autotable sizes columns by the widest space-separated word, and CJK text has no spaces: mark a break between CJK characters
  // (an invisible character autotable splits on; the text and width calls below drop it). A document default, so it runs for every table.
  (doc as unknown as { __autoTableDocumentDefaults: object }).__autoTableDocumentDefaults = {
    didParseCell: (h: { cell: { text: string[] } }) => { h.cell.text = h.cell.text.map((l) => l.replace(CJK_PAIR, `$1${MARK}`)); },
  };

  d.setFont = ((name: string, style?: string, weight?: string | number) => orig.setFont(name === 'helvetica' ? SANS : name, style, weight)) as never;
  d.getStringUnitWidth = ((s: string, o?: object) => (cjk && needsFallback(s) ? unitWidth(s) : orig.unitWidth(s, o))) as never;
  const split = (s: string | string[], max: number, o?: { fontSize?: number }): string[] => {
    if (Array.isArray(s)) return s.flatMap((l) => split(l, max, o)); // jspdf-autotable passes a cell's lines
    if (!cjk || !needsFallback(s)) return orig.split(s, max, o);
    const k = (o?.fontSize ?? doc.getFontSize()) / doc.internal.scaleFactor;
    const out: string[] = [];
    for (const para of s.split(/\r\n|\r|\n/)) {
      let line = '';
      // words, spaces, and each CJK character on its own (CJK text breaks between any two characters)
      for (const tok of words(para)) {
        if (unitWidth(line + tok) * k <= max || !line.trim()) { line += tok; continue; }
        out.push(line.trimEnd()); line = tok.trimStart();
      }
      out.push(line);
    }
    return out;
  };
  d.splitTextToSize = split as never;
  d.text = ((text: string | string[], x: number, y: number, opts?: { align?: string; baseline?: string; angle?: number }, ...rest: never[]) => {
    const lines = (Array.isArray(text) ? text : [text]).map((l) => l.replace(BREAK, ''));
    if (!cjk || !lines.some(needsFallback)) return orig.text(Array.isArray(text) ? lines : lines[0], x, y, opts as never, ...rest);
    const lh = sizeK() * doc.getLineHeightFactor();
    lines.forEach((line, i) => {
      const w = unitWidth(line) * sizeK();
      let x0 = opts?.align === 'right' ? x - w : opts?.align === 'center' ? x - w / 2 : x;
      for (const r of runs(line)) {
        const draw = () => { orig.text(r.text, x0, y + i * lh, { baseline: opts?.baseline } as never); x0 += orig.unitWidth(r.text) * sizeK(); };
        if (r.cjk) inCjk(draw); else draw();
      }
    });
    return doc;
  }) as never;

  doc.setFont(SANS, 'normal');
  return doc;
}
