// Segmented 3D walls (Spec rule 14: never boolean subtraction). Pure geometry, no three.js.
//
// Each wall's drawn outline (the mitred quad from `wallOutlines`, C16) is cut along the wall at every door/window edge into
// full-height pieces and, over an opening, the solid parts below the sill and above the head. Cuts are perpendicular to the wall
// (clipping the convex outline between two planes), so the mitred ends are preserved exactly and the pieces tile the wall with
// no gaps or overlaps.
import { fixtureCentre, wallGeometry } from '../engine/constraints';
import { cross, dot, sub } from '../engine/geometry';
import { wallOutlines } from '../engine/wallOutline';
import type { Room, Vec2 } from '../engine/types';
import type { Vec3 } from './transforms';

export type WallPieceKind = 'full' | 'below' | 'above';

export interface WallPiece {
  wallId: string;
  /** The fixture whose opening this piece sits under/over; absent for full-height pieces. */
  fixtureId?: string;
  kind: WallPieceKind;
  /** Convex plan polygon (the wall outline's orientation: clockwise for a counter-clockwise room). */
  polygon: Vec2[];
  /** Vertical extent above the room's floor. */
  y0: number;
  y1: number;
}

const MIN_SPAN = 1e-6;

/** Keep the part of a convex polygon with `dot(p − origin, dir) ≥ lo` (or ≤ hi). Sutherland–Hodgman on one half-plane. */
function clipHalfPlane(poly: Vec2[], origin: Vec2, dir: Vec2, bound: number, keepGreater: boolean): Vec2[] {
  const sd = (p: Vec2): number => (dot(sub(p, origin), dir) - bound) * (keepGreater ? 1 : -1);
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = sd(a);
    const db = sd(b);
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** The part of a convex polygon between two planes perpendicular to `dir`, at distances `s0 ≤ s ≤ s1` from `origin`. */
export function clipBand(poly: Vec2[], origin: Vec2, dir: Vec2, s0: number, s1: number): Vec2[] {
  let p = poly;
  if (Number.isFinite(s0)) p = clipHalfPlane(p, origin, dir, s0, true);
  if (p.length >= 3 && Number.isFinite(s1)) p = clipHalfPlane(p, origin, dir, s1, false);
  return p;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += cross(poly[i], poly[(i + 1) % poly.length]);
  return a / 2;
}

interface Span { lo: number; hi: number; fixtureId: string; y0: number; y1: number }

/** Solid vertical ranges of a wall of height `H` over an interval, given the openings that cover it. */
function solidRanges(H: number, covering: Span[]): Array<{ y0: number; y1: number; fixtureId?: string; kind: WallPieceKind }> {
  const open = covering
    .map((o) => ({ y0: Math.max(0, o.y0), y1: Math.min(H, o.y1), fixtureId: o.fixtureId }))
    .filter((o) => o.y1 - o.y0 > MIN_SPAN)
    .sort((a, b) => a.y0 - b.y0);
  if (open.length === 0) return [{ y0: 0, y1: H, kind: 'full' }];
  const out: Array<{ y0: number; y1: number; fixtureId?: string; kind: WallPieceKind }> = [];
  let cursor = 0;
  let prevFixture: string | undefined;
  for (const o of open) {
    if (o.y0 - cursor > MIN_SPAN) out.push({ y0: cursor, y1: o.y0, kind: cursor === 0 ? 'below' : 'above', fixtureId: o.fixtureId ?? prevFixture });
    cursor = Math.max(cursor, o.y1);
    prevFixture = o.fixtureId;
  }
  if (H - cursor > MIN_SPAN) out.push({ y0: cursor, y1: H, kind: 'above', fixtureId: prevFixture });
  return out;
}

/** All wall pieces of a room, deterministic: walls in outline order, pieces along the wall, then bottom to top. */
export function wallPieces(room: Room): WallPiece[] {
  const H = room.wallHeight;
  const pieces: WallPiece[] = [];
  for (const o of wallOutlines(room.vertices, room.walls)) {
    if (!o.wallId) continue;
    const g = wallGeometry(room, o.wallId);
    if (!g) continue;
    const origin = o.polygon[0];
    const dir = g.dir;
    const spans: Span[] = room.fixtures
      .filter((f) => f.wallId === o.wallId)
      .map((f) => {
        const c = dot(sub(fixtureCentre(g, f), origin), dir);
        return {
          lo: Math.max(0, c - f.width / 2), hi: Math.min(g.length, c + f.width / 2), fixtureId: f.id,
          y0: f.elevation, y1: f.elevation + f.height,
        };
      })
      .filter((s) => s.hi - s.lo > MIN_SPAN);

    const cuts = [...new Set([0, g.length, ...spans.flatMap((s) => [s.lo, s.hi])])].sort((a, b) => a - b);
    // Elementary intervals between cuts; merge neighbours that have identical solid ranges so a wall with one window is 3 runs, not 5.
    interface Run { s0: number; s1: number; key: string; ranges: ReturnType<typeof solidRanges> }
    const runs: Run[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      const ranges = solidRanges(H, spans.filter((s) => s.lo < mid && mid < s.hi));
      const key = JSON.stringify(ranges.map((r) => [r.y0, r.y1, r.fixtureId ?? '', r.kind]));
      const last = runs[runs.length - 1];
      if (last && last.key === key) last.s1 = cuts[i + 1];
      else runs.push({ s0: cuts[i], s1: cuts[i + 1], key, ranges });
    }
    if (runs.length === 0) runs.push({ s0: 0, s1: g.length, key: '', ranges: [{ y0: 0, y1: H, kind: 'full' }] });
    // The first and last run extend past the wall ends so the mitred corners are kept whole.
    runs[0].s0 = -Infinity;
    runs[runs.length - 1].s1 = Infinity;

    for (const r of runs) {
      const poly = clipBand(o.polygon, origin, dir, r.s0, r.s1);
      if (poly.length < 3 || Math.abs(polygonArea(poly)) < MIN_SPAN * MIN_SPAN) continue;
      for (const range of r.ranges) {
        pieces.push({ wallId: o.wallId, fixtureId: range.fixtureId, kind: range.kind, polygon: poly, y0: range.y0, y1: range.y1 });
      }
    }
  }
  return pieces;
}

// ------------------------------------------------------------------ mesh data

export interface MeshData {
  /** Flat xyz, three coordinates. Faces do not share vertices, so every face has its own flat normal. */
  positions: number[];
  normals: number[];
  indices: number[];
  /** UVs in metres (box-projected along each face's dominant axis), so textures keep their real-world scale. */
  uvs: number[];
}

/** Extruded convex plan polygon (either orientation) from `y0` to `y1`: top, bottom and one quad per side, normals pointing outwards. */
export function prism(input: Vec2[], y0: number, y1: number): MeshData {
  const polygon = polygonArea(input) < 0 ? [...input].reverse() : input; // outward side normals below assume CCW
  const m: MeshData = { positions: [], normals: [], indices: [], uvs: [] };
  const tri = (a: Vec3, b: Vec3, c: Vec3, n: Vec3): void => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const base = m.positions.length / 3;
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      m.positions.push(p[0], p[1], p[2]);
      m.normals.push(n[0], n[1], n[2]);
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      if (ay >= ax && ay >= az) m.uvs.push(p[0], p[2]);
      else if (ax >= az) m.uvs.push(p[2], p[1]);
      else m.uvs.push(p[0], p[1]);
    }
    m.indices.push(base, base + 1, base + 2);
  };
  const at = (p: Vec2, y: number): Vec3 => [p.x, y, p.y];
  const n = polygon.length;
  for (let i = 1; i + 1 < n; i++) {
    tri(at(polygon[0], y1), at(polygon[i], y1), at(polygon[i + 1], y1), [0, 1, 0]);
    tri(at(polygon[0], y0), at(polygon[i], y0), at(polygon[i + 1], y0), [0, -1, 0]);
  }
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const ex = b.x - a.x, ez = b.y - a.y;
    const el = Math.hypot(ex, ez);
    if (el < MIN_SPAN) continue;
    // Outward normal of a CCW polygon edge, in three coordinates (plan y is three z): (ez, −ex) / |e|.
    const nrm: Vec3 = [ez / el, 0, -ex / el];
    tri(at(a, y0), at(b, y0), at(b, y1), nrm);
    tri(at(a, y0), at(b, y1), at(a, y1), nrm);
  }
  return m;
}

