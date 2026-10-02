import { beforeEach, describe, expect, it } from 'vitest';
import { apply, ApplyError, inverse, setDebugAssertions } from '../../src/engine';
import type { ApplyErrorCode, Command, Fixture, FurnitureInstance, Project } from '../../src/engine';
import { deepFreeze, expectProjectEqual, makeDoor, makeInstance, makeProject, makeRoom, rectVertices, ringWalls } from '../helpers';

const base = (): Project => makeProject([makeRoom()], []);
const inst = (id: string, x = 2, y = 2, over: Partial<FurnitureInstance> = {}) => makeInstance({ id, position: { x, y }, ...over });
const place = (i: FurnitureInstance): Command => ({ type: 'PlaceFurniture', instance: i });

function codeOf(fn: () => unknown): ApplyErrorCode | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApplyError) return e.code;
    throw e;
  }
  return undefined;
}

beforeEach(() => setDebugAssertions(true));

describe('apply: furniture commands', () => {
  it('place → move → resize → rotate', () => {
    let s = base();
    s = apply(place(inst('a')), s);
    s = apply({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2 }, to: { x: 1.5, y: 2.25 } }, s);
    s = apply({
      type: 'ResizeFurniture', instanceId: 'a',
      from: { position: { x: 1.5, y: 2.25 }, width: 1, length: 1 }, to: { position: { x: 2, y: 2.25 }, width: 2, length: 0.5 },
    }, s);
    s = apply({ type: 'RotateFurniture', instanceId: 'a', from: 0, to: Math.PI / 2 }, s);
    expect(s.rooms[0].furniture[0]).toMatchObject({ position: { x: 2, y: 2.25 }, width: 2, length: 0.5, rotation: Math.PI / 2 });
  });
  it('does not mutate its input (deep-frozen state and command)', () => {
    const s = deepFreeze(base());
    const c = deepFreeze(place(inst('a')));
    expect(() => apply(c, s)).not.toThrow();
    expect(s.rooms[0].furniture).toHaveLength(0);
  });
  it('returns a new project and shares nothing mutable with the command', () => {
    const c = place(inst('a'));
    const s = apply(c, base());
    (s.rooms[0].furniture[0].position as { x: number }).x = 99;
    expect((c as { instance: FurnitureInstance }).instance.position.x).toBe(2);
  });
  it('collections stay sorted by id regardless of insertion order', () => {
    let s = apply(place(inst('b', 1, 1)), base());
    s = apply(place(inst('a', 3, 3)), s);
    expect(s.rooms[0].furniture.map((f) => f.id)).toEqual(['a', 'b']);
  });
  it('delete removes the instance', () => {
    const a = inst('a');
    const s = apply({ type: 'DeleteFurniture', instanceId: 'a', snapshot: a }, apply(place(a), base()));
    expect(s.rooms[0].furniture).toEqual([]);
  });
});

