import { convexPenetration, verticalOverlap } from './collision';
import { checkContainment } from './containment';
import {
  checkDoorVsDoor, checkFixtureInWall, checkFurnitureVsDoor, clearanceZones, doorShapes, piecesPenetration,
  type ClearanceZone, type DoorShapes,
} from './constraints';
import { footprintOf, verticalInterval } from './footprints';
import { aabbOf, aabbOverlap } from './geometry';
import type {
  AABB, ConstraintType, Fixture, FurnitureDefinition, FurnitureInstance, Interval, Room, ValidationResult,
  ValidationViolation, Vec2,
} from './types';

/** Feedback priority (Spec §4): outside room → door swing → fixture access → collision → clearance. */
const PRIORITY: ConstraintType[] = [
  'locked', 'outside_room', 'fixture_out_of_wall', 'door_swing', 'fixture_access', 'physical_collision', 'clearance',
];
export const priorityOf = (t: ConstraintType): number => PRIORITY.indexOf(t);

/** Per-object geometry computed once per validation pass. */
interface Prepared {
  inst: FurnitureInstance;
  corners: Vec2[];
  box: AABB;
  interval: Interval;
  zones: ClearanceZone[];
  /** Largest clearance offset: bounds how far this object's zones can reach beyond its footprint. */
  reach: number;
}

function prepare(inst: FurnitureInstance, defs: FurnitureDefinition[]): Prepared {
  const corners = footprintOf(inst);
  const policies = defs.find((d) => d.id === inst.definitionId)?.clearancePolicies ?? [];
  return {
    inst, corners, box: aabbOf(corners), interval: verticalInterval(inst),
    zones: policies.length ? clearanceZones(inst, policies) : [],
    reach: policies.reduce((m, p) => Math.max(m, p.offset), 0),
  };
}

const expand = (b: AABB, by: number): AABB => ({
  min: { x: b.min.x - by, y: b.min.y - by }, max: { x: b.max.x + by, y: b.max.y + by },
});

function doorMap(room: Room): Map<string, DoorShapes> {
  const m = new Map<string, DoorShapes>();
  for (const f of room.fixtures) {
    const s = doorShapes(room, f);
    if (s) m.set(f.id, s);
  }
  return m;
}

// ------------------------------------------------------------------ building blocks

function containmentViolations(room: Room, p: Prepared): ValidationViolation[] {
  const c = checkContainment(p.corners, room.vertices, room.walls);
  if (c.inside) return [];
  return [{
    type: 'outside_room', severity: 'hard', message: 'Object extends outside the room',
    involvedObjectIds: [p.inst.id], involvedWallIds: c.wallIds, magnitude: c.magnitude,
  }];
}

function doorViolations(room: Room, doors: Map<string, DoorShapes>, p: Prepared): ValidationViolation[] {
  const out: ValidationViolation[] = [];
  for (const f of room.fixtures) {
    const s = doors.get(f.id);
    if (s) out.push(...checkFurnitureVsDoor(p.inst, f, s));
  }
  return out;
}

/** The owner's clearance zones landing on `target` (hard and soft reported separately). */
function zoneHits(owner: Prepared, target: Prepared): ValidationViolation[] {
  if (!owner.zones.length) return [];
  if (!aabbOverlap(expand(owner.box, owner.reach), target.box)) return [];
  if (!verticalOverlap(owner.interval, target.interval)) return [];
  const sev = new Set<'hard' | 'soft'>();
  for (const z of owner.zones) {
    if (convexPenetration(z.polygon, target.corners) > 0) sev.add(z.policy.severity);
  }
  return [...sev].map((severity) => ({
    type: 'clearance' as const, severity, message: 'Object is inside a clearance zone',
    involvedObjectIds: [owner.inst.id, target.inst.id],
  }));
}

function pairViolations(a: Prepared, b: Prepared): ValidationViolation[] {
  const out: ValidationViolation[] = [];
  if (aabbOverlap(a.box, b.box) && verticalOverlap(a.interval, b.interval)) {
    const depth = convexPenetration(a.corners, b.corners);
    if (depth > 0) {
      out.push({
        type: 'physical_collision', severity: 'hard', message: 'Objects overlap',
        involvedObjectIds: [a.inst.id, b.inst.id], magnitude: depth,
      });
    }
  }
  out.push(...zoneHits(a, b), ...zoneHits(b, a));
  return out;
}

