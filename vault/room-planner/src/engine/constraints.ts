import { convexPenetration, verticalOverlap } from './collision';
import { EPSILON } from './coordinates';
import { footprintOf, localAxes, verticalInterval } from './footprints';
import { add, dist, normalize, perpLeft, rotateVec, scale, sub } from './geometry';
import type {
  ClearancePolicy, Fixture, FurnitureInstance, Interval, Room, ValidationViolation, Vec2, WallSegment,
} from './types';

/** Minimum clearance between a fixture opening edge and its wall end (C8). */
export const FIXTURE_END_MARGIN = 0.05;
/** Arc discretization (Phase 1 §7): max angular step 5° or max inscribed error 0.5 mm, whichever is finer. */
export const ARC_MAX_STEP_RAD = (5 * Math.PI) / 180;
export const ARC_MAX_ERROR = 0.0005;
export const DEFAULT_SWING_ANGLE = Math.PI / 2;

// ------------------------------------------------------------------ wall geometry

export interface WallGeom {
  wall: WallSegment;
  start: Vec2;
  end: Vec2;
  length: number;
  /** Unit vector from start vertex to end vertex. */
  dir: Vec2;
  /** Interior normal (room is on the left of a CCW boundary). */
  normal: Vec2;
}

export function wallGeometry(room: Room, wallId: string): WallGeom | undefined {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) return undefined;
  const s = room.vertices.find((v) => v.id === wall.startVertexId);
  const e = room.vertices.find((v) => v.id === wall.endVertexId);
  if (!s || !e) return undefined;
  const length = dist(s.position, e.position);
  const dir = normalize(sub(e.position, s.position));
  return { wall, start: s.position, end: e.position, length, dir, normal: perpLeft(dir) };
}

// ------------------------------------------------------------------ fixtures

/** Fixture centre point on the interior face. */
export function fixtureCentre(g: WallGeom, f: Fixture): Vec2 {
  return add(g.start, scale(g.dir, f.offsetAlongWall));
}

export function checkFixtureInWall(room: Room, f: Fixture): ValidationViolation[] {
  const out: ValidationViolation[] = [];
  const g = wallGeometry(room, f.wallId);
  const base = { type: 'fixture_out_of_wall' as const, severity: 'hard' as const, involvedObjectIds: [] as string[], involvedWallIds: [f.wallId], involvedFixtureIds: [f.id] };
  if (!g) {
    out.push({ ...base, message: 'Fixture is not attached to a wall' });
    return out;
  }
  const lo = f.offsetAlongWall - f.width / 2;
  const hi = f.offsetAlongWall + f.width / 2;
  if (lo < FIXTURE_END_MARGIN - EPSILON || hi > g.length - FIXTURE_END_MARGIN + EPSILON) {
    const overshoot = Math.max(0, FIXTURE_END_MARGIN - lo) + Math.max(0, hi - (g.length - FIXTURE_END_MARGIN));
    out.push({ ...base, message: 'Fixture is outside its wall segment or inside the end margin', magnitude: overshoot });
  }
  const vOver =
    Math.max(0, -f.elevation) +
    Math.max(0, f.elevation + f.height - room.wallHeight) +
    (f.type === 'door' ? Math.abs(f.elevation) : 0);
  if (vOver > EPSILON) {
    out.push({ ...base, message: 'Fixture is outside the wall vertical extent', magnitude: vOver });
  }
  return out;
}

/** Number of polygon segments for an arc so that both the 5° and 0.5 mm limits hold. */
export function arcSegmentCount(angle: number, radius: number): number {
  let step = ARC_MAX_STEP_RAD;
  if (radius > ARC_MAX_ERROR / 2) {
    step = Math.min(step, 2 * Math.acos(1 - ARC_MAX_ERROR / radius));
  }
  return Math.max(1, Math.ceil(angle / step - 1e-9));
}

export interface DoorShapes {
  hinge: Vec2;
  /** Convex pieces (triangles) covering the swing sector. */
  swing: Vec2[][];
  /** Convex pieces (quads) covering the access zone beyond the leaf. Empty if depth is 0. */
  access: Vec2[][];
  interval: Interval;
}

/**
 * Door swing geometry (Phase 1 §7). Viewed from inside the room facing the wall, hingeSide 'left' is toward the
 * wall's end vertex. The leaf swings from its closed position into the room through `swingAngle`.
 * Access zone = annular sector of depth `accessZoneDepth` beyond the leaf radius, over the same angular span.
 */
