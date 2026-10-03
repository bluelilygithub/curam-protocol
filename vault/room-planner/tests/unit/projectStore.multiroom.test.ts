// Several rooms per project (M5 projects): the store keeps the whole project and shows the editor one room.
import { describe, expect, it } from 'vitest';
import { proposeCreateRoom, proposeDeleteRoom, proposeMove, type Command, type Project } from '../../src/engine';
import { createProjectStore, nextActive, viewOf } from '../../src/state/projectStore';
import { makeInstance, makeProject, makeRoom } from '../helpers';

const room = (id: string, name: string, furnitureId?: string) => makeRoom({
  id, name,
  furniture: furnitureId ? [makeInstance({ id: furnitureId, roomId: id, position: { x: 2, y: 2.5 }, width: 1, length: 1, height: 1 })] : [],
});
const three = (): Project => makeProject([room('a', 'Kitchen', 'fa'), room('b', 'Living', 'fb'), room('c', 'Bed')]);

describe('the active room and its view', () => {
  it('opens on the first room; the view holds only that room, the document holds all', () => {
    const s = createProjectStore(three());
    expect(s.getState().activeRoomId).toBe('a');
    expect(s.getState().project!.rooms.map((r) => r.id)).toEqual(['a']);
    expect(s.getState().document!.rooms.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('switching rooms changes the view only: same document, no history, no revision bump, no undo entry', () => {
    const s = createProjectStore(three());
    const doc = s.getState().document;
    const rev = s.getState().revision;
    s.getState().setActiveRoom('b');
    expect(s.getState().project!.rooms.map((r) => r.id)).toEqual(['b']);
    expect(s.getState().document).toBe(doc);
    expect(s.getState().revision).toBe(rev);
    expect(s.getState().canUndo).toBe(false);
    expect(s.getState().historyLength()).toBe(0);
  });

  it('the view keeps its identity until the document or the active room changes (renderers rebuild on identity)', () => {
    const s = createProjectStore(three());
    const v = s.getState().project;
    s.setState({ canUndo: false }); // unrelated state change
    expect(s.getState().project).toBe(v);
    s.getState().setActiveRoom('a'); // same room: nothing
    expect(s.getState().project).toBe(v);
    s.getState().setActiveRoom('b');
    expect(s.getState().project).not.toBe(v);
  });

  it('ignores an unknown room id', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('nope');
    expect(s.getState().activeRoomId).toBe('a');
  });

  it('viewOf: unknown or null id → no rooms; null document → null', () => {
    expect(viewOf(three(), 'zzz')!.rooms).toEqual([]);
    expect(viewOf(three(), null)!.rooms).toEqual([]);
    expect(viewOf(null, 'a')).toBeNull();
  });
});

describe('editing one room does not see or touch the others', () => {
  it('a move in the active room is validated against that room only, and changes only that room', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('b');
    // room a also has a 1 x 1 object at (2, 2.5); moving fb to (2.2, 2.5) would overlap it if the rooms were mixed
    const r = proposeMove(s.getState().project!, 'fb', { x: 2.2, y: 2.5 });
    expect(r.rejected).toBe(false);
    s.getState().commitResult(proposeMove(s.getState().project!, 'fb', { x: 3, y: 3 }), 'Move');
    expect(s.getState().document!.rooms.find((x) => x.id === 'b')!.furniture[0].position).toEqual({ x: 3, y: 3 });
    expect(s.getState().document!.rooms.find((x) => x.id === 'a')!.furniture[0].position).toEqual({ x: 2, y: 2.5 });
    expect(s.getState().project!.rooms[0].furniture[0].position).toEqual({ x: 3, y: 3 });
    expect(s.getState().historyLength()).toBe(1);
  });

  it('undo after switching rooms still undoes the edit in its own room', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('b');
    s.getState().commitResult(proposeMove(s.getState().project!, 'fb', { x: 3, y: 3 }), 'Move');
    s.getState().setActiveRoom('a');
    s.getState().undo();
    expect(s.getState().document!.rooms.find((x) => x.id === 'b')!.furniture[0].position).toEqual({ x: 2, y: 2.5 });
  });
});

