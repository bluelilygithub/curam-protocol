import { apply } from './commands';
import {
  EPSILON, angularDistance, quantizeLinear, quantizeRotation, quantizeVec2,
} from './coordinates';
import { footprintOf } from './footprints';
import { aabbOf, add, rotateVec, scale, sub } from './geometry';
import { findNearestValidPosition } from './nearestValid';
import { normalizeCCW, validatePolygon } from './polygons';
import { rankSnapCandidates } from './snapping';
import { validateFixture, validateInstance } from './validation';
import {
  ApplyError,
  type Command, type Fixture, type FixturePatch, type FurnitureInstance, type FurniturePatch, type PolygonErrorCode,
  type Project, type Room, type RoomGeometryState, type SnapCandidate, type ValidationViolation, type Vec2,
} from './types';

/**
 * Canonical commit pipeline (C11): resolve snap → quantize → lock check → validate → escape rule → emit command.
 * Pure: never mutates state, never throws on constraint failure; returns a command or a structured rejection.
 */
export interface PipelineRejection {
  rejected: true;
  violations: ValidationViolation[];
  polygonError?: PolygonErrorCode;
  /** The proposal equals the current state: nothing to commit, nothing to report. */
  noop?: boolean;
  message?: string;
}
export type PipelineResult = { rejected: false; command: Command } | PipelineRejection;

export interface PipelineContext {
  snapCandidates?: SnapCandidate[];
  snapDistance?: number;
  /** Active angular snap increment in degrees (default 0.1). */
  angularSnapDeg?: number;
}

const accept = (command: Command): PipelineResult => ({ rejected: false, command });
const reject = (violations: ValidationViolation[], extra: Partial<PipelineRejection> = {}): PipelineResult => ({
  rejected: true, violations, ...extra,
});
const noop = (): PipelineResult => reject([], { noop: true });

function lockedViolation(id: string): ValidationViolation {
  return { type: 'locked', severity: 'hard', message: 'Object is locked', involvedObjectIds: [id] };
}

function locate(project: Project, id: string): { room: Room; inst: FurnitureInstance } {
  for (const room of project.rooms) {
    const inst = room.furniture.find((f) => f.id === id);
    if (inst) return { room, inst };
  }
  throw new ApplyError('ID_NOT_FOUND', `furniture instance ${id} not found`);
}

const hardOnly = (vs: ValidationViolation[]): ValidationViolation[] => vs.filter((v) => v.severity === 'hard');

/** Identity of a violation for the escape rule: type + the other objects/fixtures involved (not walls, not magnitude). */
function violationKey(v: ValidationViolation, selfId?: string): string {
  const others = v.involvedObjectIds.filter((i) => i !== selfId).sort().join(',');
  const fixtures = (v.involvedFixtureIds ?? []).slice().sort().join(',');
  return `${v.type}|${others}|${fixtures}`;
}

/**
 * Escape rule (Phase 1 §6): an object with no hard violations must stay at none. An already-invalid object may commit
 * if it introduces no new violation (type + involved objects) and no violation gets worse (magnitude).
 */
function escapeOk(before: ValidationViolation[], after: ValidationViolation[], selfId?: string): boolean {
  if (after.length === 0) return true;
  if (before.length === 0) return false;
  const prior = new Map<string, number>();
  for (const v of before) {
    const k = violationKey(v, selfId);
    prior.set(k, Math.max(prior.get(k) ?? 0, v.magnitude ?? 0));
  }
  for (const v of after) {
    const k = violationKey(v, selfId);
    const was = prior.get(k);
    if (was === undefined) return false;
    if ((v.magnitude ?? 0) > was + EPSILON) return false;
  }
  return true;
}

/**
 * The pipeline's validate + escape-rule step, exposed so the interaction layer can give live per-frame feedback with
 * exactly the same decision the commit will make. `ok` means "this command would be committed".
 */
export function evaluateCommand(
  project: Project, command: Command, subjectIds: string[],
): { ok: boolean; violations: ValidationViolation[] } {
  return evaluate(project, command, subjectIds);
}

