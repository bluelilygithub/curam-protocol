import { wallGeometry } from './constraints';
import { angularDistance } from './coordinates';
import { footprintCorners, type OrientedRect } from './footprints';
import { add, dist, distPointSegment, dot, normalize, perpLeft, scale, sub } from './geometry';
import type { FurnitureInstance, Room, SnapCandidate, SnapTargetType, Vec2 } from './types';

export const DEFAULT_SNAP_DISTANCE = 0.25;
export const DEFAULT_GRID = 0.1;

export const SNAP_PRIORITY: Record<SnapTargetType, number> = {
  wall_endpoint: 100,
  wall: 80,
  furniture_edge: 60,
  furniture_centre: 50,
  alignment: 40,
  grid: 20,
};

/** Stable order used as the final tie-break (descending priority order, as listed in the contract). */
export const SNAP_TYPE_ORDER: SnapTargetType[] = [
  'wall_endpoint', 'wall', 'furniture_edge', 'furniture_centre', 'alignment', 'grid',
];

export interface SnapContext {
  /** The object being moved, with its proposed (float) position. */
  moving: OrientedRect;
  room: Room;
  /** Other furniture (the moving object must already be excluded). */
  others: FurnitureInstance[];
  snapDistance?: number;
  grid?: number;
  enabled?: SnapTargetType[];
}

function make(type: SnapTargetType, position: Vec2, from: Vec2, reason: string): SnapCandidate {
  return { targetType: type, position, distance: dist(position, from), priority: SNAP_PRIORITY[type], reason };
}

/** Translate `corners` so the corner(s) nearest an edge line lie on it; `outward` is the side the object must stay on. */
function flushCandidate(
  corners: Vec2[], a: Vec2, b: Vec2, outward: Vec2, centre: Vec2,
): Vec2 | undefined {
  const dir = normalize(sub(b, a));
  // Signed distance of each corner measured along `outward` from the edge line (positive = on the outward side).
  let minCorner: Vec2 | undefined;
  let minD = Infinity;
  for (const c of corners) {
    const d = dot(sub(c, a), outward);
    if (d < minD) { minD = d; minCorner = c; }
  }
  if (!minCorner) return undefined;
  // Must overlap the edge extent tangentially.
  const t0 = 0;
  const t1 = dot(sub(b, a), dir);
  const tc = corners.map((c) => dot(sub(c, a), dir));
  if (Math.max(...tc) < Math.min(t0, t1) || Math.min(...tc) > Math.max(t0, t1)) return undefined;
  return add(centre, scale(outward, -minD));
}

/** Generate snap candidates for the proposed position (Phase 1 §8). Pure and deterministic. */
export function generateSnapCandidates(ctx: SnapContext): SnapCandidate[] {
  const snapDistance = ctx.snapDistance ?? DEFAULT_SNAP_DISTANCE;
  const grid = ctx.grid ?? DEFAULT_GRID;
  const enabled = new Set(ctx.enabled ?? SNAP_TYPE_ORDER);
  const P = ctx.moving.position;
  const corners = footprintCorners(ctx.moving);
  const out: SnapCandidate[] = [];

  if (enabled.has('grid')) {
    out.push(make('grid', { x: Math.round(P.x / grid) * grid, y: Math.round(P.y / grid) * grid }, P, 'grid'));
  }

  const verts = ctx.room.vertices;
  if (enabled.has('wall_endpoint')) {
    for (const v of verts) {
      for (const c of corners) {
        out.push(make('wall_endpoint', add(P, sub(v.position, c)), P, `corner to vertex ${v.id}`));
      }
    }
  }

  if (enabled.has('wall')) {
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i].position;
      const b = verts[(i + 1) % verts.length].position;
      const inward = perpLeft(normalize(sub(b, a)));
      const pos = flushCandidate(corners, a, b, inward, P);
      if (pos) out.push(make('wall', pos, P, `flush to wall ${i}`));
    }
  }

  const movingReach = Math.hypot(ctx.moving.width, ctx.moving.length) / 2;
  for (const o of ctx.others) {
    // Edge and centre candidates only matter for neighbours within reach; alignment works across the room.
    const near = dist(o.position, P) <= Math.hypot(o.width, o.length) / 2 + movingReach + snapDistance;
    const oc = near && enabled.has('furniture_edge') ? footprintCorners(o) : [];
    if (enabled.has('furniture_edge')) {
      for (let i = 0; i < oc.length; i++) {
        const a = oc[i];
        const b = oc[(i + 1) % oc.length];
        // CCW polygon: outward normal is to the right of the edge direction.
        const outward = scale(perpLeft(normalize(sub(b, a))), -1);
        const pos = flushCandidate(corners, a, b, outward, P);
        if (pos) out.push(make('furniture_edge', pos, P, `flush to ${o.id} edge ${i}`));
      }
    }
    if (enabled.has('furniture_centre')) {
      out.push(make('furniture_centre', { ...o.position }, P, `centre of ${o.id}`));
    }
    if (enabled.has('alignment')) {
      out.push(make('alignment', { x: o.position.x, y: P.y }, P, `x aligned with ${o.id}`));
      out.push(make('alignment', { x: P.x, y: o.position.y }, P, `y aligned with ${o.id}`));
    }
  }
  return out.filter((c) => c.distance <= snapDistance);
}

/** B2: the rotation snaps to wall-flush when within this many degrees of it. */
export const WALL_FLUSH_WINDOW_DEG = 10;

/**
 * Wall-orientation rotation snap (B2, priority 70): if any footprint corner of `inst` rotated to `rotation` is within
 * `snapDistance` of a wall and `rotation` is within 10° of a wall-flush angle (the wall direction plus k × 90°, i.e. facing
 * into / away from the wall or along it), returns that flush angle; otherwise null.
 * Deviation noted in DECISIONS: the spec says "centre within snapDistance of a wall", which furniture can almost never satisfy,
 * so the footprint's nearest corner is used instead.
 */
export function wallFlushAngle(
  inst: { position: Vec2; width: number; length: number }, rotation: number, room: Room, snapDistance = DEFAULT_SNAP_DISTANCE,
): number | null {
  const corners = footprintCorners({ position: inst.position, width: inst.width, length: inst.length, rotation });
  let best: { angle: number; diff: number } | null = null;
  for (const w of room.walls) {
    const g = wallGeometry(room, w.id);
    if (!g) continue;
    if (!corners.some((c) => distPointSegment(c, g.start, g.end) <= snapDistance)) continue;
    const base = Math.atan2(g.dir.y, g.dir.x);
    for (let k = 0; k < 4; k++) {
      const angle = base + (k * Math.PI) / 2;
      const diff = angularDistance(angle, rotation);
      if (diff <= (WALL_FLUSH_WINDOW_DEG * Math.PI) / 180 && (!best || diff < best.diff)) best = { angle, diff };
    }
  }
  return best ? best.angle : null;
}

/**
 * Rank candidates: within threshold → priority (high first) → smaller distance → stable type order → position → reason.
 * Fully deterministic.
 */
export function rankSnapCandidates(candidates: SnapCandidate[], snapDistance = DEFAULT_SNAP_DISTANCE): SnapCandidate[] {
  return candidates
    .filter((c) => c.distance <= snapDistance)
    .sort((a, b) =>
      b.priority - a.priority ||
      a.distance - b.distance ||
      SNAP_TYPE_ORDER.indexOf(a.targetType) - SNAP_TYPE_ORDER.indexOf(b.targetType) ||
      a.position.x - b.position.x ||
      a.position.y - b.position.y ||
      a.reason.localeCompare(b.reason));
}
