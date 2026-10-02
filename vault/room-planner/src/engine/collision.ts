import { EPSILON } from './coordinates';
import { aabbOf, aabbOverlap, dot, perpLeft, sub } from './geometry';
import type { Interval, Vec2 } from './types';

function project(poly: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = dot(p, axis);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * SAT penetration depth between two convex polygons. Returns 0 when separated or merely touching
 * (|gap| or |penetration| <= EPSILON, C4); otherwise the minimum overlap along any separating axis.
 */
export function convexPenetration(a: Vec2[], b: Vec2[]): number {
  if (!aabbOverlap(aabbOf(a), aabbOf(b))) return 0;
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const len = Math.hypot(e.x, e.y);
      if (len === 0) continue;
      const axis = perpLeft({ x: e.x / len, y: e.y / len });
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= EPSILON) return 0;
      if (overlap < depth) depth = overlap;
    }
  }
  return depth === Infinity ? 0 : depth;
}

export function convexOverlap(a: Vec2[], b: Vec2[]): boolean {
  return convexPenetration(a, b) > 0;
}

/** Vertical intervals overlap only if they share more than EPSILON of height (touching heights do not). */
export function verticalOverlap(a: Interval, b: Interval): boolean {
  return Math.min(a.max, b.max) - Math.max(a.min, b.min) > EPSILON;
}

export interface Collidable { corners: Vec2[]; interval: Interval }

/** Two objects collide only when both 2D footprints and vertical intervals overlap. */
export function collides(a: Collidable, b: Collidable): boolean {
  return verticalOverlap(a.interval, b.interval) && convexOverlap(a.corners, b.corners);
}