function evaluate(
  project: Project, command: Command, subjectIds: string[],
): { ok: boolean; violations: ValidationViolation[] } {
  const after = apply(command, project);
  const defs = project.furnitureDefinitions;
  const reported: ValidationViolation[] = [];
  let ok = true;
  for (const id of subjectIds) {
    const a = after.rooms.flatMap((r) => r.furniture.map((f) => ({ r, f }))).find((x) => x.f.id === id);
    if (!a) continue;
    const afterHard = hardOnly(validateInstance(a.r, defs, a.f)).filter((v) => v.involvedObjectIds.includes(id));
    const b = project.rooms.flatMap((r) => r.furniture.map((f) => ({ r, f }))).find((x) => x.f.id === id);
    const beforeHard = b ? hardOnly(validateInstance(b.r, defs, b.f)).filter((v) => v.involvedObjectIds.includes(id)) : [];
    reported.push(...afterHard);
    if (!escapeOk(beforeHard, afterHard, id)) ok = false;
  }
  return { ok, violations: reported };
}

/** Try snap candidates (best first), then the raw proposal. A snap that causes a hard violation is discarded (A2). */
function firstAcceptable<T>(
  ranked: T[], build: (c: T) => PipelineResult | { command: Command } | null, project: Project, ids: string[],
): PipelineResult {
  let last: PipelineResult = noop();
  for (const c of ranked) {
    const built = build(c);
    if (built === null) { last = noop(); continue; }
    if ('rejected' in built) return built;
    const r = evaluate(project, built.command, ids);
    if (r.ok) return accept(built.command);
    last = reject(r.violations);
  }
  return last;
}

// ------------------------------------------------------------------ furniture

export function proposeMove(project: Project, id: string, proposed: Vec2, ctx: PipelineContext = {}): PipelineResult {
  const { inst } = locate(project, id);
  if (inst.locked) return reject([lockedViolation(id)]);
  const targets: Vec2[] = [
    ...rankSnapCandidates(ctx.snapCandidates ?? [], ctx.snapDistance).map((c) => c.position),
    proposed,
  ];
  const seen = new Set<string>();
  const queue: Vec2[] = [];
  for (const t of targets) {
    const q = quantizeVec2(t);
    const k = `${q.x},${q.y}`;
    if (!seen.has(k)) { seen.add(k); queue.push(q); }
  }
  return firstAcceptable(queue, (to) =>
    to.x === inst.position.x && to.y === inst.position.y
      ? null
      : { command: { type: 'MoveFurniture', instanceId: id, from: { ...inst.position }, to } }, project, [id]);
}

export function proposeResize(
  project: Project, id: string, proposed: { position: Vec2; width: number; length: number },
): PipelineResult {
  const { inst } = locate(project, id);
  if (inst.locked) return reject([lockedViolation(id)]);
  const to = {
    position: quantizeVec2(proposed.position),
    width: quantizeLinear(proposed.width),
    length: quantizeLinear(proposed.length),
  };
  if (to.width <= 0 || to.length <= 0) throw new RangeError('resize dimensions must be positive');
  const from = { position: { ...inst.position }, width: inst.width, length: inst.length };
  if (to.position.x === from.position.x && to.position.y === from.position.y && to.width === from.width && to.length === from.length) {
    return noop();
  }
  const command: Command = { type: 'ResizeFurniture', instanceId: id, from, to };
  const r = evaluate(project, command, [id]);
  return r.ok ? accept(command) : reject(r.violations);
}

export function proposeRotate(project: Project, id: string, proposedRad: number, ctx: PipelineContext = {}): PipelineResult {
  const { inst } = locate(project, id);
  if (inst.locked) return reject([lockedViolation(id)]);
  const to = quantizeRotation(proposedRad, ctx.angularSnapDeg ?? 0.1);
  if (angularDistance(to, inst.rotation) < 1e-12) return noop();
  const command: Command = { type: 'RotateFurniture', instanceId: id, from: inst.rotation, to };
  const r = evaluate(project, command, [id]);
  return r.ok ? accept(command) : reject(r.violations);
}

