// Walk mode for the garden: first-person movement at eye height with collision. Pure (no three.js) so the one guarantee that matters, that the
// walker is never inside a wall, a fence, a structure or a plant's trunk, is property-tested. Adapted from Room Planner's walker (which is
// inside a closed room) to open ground.
//
// The walker is a circle of radius WALK_RADIUS on the plan. It is kept out of everything a standing person would bump into: the house, solid
// structures, fences and hedges (except through a gate), and the trunk or dense core of a plant. Things at or below knee height (lawn, paths,
// a deck, groundcover) do not block. Movement is applied in small steps and pushed out of whatever it overlaps, so the walker slides along a
// wall instead of stopping dead; a step that cannot be resolved is refused.
//
// Plan axes: +x east-ish, +y up the plan (north when the north arrow is up). `yaw` is the direction faced, counter-clockwise from +x. The 3D
// scene maps plan (x, y) to three (x, -y), which `walkPose` does.
import { add, dist, distToPolygonBoundary, normalize, pointInPolygonInclusive, projectParam, scale, sub } from '@planner-core/engine/geometry';
import { footprintCorners } from '@planner-core/engine/footprints';
import type { Vec2 } from '@planner-core/types';
import { sampleShape } from '../domain/shapes';
import type { FenceType, GardenProject, Structure } from '../domain/types';
import { plantSizeAt } from '../plants/growth';
import { plantById } from '../plants/plants';
import type { GrowthStage } from '../plants/growth';

export const WALK_EYE = 1.6;
export const WALK_RADIUS = 0.25;
/** Things whose top is at or below this do not block (lawn, paths, a deck, groundcover). */
export const KNEE_HEIGHT = 0.4;
export const WALK_SPEED = 1.4;
export const RUN_SPEED = 2.4;
/** Arrow-key turn rate (rad/s) and the pitch limit. */
export const TURN_RATE = 1.8;
export const MAX_PITCH = (80 * Math.PI) / 180;
/** The walker cannot leave a box this far outside the plot (the 3D ground is only so big). */
export const WORLD_MARGIN = 40;
const MAX_SUBSTEP = 0.1;
const SLACK = 1e-7;
/** Fence thickness on the plan, by type (a hedge is a metre wide of leaves; a paling fence is a few centimetres). */
const FENCE_THICKNESS: Record<FenceType, number> = { colorbond: 0.06, timber_paling: 0.08, brick: 0.2, hedge: 0.6, open: 0 };
/** Structures that never block: a person walks onto a deck and under a pergola, and a clothesline's poles are thin. Gates are openings. */
const PASSABLE: ReadonlyArray<Structure['kind']> = ['deck', 'pergola', 'clothesline', 'gate'];

/** Solid however low they are: nobody walks into a pool (it is only a few centimetres high in the model: its water is below the ground). */
const ALWAYS_SOLID: ReadonlyArray<Structure['kind']> = ['pool'];

export type Obstacle =
  | { kind: 'poly'; pts: Vec2[]; fence: boolean }
  | { kind: 'circle'; c: Vec2; r: number };

export interface WalkWorld {
  obstacles: Obstacle[];
  /** Openings in the fence: while the walker's centre is inside one, the fence does not block. */
  gates: Vec2[][];
  min: Vec2;
  max: Vec2;
  /** Where the plot is, to start from and face. */
  centre: Vec2;
  houseCentre: Vec2 | null;
  /** The first gate and the way into the plot through it, or null. */
  entrance: { at: Vec2; inward: Vec2 } | null;
}

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

// ------------------------------------------------------------------ the world to walk in

const centroid = (pts: Vec2[]): Vec2 => scale(pts.reduce((s, q) => add(s, q), { x: 0, y: 0 }), 1 / Math.max(1, pts.length));