describe('creating and deleting rooms', () => {
  const create = (id: string, name: string): Command => ({ type: 'CreateRoom', room: room(id, name) });

  it('a new room becomes active; undo brings the previous room back', () => {
    const s = createProjectStore(makeProject([room('a', 'Kitchen')]));
    s.getState().commit(create('b', 'Living'), 'Add room');
    expect(s.getState().activeRoomId).toBe('b');
    expect(s.getState().document!.rooms.map((r) => r.id)).toEqual(['a', 'b']);
    s.getState().undo();
    expect(s.getState().activeRoomId).toBe('a');
    s.getState().redo();
    expect(s.getState().activeRoomId).toBe('b');
  });

  it('deleting the active room selects its neighbour; undo brings it back and active again', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('b');
    s.getState().commitResult(proposeDeleteRoom(s.getState().document!, 'b'), 'Delete room');
    expect(s.getState().document!.rooms.map((r) => r.id)).toEqual(['a', 'c']);
    expect(s.getState().activeRoomId).toBe('c'); // the room that took its place
    s.getState().undo();
    expect(s.getState().activeRoomId).toBe('b');
    expect(s.getState().project!.rooms[0].name).toBe('Living');
  });

  it('deleting the last room in the list selects the one before it', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('c');
    s.getState().commitResult(proposeDeleteRoom(s.getState().document!, 'c'), 'Delete room');
    expect(s.getState().activeRoomId).toBe('b');
  });

  it('deleting a room that is not active leaves the active room alone', () => {
    const s = createProjectStore(three());
    s.getState().commitResult(proposeDeleteRoom(s.getState().document!, 'c'), 'Delete room');
    expect(s.getState().activeRoomId).toBe('a');
  });

  it('deleting the only room leaves an empty project: no active room, empty view; undo restores it', () => {
    const s = createProjectStore(makeProject([room('a', 'Kitchen', 'fa')]));
    s.getState().commitResult(proposeDeleteRoom(s.getState().document!, 'a'), 'Delete room');
    expect(s.getState().activeRoomId).toBeNull();
    expect(s.getState().project!.rooms).toEqual([]);
    s.getState().undo();
    expect(s.getState().activeRoomId).toBe('a');
    expect(s.getState().project!.rooms[0].furniture).toHaveLength(1);
  });

  it('renaming a room is one undoable step and keeps it active', () => {
    const s = createProjectStore(three());
    s.getState().commit({ type: 'UpdateRoom', roomId: 'a', from: { name: 'Kitchen' }, to: { name: 'Galley' } }, 'Rename room');
    expect(s.getState().project!.rooms[0].name).toBe('Galley');
    expect(s.getState().activeRoomId).toBe('a');
    s.getState().undo();
    expect(s.getState().project!.rooms[0].name).toBe('Kitchen');
  });
});

describe('drawing a new room (no active room)', () => {
  it('null active empties the view but keeps the document; restoring goes back to the room that was active', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('b');
    s.getState().setActiveRoom(null);
    expect(s.getState().project!.rooms).toEqual([]);
    expect(s.getState().document!.rooms).toHaveLength(3);
    s.getState().restoreActiveRoom();
    expect(s.getState().activeRoomId).toBe('b');
  });

  it('restoring with nothing remembered goes to the first room; restoring when not drawing does nothing', () => {
    const s = createProjectStore(three());
    s.getState().restoreActiveRoom();
    expect(s.getState().activeRoomId).toBe('a');
    s.getState().setActiveRoom(null);
    s.getState().load(three()); // loading clears any remembered room
    s.getState().setActiveRoom(null);
    s.getState().restoreActiveRoom();
    expect(s.getState().activeRoomId).toBe('a');
  });

  it('closing a drawn room (CreateRoom) makes it active', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom(null);
    const r = proposeCreateRoom(s.getState().document!, room('d', 'Hall'));
    s.getState().commitResult(r, 'Create room');
    expect(s.getState().activeRoomId).toBe('d');
  });

  it('undo or redo while drawing falls back to a room instead of staying empty', () => {
    const s = createProjectStore(three());
    s.getState().commitResult(proposeMove(s.getState().project!, 'fa', { x: 3, y: 3 }), 'Move');
    s.getState().setActiveRoom(null);
    s.getState().undo();
    expect(s.getState().activeRoomId).toBe('a');
  });
});

describe('silent changes and loading', () => {
  it('updateSilently (project name, saved views) bumps the revision, keeps the active room, adds no history', () => {
    const s = createProjectStore(three());
    s.getState().setActiveRoom('b');
    const rev = s.getState().revision;
    s.getState().updateSilently((p) => ({ ...p, name: 'Flat 4' }));
    expect(s.getState().revision).toBe(rev + 1);
    expect(s.getState().activeRoomId).toBe('b');
    expect(s.getState().document!.name).toBe('Flat 4');
    expect(s.getState().project!.name).toBe('Flat 4');
    expect(s.getState().historyLength()).toBe(0);
    s.getState().updateSilently((p) => p); // no change, no bump
    expect(s.getState().revision).toBe(rev + 1);
  });

  it('load replaces everything: first room active, history cleared', () => {
    const s = createProjectStore(three());
    s.getState().commitResult(proposeMove(s.getState().project!, 'fa', { x: 3, y: 3 }), 'Move');
    s.getState().load(makeProject([room('z', 'New')]));
    expect(s.getState().activeRoomId).toBe('z');
    expect(s.getState().canUndo).toBe(false);
    s.getState().load(null);
    expect(s.getState().project).toBeNull();
    expect(s.getState().document).toBeNull();
    expect(s.getState().activeRoomId).toBeNull();
  });

  it('with no project every action is a quiet no-op', () => {
    const s = createProjectStore(null);
    expect(s.getState().commit({ type: 'CreateRoom', room: room('a', 'x') }, 'x')).toBe(false);
    expect(s.getState().undo()).toBeNull();
    expect(s.getState().redo()).toBeNull();
    s.getState().setActiveRoom('a');
    s.getState().restoreActiveRoom();
    s.getState().updateSilently((p) => p);
    expect(s.getState().activeRoomId).toBeNull();
  });
});

describe('nextActive', () => {
  const p = three();
  it('prefers a newly appeared room, keeps a surviving active room, else the neighbour', () => {
    const added = { ...p, rooms: [...p.rooms, room('d', 'D')] };
    expect(nextActive(p, added, 'a')).toBe('d');
    expect(nextActive(p, p, 'b')).toBe('b');
    const without = { ...p, rooms: p.rooms.filter((r) => r.id !== 'b') };
    expect(nextActive(p, without, 'b')).toBe('c');
    expect(nextActive(p, { ...p, rooms: [] }, 'a')).toBeNull();
    expect(nextActive(null, p, null)).toBe('c'); // everything is "new": the last one wins
  });
});