export function proposeDelete(project: Project, id: string): PipelineResult {
  const { inst } = locate(project, id);
  if (inst.locked) return reject([lockedViolation(id)]);
  return accept({ type: 'DeleteFurniture', instanceId: id, snapshot: structuredClone(inst) });
}

export function quantizeInstance(inst: FurnitureInstance): FurnitureInstance {
  return {
    ...inst,
    position: quantizeVec2(inst.position),
    elevation: quantizeLinear(inst.elevation),
    width: quantizeLinear(inst.width),
    length: quantizeLinear(inst.length),
    height: quantizeLinear(inst.height),
    rotation: quantizeRotation(inst.rotation),
  };
}

export function proposePlaceFurniture(project: Project, instance: FurnitureInstance): PipelineResult {
  const q = quantizeInstance(instance);
  const command: Command = { type: 'PlaceFurniture', instance: q };
  const r = evaluate(project, command, [q.id]);
  return r.ok ? accept(command) : reject(r.violations);
}

export function proposeUpdateFurniture(project: Project, id: string, to: FurniturePatch): PipelineResult {
  const { inst } = locate(project, id);
  const keys = Object.keys(to);
  if (inst.locked && !(keys.length === 1 && keys[0] === 'locked')) return reject([lockedViolation(id)]);
  const q: FurniturePatch = { ...to };
  if (q.elevation !== undefined) q.elevation = quantizeLinear(q.elevation);
  if (q.height !== undefined) q.height = quantizeLinear(q.height);
  const from: Record<string, unknown> = {};
  for (const k of keys) from[k] = (inst as unknown as Record<string, unknown>)[k] ?? null;
  const command: Command = { type: 'UpdateFurniture', instanceId: id, from: from as FurniturePatch, to: q };
  if (!keys.some((k) => k === 'elevation' || k === 'height')) return accept(command);
  const r = evaluate(project, command, [id]);
  return r.ok ? accept(command) : reject(r.violations);
}

// ------------------------------------------------------------------ fixtures

function quantizeFixture(f: Fixture): Fixture {
  return {
    ...f,
    offsetAlongWall: quantizeLinear(f.offsetAlongWall),
    width: quantizeLinear(f.width),
    height: quantizeLinear(f.height),
    elevation: quantizeLinear(f.elevation),
  };
}

export function proposePlaceFixture(project: Project, fixture: Fixture): PipelineResult {
  const q = quantizeFixture(fixture);
  const room = project.rooms.find((r) => r.walls.some((w) => w.id === q.wallId));
  if (!room) throw new ApplyError('ID_NOT_FOUND', `wall ${q.wallId} not found`);
  const hard = hardOnly(validateFixture({ ...room, fixtures: [...room.fixtures, q] }, q, project.furnitureDefinitions))
    .filter((v) => (v.involvedFixtureIds ?? []).includes(q.id));
  return hard.length ? reject(hard) : accept({ type: 'PlaceFixture', fixture: q });
}

export function proposeUpdateFixture(project: Project, id: string, to: FixturePatch): PipelineResult {
  const room = project.rooms.find((r) => r.fixtures.some((f) => f.id === id));
  if (!room) throw new ApplyError('ID_NOT_FOUND', `fixture ${id} not found`);
  const fx = room.fixtures.find((f) => f.id === id)!;
  const q: FixturePatch = { ...to };
  for (const k of ['offsetAlongWall', 'width', 'height', 'elevation'] as const) {
    if (q[k] !== undefined) q[k] = quantizeLinear(q[k] as number);
  }
  const from: Record<string, unknown> = {};
  for (const k of Object.keys(q)) from[k] = (fx as unknown as Record<string, unknown>)[k] ?? null;
  const command: Command = { type: 'UpdateFixture', fixtureId: id, from: from as FixturePatch, to: q };
  const afterRoom = apply(command, project).rooms.find((r) => r.id === room.id)!;
  const afterFx = afterRoom.fixtures.find((f) => f.id === id)!;
  const afterHard = hardOnly(validateFixture(afterRoom, afterFx, project.furnitureDefinitions)).filter((v) => (v.involvedFixtureIds ?? []).includes(id));
  const beforeHard = hardOnly(validateFixture(room, fx, project.furnitureDefinitions)).filter((v) => (v.involvedFixtureIds ?? []).includes(id));
  return escapeOk(beforeHard, afterHard) ? accept(command) : reject(afterHard);
}

