import { EPSILON, quantizeLinear, quantizeRotation } from './coordinates';
import {
  ApplyError,
  type Command, type Fixture, type FixturePatch, type FurnitureInstance, type FurniturePatch, type Project, type Room,
  type RoomGeometryState, type Vec2,
} from './types';

/**
 * Collections inside a Project (rooms, furniture, fixtures) are kept sorted by id. This makes insertion order
 * canonical, so `apply(inverse(c), apply(c, s))` is structurally equal to `s` and replay hashes are stable.
 */
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

let debugAssertions = true;
/** Quantization asserts are debug-only (A10). They never repair values. */
export function setDebugAssertions(on: boolean): void {
  debugAssertions = on;
}

// ------------------------------------------------------------------ guards

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function corrupt(msg: string): never {
  throw new ApplyError('STRUCTURALLY_CORRUPT_COMMAND', msg);
}

function reqId(x: unknown, what: string): string {
  if (x === undefined || x === null || x === '') throw new ApplyError('MISSING_ID', `missing ${what}`);
  if (typeof x !== 'string') corrupt(`${what} must be a string id (index-style references are not allowed)`);
  return x as string;
}

function reqNum(x: unknown, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) corrupt(`${what} must be a finite number`);
  return x as number;
}

function reqVec(x: unknown, what: string): Vec2 {
  if (!isObj(x)) corrupt(`${what} must be a point`);
  const o = x as Record<string, unknown>;
  return { x: reqNum(o.x, `${what}.x`), y: reqNum(o.y, `${what}.y`) };
}

function reqArray(x: unknown, what: string): unknown[] {
  if (!Array.isArray(x)) corrupt(`${what} must be an array`);
  return x as unknown[];
}

function notFound(what: string, id: string): never {
  throw new ApplyError('ID_NOT_FOUND', `${what} ${id} not found`);
}

/** Tolerance-based (never exact equality): value must be within EPSILON of the 1 mm grid. */
function assertLinear(v: number, what: string): void {
  if (debugAssertions && Math.abs(v - quantizeLinear(v)) > EPSILON) corrupt(`${what} is not quantized (${v})`);
}
function assertRotation(r: number, what: string): void {
  if (!debugAssertions) return;
  if (r < 0 || r >= Math.PI * 2) corrupt(`${what} is outside [0, 2π)`);
  if (Math.abs(r - quantizeRotation(r)) > 1e-9) corrupt(`${what} is not quantized (${r})`);
}

// ------------------------------------------------------------------ lookups & immutable updates

function findRoom(p: Project, id: string): Room {
  const r = p.rooms.find((x) => x.id === id);
  return r ?? notFound('room', id);
}

function findInstance(p: Project, id: string): { room: Room; inst: FurnitureInstance } {
  for (const room of p.rooms) {
    const inst = room.furniture.find((f) => f.id === id);
    if (inst) return { room, inst };
  }
  return notFound('furniture instance', id);
}

function findFixture(p: Project, id: string): { room: Room; fixture: Fixture } {
  for (const room of p.rooms) {
    const fixture = room.fixtures.find((f) => f.id === id);
    if (fixture) return { room, fixture };
  }
  return notFound('fixture', id);
}

function withRoom(p: Project, room: Room): Project {
  return { ...p, rooms: p.rooms.map((r) => (r.id === room.id ? room : r)) };
}

function withInstance(p: Project, roomId: string, id: string, fn: (i: FurnitureInstance) => FurnitureInstance): Project {
  const room = findRoom(p, roomId);
  return withRoom(p, { ...room, furniture: room.furniture.map((f) => (f.id === id ? fn(f) : f)) });
}

function checkInstance(i: unknown): FurnitureInstance {
  if (!isObj(i)) corrupt('instance must be an object');
  const o = i as Record<string, unknown>;
  reqId(o.id, 'instance.id');
  reqId(o.definitionId, 'instance.definitionId');
  reqId(o.roomId, 'instance.roomId');
  const pos = reqVec(o.position, 'instance.position');
  for (const k of ['elevation', 'width', 'length', 'height'] as const) {
    assertLinear(reqNum(o[k], `instance.${k}`), `instance.${k}`);
  }
  assertLinear(pos.x, 'instance.position.x');
  assertLinear(pos.y, 'instance.position.y');
  assertRotation(reqNum(o.rotation, 'instance.rotation'), 'instance.rotation');
  return i as unknown as FurnitureInstance;
}

