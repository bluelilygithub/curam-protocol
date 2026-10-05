// Shadows on level ground from everything in the garden that stands up: the house, fences and hedges, structures, and plants at the current
// growth stage and month. Pure geometry, no drawing.
//
// A vertical solid whose footprint is P, spanning heights zb..zt, throws a shadow equal to P swept along the shadow vector d = -s / tan(alt)
// (s = unit vector toward the sun on the plan) from zb*d to zt*d. For a polygon that is the union of: P moved by zb*d, P moved by zt*d, and,
// for every edge, the parallelogram between the two. That is exact for any polygon (convex or not) and cheap to test a point against.
// Each shadow has an `opacity` (0-1): a house blocks all the sun, a deciduous tree in winter blocks little. Points under several shadows
// get the product of what each lets through.
import { footprintCorners } from '@planner-core/engine/footprints';
import { pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { canopyOpacity, canopyShape } from './canopy';
import { sampleShape } from '../domain/shapes';
import { FENCE_HEIGHT, type GardenProject, type Structure, type Vec2 } from '../domain/types';
import { plantById } from '../plants/plants';
import type { GrowthStage } from '../plants/growth';

/** Below this the sun is too low for a garden to count it, and shadows would run to infinity. */
export const MIN_SUN_ALTITUDE = 3;

export type Obstacle =
  | { kind: 'prism'; polygon: Vec2[]; zb: number; zt: number; opacity: number; label: string }
  | { kind: 'canopy'; centre: Vec2; radius: number; zb: number; zt: number; opacity: number; label: string };

export type Shadow =
  | { kind: 'poly'; pts: Vec2[]; opacity: number; box: Box; group: number }
  | { kind: 'stadium'; a: Vec2; b: Vec2; r: number; opacity: number; box: Box; group: number };
interface Box { x0: number; y0: number; x1: number; y1: number }

/** How much of the sun each kind of structure blocks. */
const STRUCTURE_OPACITY: Record<Structure['kind'], number> = {
  shed: 1, deck: 1, raised_bed: 1, water_tank: 1, retaining_wall: 1, gate: 0.9, trellis: 0.4, pergola: 0.45, clothesline: 0, pool: 0,
};

const FENCE_OPACITY: Record<string, number> = { colorbond: 1, timber_paling: 1, brick: 1, hedge: 0.85, open: 0 };

/** A thin rectangle around a segment, for fences. */
function segmentRect(a: Vec2, b: Vec2, thickness: number): Vec2[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thickness / 2), ny = (dx / len) * (thickness / 2);
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
}

/** Everything in the project that casts a shadow, at a growth stage and month. */
export function obstaclesOf(p: GardenProject, stage: GrowthStage, month: number): Obstacle[] {
  const out: Obstacle[] = [];
  if (p.house && p.house.vertices.length >= 3) {
    out.push({ kind: 'prism', polygon: p.house.vertices.map((v) => v.position), zb: 0, zt: p.house.height, opacity: 1, label: 'house' });
  }
  if (p.boundary) {
    const v = p.boundary.vertices;
    for (let i = 0; i < v.length; i++) {
      const seg = p.boundary.segments[i];
      const fence = seg?.fence ?? 'open';
      const op = FENCE_OPACITY[fence] ?? 1;
      const h = seg?.height ?? FENCE_HEIGHT[fence];
      if (op <= 0 || h <= 0) continue;
      out.push({ kind: 'prism', polygon: segmentRect(v[i].position, v[(i + 1) % v.length].position, fence === 'hedge' ? 0.6 : 0.08), zb: 0, zt: h, opacity: op, label: `${fence} fence` });
    }
  }
  for (const s of p.structures) {
    const op = STRUCTURE_OPACITY[s.kind];
    if (op <= 0 || s.height <= 0) continue;
    if (s.kind === 'water_tank') {
      out.push({ kind: 'canopy', centre: s.position, radius: s.width / 2, zb: 0, zt: s.height, opacity: op, label: 'water tank' });
      continue;
    }
    const poly = footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.08), rotation: s.rotation });
    // a pergola or trellis shades from its top; a shed or deck is solid from the ground
    const zb = s.kind === 'pergola' ? Math.max(0, s.height - 0.2) : 0;
    out.push({ kind: 'prism', polygon: poly, zb, zt: s.height, opacity: op, label: s.kind });
  }
  for (const b of p.beds) {
    if (!b.raised) continue;
    out.push({ kind: 'prism', polygon: sampleShape(b.shape), zb: 0, zt: 0.35, opacity: 1, label: 'raised bed' });
  }
  for (const inst of p.plants) {
    const rec = plantById(inst.plantId);
    if (!rec) continue;
    const c = canopyShape(rec, stage);
    if (!c) continue; // too low to shade anything
    out.push({ kind: 'canopy', centre: inst.position, radius: c.radius, zb: c.zb, zt: c.zt, opacity: canopyOpacity(rec, month), label: rec.common[0] ?? rec.botanical });
  }
  return out;
}