export function doorShapes(room: Room, f: Fixture): DoorShapes | undefined {
  if (f.type !== 'door') return undefined;
  const g = wallGeometry(room, f.wallId);
  if (!g) return undefined;
  const left = (f.hingeSide ?? 'left') === 'left';
  const centre = fixtureCentre(g, f);
  const hinge = add(centre, scale(g.dir, (left ? 1 : -1) * (f.width / 2)));
  const closed = scale(g.dir, left ? -1 : 1);
  const sign = left ? -1 : 1;
  const angle = f.swingAngle ?? DEFAULT_SWING_ANGLE;
  const at = (theta: number, r: number): Vec2 => add(hinge, scale(rotateVec(closed, sign * theta), r));

  const swing: Vec2[][] = [];
  const nSwing = arcSegmentCount(angle, f.width);
  const tri: Vec2[][] = [];
  for (let i = 0; i < nSwing; i++) {
    const a0 = (angle * i) / nSwing;
    const a1 = (angle * (i + 1)) / nSwing;
    tri.push([hinge, at(a0, f.width), at(a1, f.width)]);
  }
  // Normalise winding to CCW for each piece.
  for (const t of tri) swing.push(ccw(t));

  const access: Vec2[][] = [];
  const depth = f.accessZoneDepth ?? 0;
  if (depth > 0) {
    const r1 = f.width;
    const r2 = f.width + depth;
    const nAcc = arcSegmentCount(angle, r2);
    for (let i = 0; i < nAcc; i++) {
      const a0 = (angle * i) / nAcc;
      const a1 = (angle * (i + 1)) / nAcc;
      access.push(ccw([at(a0, r1), at(a0, r2), at(a1, r2), at(a1, r1)]));
    }
  }
  return { hinge, swing, access, interval: { min: f.elevation, max: f.elevation + f.height } };
}

function ccw(poly: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? [...poly].reverse() : poly;
}

/** Max penetration of a convex shape into any of the pieces (0 if none). */
export function piecesPenetration(shape: Vec2[], pieces: Vec2[][]): number {
  let m = 0;
  for (const p of pieces) m = Math.max(m, convexPenetration(shape, p));
  return m;
}

export function piecesOverlap(a: Vec2[][], b: Vec2[][]): boolean {
  for (const p of a) for (const q of b) if (convexPenetration(p, q) > 0) return true;
  return false;
}

/** Hard violations of one furniture instance against one door's swing sector / access zone. */
export function checkFurnitureVsDoor(
  inst: FurnitureInstance, door: Fixture, shapes: DoorShapes,
): ValidationViolation[] {
  const out: ValidationViolation[] = [];
  if (!verticalOverlap(verticalInterval(inst), shapes.interval)) return out;
  const fp = footprintOf(inst);
  const swingDepth = piecesPenetration(fp, shapes.swing);
  if (swingDepth > 0) {
    out.push({
      type: 'door_swing', severity: 'hard', message: 'Object blocks a door swing',
      involvedObjectIds: [inst.id], involvedFixtureIds: [door.id], involvedWallIds: [door.wallId], magnitude: swingDepth,
    });
  }
  const accDepth = piecesPenetration(fp, shapes.access);
  if (accDepth > 0) {
    out.push({
      type: 'fixture_access', severity: 'hard', message: 'Object blocks a door access zone',
      involvedObjectIds: [inst.id], involvedFixtureIds: [door.id], involvedWallIds: [door.wallId], magnitude: accDepth,
    });
  }
  return out;
}

/** Door-vs-door swing/access overlap is a soft violation (visual only). */
export function checkDoorVsDoor(a: Fixture, sa: DoorShapes, b: Fixture, sb: DoorShapes): ValidationViolation[] {
  if (piecesOverlap([...sa.swing, ...sa.access], [...sb.swing, ...sb.access])) {
    return [{
      type: 'door_swing', severity: 'soft', message: 'Door swings overlap',
      involvedObjectIds: [], involvedFixtureIds: [a.id, b.id], involvedWallIds: [a.wallId, b.wallId],
    }];
  }
  return [];
}

// ------------------------------------------------------------------ clearance

export interface ClearanceZone { policy: ClearancePolicy; polygon: Vec2[] }

/**
 * Clearance zones in world space (Spec §3): a rectangle extending `offset` outward from the matching footprint edge in
 * the object's rotated frame. 'all' is the union of the four edge rectangles (corners are not filled).
 */
export function clearanceZones(inst: FurnitureInstance, policies: ClearancePolicy[]): ClearanceZone[] {
  const { u, v } = localAxes(inst.rotation);
  const hw = inst.width / 2;
  const hl = inst.length / 2;
  const rect = (x0: number, x1: number, y0: number, y1: number): Vec2[] =>
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) =>
      add(inst.position, add(scale(u, x), scale(v, y))));
  const zones: ClearanceZone[] = [];
  for (const policy of policies) {
    const o = policy.offset;
    if (o <= 0) continue;
    const sides = policy.side === 'all' ? (['front', 'back', 'left', 'right'] as const) : [policy.side];
    for (const s of sides) {
      let polygon: Vec2[];
      if (s === 'front') polygon = rect(-hw, hw, hl, hl + o);
      else if (s === 'back') polygon = rect(-hw, hw, -hl - o, -hl);
      else if (s === 'right') polygon = rect(hw, hw + o, -hl, hl);
      else polygon = rect(-hw - o, -hw, -hl, hl);
      zones.push({ policy, polygon });
    }
  }
  return zones;
}