function checkFixture(f: unknown): Fixture {
  if (!isObj(f)) corrupt('fixture must be an object');
  const o = f as Record<string, unknown>;
  reqId(o.id, 'fixture.id');
  reqId(o.wallId, 'fixture.wallId');
  if (o.type !== 'door' && o.type !== 'window') corrupt('fixture.type must be door or window');
  for (const k of ['offsetAlongWall', 'width', 'height', 'elevation'] as const) {
    assertLinear(reqNum(o[k], `fixture.${k}`), `fixture.${k}`);
  }
  return f as unknown as Fixture;
}

function checkGeometry(g: unknown, what: string): RoomGeometryState {
  if (!isObj(g)) corrupt(`${what} must be an object`);
  const o = g as Record<string, unknown>;
  const vertices = reqArray(o.vertices, `${what}.vertices`);
  const walls = reqArray(o.walls, `${what}.walls`);
  const fixtures = reqArray(o.fixtures, `${what}.fixtures`);
  const ids = new Set<string>();
  for (const v of vertices) {
    if (!isObj(v)) corrupt(`${what}.vertices entry must be an object`);
    ids.add(reqId((v as Record<string, unknown>).id, 'vertex.id'));
    const pos = reqVec((v as Record<string, unknown>).position, 'vertex.position');
    assertLinear(pos.x, 'vertex.x');
    assertLinear(pos.y, 'vertex.y');
  }
  const wallIds = new Set<string>();
  for (const w of walls) {
    if (!isObj(w)) corrupt(`${what}.walls entry must be an object`);
    const wo = w as Record<string, unknown>;
    wallIds.add(reqId(wo.id, 'wall.id'));
    const s = reqId(wo.startVertexId, 'wall.startVertexId');
    const e = reqId(wo.endVertexId, 'wall.endVertexId');
    if (!ids.has(s)) notFound('vertex', s);
    if (!ids.has(e)) notFound('vertex', e);
    assertLinear(reqNum(wo.thickness, 'wall.thickness'), 'wall.thickness');
  }
  for (const f of fixtures) {
    const fx = checkFixture(f);
    if (!wallIds.has(fx.wallId)) notFound('wall', fx.wallId);
  }
  return g as unknown as RoomGeometryState;
}

function sameKeys(a: object, b: object, what: string): string[] {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) corrupt(`${what}: from/to keys differ`);
  return ka;
}

function applyPatch<T extends object>(target: T, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = structuredClone(v);
  }
  return next as T;
}

const FURNITURE_KEYS = new Set(['elevation', 'height', 'locked', 'finishOverrides', 'metadata']);
const FIXTURE_KEYS = new Set([
  'wallId', 'offsetAlongWall', 'width', 'height', 'elevation', 'hingeSide', 'swingAngle', 'accessZoneDepth',
]);

// ------------------------------------------------------------------ apply

/**
 * Pure, total over well-formed commands (Spec rule 18–19). Throws `ApplyError` with a stable code only for malformed
 * input. Never validates design constraints, never repairs, never mutates its inputs.
 */