describe('apply: UpdateFurniture / UpdateFixture (C9)', () => {
  const withA = () => apply(place(inst('a')), base());
  it('merges the patch; null removes an optional property', () => {
    let s = apply({ type: 'UpdateFurniture', instanceId: 'a', from: { locked: null, metadata: null }, to: { locked: true, metadata: { sku: 'X1' } } }, withA());
    expect(s.rooms[0].furniture[0]).toMatchObject({ locked: true, metadata: { sku: 'X1' } });
    s = apply({ type: 'UpdateFurniture', instanceId: 'a', from: { locked: true, metadata: { sku: 'X1' } }, to: { locked: null, metadata: null } }, s);
    expect('locked' in s.rooms[0].furniture[0]).toBe(false);
    expect('metadata' in s.rooms[0].furniture[0]).toBe(false);
  });
  it('finishOverrides replace as a whole record (C13)', () => {
    const s = apply({ type: 'UpdateFurniture', instanceId: 'a', from: { finishOverrides: null }, to: { finishOverrides: { seat: 'mat-1' } } }, withA());
    expect(s.rooms[0].furniture[0].finishOverrides).toEqual({ seat: 'mat-1' });
  });
  it('from/to key mismatch is STRUCTURALLY_CORRUPT_COMMAND', () => {
    expect(codeOf(() => apply({ type: 'UpdateFurniture', instanceId: 'a', from: { elevation: 0 }, to: { height: 1 } }, withA()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('may not carry position/width/length/rotation', () => {
    const bad = { type: 'UpdateFurniture', instanceId: 'a', from: { width: 1 }, to: { width: 2 } } as unknown as Command;
    expect(codeOf(() => apply(bad, withA()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('UpdateFixture merges; id/type changes are rejected', () => {
    const door = makeDoor({ id: 'd' });
    let s = apply({ type: 'PlaceFixture', fixture: door }, base());
    s = apply({ type: 'UpdateFixture', fixtureId: 'd', from: { offsetAlongWall: 2, swingAngle: Math.PI / 2 }, to: { offsetAlongWall: 1.5, swingAngle: null } }, s);
    expect(s.rooms[0].fixtures[0].offsetAlongWall).toBe(1.5);
    expect('swingAngle' in s.rooms[0].fixtures[0]).toBe(false);
    const bad = { type: 'UpdateFixture', fixtureId: 'd', from: { type: 'door' }, to: { type: 'window' } } as unknown as Command;
    expect(codeOf(() => apply(bad, s))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('DeleteFixture', () => {
    const door = makeDoor({ id: 'd' });
    const s = apply({ type: 'DeleteFixture', fixtureId: 'd', snapshot: door }, apply({ type: 'PlaceFixture', fixture: door }, base()));
    expect(s.rooms[0].fixtures).toEqual([]);
  });
});

describe('apply: rooms (C9, C14)', () => {
  it('CreateRoom / DeleteRoom', () => {
    const r = makeRoom({ id: 'room-2' });
    let s = apply({ type: 'CreateRoom', room: r }, base());
    expect(s.rooms.map((x) => x.id)).toEqual(['room-1', 'room-2']);
    s = apply({ type: 'DeleteRoom', roomId: 'room-2', snapshot: r }, s);
    expect(s.rooms.map((x) => x.id)).toEqual(['room-1']);
  });
  it('CreateRoom with an existing id is corrupt', () => {
    expect(codeOf(() => apply({ type: 'CreateRoom', room: makeRoom() }, base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
});

describe('apply: EditWall (C5, C6)', () => {
  const room = makeRoom();
  const geometry = (r = room) => ({ vertices: r.vertices, walls: r.walls, fixtures: r.fixtures });
  it('replaces vertices, walls and fixtures from `to`', () => {
    const moved = room.vertices.map((v) => (v.id === 'v3' ? { ...v, position: { x: 4, y: 4 } } : v.id === 'v4' ? { ...v, position: { x: 0, y: 4 } } : v));
    const s = apply({ type: 'EditWall', roomId: 'room-1', from: geometry(), to: { ...geometry(), vertices: moved } }, base());
    expect(s.rooms[0].vertices[2].position).toEqual({ x: 4, y: 4 });
  });
  it('vertex insertion by ID: the split segment keeps its id for the first half, other segments are untouched', () => {
    const vertices = [...room.vertices.slice(0, 1), { id: 'vn', position: { x: 2, y: 0 } }, ...room.vertices.slice(1)];
    const walls = [
      { id: 'w1', startVertexId: 'v1', endVertexId: 'vn', thickness: 0.15 },
      { id: 'w1b', startVertexId: 'vn', endVertexId: 'v2', thickness: 0.15 },
      ...room.walls.slice(1),
    ];
    const s = apply({ type: 'EditWall', roomId: 'room-1', from: geometry(), to: { vertices, walls, fixtures: [] } }, base());
    expect(s.rooms[0].walls.slice(2)).toEqual(room.walls.slice(1)); // all other walls reference the same vertex ids
    expect(s.rooms[0].vertices).toHaveLength(5);
  });
  it('carries fixtures on both sides: undo restores them exactly', () => {
    const door = makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 2 });
    const start = apply({ type: 'PlaceFixture', fixture: door }, base());
    const cmd: Command = {
      type: 'EditWall', roomId: 'room-1',
      from: { vertices: room.vertices, walls: room.walls, fixtures: [door] },
      to: { vertices: room.vertices, walls: room.walls, fixtures: [{ ...door, offsetAlongWall: 1 }] },
    };
    const after = apply(cmd, start);
    expect(after.rooms[0].fixtures[0].offsetAlongWall).toBe(1);
    expectProjectEqual(apply(inverse(cmd), after), start);
  });
  it('a wall referencing an unknown vertex id -> ID_NOT_FOUND', () => {
    const walls = [{ id: 'w1', startVertexId: 'v1', endVertexId: 'ghost', thickness: 0.15 }];
    expect(codeOf(() => apply({ type: 'EditWall', roomId: 'room-1', from: geometry(), to: { vertices: room.vertices, walls, fixtures: [] } }, base()))).toBe('ID_NOT_FOUND');
  });
  it('index-style references are malformed: numbers -> STRUCTURALLY_CORRUPT, missing -> MISSING_ID', () => {
    const numeric = [{ id: 'w1', startVertexId: 0, endVertexId: 1, thickness: 0.15 }] as unknown as typeof room.walls;
    expect(codeOf(() => apply({ type: 'EditWall', roomId: 'room-1', from: geometry(), to: { vertices: room.vertices, walls: numeric, fixtures: [] } }, base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
    const missing = [{ id: 'w1', startIndex: 0, endIndex: 1, thickness: 0.15 }] as unknown as typeof room.walls;
    expect(codeOf(() => apply({ type: 'EditWall', roomId: 'room-1', from: geometry(), to: { vertices: room.vertices, walls: missing, fixtures: [] } }, base()))).toBe('MISSING_ID');
  });
  it('fixtures are mandatory on both sides', () => {
    const bad = { type: 'EditWall', roomId: 'room-1', from: { vertices: room.vertices, walls: room.walls }, to: geometry() } as unknown as Command;
    expect(codeOf(() => apply(bad, base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('a fixture whose wall is gone from `to.walls` is ID_NOT_FOUND (it must be re-homed)', () => {
    const door = makeDoor({ id: 'd', wallId: 'w1' });
    const walls = ringWalls(rectVertices(4, 5), 'x');
    expect(codeOf(() => apply({ type: 'EditWall', roomId: 'room-1', from: geometry(), to: { vertices: room.vertices, walls, fixtures: [door] } }, base()))).toBe('ID_NOT_FOUND');
  });
});

describe('apply: malformed commands throw stable ApplyErrorCodes (every code is produced)', () => {
  it('UNKNOWN_COMMAND_TYPE', () => {
    expect(codeOf(() => apply({ type: 'Teleport' } as unknown as Command, base()))).toBe('UNKNOWN_COMMAND_TYPE');
    expect(codeOf(() => inverse({ type: 'Teleport' } as unknown as Command))).toBe('UNKNOWN_COMMAND_TYPE');
  });
  it('MISSING_ID', () => {
    expect(codeOf(() => apply({ type: 'MoveFurniture', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } as unknown as Command, base()))).toBe('MISSING_ID');
    expect(codeOf(() => apply({ type: 'DeleteRoom', snapshot: makeRoom() } as unknown as Command, base()))).toBe('MISSING_ID');
  });
  it('ID_NOT_FOUND', () => {
    expect(codeOf(() => apply({ type: 'MoveFurniture', instanceId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, base()))).toBe('ID_NOT_FOUND');
    expect(codeOf(() => apply(place(inst('a', 2, 2, { roomId: 'nope' })), base()))).toBe('ID_NOT_FOUND');
    expect(codeOf(() => apply({ type: 'DeleteFixture', fixtureId: 'ghost', snapshot: makeDoor({ id: 'ghost' }) }, base()))).toBe('ID_NOT_FOUND');
  });
  it('STRUCTURALLY_CORRUPT_COMMAND', () => {
    expect(codeOf(() => apply(null as unknown as Command, base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
    expect(codeOf(() => apply({ type: 'MoveFurniture', instanceId: 'a', from: { x: 0, y: 0 }, to: { x: 'one', y: 1 } } as unknown as Command, apply(place(inst('a')), base())))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
    expect(codeOf(() => apply({ type: 'DeleteFurniture', instanceId: 'a' } as unknown as Command, apply(place(inst('a')), base())))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
    expect(codeOf(() => apply(place(inst('a')), apply(place(inst('a')), base())))).toBe('STRUCTURALLY_CORRUPT_COMMAND'); // duplicate id
  });
});

describe('quantization assert (A10): tolerance-based, never exact, never repairs', () => {
  it('a value within EPSILON of the grid passes', () => {
    expect(() => apply(place(inst('a', 2 + 1e-9, 2)), base())).not.toThrow();
  });
  it('an unquantized value fails the debug assert and is not repaired', () => {
    expect(codeOf(() => apply(place(inst('a', 2.0004, 2)), base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('rotation: float error from degree->radian conversion passes; 0.05° off the grid fails', () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(() => apply(place(inst('a', 2, 2, { rotation: deg(45) + 1e-16 })), base())).not.toThrow();
    expect(codeOf(() => apply(place(inst('a', 2, 2, { rotation: deg(45.05) })), base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('rotation outside [0, 2π) fails (C3)', () => {
    expect(codeOf(() => apply(place(inst('a', 2, 2, { rotation: Math.PI * 2 })), base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
    expect(codeOf(() => apply(place(inst('a', 2, 2, { rotation: -0.1 })), base()))).toBe('STRUCTURALLY_CORRUPT_COMMAND');
  });
  it('can be switched off (production)', () => {
    setDebugAssertions(false);
    expect(() => apply(place(inst('a', 2.0004, 2)), base())).not.toThrow();
  });
});

describe('Composite', () => {
  const two = (): Project => apply(place(inst('b', 3, 3)), apply(place(inst('a', 1, 1)), base()));
  const groupMove: Command = {
    type: 'Composite',
    commands: [
      { type: 'MoveFurniture', instanceId: 'a', from: { x: 1, y: 1 }, to: { x: 1.5, y: 1 } },
      { type: 'MoveFurniture', instanceId: 'b', from: { x: 3, y: 3 }, to: { x: 3.5, y: 3 } },
    ],
  };
  it('applies left-to-right', () => {
    const s = apply(groupMove, two());
    expect(s.rooms[0].furniture.map((f) => f.position.x)).toEqual([1.5, 3.5]);
  });
  it('inverse is the reversed list of inverses and restores both objects', () => {
    const inv = inverse(groupMove) as { commands: Command[] };
    expect(inv.commands.map((c) => (c as { instanceId: string }).instanceId)).toEqual(['b', 'a']);
    expectProjectEqual(apply(inv as Command, apply(groupMove, two())), two());
  });
  it('is atomic: if any sub-command throws, there is no result and the input is untouched', () => {
    const s = deepFreeze(two());
    const bad: Command = { type: 'Composite', commands: [groupMove, { type: 'MoveFurniture', instanceId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] };
    expect(codeOf(() => apply(bad, s))).toBe('ID_NOT_FOUND');
    expect(s.rooms[0].furniture.map((f) => f.position.x)).toEqual([1, 3]);
  });
  it('nested composites', () => {
    const nested: Command = { type: 'Composite', commands: [groupMove, groupMove.commands[0]] };
    expect(() => apply(nested, two())).not.toThrow();
  });
});

describe('inverse(): every command kind round-trips', () => {
  const door: Fixture = makeDoor({ id: 'd' });
  const a = inst('a', 2, 2);
  const start = (): Project => apply(place(a), apply({ type: 'PlaceFixture', fixture: door }, base()));
  const cases: Array<[string, Command]> = [
    ['PlaceFurniture', place(inst('n', 3, 3))],
    ['DeleteFurniture', { type: 'DeleteFurniture', instanceId: 'a', snapshot: a }],
    ['MoveFurniture', { type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2 }, to: { x: 2.5, y: 2 } }],
    ['ResizeFurniture', { type: 'ResizeFurniture', instanceId: 'a', from: { position: { x: 2, y: 2 }, width: 1, length: 1 }, to: { position: { x: 2.25, y: 2 }, width: 1.5, length: 1 } }],
    ['RotateFurniture', { type: 'RotateFurniture', instanceId: 'a', from: 0, to: Math.PI / 2 }],
    ['PlaceFixture', { type: 'PlaceFixture', fixture: makeDoor({ id: 'd2', offsetAlongWall: 3 }) }],
    ['DeleteFixture', { type: 'DeleteFixture', fixtureId: 'd', snapshot: door }],
    ['UpdateFurniture', { type: 'UpdateFurniture', instanceId: 'a', from: { elevation: 0, locked: null }, to: { elevation: 0.5, locked: true } }],
    ['UpdateFixture', { type: 'UpdateFixture', fixtureId: 'd', from: { offsetAlongWall: 2 }, to: { offsetAlongWall: 1.2 } }],
    ['CreateRoom', { type: 'CreateRoom', room: makeRoom({ id: 'room-2' }) }],
    ['DeleteRoom', { type: 'DeleteRoom', roomId: 'room-1', snapshot: start().rooms[0] }],
  ];
  it.each(cases)('%s', (_name, cmd) => {
    const s = start();
    expectProjectEqual(apply(inverse(cmd), apply(cmd, s)), s);
  });
  it('inverse of inverse is the original', () => {
    for (const [, cmd] of cases) expect(inverse(inverse(cmd))).toEqual(cmd);
  });
});
