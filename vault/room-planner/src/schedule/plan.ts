// A to-scale plan sheet as drawing primitives (lines, polygons, text): walls, doors with their swing, windows, furniture numbered to match the
// schedule, dimension lines, a title block and a scale bar. Pure: the PDF writer (pdf.ts) turns the primitives into PDF; tests check them directly.
import { doorFrame, fixtureCentre, wallGeometry } from '../engine/constraints';
import { isAboveCutPlane } from '../engine/selection';
import { footprintOf } from '../engine/footprints';
import { add, aabbOf, rotateVec, scale as vscale } from '../engine/geometry';
import { wallOutlines } from '../engine/wallOutline';
import type { Project, Room, Vec2 } from '../engine/types';
import type { Schedule } from './schedule';

export type Rgb = [number, number, number];
export type Prim =
  | { t: 'poly'; pts: Vec2[]; fill?: Rgb; stroke?: Rgb; width?: number; dash?: number[]; closed?: boolean }
  | { t: 'line'; a: Vec2; b: Vec2; width: number; color: Rgb; dash?: number[] }
  | { t: 'text'; x: number; y: number; size: number; text: string; anchor: 'left' | 'centre' | 'right'; color: Rgb; bold?: boolean; rotate?: number }
  | { t: 'circle'; x: number; y: number; r: number; fill?: Rgb; stroke?: Rgb; width?: number };

export interface PlanSheet {
  /** Page size in points (1/72 inch), y up. */
  width: number;
  height: number;
  prims: Prim[];
  /** "1:50". */
  scaleLabel: string;
  /** Points per metre. */
  k: number;
}

export const INK: Rgb = [0.1, 0.1, 0.1];
export const MUTED: Rgb = [0.45, 0.45, 0.45];
const WALL_FILL: Rgb = [0.82, 0.81, 0.78];
const RUG_FILL: Rgb = [0.94, 0.92, 0.88];
const PRIMARY: Rgb = [0.8, 0.47, 0.36];

export const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 36;
const TITLE_H = 56;
const DIM_MARGIN = 38;
const DENOMS = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
const PT_PER_MM = 72 / 25.4;

export interface PlanOptions {
  projectName: string;
  /** "yyyy-mm-dd". */
  date: string;
  sheet: number;
  sheets: number;
  /** instance id → number from the schedule */
  numbers: Map<string, number>;
}

/** The numbers printed on the plan: one per piece, from the schedule's grouping. */
export function numbersFor(schedule: Schedule): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of schedule.furniture) for (const id of r.instanceIds) m.set(id, r.no);
  return m;
}

/** The biggest standard scale (1:50, 1:100 …) at which `w × h` metres fits in `fitW × fitH` points; the page is then chosen to suit. */
export function chooseScale(w: number, h: number, fitW: number, fitH: number): { denom: number; k: number } {
  for (const denom of DENOMS) {
    const k = (1000 / denom) * PT_PER_MM;
    if (w * k <= fitW && h * k <= fitH) return { denom, k };
  }
  const denom = DENOMS[DENOMS.length - 1];
  return { denom, k: (1000 / denom) * PT_PER_MM };
}

const metres = (v: number): string => `${v.toFixed(2)} m`;

