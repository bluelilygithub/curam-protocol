import { EPSILON } from './coordinates';
import type { AABB, Vec2 } from './types';

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const perpLeft = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
export function rotateVec(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Parameter t in [0,1] of the closest point on segment ab to p. */
export function projectParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return 0;
  return Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const t = projectParam(p, a, b);
  return dist(p, add(a, scale(sub(b, a), t)));
}

/** True when the closed segments ab and cd share any point (touching counts, within EPSILON). */
export function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps = EPSILON): boolean {
  if (
    distPointSegment(a, c, d) <= eps ||
    distPointSegment(b, c, d) <= eps ||
    distPointSegment(c, a, b) <= eps ||
    distPointSegment(d, a, b) <= eps
  ) {
    return true;
  }
  const ab = sub(b, a);
  const cd = sub(d, c);
  const d1 = cross(ab, sub(c, a));
  const d2 = cross(ab, sub(d, a));
  const d3 = cross(cd, sub(a, c));
  const d4 = cross(cd, sub(b, c));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function aabbOf(points: Vec2[]): AABB {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** Inclusive overlap test with EPSILON slack: never rejects a pair the narrow phase could report as colliding. */
export function aabbOverlap(a: AABB, b: AABB, eps = EPSILON): boolean {
  return (
    a.min.x <= b.max.x + eps && b.min.x <= a.max.x + eps &&
    a.min.y <= b.max.y + eps && b.min.y <= a.max.y + eps
  );
}

/** Point on or inside a polygon (boundary within `eps` counts as inside). */
export function pointInPolygonInclusive(p: Vec2, poly: Vec2[], eps = EPSILON): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (distPointSegment(p, poly[i], poly[(i + 1) % n]) <= eps) return true;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the polygon boundary. */
export function distToPolygonBoundary(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, distPointSegment(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return best;
}
