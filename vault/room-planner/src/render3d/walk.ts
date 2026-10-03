// Walk mode (Spec Addition A1, C4): first-person movement at eye height with collision. Pure: no three.js, so the one guarantee
// that matters — the camera is never inside a wall or a solid object — is property-tested.
//
// The walker is a circle of radius WALK_RADIUS on the plan. It is kept inside the room (a wall's inside face is the polygon edge) and
// outside every piece of furniture that a standing person would bump into: anything whose top is above knee height and whose bottom
// is below head height. Movement is applied in small steps and pushed out of whatever it overlaps, so the walker slides along walls
// and furniture instead of stopping dead. If a step cannot be resolved (a pocket too tight for the circle) it is refused.
import { EPSILON } from '../engine/coordinates';
import { footprintOf } from '../engine/footprints';
import { add, dist, distToPolygonBoundary, normalize, pointInPolygonInclusive, projectParam, scale, sub } from '../engine/geometry';
import type { Room, Vec2 } from '../engine/types';
import { autoStops, roomCentroid } from './tour';
import type { Vec3 } from './transforms';

export const WALK_EYE = 1.6;
export const WALK_RADIUS = 0.25;
/** Objects whose top is at or below this do not block (rugs, floor mats). */
export const KNEE_HEIGHT = 0.4;
/** Objects whose underside is at or above this do not block (high wall shelves). */
export const HEAD_HEIGHT = 1.8;
export const WALK_SPEED = 1.4;
export const RUN_SPEED = 2.4;
/** Arrow-key turn rate (rad/s) and the pitch limit. */
export const TURN_RATE = 1.8;
export const MAX_PITCH = (80 * Math.PI) / 180;
const MAX_SUBSTEP = 0.1;
const SLACK = 1e-7;

export interface WalkState { position: Vec2; yaw: number; pitch: number }
export interface WalkInput {
  /** −1..1: forward (+) / back (−), and right (+) / left (−). */
  forward: number;
  strafe: number;
  /** Radians per second from the arrow keys (+ = turn right). */
  turn: number;
  run: boolean;
  /** Radians to look this frame from dragging (+ = right / up). */
  lookYaw: number;
  lookPitch: number;
}

export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, turn: 0, run: false, lookYaw: 0, lookPitch: 0 };

// ------------------------------------------------------------------ obstacles

/** Furniture a standing person would bump into. */
export function blockingFootprints(room: Room): Vec2[][] {
  return room.furniture
    .filter((f) => f.elevation + f.height > KNEE_HEIGHT + EPSILON && f.elevation < HEAD_HEIGHT - EPSILON)
    .map((f) => footprintOf(f));
}

const polygonOf = (room: Room): Vec2[] => room.vertices.map((v) => v.position);

function signedArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return a / 2;
}

/** True when the walker may stand at `p`: inside the room with a full radius of clearance from every wall and every blocker. */
export function isWalkable(room: Room, p: Vec2, blockers: Vec2[][] = blockingFootprints(room)): boolean {
  const poly = polygonOf(room);
  if (poly.length < 3 || !pointInPolygonInclusive(p, poly, 0)) return false;
  if (distToPolygonBoundary(p, poly) < WALK_RADIUS - SLACK) return false;
  for (const b of blockers) {
    if (pointInPolygonInclusive(p, b, 0)) return false;
    if (distToPolygonBoundary(p, b) < WALK_RADIUS - SLACK) return false;
  }
  return true;
}

// ------------------------------------------------------------------ resolving overlaps

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  return add(a, scale(sub(b, a), projectParam(p, a, b)));
}

/** Push `p` out of the room's walls (keep a radius from every edge, on the inside). */
function pushFromWalls(p: Vec2, poly: Vec2[], ccw: boolean): Vec2 {
  let q = p;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = closestOnSegment(q, a, b);
    const d = dist(q, c);
    if (d >= WALK_RADIUS) continue;
    if (d > 1e-9) { q = add(c, scale(sub(q, c), WALK_RADIUS / d)); continue; }
    const e = normalize(sub(b, a));
    const inward = ccw ? { x: -e.y, y: e.x } : { x: e.y, y: -e.x };
    q = add(c, scale(inward, WALK_RADIUS));
  }
  return q;
}

