// M5 projects at the app level: several rooms per project (add, switch, rename, copy, delete, undo) and the project library
// (autosave, reopen, new, import/export) through the real createApp, in Node with fake storage and timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/createApp';
import { AUTOSAVE_MS } from '../../src/state/projects';
import { deserializeProject } from '../../src/engine';
import type { PointerEv } from '../../src/interaction/interaction';
import { makeInstance } from '../helpers';

const fakeStorage = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0); };
const ptr = (x: number, y: number): PointerEv => ({ world: { x, y }, screen: { x: x * 100, y: -y * 100 }, shift: false, alt: false, ctrl: false, mpp: 0.01 });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function started(storage = fakeStorage()) {
  const app = createApp(storage);
  const stop = app.start();
  await app.whenReady();
  await flush();
  return { app, storage, stop };
}

const names = (app: ReturnType<typeof createApp>): string[] => app.project.getState().document!.rooms.map((r) => r.name).sort();
const active = (app: ReturnType<typeof createApp>) => app.project.getState().project!.rooms[0];

describe('several rooms in one project', () => {
  it('adding rooms names them Room 1, Room 2, … and opens the new one; undo goes back to the previous room', async () => {
    const { app } = await started();
    app.startRectangle();
    app.startRectangle();
    expect(names(app)).toEqual(['Room 1', 'Room 2']);
    expect(active(app).name).toBe('Room 2');
    expect(app.project.getState().project!.rooms).toHaveLength(1); // the editor sees one room
    expect(app.project.getState().undoLabel).toBe('Create room');
    app.project.getState().undo();
    expect(active(app).name).toBe('Room 1');
    expect(names(app)).toEqual(['Room 1']);
  });

  it('switching rooms clears the selection, adds no history, and each room keeps its own contents', async () => {
    const { app } = await started();
    app.startRectangle();
    const first = active(app);
    app.project.getState().commit({ type: 'PlaceFurniture', instance: makeInstance({ id: 'sofa', roomId: first.id, definitionId: 'sofa-3', width: 2.2, length: 0.95, height: 0.85 }) }, 'Place sofa');
    app.startRectangle();
    const second = active(app);
    expect(second.furniture).toHaveLength(0);
    app.ui.getState().select([{ kind: 'wall', id: second.walls[0].id }]);
    const hist = app.project.getState().historyLength();
    app.switchRoom(first.id);
    expect(app.ui.getState().selection).toEqual([]);
    expect(active(app).id).toBe(first.id);
    expect(active(app).furniture).toHaveLength(1);
    expect(app.project.getState().historyLength()).toBe(hist);
    app.switchRoom(second.id);
    expect(active(app).furniture).toHaveLength(0);
    app.switchRoom(second.id); // already open: nothing
    expect(app.project.getState().historyLength()).toBe(hist);
  });

  it('copying a room duplicates its furniture and openings with new ids, opens the copy, and undo removes it', async () => {
    const { app } = await started();
    app.startRectangle();
    const room = active(app);
    app.project.getState().commit({ type: 'PlaceFurniture', instance: makeInstance({ id: 'sofa', roomId: room.id, definitionId: 'sofa-3', width: 2.2, length: 0.95, height: 0.85 }) }, 'Place sofa');
    app.duplicateRoom();
    expect(names(app)).toEqual(['Room 1', 'Room 1 (copy)']);
    const copy = active(app);
    expect(copy.name).toBe('Room 1 (copy)');
    expect(copy.furniture).toHaveLength(1);
    expect(copy.furniture[0].id).not.toBe('sofa');
    expect(copy.furniture[0].roomId).toBe(copy.id);
    expect(app.project.getState().undoLabel).toBe('Duplicate room');
    app.project.getState().undo();
    expect(names(app)).toEqual(['Room 1']);
    expect(active(app).furniture[0].id).toBe('sofa');
  });

  it('renaming is one undoable step; a blank or unchanged name does nothing', async () => {
    const { app } = await started();
    app.startRectangle();
    const id = active(app).id;
    const hist = app.project.getState().historyLength();
    app.renameRoom(id, '   ');
    app.renameRoom(id, 'Room 1');
    expect(app.project.getState().historyLength()).toBe(hist);
    app.renameRoom(id, '  Living   room ');
    expect(active(app).name).toBe('Living room');
    expect(app.project.getState().undoLabel).toBe('Rename room');
    app.project.getState().undo();
    expect(active(app).name).toBe('Room 1');
    app.renameRoom('nope', 'x'); // unknown room: nothing
  });

  it('deleting a room opens its neighbour; deleting the last leaves an empty project; undo brings it back', async () => {
    const { app } = await started();
    app.startRectangle();
    app.startRectangle();
    const [a, b] = app.project.getState().document!.rooms;
    app.deleteRoom();
    expect(app.project.getState().document!.rooms).toHaveLength(1);
    expect(active(app).id).not.toBeUndefined();
    app.deleteRoom();
    expect(app.project.getState().document!.rooms).toHaveLength(0);
    expect(app.project.getState().project!.rooms).toEqual([]);
    app.project.getState().undo();
    expect(app.project.getState().document!.rooms).toHaveLength(1);
    expect(active(app)).toBeTruthy();
    app.deleteRoom('nope'); // unknown id: nothing
    expect([a.id, b.id]).toContain(active(app).id);
  });

  it('"Draw a room" with rooms already there: the open room steps aside, the drawn room is added and opened, the others are untouched', async () => {
    const { app } = await started();
    app.startRectangle();
    const first = active(app);
    app.startDrawing();
    expect(app.project.getState().activeRoomId).toBeNull();
    expect(app.project.getState().project!.rooms).toEqual([]);
    expect(app.ui.getState().tool).toBe('wall_edit');
    for (const [x, y] of [[0, 0], [3, 0], [3, 3], [0, 3]]) { app.interaction.pointerDown(ptr(x, y)); app.interaction.pointerUp(ptr(x, y)); }
    app.interaction.pointerDown(ptr(0, 0)); // close on the first corner
    app.interaction.pointerUp(ptr(0, 0));
    expect(names(app)).toEqual(['Room 1', 'Room 2']);
    expect(active(app).name).toBe('Room 2');
    expect(active(app).vertices).toHaveLength(4);
    expect(app.project.getState().document!.rooms.find((r) => r.id === first.id)!.vertices).toHaveLength(4);
    expect(app.project.getState().undoLabel).toBe('Draw room');
  });

  it('giving up on a new room brings the open room back: Esc twice, the Cancel button, or leaving the Walls tool', async () => {
    const { app } = await started();
    app.startRectangle();
    const id = active(app).id;
    app.startDrawing();
    app.interaction.pointerDown(ptr(1, 1)); app.interaction.pointerUp(ptr(1, 1)); // one corner placed
    app.interaction.keyDown({ key: 'Escape', shift: false, ctrl: false, alt: false }); // abandons the corner
    expect(app.project.getState().activeRoomId).toBeNull();
    app.interaction.keyDown({ key: 'Escape', shift: false, ctrl: false, alt: false }); // gives up the room
    expect(app.project.getState().activeRoomId).toBe(id);
    expect(app.ui.getState().tool).toBe('select');
    app.startDrawing();
    app.cancelNewRoom();
    expect(app.project.getState().activeRoomId).toBe(id);
    app.startDrawing();
    app.interaction.keyDown({ key: '1', shift: false, ctrl: false, alt: false }); // the Select tool key
    expect(app.project.getState().activeRoomId).toBe(id);
    expect(app.project.getState().historyLength()).toBe(1); // only the first room was ever created
  });

  it('with no rooms, "Draw a room" behaves as before', async () => {
    const { app } = await started();
    app.startDrawing();
    expect(app.ui.getState().tool).toBe('wall_edit');
    expect(app.project.getState().document!.rooms).toHaveLength(0);
    for (const [x, y] of [[0, 0], [3, 0], [3, 3]]) { app.interaction.pointerDown(ptr(x, y)); app.interaction.pointerUp(ptr(x, y)); }
    app.interaction.keyDown({ key: 'Enter', shift: false, ctrl: false, alt: false });
    expect(names(app)).toEqual(['Room 1']);
  });

  it('every room is in the exported file, and a file with several rooms opens with all of them', async () => {
    const { app } = await started();
    app.startRectangle();
    app.startRectangle();
    app.startRectangle();
    const out = app.exportJson()!;
    expect(out.name).toMatch(/\.roomplan\.json$/);
    const parsed = deserializeProject(out.text);
    expect(parsed.rooms).toHaveLength(3);
    expect(app.openJson(out.text)).toBe(true);
    await flush();
    expect(app.project.getState().document!.rooms).toHaveLength(3);
    expect(app.openJson('not a project')).toBe(false);
    expect(await app.importFile('{"schemaVersion":2}')).toBe(false);
  });
});

