import { EPSILON, MIN_EDGE } from './coordinates';
import { cross, dist, segmentsTouch } from './geometry';
import type { PolygonErrorCode, Vec2, Vertex } from './types';

export function signedArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    a += cross(points[i], points[(i + 1) % points.length]);
  }
  return a / 2;
}

/** Absolute area in m². */
export function polygonArea(points: Vec2[]): number {
  return Math.abs(signedArea(points));
}

export function isCCW(points: Vec2[]): boolean {
  return signedArea(points) > 0;
}

/** Returns vertices in CCW order (reversed copy if needed). IDs travel with their vertices. */
export function normalizeCCW(vertices: Vertex[]): Vertex[] {
  const copy = vertices.map((v) => ({ id: v.id, position: { ...v.position } }));
  return signedArea(copy.map((v) => v.position)) < 0 ? copy.reverse() : copy;
}

export type PolygonValidation = { ok: true } | { ok: false; code: PolygonErrorCode };

/**
 * Validate a simple polygon (Spec §4, C7). Collinear consecutive vertices are valid.
 * Check order: TOO_FEW_VERTICES, DEGENERATE_EDGE, DUPLICATE_VERTEX, SELF_INTERSECTION, ZERO_AREA.
 */
export function validatePolygon(vertices: Vertex[]): PolygonValidation {
  const n = vertices.length;
  if (n < 3) return { ok: false, code: 'TOO_FEW_VERTICES' };
  const p = vertices.map((v) => v.position);

  for (let i = 0; i < n; i++) {
    if (dist(p[i], p[(i + 1) % n]) < MIN_EDGE - EPSILON) return { ok: false, code: 'DEGENERATE_EDGE' };
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent via wraparound
      if (dist(p[i], p[j]) <= EPSILON) return { ok: false, code: 'DUPLICATE_VERTEX' };
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsTouch(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return { ok: false, code: 'SELF_INTERSECTION' };
    }
  }
  if (Math.abs(signedArea(p)) <= EPSILON) return { ok: false, code: 'ZERO_AREA' };
  return { ok: true };
}