/** Push `p` out of a convex blocker (a rotated rectangle) until it is a radius away. */
function pushFromBlocker(p: Vec2, poly: Vec2[]): Vec2 {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return p;
  const inside = pointInPolygonInclusive(p, poly, 0);
  if (!inside && bestD >= WALK_RADIUS) return p;
  if (bestD > 1e-9) {
    const away = inside ? sub(best, p) : sub(p, best); // from the inside, the way out is toward the nearest edge
    return add(best, scale(normalize(away), WALK_RADIUS));
  }
  // exactly on the boundary: step out along the nearest edge's outward normal
  const centre = poly.reduce((s, v) => add(s, v), { x: 0, y: 0 });
  const mid = scale(centre, 1 / poly.length);
  return add(best, scale(normalize(sub(best, mid)), WALK_RADIUS));
}

/** Resolve overlaps repeatedly: pushing out of one thing can push into another. */
export function resolveWalk(room: Room, p: Vec2, blockers: Vec2[][] = blockingFootprints(room)): Vec2 {
  const poly = polygonOf(room);
  const ccw = signedArea(poly) >= 0;
  let q = p;
  for (let pass = 0; pass < 8; pass++) {
    const before = q;
    q = pushFromWalls(q, poly, ccw);
    for (const b of blockers) q = pushFromBlocker(q, b);
    if (dist(q, before) < 1e-10) break;
  }
  return q;
}

/**
 * Move from `from` by `delta`, sliding along whatever is in the way. `from` must be walkable; the result always is (a step that
 * cannot be resolved is refused, so the walker stays where it last stood validly).
 */
export function walkStep(room: Room, from: Vec2, delta: Vec2): Vec2 {
  const blockers = blockingFootprints(room);
  const n = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y) / MAX_SUBSTEP));
  const step = scale(delta, 1 / n);
  let p = from;
  for (let i = 0; i < n; i++) {
    const next = resolveWalk(room, add(p, step), blockers);
    if (!isWalkable(room, next, blockers)) return p;
    p = next;
  }
  return p;
}

/** The walkable point nearest `p` (searching outward in rings), or null if the room has no room to stand in. */
export function nearestWalkable(room: Room, p: Vec2): Vec2 | null {
  const blockers = blockingFootprints(room);
  if (isWalkable(room, p, blockers)) return p;
  for (let r = 0.1; r <= 4; r += 0.1) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      if (isWalkable(room, q, blockers)) return q;
    }
  }
  const c = roomCentroid(room);
  return isWalkable(room, c, blockers) ? c : null;
}

// ------------------------------------------------------------------ state

/** Where walking starts: the entrance, looking into the room. Null if there is nowhere to stand. */
export function walkStart(room: Room): WalkState | null {
  const stop = autoStops(room, false)[0];
  const centre = roomCentroid(room);
  const want = stop ? { x: stop.position[0], y: stop.position[2] } : centre;
  const position = nearestWalkable(room, want);
  if (!position) return null;
  const look = sub(centre, position);
  return { position, yaw: dist(centre, position) < 1e-6 ? 0 : Math.atan2(look.y, look.x), pitch: 0 };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Advance the walker by `dt` seconds of input. Forward is the way the camera faces; strafe is to its right. */
export function stepWalk(room: Room, s: WalkState, input: WalkInput, dt: number): WalkState {
  const yaw = wrap(s.yaw + input.turn * dt + input.lookYaw);
  const pitch = clamp(s.pitch + input.lookPitch, -MAX_PITCH, MAX_PITCH);
  let mx = input.forward * Math.cos(yaw) - input.strafe * Math.sin(yaw);
  let my = input.forward * Math.sin(yaw) + input.strafe * Math.cos(yaw);
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const position = len === 0 ? s.position : walkStep(room, s.position, { x: mx * speed * dt, y: my * speed * dt });
  return { position, yaw, pitch };
}

/** Camera pose (three coordinates) for a walker: eye height, looking along yaw and pitch. */
export function walkPose(s: WalkState): { position: Vec3; target: Vec3 } {
  const cp = Math.cos(s.pitch);
  return {
    position: [s.position.x, WALK_EYE, s.position.y],
    target: [s.position.x + Math.cos(s.yaw) * cp, WALK_EYE + Math.sin(s.pitch), s.position.y + Math.sin(s.yaw) * cp],
  };
}

