// To-scale PDF drawing shared by Room Planner's plan sheet and Garden Planner's planting plan. A plan is first built as plain drawing primitives
// (lines, polygons, circles, text: pure, so tests check them directly), and this turns primitives into PDF with pdf-lib (MIT). Moved here from
// room-planner/src/schedule/{plan,pdf}.ts so the two cannot drift apart.
import { degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Vec2 } from '../types';

export type Rgb = [number, number, number];
export type Prim =
  | { t: 'poly'; pts: Vec2[]; fill?: Rgb; stroke?: Rgb; width?: number; dash?: number[]; closed?: boolean; /** 0-1 for the fill (and outline); default opaque. */ opacity?: number }
  | { t: 'line'; a: Vec2; b: Vec2; width: number; color: Rgb; dash?: number[] }
  | { t: 'text'; x: number; y: number; size: number; text: string; anchor: 'left' | 'centre' | 'right'; color: Rgb; bold?: boolean; italic?: boolean; rotate?: number }
  | { t: 'circle'; x: number; y: number; r: number; fill?: Rgb; stroke?: Rgb; width?: number; opacity?: number };

/** Page sizes in points (1/72 inch). */
export const A4 = { w: 595.28, h: 841.89 };
export const A3 = { w: 841.89, h: 1190.55 };
export const PT_PER_MM = 72 / 25.4;
/** Standard drawing scales, 1:n. */
export const DENOMS = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];

/** The biggest standard scale (1:50, 1:100 …) at which `w × h` metres fits in `fitW × fitH` points; the page is then chosen to suit. */
export function chooseScale(w: number, h: number, fitW: number, fitH: number): { denom: number; k: number } {
  for (const denom of DENOMS) {
    const k = (1000 / denom) * PT_PER_MM;
    if (w * k <= fitW && h * k <= fitH) return { denom, k };
  }
  const denom = DENOMS[DENOMS.length - 1];
  return { denom, k: (1000 / denom) * PT_PER_MM };
}

export const col = (c: Rgb) => rgb(c[0], c[1], c[2]);

/** Text the standard PDF fonts can draw: Latin letters and common punctuation; anything else becomes "?". */
export function winAnsi(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-')
    .replace(/[^ -~ -ÿ]/g, '?');
}

/** One line of text cut with "..." to fit `maxWidth`. */
export function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const t = winAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

/** Text broken into lines that each fit `maxWidth` (at word breaks; a single word wider than the width is cut). */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = font.widthOfTextAtSize(w, size) <= maxWidth ? w : fit(font, w, size, maxWidth);
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface Drawable { prims: Prim[] }

/** Draw primitives on a page: PDF points, y up. */
export function drawPrims(page: PDFPage, sheet: Drawable, regular: PDFFont, bold: PDFFont, italic?: PDFFont): void {
  for (const p of sheet.prims) {
    if (p.t === 'line') {
      page.drawLine({ start: p.a, end: p.b, thickness: p.width, color: col(p.color), dashArray: p.dash });
    } else if (p.t === 'poly') {
      if (p.pts.length < 2) continue;
      // pdf-lib draws SVG paths with y pointing down from the origin, so a negated y lands at the right place on the page
      const path = p.pts.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x.toFixed(3)} ${(-q.y).toFixed(3)}`).join(' ') + (p.closed === false ? '' : ' Z');
      page.drawSvgPath(path, {
        x: 0, y: 0,
        ...(p.fill ? { color: col(p.fill) } : {}),
        ...(p.stroke ? { borderColor: col(p.stroke), borderWidth: p.width ?? 0.8, ...(p.dash ? { borderDashArray: p.dash } : {}) } : {}),
        ...(p.opacity !== undefined ? { opacity: p.opacity, borderOpacity: p.opacity } : {}),
      });
    } else if (p.t === 'circle') {
      page.drawCircle({
        x: p.x, y: p.y, size: p.r,
        ...(p.fill ? { color: col(p.fill) } : {}),
        ...(p.stroke ? { borderColor: col(p.stroke), borderWidth: p.width ?? 0.8 } : {}),
        ...(p.opacity !== undefined ? { opacity: p.opacity, borderOpacity: p.opacity } : {}),
      });
    } else {
      const font = p.bold ? bold : p.italic && italic ? italic : regular;
      const text = winAnsi(p.text);
      const w = font.widthOfTextAtSize(text, p.size);
      const shift = p.anchor === 'centre' ? -w / 2 : p.anchor === 'right' ? -w : 0;
      const a = ((p.rotate ?? 0) * Math.PI) / 180;
      page.drawText(text, { x: p.x + shift * Math.cos(a), y: p.y + shift * Math.sin(a), size: p.size, font, color: col(p.color), rotate: degrees(p.rotate ?? 0) });
    }
  }
}