/** A thin rectangle along a segment, `t` metres thick. */
function band(a: Vec2, b: Vec2, t: number): Vec2[] {
  const d = normalize(sub(b, a));
  const n = { x: -d.y * (t / 2), y: d.x * (t / 2) };
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

/** What the person can bump into, from the garden as it is at this growth stage. */
export function buildWalkWorld(p: GardenProject, stage: GrowthStage): WalkWorld {
  const obstacles: Obstacle[] = [];
  const gates: Vec2[][] = [];
  const all: Vec2[] = [];

  if (p.house && p.house.height > KNEE_HEIGHT) {
    const pts = p.house.vertices.map((v) => v.position);
    obstacles.push({ kind: 'poly', pts, fence: false });
  }
  if (p.house) all.push(...p.house.vertices.map((v) => v.position));
  if (p.boundary) {
    const v = p.boundary.vertices.map((q) => q.position);
    all.push(...v);
    for (let i = 0; i < v.length; i += 1) {
      const seg = p.boundary.segments[i];
      if (!seg || seg.fence === 'open' || !(seg.height > KNEE_HEIGHT)) continue;
      obstacles.push({ kind: 'poly', pts: band(v[i], v[(i + 1) % v.length], FENCE_THICKNESS[seg.fence]), fence: true });
    }
  }
  for (const s of p.structures) {
    const corners = footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation });
    all.push(...corners);
    if (s.kind === 'gate') {
      // the opening: as wide as the gate, and deep enough to stand in with the fence's thickness either side
      gates.push(footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1) + 2 * WALK_RADIUS + 0.2, rotation: s.rotation }));
      continue;
    }
    if (PASSABLE.includes(s.kind)) continue;
    if (!ALWAYS_SOLID.includes(s.kind) && !(s.height > KNEE_HEIGHT)) continue;
    obstacles.push({ kind: 'poly', pts: corners, fence: false });
  }
  for (const b of p.beds) all.push(...sampleShape(b.shape));

  for (const inst of p.plants) {
    const rec = plantById(inst.plantId);
    if (!rec) continue;
    const size = plantSizeAt(rec, stage);
    if (size.height <= KNEE_HEIGHT) continue; // groundcover, young seedlings
    let r: number;
    if (rec.type === 'tree' || rec.type === 'palm') r = Math.min(0.4, Math.max(0.1, 0.08 + 0.012 * size.height)); // the trunk: you can walk under the leaves
    else r = Math.min(size.height >= 0.6 ? 0.7 : 0.4, size.spread * (size.height >= 0.6 ? 0.35 : 0.25)); // the dense core of a shrub
    if (r > 0.05) obstacles.push({ kind: 'circle', c: inst.position, r });
    all.push(inst.position);
  }

  const plot = p.boundary ? p.boundary.vertices.map((q) => q.position) : all;
  const base = all.length ? all : [{ x: 0, y: 0 }];
  const xs = base.map((q) => q.x), ys = base.map((q) => q.y);
  const min = { x: Math.min(...xs) - WORLD_MARGIN, y: Math.min(...ys) - WORLD_MARGIN };
  const max = { x: Math.max(...xs) + WORLD_MARGIN, y: Math.max(...ys) + WORLD_MARGIN };
  const centre = plot.length ? centroid(plot) : { x: 0, y: 0 };
  const gate = p.structures.find((s) => s.kind === 'gate');
  let entrance: WalkWorld['entrance'] = null;
  if (gate) {
    const toCentre = normalize(sub(centre, gate.position));
    entrance = { at: gate.position, inward: dist(centre, gate.position) < 1e-6 ? { x: 0, y: 1 } : toCentre };
  }
  return { obstacles, gates, min, max, centre, houseCentre: p.house ? centroid(p.house.vertices.map((v) => v.position)) : null, entrance };
}

// ------------------------------------------------------------------ is this spot free?

const inGate = (w: WalkWorld, p: Vec2): boolean => w.gates.some((g) => pointInPolygonInclusive(p, g, 0));

/** True when the walker may stand at `p`: inside the world, with a full radius of clearance from everything solid. */
export function isWalkable(w: WalkWorld, p: Vec2): boolean {
  if (p.x < w.min.x || p.x > w.max.x || p.y < w.min.y || p.y > w.max.y) return false;
  const open = inGate(w, p);
  for (const o of w.obstacles) {
    if (o.kind === 'circle') { if (dist(p, o.c) < o.r + WALK_RADIUS - SLACK) return false; continue; }
    if (o.fence && open) continue;
    if (pointInPolygonInclusive(p, o.pts, 0)) return false;
    if (distToPolygonBoundary(p, o.pts) < WALK_RADIUS - SLACK) return false;
  }
  return true;
}

// ------------------------------------------------------------------ resolving overlaps

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  return add(a, scale(sub(b, a), Math.max(0, Math.min(1, projectParam(p, a, b)))));
}

/** Push `p` out of a polygon until it is a radius away (from the inside, toward the nearest edge). */
function pushFromPoly(p: Vec2, poly: Vec2[]): Vec2 {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const c = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return p;
  const inside = pointInPolygonInclusive(p, poly, 0);
  if (!inside && bestD >= WALK_RADIUS) return p;
  if (bestD > 1e-9) return add(best, scale(normalize(inside ? sub(best, p) : sub(p, best)), WALK_RADIUS));
  const mid = centroid(poly);
  return add(best, scale(normalize(sub(best, mid)), WALK_RADIUS));
}

