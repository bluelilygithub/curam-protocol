// Small geometry helpers for the checks.
import { dist, distPointSegment, pointInPolygonInclusive, projectParam, segmentsTouch } from '@planner-core/engine/geometry';
import type { Vec2 } from '../domain/types';

export interface Closest { dist: number; point: Vec2; inside: boolean }

/** Closest point on a polygon's outline to `p`, how far, and whether `p` is inside it. */
export function closestOnPolygon(p: Vec2, poly: Vec2[]): Closest {
  let best = Infinity, bestPt = poly[0];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const t = projectParam(p, a, b);
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const d = dist(p, q);
    if (d < best) { best = d; bestPt = q; }
  }
  return { dist: best, point: bestPt, inside: pointInPolygonInclusive(p, poly, 0) };
}

/** Distance from a point to a polyline (0 on it). */
export function distToPolyline(p: Vec2, pts: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distPointSegment(p, pts[i - 1], pts[i]));
  return pts.length === 1 ? dist(p, pts[0]) : best;
}

/** True when two polygons share any area or touch. */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (a.some((p) => pointInPolygonInclusive(p, b, 0)) || b.some((p) => pointInPolygonInclusive(p, a, 0))) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsTouch(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/** True when a circle overlaps a polygon. */
export function circleOverlapsPolygon(c: Vec2, r: number, poly: Vec2[]): boolean {
  if (pointInPolygonInclusive(c, poly, 0)) return true;
  return closestOnPolygon(c, poly).dist <= r;
}

/** The area a gate sweeps as it opens: a quarter circle about the hinge, on the side `swing` says (+1 or -1). */
export function gateSwingSector(centre: Vec2, width: number, rotation: number, swing: 1 | -1, steps = 10): Vec2[] {
  const ux = Math.cos(rotation), uy = Math.sin(rotation);
  const hinge = { x: centre.x - (width / 2) * ux, y: centre.y - (width / 2) * uy };
  // closed, the leaf lies along u from the hinge; it swings up to 90 degrees toward +v (swing +1, counter-clockwise) or -v (swing -1)
  const out: Vec2[] = [hinge];
  for (let i = 0; i <= steps; i++) {
    const a = (swing * (i / steps) * Math.PI) / 2;
    const dx = ux * Math.cos(a) - uy * Math.sin(a), dy = ux * Math.sin(a) + uy * Math.cos(a);
    out.push({ x: hinge.x + dx * width, y: hinge.y + dy * width });
  }
  return out;
}

/** A number for a message: at most `d` decimals, trailing zeros dropped (0.70 -> 0.7, 2.0 -> 2). */
export const fmt = (n: number, d = 1): string => n.toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