const boxOf = (pts: Vec2[], pad = 0): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
};

const shift = (pts: Vec2[], dx: number, dy: number): Vec2[] => pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));

/**
 * The shadows every obstacle throws for a sun at `altitude` degrees, in the direction `toSun` on the plan (unit vector). Shadows fall the
 * other way. Returns [] when the sun is below MIN_SUN_ALTITUDE.
 */
export function shadowsFor(obstacles: Obstacle[], toSun: Vec2, altitude: number): Shadow[] {
  if (altitude < MIN_SUN_ALTITUDE) return [];
  const k = 1 / Math.tan((altitude * Math.PI) / 180); // metres of shadow per metre of height
  const dx = -toSun.x * k, dy = -toSun.y * k;
  const out: Shadow[] = [];
  let group = 0;
  for (const o of obstacles) {
    if (o.opacity <= 0) continue;
    group += 1; // all the parts of one obstacle share a group
    if (o.kind === 'canopy') {
      const a = { x: o.centre.x + dx * o.zb, y: o.centre.y + dy * o.zb };
      const b = { x: o.centre.x + dx * o.zt, y: o.centre.y + dy * o.zt };
      out.push({ kind: 'stadium', a, b, r: o.radius, opacity: o.opacity, box: boxOf([a, b], o.radius), group });
      continue;
    }
    const base = o.polygon;
    const lo = shift(base, dx * o.zb, dy * o.zb), hi = shift(base, dx * o.zt, dy * o.zt);
    const parts: Vec2[][] = [lo, hi];
    for (let i = 0; i < base.length; i++) {
      const j = (i + 1) % base.length;
      parts.push([lo[i], lo[j], hi[j], hi[i]]);
    }
    for (const pts of parts) out.push({ kind: 'poly', pts, opacity: o.opacity, box: boxOf(pts), group });
  }
  return out;
}

function distToSegment2(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
  const cx = a.x + abx * t - p.x, cy = a.y + aby * t - p.y;
  return cx * cx + cy * cy;
}

/**
 * Fraction of the sun that reaches a point (1 = full sun, 0 = fully shaded). An obstacle's parts overlap each other, so an obstacle counts
 * once (it either covers the point or not); different obstacles multiply what they let through.
 */
export function sunFractionAt(p: Vec2, shadows: Shadow[]): number {
  let through = 1;
  let i = 0;
  while (i < shadows.length) {
    const g = shadows[i].group;
    const op = shadows[i].opacity;
    let covered = false;
    while (i < shadows.length && shadows[i].group === g) {
      if (!covered && covers(shadows[i], p)) covered = true;
      i++;
    }
    if (covered) through *= 1 - op;
  }
  return through;
}

function covers(s: Shadow, p: Vec2): boolean {
  if (p.x < s.box.x0 || p.x > s.box.x1 || p.y < s.box.y0 || p.y > s.box.y1) return false;
  if (s.kind === 'stadium') return distToSegment2(p, s.a, s.b) <= s.r * s.r;
  return pointInPolygonInclusive(p, s.pts);
}
