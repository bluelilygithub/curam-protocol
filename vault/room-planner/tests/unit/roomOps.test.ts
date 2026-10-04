// Room and project operations for the library (M5 projects): clone, naming, rename command.
import { describe, expect, it } from 'vitest';
import {
  apply, ApplyError, cleanName, cloneProject, cloneRoom, CommandHistory, inverse, nextRoomName, projectName, validateRoom,
  type Command, type Project,
} from '../../src/engine';
import { expectProjectEqual, makeDoor, makeInstance, makeProject, makeRoom } from '../helpers';

const counter = (prefix = 'n') => { let i = 0; return () => `${prefix}${++i}`; };

const furnished = () => makeRoom({
  id: 'room-1', name: 'Living',
  fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1 }), { id: 'win', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 }],
  furniture: [
    makeInstance({ id: 'a', roomId: 'room-1', definitionId: 'sofa-3', position: { x: 2, y: 4 }, width: 2.2, length: 0.95, height: 0.85 }),
    makeInstance({ id: 'b', roomId: 'room-1', definitionId: 'coffee-table', position: { x: 2, y: 2.8 }, width: 1.2, length: 0.6, height: 0.42, locked: true, finishOverrides: { top: 'oak' } }),
  ],
});

describe('cloneRoom', () => {
  const room = furnished();
  const before = JSON.stringify(room);
  const copy = cloneRoom(room, counter(), 'Living (copy)');

  it('replaces every id: room, corners, walls, openings, furniture; none is shared with the original', () => {
    const old = new Set([room.id, ...room.vertices.map((v) => v.id), ...room.walls.map((w) => w.id), ...room.fixtures.map((f) => f.id), ...room.furniture.map((f) => f.id)]);
    const fresh = [copy.id, ...copy.vertices.map((v) => v.id), ...copy.walls.map((w) => w.id), ...copy.fixtures.map((f) => f.id), ...copy.furniture.map((f) => f.id)];
    expect(new Set(fresh).size).toBe(fresh.length);
    for (const id of fresh) expect(old.has(id)).toBe(false);
  });

  it('remaps every reference: walls to corners, openings to walls, furniture to the new room', () => {
    const vids = new Set(copy.vertices.map((v) => v.id));
    const wids = new Set(copy.walls.map((w) => w.id));
    for (const w of copy.walls) { expect(vids.has(w.startVertexId)).toBe(true); expect(vids.has(w.endVertexId)).toBe(true); }
    for (const f of copy.fixtures) expect(wids.has(f.wallId)).toBe(true);
    for (const f of copy.furniture) expect(f.roomId).toBe(copy.id);
    // the door was on the first wall, the window on the second: order and attachment are kept
    const wallIndex = (r: typeof room, wallId: string): number => r.walls.findIndex((w) => w.id === wallId);
    expect(wallIndex(copy, copy.fixtures.find((f) => f.type === 'door')!.wallId)).toBe(wallIndex(room, 'w1'));
    expect(wallIndex(copy, copy.fixtures.find((f) => f.type === 'window')!.wallId)).toBe(wallIndex(room, 'w2'));
  });

  it('keeps geometry, sizes, flags and finishes; only the name changes; it is exactly as valid as the original', () => {
    expect(copy.name).toBe('Living (copy)');
    expect(copy.vertices.map((v) => v.position)).toEqual(room.vertices.map((v) => v.position));
    expect(copy.walls.map((w) => w.thickness)).toEqual(room.walls.map((w) => w.thickness));
    expect(copy.wallHeight).toBe(room.wallHeight);
    const locked = copy.furniture.find((f) => f.definitionId === 'coffee-table')!;
    expect(locked.locked).toBe(true);
    expect(locked.finishOverrides).toEqual({ top: 'oak' });
    expect(locked.position).toEqual({ x: 2, y: 2.8 });
    const defs = [{ id: 'sofa-3', name: 's', category: 'c', defaultWidth: 1, defaultLength: 1, defaultHeight: 1 }];
    expect(validateRoom(copy, defs).valid).toBe(validateRoom(room, defs).valid);
    expect(validateRoom(copy, defs).violations.map((v) => v.type).sort()).toEqual(validateRoom(room, defs).violations.map((v) => v.type).sort());
  });

  it('keeps collections sorted by id (C18) and does not touch the original or share objects with it', () => {
    expect([...copy.furniture].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(copy.furniture);
    expect([...copy.fixtures].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(copy.fixtures);
    expect(JSON.stringify(room)).toBe(before);
    copy.furniture[0].position.x = 99;
    copy.vertices[0].position.x = 99;
    expect(JSON.stringify(room)).toBe(before);
  });

  it('keeps the name when none is given', () => {
    expect(cloneRoom(room, counter()).name).toBe('Living');
  });
});

describe('names', () => {
  it('nextRoomName: "Room N" with N the first number not in use, starting from the room count + 1', () => {
    expect(nextRoomName(makeProject([]))).toBe('Room 1');
    expect(nextRoomName(makeProject([makeRoom({ id: 'r1', name: 'Room 1' })]))).toBe('Room 2');
    expect(nextRoomName(makeProject([makeRoom({ id: 'r1', name: 'Room 1' }), makeRoom({ id: 'r2', name: 'Room 3' })]))).toBe('Room 4');
    expect(nextRoomName(makeProject([makeRoom({ id: 'r1', name: 'Kitchen' }), makeRoom({ id: 'r2', name: 'Hall' })]))).toBe('Room 3');
  });
  it('projectName: own name, else first room, else a default', () => {
    expect(projectName({ ...makeProject([makeRoom({ name: 'Hall' })]), name: '  Flat 4  ' })).toBe('Flat 4');
    expect(projectName(makeProject([makeRoom({ name: 'Hall' })]))).toBe('Hall');
    expect(projectName(makeProject([]))).toBe('Untitled project');
  });
  it('cleanName trims, collapses spaces, limits length, and keeps the fallback for blank input', () => {
    expect(cleanName('  Flat   4 ', 'x')).toBe('Flat 4');
    expect(cleanName('   ', 'Keep')).toBe('Keep');
    expect(cleanName('y'.repeat(200), 'x')).toHaveLength(80);
    expect(cleanName('abcdef', 'x', 3)).toBe('abc');
  });
});

describe('cloneProject', () => {
  const p: Project = {
    ...makeProject([furnished(), makeRoom({ id: 'room-2', name: 'Bed' })]), name: 'Flat',
    savedViews: [{ id: 'v1', name: 'Overview', cameraPosition: [1, 2, 3], target: [0, 0, 0], projection: 'perspective', roomId: 'room-1' }],
  };
  const before = JSON.stringify(p);
  const copy = cloneProject(p, counter(), 'Flat (copy)');
  it('is a new, independent project: new id, new name, every room cloned with fresh ids', () => {
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe('Flat (copy)');
    expect(copy.rooms).toHaveLength(2);
    expect(copy.rooms.map((r) => r.name).sort()).toEqual(['Bed', 'Living']);
    const oldIds = new Set(p.rooms.flatMap((r) => [r.id, ...r.furniture.map((f) => f.id)]));
    for (const r of copy.rooms) { expect(oldIds.has(r.id)).toBe(false); for (const f of r.furniture) expect(oldIds.has(f.id)).toBe(false); }
    expect(JSON.stringify(p)).toBe(before);
  });
  it('keeps saved views with fresh ids pointing at the cloned room', () => {
    const living = copy.rooms.find((r) => r.name === 'Living')!;
    expect(copy.savedViews).toHaveLength(1);
    expect(copy.savedViews![0].id).not.toBe('v1');
    expect(copy.savedViews![0].roomId).toBe(living.id);
    expect(copy.savedViews![0].cameraPosition).toEqual([1, 2, 3]);
  });
  it('rooms stay sorted by id, and materials and definitions carry over', () => {
    expect([...copy.rooms].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(copy.rooms);
    expect(copy.materials).toEqual(p.materials);
    expect(copy.furnitureDefinitions).toEqual(p.furnitureDefinitions);
  });
  it('a project without saved views stays without them', () => {
    expect(cloneProject(makeProject([makeRoom()]), counter(), 'x').savedViews).toBeUndefined();
  });
});

describe('UpdateRoom (rename a room)', () => {
  const base = makeProject([makeRoom({ id: 'room-1', name: 'Room 1' })]);
  const cmd: Command = { type: 'UpdateRoom', roomId: 'room-1', from: { name: 'Room 1' }, to: { name: 'Kitchen' } };
  it('renames, and the inverse restores the project exactly', () => {
    const after = apply(cmd, base);
    expect(after.rooms[0].name).toBe('Kitchen');
    expectProjectEqual(apply(inverse(cmd), after), base);
  });
  it('changes nothing else', () => {
    const after = apply(cmd, base);
    expect({ ...after.rooms[0], name: 'Room 1' }).toEqual(base.rooms[0]);
  });
  it('is one undo step, redoable, and survives a JSON round trip', () => {
    const h = new CommandHistory();
    h.push(cmd, 'Rename room');
    const after = apply(cmd, base);
    expect(h.undoLabel()).toBe('Rename room');
    expect(h.undo(after)!.rooms[0].name).toBe('Room 1');
    expect(h.redo(apply(inverse(cmd), after))!.rooms[0].name).toBe('Kitchen');
    expect(apply(JSON.parse(JSON.stringify(cmd)) as Command, base).rooms[0].name).toBe('Kitchen');
  });
  it('rejects an unknown room and a blank name with the right error codes', () => {
    expect(() => apply({ ...cmd, roomId: 'nope' } as Command, base)).toThrowError(ApplyError);
    try { apply({ ...cmd, roomId: 'nope' } as Command, base); } catch (e) { expect((e as ApplyError).code).toBe('ID_NOT_FOUND'); }
    try { apply({ ...cmd, to: { name: '   ' } } as Command, base); } catch (e) { expect((e as ApplyError).code).toBe('STRUCTURALLY_CORRUPT_COMMAND'); }
    expect(() => apply({ ...cmd, to: { name: '   ' } } as Command, base)).toThrow();
    expect(() => apply({ ...cmd, from: 'x' } as unknown as Command, base)).toThrow();
    expect(() => apply({ ...cmd, to: {} } as unknown as Command, base)).toThrow();
    expect(() => apply({ type: 'UpdateRoom', roomId: 'room-1' } as unknown as Command, base)).toThrow();
  });
});