/** Volume of a prism's plan polygon × height. */
export const pieceVolume = (p: Pick<WallPiece, 'polygon' | 'y0' | 'y1'>): number => Math.abs(polygonArea(p.polygon)) * (p.y1 - p.y0);

// ------------------------------------------------------------------ skirting boards (Realistic look)

export const SKIRTING_HEIGHT = 0.1;
export const SKIRTING_THICKNESS = 0.012;

export interface SkirtingPiece { wallId: string; polygon: Vec2[]; y0: number; y1: number }

/** A low board along the inside face of every wall, interrupted by the width of each door. Windows sit above it, so it runs on. */
export function skirtingPieces(room: Room): SkirtingPiece[] {
  const out: SkirtingPiece[] = [];
  for (const w of room.walls) {
    const g = wallGeometry(room, w.id);
    if (!g || g.length < 0.05) continue;
    const cuts = room.fixtures
      .filter((f) => f.wallId === w.id && f.type === 'door')
      .map((f) => ({ lo: Math.max(0, f.offsetAlongWall - f.width / 2), hi: Math.min(g.length, f.offsetAlongWall + f.width / 2) }))
      .sort((a, b) => a.lo - b.lo);
    let from = 0;
    const spans: Array<[number, number]> = [];
    for (const c of cuts) {
      if (c.lo - from > 0.02) spans.push([from, c.lo]);
      from = Math.max(from, c.hi);
    }
    if (g.length - from > 0.02) spans.push([from, g.length]);
    for (const [s0, s1] of spans) {
      const a = { x: g.start.x + g.dir.x * s0, y: g.start.y + g.dir.y * s0 };
      const b = { x: g.start.x + g.dir.x * s1, y: g.start.y + g.dir.y * s1 };
      const n = { x: g.normal.x * SKIRTING_THICKNESS, y: g.normal.y * SKIRTING_THICKNESS };
      out.push({ wallId: w.id, polygon: [a, b, { x: b.x + n.x, y: b.y + n.y }, { x: a.x + n.x, y: a.y + n.y }], y0: 0, y1: SKIRTING_HEIGHT });
    }
  }
  return out;
}
