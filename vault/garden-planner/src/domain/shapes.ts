// Outlines: sampling a curved shape into a polygon, area and bounds. Curves are Catmull-Rom splines through the points, so a bed
// follows the points the user placed (no hidden control handles).
import { aabbOf, dist } from '@planner-core/engine/geometry';
import { polygonArea } from '@planner-core/engine/polygons';
import type { AABB, Vec2 } from '@planner-core/types';
import type { Shape } from './types';

const SAMPLES_PER_EDGE = 10;

function catmull(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** The outline as a plain polygon. Straight shapes return their points; smooth shapes are sampled along the curve. */
export function sampleShape(shape: Shape, perEdge = SAMPLES_PER_EDGE): Vec2[] {
  const pts = shape.points;
  const n = pts.length;
  if (!shape.smooth || n < 3) return pts.map((p) => ({ ...p }));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < perEdge; s++) out.push(catmull(p0, p1, p2, p3, s / perEdge));
  }
  return out;
}

export const shapeArea = (shape: Shape): number => (shape.points.length < 3 ? 0 : polygonArea(sampleShape(shape)));
export const shapeBounds = (shape: Shape): AABB => aabbOf(sampleShape(shape));

/** Centroid of the sampled polygon (area-weighted); falls back to the mean of the points for a degenerate outline. */
export function shapeCentroid(shape: Shape): Vec2 {
  const poly = sampleShape(shape);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const w = p.x * q.y - q.x * p.y;
    a += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Length of an open polyline. */
export function polylineLength(points: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

/** Outline of a path: the centre line thickened to `width` (mitre-free: each segment as a rectangle is enough for hit tests and 3D). */
export function pathSegments(points: Vec2[], width: number): Vec2[][] {
  const quads: Vec2[][] = [];
  const h = width / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = dist(a, b);
    if (len === 0) continue;
    const nx = (-(b.y - a.y) / len) * h, ny = ((b.x - a.x) / len) * h;
    quads.push([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]);
  }
  return quads;
}
