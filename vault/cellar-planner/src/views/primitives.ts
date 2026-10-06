// Drawing primitives shared by the 2D plan, the wall elevation and (later) the drawing package. Everything is in MILLIMETRES with y pointing DOWN
// the page, so a renderer (Konva now, a PDF later) only maps millimetres to its own units. Tones are meanings, not colours.

export type Tone = 'panel' | 'glass' | 'stud' | 'inside' | 'door' | 'rack' | 'rackIssue' | 'zone' | 'header' | 'equipment' | 'ink' | 'muted';

export type Prim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; tone: Tone; dash?: boolean; label?: string }
  /** A line (open) or polygon (closed) through [x0, y0, x1, y1, ...]. */
  | { kind: 'poly'; pts: number[]; tone: Tone; closed?: boolean; dash?: boolean }
  /** Text anchored at a point; `size` is in screen pixels, not millimetres. */
  | { kind: 'text'; x: number; y: number; text: string; tone: Tone; size?: number; anchor?: 'start' | 'middle' | 'end' }
  /** A dimension line from (x1, y1) to (x2, y2), drawn `offset` mm to the side (positive = to the right of the direction of travel) with ticks. */
  | { kind: 'dim'; x1: number; y1: number; x2: number; y2: number; offset: number; text: string };

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** The box that holds everything drawn (dimension lines included). Empty input gives a unit box at the origin. */
export function boundsOf(prims: Prim[]): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number): void => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of prims) {
    if (p.kind === 'rect') { add(p.x, p.y); add(p.x + p.w, p.y + p.h); }
    else if (p.kind === 'poly') for (let i = 0; i + 1 < p.pts.length; i += 2) add(p.pts[i], p.pts[i + 1]);
    else if (p.kind === 'text') add(p.x, p.y);
    else {
      add(p.x1, p.y1); add(p.x2, p.y2);
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * p.offset, ny = (dx / len) * p.offset;
      add(p.x1 + nx, p.y1 + ny); add(p.x2 + nx, p.y2 + ny);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}

/** The scale (pixels per millimetre) and offset that fit `b` inside a `w` x `h` pixel view with a margin. */
export function fitView(b: Bounds, w: number, h: number, marginPx = 40): { scale: number; ox: number; oy: number } {
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const scale = Math.max(0.01, Math.min((w - 2 * marginPx) / bw, (h - 2 * marginPx) / bh));
  return { scale, ox: (w - bw * scale) / 2 - b.x0 * scale, oy: (h - bh * scale) / 2 - b.y0 * scale };
}