export function apply(command: Command, project: Project): Project {
  if (!isObj(command)) corrupt('command must be an object');
  const c = command as Command;
  switch (c.type) {
    case 'PlaceFurniture': {
      const inst = checkInstance(c.instance);
      const room = findRoom(project, inst.roomId);
      if (project.rooms.some((r) => r.furniture.some((f) => f.id === inst.id))) corrupt(`instance ${inst.id} already exists`);
      return withRoom(project, { ...room, furniture: [...room.furniture, structuredClone(inst)].sort(byId) });
    }
    case 'MoveFurniture': {
      const id = reqId(c.instanceId, 'instanceId');
      reqVec(c.from, 'from');
      const to = reqVec(c.to, 'to');
      assertLinear(to.x, 'to.x');
      assertLinear(to.y, 'to.y');
      const { room } = findInstance(project, id);
      return withInstance(project, room.id, id, (i) => ({ ...i, position: { ...to } }));
    }
    case 'ResizeFurniture': {
      const id = reqId(c.instanceId, 'instanceId');
      if (!isObj(c.from) || !isObj(c.to)) corrupt('from/to must be objects');
      reqVec(c.from.position, 'from.position');
      reqNum(c.from.width, 'from.width');
      reqNum(c.from.length, 'from.length');
      const to = c.to;
      const pos = reqVec(to.position, 'to.position');
      assertLinear(pos.x, 'to.position.x');
      assertLinear(pos.y, 'to.position.y');
      assertLinear(reqNum(to.width, 'to.width'), 'to.width');
      assertLinear(reqNum(to.length, 'to.length'), 'to.length');
      const { room } = findInstance(project, id);
      return withInstance(project, room.id, id, (i) => ({
        ...i, position: { ...pos }, width: to.width, length: to.length,
      }));
    }
    case 'RotateFurniture': {
      const id = reqId(c.instanceId, 'instanceId');
      reqNum(c.from, 'from');
      const to = reqNum(c.to, 'to');
      assertRotation(to, 'to');
      const { room } = findInstance(project, id);
      return withInstance(project, room.id, id, (i) => ({ ...i, rotation: to }));
    }
    case 'DeleteFurniture': {
      const id = reqId(c.instanceId, 'instanceId');
      if (!isObj(c.snapshot)) corrupt('snapshot is required');
      const { room } = findInstance(project, id);
      return withRoom(project, { ...room, furniture: room.furniture.filter((f) => f.id !== id) });
    }
    case 'PlaceFixture': {
      const fx = checkFixture(c.fixture);
      const room = project.rooms.find((r) => r.walls.some((w) => w.id === fx.wallId)) ?? notFound('wall', fx.wallId);
      if (project.rooms.some((r) => r.fixtures.some((f) => f.id === fx.id))) corrupt(`fixture ${fx.id} already exists`);
      return withRoom(project, { ...room, fixtures: [...room.fixtures, structuredClone(fx)].sort(byId) });
    }
    case 'EditWall': {
      const roomId = reqId(c.roomId, 'roomId');
      const room = findRoom(project, roomId);
      checkGeometry(c.from, 'from');
      const to = checkGeometry(c.to, 'to');
      return withRoom(project, {
        ...room,
        vertices: structuredClone(to.vertices),
        walls: structuredClone(to.walls),
        fixtures: structuredClone(to.fixtures).sort(byId),
      });
    }
    case 'UpdateFurniture': {
      const id = reqId(c.instanceId, 'instanceId');
      if (!isObj(c.from) || !isObj(c.to)) corrupt('from/to must be objects');
      const keys = sameKeys(c.from, c.to, 'UpdateFurniture');
      for (const k of keys) if (!FURNITURE_KEYS.has(k)) corrupt(`UpdateFurniture may not carry "${k}"`);
      for (const k of ['elevation', 'height'] as const) {
        const v = (c.to as FurniturePatch)[k];
        if (v !== undefined) assertLinear(reqNum(v, `to.${k}`), `to.${k}`);
      }
      const { room } = findInstance(project, id);
      return withInstance(project, room.id, id, (i) => applyPatch(i, c.to as Record<string, unknown>));
    }
    case 'UpdateFixture': {
      const id = reqId(c.fixtureId, 'fixtureId');
      if (!isObj(c.from) || !isObj(c.to)) corrupt('from/to must be objects');
      const keys = sameKeys(c.from, c.to, 'UpdateFixture');
      for (const k of keys) if (!FIXTURE_KEYS.has(k)) corrupt(`UpdateFixture may not carry "${k}"`);
      for (const k of ['offsetAlongWall', 'width', 'height', 'elevation'] as const) {
        const v = (c.to as FixturePatch)[k];
        if (v !== undefined) assertLinear(reqNum(v, `to.${k}`), `to.${k}`);
      }
      const { room } = findFixture(project, id);
      const toPatch = c.to as Record<string, unknown>;
      if (typeof toPatch.wallId === 'string' && !project.rooms.some((r) => r.id === room.id && r.walls.some((w) => w.id === toPatch.wallId))) {
        notFound('wall', toPatch.wallId);
      }
      return withRoom(project, { ...room, fixtures: room.fixtures.map((f) => (f.id === id ? applyPatch(f, toPatch) : f)) });
    }
    case 'DeleteFixture': {
      const id = reqId(c.fixtureId, 'fixtureId');
      if (!isObj(c.snapshot)) corrupt('snapshot is required');
      const { room } = findFixture(project, id);
      return withRoom(project, { ...room, fixtures: room.fixtures.filter((f) => f.id !== id) });
    }
    case 'CreateRoom': {
      if (!isObj(c.room)) corrupt('room is required');
      const room = c.room;
      reqId(room.id, 'room.id');
      if (project.rooms.some((r) => r.id === room.id)) corrupt(`room ${room.id} already exists`);
      checkGeometry({ vertices: room.vertices, walls: room.walls, fixtures: room.fixtures }, 'room');
      for (const f of reqArray(room.furniture, 'room.furniture')) checkInstance(f);
      return { ...project, rooms: [...project.rooms, structuredClone(room)].sort(byId) };
    }
    case 'UpdateRoom': {
      const id = reqId(c.roomId, 'roomId');
      const room = findRoom(project, id);
      const to = c.to;
      if (!isObj(to)) corrupt('to must be an object');
      if (!isObj(c.from)) corrupt('from must be an object');
      const patch = to as { name?: unknown; palette?: unknown };
      if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim())) corrupt('to.name must be a non-empty string');
      if ('palette' in patch && patch.palette !== null && typeof patch.palette !== 'string') corrupt('to.palette must be a string or null');
      if (!('name' in patch) && !('palette' in patch)) corrupt('to must change the name or the palette');
      const next: Room = { ...room };
      if ('name' in patch) next.name = patch.name as string;
      if ('palette' in patch) { if (patch.palette) next.palette = patch.palette as string; else delete next.palette; }
      return withRoom(project, next);
    }
    case 'DeleteRoom': {
      const id = reqId(c.roomId, 'roomId');
      if (!isObj(c.snapshot)) corrupt('snapshot is required');
      findRoom(project, id);
      return { ...project, rooms: project.rooms.filter((r) => r.id !== id) };
    }
    case 'Composite': {
      const cmds = reqArray(c.commands, 'commands') as Command[];
      // Fold over immutable intermediate states: a throw anywhere yields no state at all (atomicity).
      return cmds.reduce<Project>((state, sub) => apply(sub, state), project);
    }
    default:
      throw new ApplyError('UNKNOWN_COMMAND_TYPE', `unknown command type: ${String((command as { type?: unknown }).type)}`);
  }
}