function pushFromCircle(p: Vec2, c: Vec2, r: number): Vec2 {
  const d = dist(p, c);
  const need = r + WALK_RADIUS;
  if (d >= need) return p;
  const dir = d > 1e-9 ? scale(sub(p, c), 1 / d) : { x: 1, y: 0 };
  return add(c, scale(dir, need));
}

/** Resolve overlaps repeatedly: pushing out of one thing can push into another. */
export function resolveWalk(w: WalkWorld, p: Vec2): Vec2 {
  let q = p;
  for (let pass = 0; pass < 8; pass += 1) {
    const before = q;
    const open = inGate(w, q);
    for (const o of w.obstacles) {
      if (o.kind === 'circle') q = pushFromCircle(q, o.c, o.r);
      else if (!(o.fence && open)) q = pushFromPoly(q, o.pts);
    }
    q = { x: Math.max(w.min.x, Math.min(w.max.x, q.x)), y: Math.max(w.min.y, Math.min(w.max.y, q.y)) };
    if (dist(q, before) < 1e-10) break;
  }
  return q;
}

/**
 * Move from `from` by `delta`, sliding along whatever is in the way. `from` must be walkable; the result always is (a step that cannot be
 * resolved is refused, so the walker stays where it last stood validly).
 */
export function walkStep(w: WalkWorld, from: Vec2, delta: Vec2): Vec2 {
  const n = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y) / MAX_SUBSTEP));
  const step = scale(delta, 1 / n);
  let p = from;
  for (let i = 0; i < n; i += 1) {
    const next = resolveWalk(w, add(p, step));
    if (!isWalkable(w, next)) return p;
    p = next;
  }
  return p;
}

/** The walkable point nearest `p` (searching outward in rings), or null if there is nowhere to stand. */
export function nearestWalkable(w: WalkWorld, p: Vec2): Vec2 | null {
  if (isWalkable(w, p)) return p;
  for (let r = 0.1; r <= 12; r += 0.1) {
    for (let k = 0; k < 32; k += 1) {
      const a = (k / 32) * Math.PI * 2;
      const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      if (isWalkable(w, q)) return q;
    }
  }
  return null;
}

// ------------------------------------------------------------------ state

/** Where walking starts: just inside the gate if there is one, otherwise the middle of the plot, looking at the house (or the plot's middle). */
export function walkStart(w: WalkWorld): WalkState | null {
  const want = w.entrance ? add(w.entrance.at, scale(w.entrance.inward, 1.2)) : w.centre;
  const position = nearestWalkable(w, want);
  if (!position) return null;
  const target = w.houseCentre && dist(w.houseCentre, position) > 0.5 ? w.houseCentre : w.centre;
  const look = sub(target, position);
  return { position, yaw: Math.hypot(look.x, look.y) < 1e-6 ? Math.PI / 2 : Math.atan2(look.y, look.x), pitch: 0 };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Advance the walker by `dt` seconds of input. Forward is the way the camera faces; strafe is to its right. */
export function stepWalk(w: WalkWorld, s: WalkState, input: WalkInput, dt: number): WalkState {
  // positive input is to the right, which on a plan with y up is a clockwise turn: the yaw gets smaller
  const yaw = wrap(s.yaw - (input.turn * dt + input.lookYaw));
  const pitch = clamp(s.pitch + input.lookPitch, -MAX_PITCH, MAX_PITCH);
  let mx = input.forward * Math.cos(yaw) + input.strafe * Math.sin(yaw);
  let my = input.forward * Math.sin(yaw) - input.strafe * Math.cos(yaw);
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const position = len === 0 ? s.position : walkStep(w, s.position, { x: mx * speed * dt, y: my * speed * dt });
  return { position, yaw, pitch };
}

/** Camera pose in three.js coordinates (plan (x, y) is three (x, -y)): eye height, looking along yaw and pitch. */
export function walkPose(s: WalkState): { position: [number, number, number]; target: [number, number, number] } {
  const cp = Math.cos(s.pitch);
  return {
    position: [s.position.x, WALK_EYE, -s.position.y],
    target: [s.position.x + Math.cos(s.yaw) * cp, WALK_EYE + Math.sin(s.pitch), -(s.position.y + Math.sin(s.yaw) * cp)],
  };
}
