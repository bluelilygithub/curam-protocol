import { describe, expect, it } from 'vitest';
import { createLocalLibrary, createServerLibrary, LibraryError, type FetchLike } from '@planner-core/library/library';
import { createLibraryStore } from '@planner-core/library/libraryStore';
import { AUTOSAVE_MS, ProjectsController } from '@planner-core/library/projectsController';
import { apply, setItem } from '../src/domain/commands';
import { cloneGarden, isBlank, newGardenProject, randomId } from '../src/domain/projectFactory';
import type { GardenProject } from '../src/domain/types';
import { CURRENT_KEY, DIRTY_KEY, gardenCodec, type GardenEntry } from '../src/state/library';
import { deserializeProject, loadDraft, serializeProject } from '../src/state/persistence';
import { createProjectStore } from '../src/state/projectStore';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};
let n = 0;
const ids = () => `id${++n}`;
const withPlant = (p: GardenProject): GardenProject => apply(setItem('plants', 'pl1', null, { id: 'pl1', plantId: 'x', position: { x: 1, y: 1 } }), p);
const clock = () => { let t = 0; return () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)).toISOString(); };

describe('garden library codec', () => {
  it('names, counts and wire entries', () => {
    const p = withPlant(newGardenProject('  Back   yard ', undefined, 'g1'));
    expect(gardenCodec.nameOf(p)).toBe('Back yard');
    expect(gardenCodec.extra(p)).toEqual({ plantCount: 1, location: 'Sydney NSW' });
    const e = gardenCodec.entryFromWire({ id: 7, name: 'x', plantCount: '3', location: 'Perth WA', updatedAt: '2026-01-01T00:00:00Z' });
    expect(e).toEqual({ id: '7', name: 'x', plantCount: 3, location: 'Perth WA', updatedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('round-trips through the file format and rejects other files', () => {
    const p = withPlant(newGardenProject('g', undefined, 'g1'));
    expect(deserializeProject(serializeProject(p))).toEqual(p);
    expect(() => deserializeProject('{"a":1}')).toThrow();
  });

  it('a clone shares no ids with the original', () => {
    const p = withPlant(newGardenProject('g', undefined, 'g1'));
    const c = cloneGarden(p, randomId, 'copy');
    expect(c.id).not.toBe(p.id);
    expect(c.plants[0].id).not.toBe('pl1');
    expect(c.plants[0].plantId).toBe('x');
    expect(isBlank(newGardenProject())).toBe(true);
    expect(isBlank(p)).toBe(false);
  });
});

describe('tracing picture references', () => {
  const pic = { name: 'p.jpg', imageId: 'srv-7', widthPx: 100, heightPx: 80, metresPerPixel: 0.1, origin: { x: 0, y: 0 }, rotation: 0, opacity: 0.6 };
  const withPic = (): GardenProject => ({ ...newGardenProject('g', undefined, 'g1'), underlay: pic });

  it('duplicating a garden shares the picture by reference (nothing is copied or re-uploaded)', () => {
    const copy = cloneGarden(withPic(), randomId, 'copy');
    expect(copy.underlay?.imageId).toBe('srv-7');
    expect(copy.underlay).toEqual(pic);
    expect(copy.underlay).not.toBe(pic); // an independent object: editing the copy's scale never changes the original
  });

  it('the design never holds picture bytes, so a save is small however big the picture is', () => {
    expect(serializeProject(withPic()).length).toBeLessThan(2000);
    expect('dataUrl' in (withPic().underlay ?? {})).toBe(false);
  });

  it('remove the picture, then undo: the same reference comes back', () => {
    const store = createProjectStore(withPic());
    store.getState().commit({ type: 'SetSingleton', name: 'underlay', from: pic, to: null }, 'Remove tracing picture');
    expect(store.getState().project?.underlay).toBeUndefined();
    store.getState().undo();
    expect(store.getState().project?.underlay).toEqual(pic);
    store.getState().redo();
    expect(store.getState().project?.underlay).toBeUndefined();
  });
});

describe('local library (offline fallback)', () => {
  it('create, list, load, save with conflict check, rename, remove', async () => {
    const lib = createLocalLibrary<GardenProject, GardenEntry>({ storage: mem(), newId: ids, indexKey: 'k', now: clock() }, gardenCodec);
    const e = await lib.create(newGardenProject('A', undefined, 'g'));
    expect((await lib.list()).map((x) => x.name)).toEqual(['A']);
    const saved = await lib.save(e.id, withPlant(newGardenProject('A', undefined, 'g')), e.updatedAt);
    expect(saved.plantCount).toBe(1);
    await expect(lib.save(e.id, newGardenProject('A'), e.updatedAt)).rejects.toMatchObject({ code: 'conflict' });
    expect((await lib.rename(e.id, ' B ')).name).toBe('B');
    expect((await lib.load(e.id)).project.name).toBe('B');
    await lib.remove(e.id);
    expect(await lib.list()).toEqual([]);
  });
});

describe('server library', () => {
  const fake = () => {
    const calls: Array<{ url: string; method: string; body?: { name?: string; data?: { plants?: unknown[] } }; auth?: string }> = [];
    const f: FetchLike = async (url, init) => {
      const body = init?.body ? (JSON.parse(init.body) as { name?: string; data?: { plants?: unknown[] } }) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body, auth: init?.headers?.Authorization });
      return { ok: true, status: 200, json: async () => ({ project: { id: 5, name: body?.name ?? 'n', plantCount: body?.data?.plants?.length ?? 0, location: 'Sydney NSW', updatedAt: '2026-01-01T00:00:00.000Z', data: body?.data } }) };
    };
    return { calls, f };
  };

  it('sends the garden to /api/garden-projects with the Vault token, name and data', async () => {
    const { calls, f } = fake();
    const lib = createServerLibrary<GardenProject, GardenEntry>(f, () => 'tok', '/api/garden-projects', gardenCodec);
    const e = await lib.create(withPlant(newGardenProject('Mine', undefined, 'g')));
    expect(e.id).toBe('5');
    expect(calls[0]).toMatchObject({ url: '/api/garden-projects', method: 'POST', auth: 'Bearer tok' });
    expect(calls[0].body?.name).toBe('Mine');
    expect(calls[0].body?.data?.plants).toHaveLength(1);
  });

  it('without a token it refuses (the app then uses the browser)', async () => {
    const lib = createServerLibrary<GardenProject, GardenEntry>(fake().f, () => null, '/x', gardenCodec);
    await expect(lib.list()).rejects.toBeInstanceOf(LibraryError);
  });
});

describe('autosave through the shared controller', () => {
  it('a change saves after the pause and clears the unsaved mark', async () => {
    const s = mem();
    const store = createProjectStore(null);
    const lib = createLibraryStore<GardenEntry>();
    const timers: Array<() => void> = [];
    const local = createLocalLibrary<GardenProject, GardenEntry>({ storage: s, newId: ids, indexKey: 'k', now: clock() }, gardenCodec);
    const ctl = new ProjectsController<GardenProject, GardenEntry>({
      doc: {
        get: () => store.getState().project, revision: () => store.getState().revision, subscribe: (fn) => store.subscribe(fn),
        load: (p) => store.getState().load(p), setName: (name) => store.getState().updateSilently((p) => ({ ...p, name })),
      },
      store: lib, storage: s, newId: ids, choose: async () => ({ library: local, note: 'browser' }), newEmpty: (name) => newGardenProject(name),
      schedule: (fn) => { timers.push(fn); return () => undefined; }, notify: () => undefined,
      currentKey: CURRENT_KEY, dirtyKey: DIRTY_KEY, clone: (p, name) => cloneGarden(p, ids, name), nameOf: gardenCodec.nameOf,
      withName: (p, name) => ({ ...p, name }), cleanName: gardenCodec.cleanName, isEmpty: isBlank, loadDraft: () => loadDraft(s),
    });
    ctl.attach();
    await ctl.init();
    expect(lib.getState().entries).toHaveLength(1); // a new library starts with one blank garden
    store.getState().commit(setItem('plants', 'pl1', null, { id: 'pl1', plantId: 'x', position: { x: 0, y: 0 } }), 'Plant');
    expect(lib.getState().status).toBe('unsaved');
    expect(s.getItem(DIRTY_KEY)).toBeTruthy();
    expect(AUTOSAVE_MS).toBeGreaterThan(0);
    timers.pop()?.();
    await ctl.saveNow();
    expect(lib.getState().status).toBe('saved');
    expect(lib.getState().entries[0].plantCount).toBe(1);
    expect(s.getItem(DIRTY_KEY)).toBeNull();
  });
});