export function proposeDeleteFixture(project: Project, id: string): PipelineResult {
  const room = project.rooms.find((r) => r.fixtures.some((f) => f.id === id));
  if (!room) throw new ApplyError('ID_NOT_FOUND', `fixture ${id} not found`);
  return accept({ type: 'DeleteFixture', fixtureId: id, snapshot: structuredClone(room.fixtures.find((f) => f.id === id)!) });
}

// ------------------------------------------------------------------ rooms & walls

function quantizeGeometry(g: RoomGeometryState): RoomGeometryState {
  return {
    vertices: normalizeCCW(g.vertices.map((v) => ({ id: v.id, position: quantizeVec2(v.position) }))),
    walls: g.walls.map((w) => ({ ...w, thickness: quantizeLinear(w.thickness) })),
    fixtures: g.fixtures.map(quantizeFixture),
  };
}

/** EditWall (§6a): polygon validity only. Furniture/fixture outcomes never block; re-validation reports them. */
export function proposeEditWall(project: Project, roomId: string, candidate: RoomGeometryState): PipelineResult {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) throw new ApplyError('ID_NOT_FOUND', `room ${roomId} not found`);
  const to = quantizeGeometry(candidate);
  const check = validatePolygon(to.vertices);
  if (!check.ok) return reject([], { polygonError: check.code });
  const from: RoomGeometryState = structuredClone({ vertices: room.vertices, walls: room.walls, fixtures: room.fixtures });
  return accept({ type: 'EditWall', roomId, from, to });
}

/** CreateRoom (C14): closing is blocked when the polygon is invalid. IDs are supplied by the caller. */
export function proposeCreateRoom(project: Project, room: Room): PipelineResult {
  const g = quantizeGeometry({ vertices: room.vertices, walls: room.walls, fixtures: room.fixtures });
  const check = validatePolygon(g.vertices);
  if (!check.ok) return reject([], { polygonError: check.code });
  const q: Room = {
    ...room,
    floorElevation: quantizeLinear(room.floorElevation),
    wallHeight: quantizeLinear(room.wallHeight),
    ceilingHeight: quantizeLinear(room.ceilingHeight),
    ...g,
    furniture: room.furniture.map(quantizeInstance),
  };
  void project;
  return accept({ type: 'CreateRoom', room: q });
}

export function proposeDeleteRoom(project: Project, roomId: string): PipelineResult {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) throw new ApplyError('ID_NOT_FOUND', `room ${roomId} not found`);
  return accept({ type: 'DeleteRoom', roomId, snapshot: structuredClone(room) });
}

// ------------------------------------------------------------------ fix position (C10)

export function proposeFixPosition(project: Project, id: string): PipelineResult {
  const { inst } = locate(project, id);
  if (inst.locked) return reject([lockedViolation(id)]);
  const to = findNearestValidPosition(project, id);
  if (!to) return reject([], { message: 'No valid position — resize or move manually' });
  if (to.x === inst.position.x && to.y === inst.position.y) return noop();
  return accept({ type: 'MoveFurniture', instanceId: id, from: { ...inst.position }, to });
}

// ------------------------------------------------------------------ group operations (single Composite each)

function groupInstances(project: Project, ids: string[]): FurnitureInstance[] {
  return ids.map((id) => locate(project, id).inst);
}