describe('projects: save, reopen, new, switch', () => {
  it('a new session opens an Untitled project, saved in this browser', async () => {
    const { app } = await started();
    expect(app.library.getState()).toMatchObject({ kind: 'local', status: 'saved', ready: true });
    expect(app.library.getState().entries.map((e) => e.name)).toEqual(['Untitled project']);
  });

  it('an edit is autosaved after the pause, and the next session reopens it with all its rooms', async () => {
    const storage = fakeStorage();
    const { app, stop } = await started(storage);
    app.startRectangle();
    app.startRectangle();
    expect(app.library.getState().status).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 50);
    await flush();
    expect(app.library.getState().status).toBe('saved');
    stop();
    const again = await started(storage);
    expect(again.app.project.getState().document!.rooms).toHaveLength(2);
    expect(again.app.library.getState().entries).toHaveLength(1);
    expect(again.app.library.getState().status).toBe('saved');
  });

  it('Save now does not wait for the pause', async () => {
    const { app } = await started();
    app.startRectangle();
    expect(app.library.getState().status).toBe('unsaved');
    await app.saveProject();
    expect(app.library.getState().status).toBe('saved');
  });

  it('New project, switching back and forth, and renaming keep every project\'s rooms apart', async () => {
    const storage = fakeStorage();
    const { app } = await started(storage);
    app.startRectangle();
    const firstId = app.library.getState().currentId!;
    await app.newProject('Flat 2');
    await flush();
    expect(app.project.getState().document!.name).toBe('Flat 2');
    expect(app.project.getState().document!.rooms).toHaveLength(0);
    app.startRectangle();
    app.startRectangle();
    await app.openProject(firstId);
    await flush();
    expect(app.project.getState().document!.rooms).toHaveLength(1);
    const flat2 = app.library.getState().entries.find((e) => e.name === 'Flat 2')!;
    expect(flat2.roomCount).toBe(2); // saved when we switched away
    await app.renameProject(flat2.id, 'Beach house');
    expect(app.library.getState().entries.map((e) => e.name).sort()).toEqual(['Beach house', 'Untitled project']);
    await app.duplicateProject(flat2.id);
    expect(app.library.getState().entries.map((e) => e.name)).toContain('Beach house (copy)');
    await app.deleteProject(flat2.id);
    expect(app.library.getState().entries.some((e) => e.id === flat2.id)).toBe(false);
  });

  it('switching projects clears selection and leaves walking or touring', async () => {
    const { app } = await started();
    app.startRectangle();
    await app.newProject('Other');
    await flush();
    const first = app.library.getState().entries.find((e) => e.name !== 'Other')!;
    app.ui.getState().select([{ kind: 'vertex', id: 'x' }]);
    app.ui.getState().setTourPlaying(true);
    await app.openProject(first.id);
    await flush();
    expect(app.ui.getState().selection).toEqual([]);
    expect(app.ui.getState().tourPlaying).toBe(false);
  });

  it('browsing and editing do not touch the library store on pointer moves (A12)', async () => {
    const { app } = await started();
    app.startRectangle();
    await app.saveProject();
    let n = 0;
    app.library.subscribe(() => { n++; });
    app.project.subscribe(() => { n++; });
    for (let i = 0; i < 60; i++) app.interaction.pointerMove(ptr(1 + i / 100, 1));
    expect(n).toBe(0);
  });

  it('the old single-project save in this browser becomes the first project', async () => {
    const storage = fakeStorage();
    const seed = createApp(storage);
    seed.startRectangle();
    seed.project.getState().updateSilently((p) => ({ ...p, name: undefined }));
    // simulate an older version: only the draft key exists
    storage.m.delete('room-planner:library:v1');
    for (const k of [...storage.m.keys()]) if (k.startsWith('room-planner:library:v1:')) storage.m.delete(k);
    storage.m.delete('room-planner:current:v1');
    storage.setItem('room-planner:project:v1', (await import('../../src/engine')).serializeProject(seed.project.getState().document!));
    const { app } = await started(storage);
    expect(app.library.getState().entries).toHaveLength(1);
    expect(app.project.getState().document!.rooms).toHaveLength(1);
  });
});
