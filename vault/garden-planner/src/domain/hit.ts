// Picking and snapping on the plan.
import { footprintCorners } from '@planner-core/engine/footprints';
import { dist, distPointSegment, pointInPolygonInclusive, projectParam, add, scale, sub } from '@planner-core/engine/geometry';
import { plantSizeAt, type GrowthStage } from '../plants/growth';
import { plantById } from '../plants/plants';
import { pathSegments, sampleShape } from './shapes';
import type { GardenProject, Vec2 } from './types';
import type { Selection } from '../state/uiStore';

/** Plants are picked within at least this radius, so a seedling is still easy to hit. */
const MIN_PLANT_PICK = 0.25;

/** The topmost thing at `at` (plants first, then structures, house, beds, paths, lawns, zones, boundary edges). `tol` is in metres. */
export function pick(p: GardenProject, at: Vec2, tol: number, stage: GrowthStage): Selection | null {
  for (let i = p.plants.length - 1; i >= 0; i--) {
    const inst = p.plants[i];
    const rec = plantById(inst.plantId);
    const r = Math.max(rec ? plantSizeAt(rec, stage).canopyRadius : 0.3, MIN_PLANT_PICK) + tol * 0.3;
    if (dist(inst.position, at) <= r) return { kind: 'plant', id: inst.id };
  }
  for (let i = p.structures.length - 1; i >= 0; i--) {
    const s = p.structures[i];
    const corners = footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation });
    if (pointInPolygonInclusive(at, corners, tol * 0.5)) return { kind: 'structure', id: s.id };
  }
  if (p.house && pointInPolygonInclusive(at, p.house.vertices.map((v) => v.position))) return { kind: 'house', id: p.house.id };
  for (let i = p.beds.length - 1; i >= 0; i--) if (pointInPolygonInclusive(at, sampleShape(p.beds[i].shape))) return { kind: 'bed', id: p.beds[i].id };
  for (let i = p.paths.length - 1; i >= 0; i--) {
    const pa = p.paths[i];
    if (pathSegments(pa.points, Math.max(pa.width, tol)).some((q) => pointInPolygonInclusive(at, q))) return { kind: 'path', id: pa.id };
  }
  for (let i = p.services.length - 1; i >= 0; i--) {
    const s = p.services[i];
    if (pathSegments(s.points, Math.max(s.kind === 'easement' ? s.width : 0.3, tol)).some((q) => pointInPolygonInclusive(at, q))) return { kind: 'service', id: s.id };
  }
  for (let i = p.lawns.length - 1; i >= 0; i--) if (pointInPolygonInclusive(at, sampleShape(p.lawns[i].shape))) return { kind: 'lawn', id: p.lawns[i].id };
  for (let i = p.zones.length - 1; i >= 0; i--) if (pointInPolygonInclusive(at, sampleShape(p.zones[i].shape))) return { kind: 'zone', id: p.zones[i].id };
  if (p.boundary) {
    const v = p.boundary.vertices.map((x) => x.position);
    for (let i = 0; i < v.length; i++) if (distPointSegment(at, v[i], v[(i + 1) % v.length]) <= tol) return { kind: 'boundary', id: 'boundary' };
  }
  return null;
}

/** Index of the boundary edge nearest `at` within `tol` (for choosing the fence on one edge). */
export function nearestBoundaryEdge(p: GardenProject, at: Vec2, tol: number): number | null {
  if (!p.boundary) return null;
  const v = p.boundary.vertices.map((x) => x.position);
  let best: number | null = null, bd = tol;
  for (let i = 0; i < v.length; i++) {
    const d = distPointSegment(at, v[i], v[(i + 1) % v.length]);
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------- snapping

export interface SnapOptions { grid: number; tol: number; useGrid: boolean; exclude?: Vec2[] }
export interface SnapResult { point: Vec2; kind: 'corner' | 'edge' | 'grid' | 'none' }

/** Outlines worth snapping to: the boundary, the house, beds, lawns, paths. */
function outlines(p: GardenProject): Array<{ pts: Vec2[]; closed: boolean }> {
  const out: Array<{ pts: Vec2[]; closed: boolean }> = [];
  if (p.boundary) out.push({ pts: p.boundary.vertices.map((v) => v.position), closed: true });
  if (p.house) out.push({ pts: p.house.vertices.map((v) => v.position), closed: true });
  for (const b of p.beds) out.push({ pts: b.shape.points, closed: true });
  for (const l of p.lawns) out.push({ pts: l.shape.points, closed: true });
  for (const z of p.zones) out.push({ pts: z.shape.points, closed: true });
  for (const pa of p.paths) out.push({ pts: pa.points, closed: false });
  for (const s of p.services) out.push({ pts: s.points, closed: false });
  return out;
}

/** Corners first, then edges, then the grid. Snapping targets (spec 3): boundary, bed edges, paths, house walls. */
export function snapPoint(p: GardenProject, at: Vec2, o: SnapOptions): SnapResult {
  const shapes = outlines(p);
  let best: SnapResult | null = null, bd = o.tol;
  for (const s of shapes) for (const v of s.pts) {
    const d = dist(v, at);
    if (d <= bd) { bd = d; best = { point: { ...v }, kind: 'corner' }; }
  }
  if (best) return best;
  for (const s of shapes) {
    const n = s.pts.length;
    for (let i = 0; i < (s.closed ? n : n - 1); i++) {
      const a = s.pts[i], b = s.pts[(i + 1) % n];
      const d = distPointSegment(at, a, b);
      if (d <= bd) { bd = d; best = { point: add(a, scale(sub(b, a), projectParam(at, a, b))), kind: 'edge' }; }
    }
  }
  if (best) return best;
  if (o.useGrid && o.grid > 0) return { point: { x: Math.round(at.x / o.grid) * o.grid, y: Math.round(at.y / o.grid) * o.grid }, kind: 'grid' };
  return { point: at, kind: 'none' };
}