function finishGroup(project: Project, ids: string[], commands: Command[]): PipelineResult {
  const command: Command = { type: 'Composite', commands };
  const r = evaluate(project, command, ids);
  return r.ok ? accept(command) : reject(r.violations);
}

export function proposeGroupMove(project: Project, ids: string[], delta: Vec2): PipelineResult {
  const insts = groupInstances(project, ids);
  const locked = insts.filter((i) => i.locked);
  if (locked.length) return reject(locked.map((i) => lockedViolation(i.id)));
  const commands: Command[] = insts.map((i) => ({
    type: 'MoveFurniture', instanceId: i.id, from: { ...i.position }, to: quantizeVec2(add(i.position, delta)),
  }));
  return finishGroup(project, ids, commands);
}

/** Bounding-box centre of a selection: the group-rotate pivot (B2, single source of truth). */
export function selectionPivot(insts: FurnitureInstance[]): Vec2 {
  const box = aabbOf(insts.flatMap((i) => footprintOf(i)));
  return scale(add(box.min, box.max), 0.5);
}

/** The Move + Rotate commands of a group rotate. Exposed so the interaction layer can preview exactly what a commit would do. */
export function groupRotateCommands(project: Project, ids: string[], deltaRad: number): Command[] {
  const insts = groupInstances(project, ids);
  const pivot = selectionPivot(insts);
  const commands: Command[] = [];
  for (const i of insts) {
    const pos = quantizeVec2(add(pivot, rotateVec(sub(i.position, pivot), deltaRad)));
    commands.push({ type: 'MoveFurniture', instanceId: i.id, from: { ...i.position }, to: pos });
    commands.push({ type: 'RotateFurniture', instanceId: i.id, from: i.rotation, to: quantizeRotation(i.rotation + deltaRad) });
  }
  return commands;
}

/** Group rotate: pivot is the bounding-box centre of the selection (B2); each instance also rotates by `deltaRad`. */
export function proposeGroupRotate(project: Project, ids: string[], deltaRad: number): PipelineResult {
  const insts = groupInstances(project, ids);
  const locked = insts.filter((i) => i.locked);
  if (locked.length) return reject(locked.map((i) => lockedViolation(i.id)));
  return finishGroup(project, ids, groupRotateCommands(project, ids, deltaRad));
}

/** A6: default duplicate offset, one default grid unit on both axes. */
export const DUPLICATE_OFFSET = 0.1;

/**
 * Duplicate (A6): offset +0.1 m on X and Y. New ids are supplied by the caller (never generated here) and the copies are
 * not locked. One instance → `PlaceFurniture`; several → one `Composite`. If the offset position is hard-invalid the result is a
 * rejection and nothing is committed: the interaction layer keeps a ghost attached to the pointer.
 */
export function proposeDuplicate(project: Project, ids: string[], newIds: string[]): PipelineResult {
  if (ids.length !== newIds.length) throw new RangeError('one new id per duplicated instance is required');
  const insts = groupInstances(project, ids);
  const commands: Command[] = insts.map((i, k): Command => {
    const copy = quantizeInstance({
      ...structuredClone(i),
      id: newIds[k],
      position: { x: i.position.x + DUPLICATE_OFFSET, y: i.position.y + DUPLICATE_OFFSET },
    });
    delete copy.locked;
    return { type: 'PlaceFurniture', instance: copy };
  });
  const command: Command = commands.length === 1 ? commands[0] : { type: 'Composite', commands };
  const r = evaluate(project, command, newIds);
  return r.ok ? accept(command) : reject(r.violations);
}

export function proposeGroupDelete(project: Project, ids: string[]): PipelineResult {
  const insts = groupInstances(project, ids);
  const locked = insts.filter((i) => i.locked);
  if (locked.length) return reject(locked.map((i) => lockedViolation(i.id)));
  return accept({
    type: 'Composite',
    commands: insts.map((i): Command => ({ type: 'DeleteFurniture', instanceId: i.id, snapshot: structuredClone(i) })),
  });
}
