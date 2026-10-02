import { EPSILON } from './coordinates';
import {
  add, cross, distPointSegment, distToPolygonBoundary, len, pointInPolygonInclusive, projectParam, scale, sub,
} from './geometry';
import type { Vec2, Vertex, WallSegment } from './types';

export interface ContainmentResult {
  inside: boolean;
  /** Length of footprint boundary outside the room plus corner exterior distances (0 when inside). */
  magnitude: number;
  /** Walls nearest to the outside portions. */
  wallIds: string[];
}

function wallIdForEdge(a: Vertex, b: Vertex, walls: WallSegment[]): string | undefined {
  return walls.find(
    (w) =>
      (w.startVertexId === a.id && w.endVertexId === b.id) ||
      (w.startVertexId === b.id && w.endVertexId === a.id),
  )?.id;
}

function nearestEdgeIndex(p: Vec2, poly: Vec2[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Footprint-in-room test (Spec §4, Rule 17). Entirely inside or exactly touching is valid; crossing or outside is not.
 * Each footprint edge is split at every polygon crossing/touch and the midpoint of each piece is tested, which is
 * robust for concave simple polygons without triangulation.
 */
export function checkContainment(corners: Vec2[], vertices: Vertex[], walls: WallSegment[]): ContainmentResult {
  const poly = vertices.map((v) => v.position);
  const wallIds = new Set<string>();
  let magnitude = 0;

  const flag = (p: Vec2): void => {
    const i = nearestEdgeIndex(p, poly);
    const id = wallIdForEdge(vertices[i], vertices[(i + 1) % vertices.length], walls);
    if (id) wallIds.add(id);
  };

  for (const c of corners) {
    if (!pointInPolygonInclusive(c, poly)) {
      magnitude += distToPolygonBoundary(c, poly);
      flag(c);
    }
  }

  for (let i = 0; i < corners.length; i++) {
    const p0 = corners[i];
    const p1 = corners[(i + 1) % corners.length];
    const r = sub(p1, p0);
    const rLen = len(r);
    if (rLen === 0) continue;
    const ts = [0, 1];
    for (let j = 0; j < poly.length; j++) {
      const q0 = poly[j];
      const q1 = poly[(j + 1) % poly.length];
      const s = sub(q1, q0);
      const denom = cross(r, s);
      if (Math.abs(denom) > 1e-12) {
        const qp = sub(q0, p0);
        const t = cross(qp, s) / denom;
        const u = cross(qp, r) / denom;
        if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
      }
      if (distPointSegment(q0, p0, p1) <= EPSILON) ts.push(projectParam(q0, p0, p1));
    }
    ts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      const ta = ts[k];
      const tb = ts[k + 1];
      if (tb - ta <= 1e-12) continue;
      const mid = add(p0, scale(r, (ta + tb) / 2));
      if (!pointInPolygonInclusive(mid, poly)) {
        magnitude += (tb - ta) * rLen;
        flag(mid);
      }
    }
  }

  return { inside: magnitude <= EPSILON, magnitude: magnitude <= EPSILON ? 0 : magnitude, wallIds: [...wallIds].sort() };
}
