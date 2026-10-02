import { EPSILON } from './coordinates';
import { add, cross, dist, normalize, perpLeft, scale, sub } from './geometry';
import type { Vec2, Vertex, WallSegment } from './types';

/** Longest mitre, as a multiple of the larger adjoining thickness, before a corner falls back to a butt joint. */
export const MITRE_LIMIT = 4;
export const DEFAULT_WALL_THICKNESS = 0.15;

export interface WallOutline {
  wallId: string | undefined;
  /** Edge i of the room polygon: vertices[i] → vertices[i+1]. */
  edgeIndex: number;
  thickness: number;
  /** CCW quad: interior start, interior end, outer end, outer start. */
  polygon: Vec2[];
}

function lineIntersection(p: Vec2, r: Vec2, q: Vec2, s: Vec2): Vec2 | null {
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const t = cross(sub(q, p), s) / denom;
  return add(p, scale(r, t));
}

/**
 * Wall outlines for drawing (C16): each wall expands outward from the interior face by its own thickness, and at every
 * vertex the two outer faces are extended until they meet (mitred outer corner). The interior polygon is never altered.
 * Collinear neighbours of different thickness step at the vertex; corners sharper than MITRE_LIMIT fall back to a butt joint.
 * Pure geometry, reused by 3D later.
 */
export function wallOutlines(vertices: Vertex[], walls: WallSegment[]): WallOutline[] {
  const n = vertices.length;
  if (n < 3) return [];
  const thicknessOf = (i: number): { id: string | undefined; t: number } => {
    const a = vertices[i].id;
    const b = vertices[(i + 1) % n].id;
    const w = walls.find((x) => (x.startVertexId === a && x.endVertexId === b) || (x.startVertexId === b && x.endVertexId === a));
    return { id: w?.id, t: w?.thickness ?? DEFAULT_WALL_THICKNESS };
  };
  // Outward normal of edge i (right of a CCW boundary direction).
  const outward = (i: number): Vec2 => {
    const a = vertices[i].position;
    const b = vertices[(i + 1) % n].position;
    const l = perpLeft(normalize(sub(b, a)));
    return { x: -l.x, y: -l.y };
  };

  /** Outer corner point of the wall that *starts* at vertex i (edge i) and of the wall that *ends* there (edge i-1). */
  const corner = (i: number): { forStart: Vec2; forEnd: Vec2 } => {
    const prev = (i - 1 + n) % n;
    const v = vertices[i].position;
    const t1 = thicknessOf(prev).t;
    const t2 = thicknessOf(i).t;
    const n1 = outward(prev);
    const n2 = outward(i);
    const d1 = normalize(sub(v, vertices[prev].position));
    const d2 = normalize(sub(vertices[(i + 1) % n].position, v));
    const p1 = add(v, scale(n1, t1));
    const p2 = add(v, scale(n2, t2));
    const mitre = lineIntersection(p1, d1, p2, d2);
    const limit = MITRE_LIMIT * Math.max(t1, t2);
    if (!mitre || dist(mitre, v) > limit + EPSILON) return { forEnd: p1, forStart: p2 }; // butt / step
    return { forEnd: mitre, forStart: mitre };
  };

  const corners = vertices.map((_, i) => corner(i));
  const out: WallOutline[] = [];
  for (let i = 0; i < n; i++) {
    const { id, t } = thicknessOf(i);
    const a = vertices[i].position;
    const b = vertices[(i + 1) % n].position;
    out.push({
      wallId: id, edgeIndex: i, thickness: t,
      polygon: [a, b, corners[(i + 1) % n].forEnd, corners[i].forStart],
    });
  }
  return out;
}
