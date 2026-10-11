import type { BBox, Pos, Units } from './geo';

/** Page layout, projection and text helpers for the map PDF. No pdf-lib here, so the screen can use them without loading it (mapPdf.ts is the part that loads on demand). */

export type Orientation = 'landscape' | 'portrait';
const A4 = { long: 841.89, short: 595.28 };
export const MARGIN = 28;
const HEADER = 58;
const STRIP = 104; // numbers, notes and the elevation chart under the map
export const GAP = 8;
/** CSS pixels of map picture per PDF point: 1.4 is about 100 dpi at pixel ratio 1, and the capture renders at pixel ratio 2. */
export const CAPTURE_PX_PER_PT = 1.4;

export const pageSize = (o: Orientation): { w: number; h: number } => (o === 'landscape' ? { w: A4.long, h: A4.short } : { w: A4.short, h: A4.long });

/** Where the map picture goes on the page, in points from the page's TOP-left corner. */
export function mapArea(o: Orientation): { x: number; top: number; w: number; h: number } {
  const p = pageSize(o);
  const top = MARGIN + HEADER;
  return { x: MARGIN, top, w: p.w - 2 * MARGIN, h: p.h - top - MARGIN - STRIP - GAP };
}

/** The size, in CSS pixels, the browser should render the map at so it fits the map area exactly. */
export function captureSize(o: Orientation): { width: number; height: number } {
  const a = mapArea(o);
  return { width: Math.round(a.w * CAPTURE_PX_PER_PT), height: Math.round(a.h * CAPTURE_PX_PER_PT) };
}

/** Landscape for a route that is wider than tall, portrait for a tall one: whichever page shape the route fills better. */
export function chooseOrientation(bbox: BBox): Orientation {
  const [w, s, e, n] = bbox;
  const dx = Math.max(1e-9, (e - w) * Math.cos(((s + n) / 2) * Math.PI / 180));
  const dy = Math.max(1e-9, n - s);
  const aspect = dx / dy;
  const la = mapArea('landscape'); const pa = mapArea('portrait');
  const dist = (target: number): number => Math.abs(Math.log(aspect / target));
  return dist(la.w / la.h) <= dist(pa.w / pa.h) ? 'landscape' : 'portrait';
}

/** Longitude/latitude -> pixel in a north-up map picture of `width` x `height` centred on `center` at `zoom` (512 px tiles, as MapLibre). */
export function makeProjector(center: Pos, zoom: number, width: number, height: number): (p: Pos) => { x: number; y: number } {
  const world = 512 * 2 ** zoom;
  const mx = (lng: number): number => (lng + 180) / 360;
  const my = (lat: number): number => {
    const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  };
  const cx = mx(center[0]); const cy = my(center[1]);
  return (p) => ({ x: (mx(p[0]) - cx) * world + width / 2, y: (my(p[1]) - cy) * world + height / 2 });
}

/** A round scale-bar length that fits in `maxPt` points: { metres, label }. */
export function niceScale(metersPerPt: number, maxPt: number, units: Units): { metres: number; pt: number; label: string } {
  const steps = units === 'mi'
    ? [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].map((m) => m * 1609.344)
    : [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
  let pick = steps[0];
  for (const s of steps) if (s / metersPerPt <= maxPt) pick = s;
  const label = units === 'mi' ? `${+(pick / 1609.344).toFixed(2)} mi` : pick >= 1000 ? `${pick / 1000} km` : `${pick} m`;
  return { metres: pick, pt: pick / metersPerPt, label };
}

/** Text as the standard PDF font can show it: anything it has no character for becomes "?", and control characters become spaces. */
export function safeText(text: string, has: (codePoint: number) => boolean): string {
  let out = '';
  for (const ch of text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')) {
    const cp = ch.codePointAt(0) as number;
    out += cp === 10 || has(cp) ? ch : '?';
  }
  return out;
}

/** Break text into lines no wider than `maxWidth` (words kept whole, an over-long word cut), at most `maxLines`, ending in "..." if cut short. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const lines: string[] = [];
  let cut = false;
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  outer: for (const para of paragraphs) {
    let cur = '';
    const push = (l: string): boolean => { if (lines.length >= maxLines) { cut = true; return false; } lines.push(l); return true; };
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (measure(word) > maxWidth) { // a word wider than the line: cut it
        let n = word.length - 1;
        while (n > 1 && measure(word.slice(0, n)) > maxWidth) n -= 1;
        if (cur) { if (!push(cur)) break outer; cur = ''; }
        if (!push(word.slice(0, n))) break outer;
        word = word.slice(n);
      }
      const next = cur ? `${cur} ${word}` : word;
      if (measure(next) <= maxWidth) cur = next;
      else { if (!push(cur)) break outer; cur = word; }
    }
    if (cur && !push(cur)) break;
    if (!cur && !para && lines.length < maxLines && lines.length) lines.push(''); // a blank line between paragraphs
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (cut && lines.length) {
    let last = lines[lines.length - 1];
    while (last && measure(`${last}...`) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}...`;
  }
  return lines;
}

/** A colour mixed with white: the soft fill under the elevation line. */
export function tint(hex: string, amount: number): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const c = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [228, 87, 46];
  return c.map((v) => (v + (255 - v) * amount) / 255) as [number, number, number];
}