export function planSheet(project: Project, room: Room, opts: PlanOptions): PlanSheet {
  const outlines = wallOutlines(room.vertices, room.walls);
  const allPts: Vec2[] = [...room.vertices.map((v) => v.position), ...outlines.flatMap((o) => o.polygon)];
  const box = aabbOf(allPts);
  const bw = box.max.x - box.min.x;
  const bh = box.max.y - box.min.y;
  const portrait = bh > bw;
  const page = portrait ? { w: A4.w, h: A4.h } : { w: A4.h, h: A4.w };
  const fitW = page.w - 2 * (MARGIN + DIM_MARGIN);
  const fitH = page.h - 2 * MARGIN - TITLE_H - 2 * DIM_MARGIN;
  const { denom, k } = chooseScale(bw, bh, fitW, fitH);
  // centre the drawing in the area above the title block
  const ox = (page.w - bw * k) / 2 - box.min.x * k;
  const oy = MARGIN + TITLE_H + DIM_MARGIN + (fitH - bh * k) / 2 - box.min.y * k;
  const P = (p: Vec2): Vec2 => ({ x: ox + p.x * k, y: oy + p.y * k });
  const prims: Prim[] = [];

  // floor
  prims.push({ t: 'poly', pts: room.vertices.map((v) => P(v.position)), fill: [1, 1, 1], stroke: undefined, closed: true });

  // pieces (under the walls and openings so a door's swing sits on top)
  const defs = new Map(project.furnitureDefinitions.map((d) => [d.id, d]));
  const furniture = [...room.furniture].sort((a, b) => a.elevation - b.elevation || a.height - b.height);
  for (const f of furniture) {
    const rug = defs.get(f.definitionId)?.category === 'rugs';
    const corners = footprintOf(f).map(P);
    prims.push({ t: 'poly', pts: corners, fill: rug ? RUG_FILL : [0.98, 0.98, 0.96], stroke: INK, width: rug ? 0.5 : 0.8, dash: isAboveCutPlane(f) ? [3, 2] : undefined, closed: true });
  }

  // walls
  for (const o of outlines) prims.push({ t: 'poly', pts: o.polygon.map(P), fill: WALL_FILL, stroke: INK, width: 0.9, closed: true });

  // doors and windows: cut the wall, jambs, glazing lines or the open leaf with its swing arc
  for (const f of room.fixtures) {
    const g = wallGeometry(room, f.wallId);
    if (!g) continue;
    const t = g.wall.thickness;
    const out = vscale(g.normal, -1);
    const c = fixtureCentre(g, f);
    const a = add(c, vscale(g.dir, -f.width / 2));
    const b = add(c, vscale(g.dir, f.width / 2));
    prims.push({ t: 'poly', pts: [a, b, add(b, vscale(out, t + 0.002)), add(a, vscale(out, t + 0.002))].map(P), fill: [1, 1, 1], closed: true });
    prims.push({ t: 'line', a: P(a), b: P(add(a, vscale(out, t))), width: 1, color: INK });
    prims.push({ t: 'line', a: P(b), b: P(add(b, vscale(out, t))), width: 1, color: INK });
    if (f.type === 'window') {
      prims.push({ t: 'line', a: P(a), b: P(b), width: 0.8, color: INK });
      prims.push({ t: 'line', a: P(add(a, vscale(out, t))), b: P(add(b, vscale(out, t))), width: 0.8, color: INK });
      prims.push({ t: 'line', a: P(add(a, vscale(out, t / 2))), b: P(add(b, vscale(out, t / 2))), width: 0.5, color: MUTED });
    } else {
      const fr = doorFrame(room, f);
      if (!fr) continue;
      const n = 24;
      const arc: Vec2[] = [];
      for (let i = 0; i <= n; i++) arc.push(add(fr.hinge, vscale(rotateVec(fr.closed, (fr.sign * (fr.angle * i)) / n), fr.radius)));
      prims.push({ t: 'poly', pts: arc.map(P), stroke: MUTED, width: 0.6, dash: [3, 2.5], closed: false });
      prims.push({ t: 'line', a: P(fr.hinge), b: P(arc[arc.length - 1]), width: 1.6, color: INK });
      prims.push({ t: 'line', a: P(a), b: P(b), width: 0.6, color: MUTED, dash: [2, 2] });
    }
  }

  // numbers: a small circle with the schedule number on each piece (skipped for rugs, which are large and plain)
  for (const f of room.furniture) {
    const no = opts.numbers.get(f.id);
    if (!no || defs.get(f.definitionId)?.category === 'rugs') continue;
    const c = P(f.position);
    const r = 5.2;
    prims.push({ t: 'circle', x: c.x, y: c.y, r, fill: [1, 1, 1], stroke: PRIMARY, width: 0.8 });
    prims.push({ t: 'text', x: c.x, y: c.y - 2.3, size: no > 9 ? 5.6 : 6.6, text: String(no), anchor: 'centre', color: INK, bold: true });
  }

  // dimension lines: overall width below, overall height on the right, and each wall's inside length beside it
  const dimLine = (p0: Vec2, p1: Vec2, off: Vec2, label: string, rotate = 0): void => {
    const a = { x: p0.x + off.x, y: p0.y + off.y };
    const b = { x: p1.x + off.x, y: p1.y + off.y };
    prims.push({ t: 'line', a, b, width: 0.5, color: MUTED });
    for (const [q, o] of [[a, p0], [b, p1]] as Array<[Vec2, Vec2]>) {
      prims.push({ t: 'line', a: { x: o.x + off.x * 0.2, y: o.y + off.y * 0.2 }, b: { x: q.x + off.x * 0.12, y: q.y + off.y * 0.12 }, width: 0.4, color: MUTED });
    }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    prims.push({ t: 'text', x: mid.x, y: mid.y + (rotate === 0 ? -8 : 0), size: 7.5, text: label, anchor: 'centre', color: INK, rotate });
  };
  const bl = P({ x: box.min.x, y: box.min.y }), br = P({ x: box.max.x, y: box.min.y }), tr = P({ x: box.max.x, y: box.max.y });
  dimLine(bl, br, { x: 0, y: -30 }, metres(bw));
  dimLine(br, tr, { x: 34, y: 0 }, metres(bh), 90);
  for (const w of room.walls) {
    const g = wallGeometry(room, w.id);
    if (!g || g.length < 0.3) continue;
    const mid = P({ x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 });
    // outside the wall (past its thickness) so it never sits on the furniture; text turned along the wall and kept upright
    const inward = vscale(g.normal, -1);
    const away = (g.wall.thickness * k) + 9;
    let ang = (Math.atan2(g.dir.y, g.dir.x) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang <= -90) ang += 180;
    prims.push({ t: 'text', x: mid.x + inward.x * away, y: mid.y + inward.y * away - 2, size: 6.2, text: metres(g.length), anchor: 'centre', color: MUTED, rotate: ang });
  }

  // title block
  const tx0 = MARGIN, tx1 = page.w - MARGIN, ty0 = MARGIN, ty1 = MARGIN + TITLE_H - 8;
  prims.push({ t: 'poly', pts: [{ x: tx0, y: ty0 }, { x: tx1, y: ty0 }, { x: tx1, y: ty1 }, { x: tx0, y: ty1 }], stroke: INK, width: 0.8, closed: true });
  prims.push({ t: 'text', x: tx0 + 10, y: ty1 - 18, size: 13, text: opts.projectName, anchor: 'left', color: INK, bold: true });
  const area = polygonAreaOf(room.vertices.map((v) => v.position));
  prims.push({ t: 'text', x: tx0 + 10, y: ty0 + 9, size: 8.5, text: `${room.name} · ${bw.toFixed(2)} × ${bh.toFixed(2)} m overall · ${area.toFixed(1)} m² inside`, anchor: 'left', color: MUTED });
  const cx = (tx0 + tx1) / 2 + 90;
  prims.push({ t: 'text', x: cx, y: ty1 - 18, size: 11, text: `Scale 1:${denom}`, anchor: 'left', color: INK, bold: true });
  prims.push({ t: 'text', x: cx, y: ty0 + 9, size: 8, text: `A4 ${portrait ? 'portrait' : 'landscape'}`, anchor: 'left', color: MUTED });
  prims.push({ t: 'text', x: tx1 - 10, y: ty1 - 18, size: 9, text: opts.date, anchor: 'right', color: INK });
  prims.push({ t: 'text', x: tx1 - 10, y: ty0 + 9, size: 8, text: `Sheet ${opts.sheet} of ${opts.sheets}`, anchor: 'right', color: MUTED });
  // scale bar (2 m, or 1 m when 2 m would be too long for the block), left of the scale
  const barM = 2 * k <= 150 ? 2 : 1;
  const sx = tx0 + 250, sy = ty0 + 22;
  const seg = (barM * k) / 2;
  for (let i = 0; i < 2; i++) prims.push({ t: 'poly', pts: [{ x: sx + i * seg, y: sy }, { x: sx + (i + 1) * seg, y: sy }, { x: sx + (i + 1) * seg, y: sy + 4 }, { x: sx + i * seg, y: sy + 4 }], fill: i % 2 ? [1, 1, 1] : INK, stroke: INK, width: 0.5, closed: true });
  prims.push({ t: 'text', x: sx, y: sy - 8, size: 6, text: '0', anchor: 'centre', color: INK });
  prims.push({ t: 'text', x: sx + 2 * seg, y: sy - 8, size: 6, text: `${barM} m`, anchor: 'centre', color: INK });

  return { width: page.w, height: page.h, prims, scaleLabel: `1:${denom}`, k };
}

function polygonAreaOf(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return Math.abs(a / 2);
}