/** The object's own clearance zones against door swing sectors and access zones. */
function doorClearance(room: Room, doors: Map<string, DoorShapes>, p: Prepared): ValidationViolation[] {
  if (!p.zones.length) return [];
  const out: ValidationViolation[] = [];
  for (const f of room.fixtures) {
    const s = doors.get(f.id);
    if (!s || !verticalOverlap(p.interval, s.interval)) continue;
    const sev = new Set<'hard' | 'soft'>();
    for (const z of p.zones) {
      if (piecesPenetration(z.polygon, [...s.swing, ...s.access]) > 0) sev.add(z.policy.severity);
    }
    for (const severity of sev) {
      out.push({
        type: 'clearance', severity, message: 'Door swing is inside a clearance zone',
        involvedObjectIds: [p.inst.id], involvedFixtureIds: [f.id],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ public API

/**
 * Every violation that involves `inst` (which may be a candidate not yet in `room.furniture`).
 * Includes clearance zones of other objects landing on `inst`.
 */
export function validateInstance(
  room: Room, defs: FurnitureDefinition[], inst: FurnitureInstance, doors: Map<string, DoorShapes> = doorMap(room),
): ValidationViolation[] {
  const me = prepare(inst, defs);
  const out: ValidationViolation[] = [
    ...containmentViolations(room, me),
    ...doorViolations(room, doors, me),
    ...doorClearance(room, doors, me),
  ];
  for (const o of room.furniture) {
    if (o.id !== inst.id) out.push(...pairViolations(me, prepare(o, defs)));
  }
  return out;
}

/** Violations involving a fixture: wall fit, objects in its swing/access zones, door-vs-door. */
export function validateFixture(room: Room, f: Fixture): ValidationViolation[] {
  const out: ValidationViolation[] = checkFixtureInWall(room, f);
  const s = doorShapes(room, f);
  if (!s) return out;
  for (const inst of room.furniture) out.push(...checkFurnitureVsDoor(inst, f, s));
  for (const other of room.fixtures) {
    if (other.id === f.id) continue;
    const so = doorShapes(room, other);
    if (so) out.push(...checkDoorVsDoor(f, s, other, so));
  }
  return out;
}

function key(v: ValidationViolation): string {
  const ids = (a?: string[]) => [...(a ?? [])].sort().join(',');
  return `${v.type}|${v.severity}|${ids(v.involvedObjectIds)}|${ids(v.involvedFixtureIds)}`;
}

export function dedupeAndSort(violations: ValidationViolation[]): ValidationViolation[] {
  const seen = new Map<string, ValidationViolation>();
  for (const v of violations) {
    const k = key(v);
    const prev = seen.get(k);
    if (!prev || (v.magnitude ?? 0) > (prev.magnitude ?? 0)) seen.set(k, v);
  }
  return [...seen.values()].sort((a, b) => priorityOf(a.type) - priorityOf(b.type));
}

export function toResult(violations: ValidationViolation[]): ValidationResult {
  const sorted = dedupeAndSort(violations);
  return { valid: !sorted.some((v) => v.severity === 'hard'), violations: sorted };
}

/** Full re-validation pass (Phase 1 §6, A3): containment → collision → fixture constraints → clearances. */
export function validateRoom(room: Room, defs: FurnitureDefinition[]): ValidationResult {
  const doors = doorMap(room);
  const prepared = room.furniture.map((f) => prepare(f, defs));
  const all: ValidationViolation[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    all.push(...containmentViolations(room, p), ...doorViolations(room, doors, p), ...doorClearance(room, doors, p));
    for (let j = i + 1; j < prepared.length; j++) all.push(...pairViolations(p, prepared[j]));
  }
  for (const f of room.fixtures) all.push(...checkFixtureInWall(room, f));
  const ds = room.fixtures.filter((f) => doors.has(f.id));
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      all.push(...checkDoorVsDoor(ds[i], doors.get(ds[i].id)!, ds[j], doors.get(ds[j].id)!));
    }
  }
  return toResult(all);
}

/** Violations that involve one object, sorted by feedback priority. */
export function violationsFor(result: ValidationResult, objectId: string): ValidationViolation[] {
  return result.violations.filter((v) => v.involvedObjectIds.includes(objectId));
}

/** The single violation the status bar shows (B5): highest priority, hard before soft. */
export function primaryViolation(result: ValidationResult): ValidationViolation | undefined {
  const hard = result.violations.filter((v) => v.severity === 'hard');
  return (hard.length ? hard : result.violations)[0];
}