// ------------------------------------------------------------------ inverse

/** Builds the inverse command from the mandatory from/snapshot data (Phase 1 §5b). Needs no state. */
export function inverse(command: Command): Command {
  switch (command.type) {
    case 'PlaceFurniture': return { type: 'DeleteFurniture', instanceId: command.instance.id, snapshot: command.instance };
    case 'DeleteFurniture': return { type: 'PlaceFurniture', instance: command.snapshot };
    case 'MoveFurniture': return { ...command, from: command.to, to: command.from };
    case 'ResizeFurniture': return { ...command, from: command.to, to: command.from };
    case 'RotateFurniture': return { ...command, from: command.to, to: command.from };
    case 'PlaceFixture': return { type: 'DeleteFixture', fixtureId: command.fixture.id, snapshot: command.fixture };
    case 'DeleteFixture': return { type: 'PlaceFixture', fixture: command.snapshot };
    case 'EditWall': return { ...command, from: command.to, to: command.from };
    case 'UpdateFurniture': return { ...command, from: command.to, to: command.from };
    case 'UpdateFixture': return { ...command, from: command.to, to: command.from };
    case 'UpdateRoom': return { ...command, from: command.to, to: command.from };
    case 'CreateRoom': return { type: 'DeleteRoom', roomId: command.room.id, snapshot: command.room };
    case 'DeleteRoom': return { type: 'CreateRoom', room: command.snapshot };
    case 'Composite': return { type: 'Composite', commands: [...command.commands].reverse().map(inverse) };
    default:
      throw new ApplyError('UNKNOWN_COMMAND_TYPE', `unknown command type: ${String((command as { type?: unknown }).type)}`);
  }
}
