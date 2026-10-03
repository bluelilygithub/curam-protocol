// The project library (M5 projects): the browser store, the Vault account client, choosing between them, and the open-project
// controller (autosave, conflict, create/open/rename/duplicate/delete). All DOM-free: fake storage, fake fetch, manual timers.
import { describe, expect, it } from 'vitest';
import { serializeProject, type Project } from '../../src/engine';
import {
  chooseLibrary, createLocalLibrary, createServerLibrary, LIBRARY_INDEX_KEY, LibraryError, type FetchLike, type LibraryEntry, type ProjectLibrary,
} from '../../src/state/library';
import { createLibraryStore } from '../../src/state/libraryStore';
import { STORAGE_KEY } from '../../src/state/persistence';
import { createProjectStore } from '../../src/state/projectStore';
import { AUTOSAVE_MS, CURRENT_KEY, DIRTY_KEY, ProjectsController, RETRY_MS } from '../../src/state/projects';
import { readVaultToken, VAULT_AUTH_KEY } from '../../src/state/vaultAuth';
import { makeProject, makeRoom } from '../helpers';

const fakeStorage = () => {
  const m = new Map<string, string>();
  return {
    m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
  };
};
const counter = (prefix = 'id') => { let i = 0; return () => `${prefix}${++i}`; };
const clock = () => { let t = Date.UTC(2026, 9, 3, 12, 0, 0); return () => new Date((t += 1000)).toISOString(); };
const doc = (name: string, rooms = 1): Project => ({ ...makeProject(Array.from({ length: rooms }, (_, i) => makeRoom({ id: `r${i + 1}`, name: `Room ${i + 1}` }))), name });
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('vaultAuth', () => {
  const st = (v: string | null) => ({ getItem: () => v });
  it('reads the token from Vault\'s persisted auth state, and nothing else', () => {
    expect(readVaultToken(st(JSON.stringify({ state: { token: 'abc', user: { id: 1 } }, version: 0 })))).toBe('abc');
    expect(readVaultToken(st(null))).toBeNull();
    expect(readVaultToken(st('not json'))).toBeNull();
    expect(readVaultToken(st(JSON.stringify({ state: { token: null } })))).toBeNull();
    expect(readVaultToken(st(JSON.stringify({ state: { token: '' } })))).toBeNull();
    expect(readVaultToken(st(JSON.stringify({ state: { token: 5 } })))).toBeNull();
    expect(readVaultToken(st(JSON.stringify(null)))).toBeNull();
    expect(readVaultToken(undefined)).toBeNull();
    expect(readVaultToken({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(VAULT_AUTH_KEY).toBe('vault-auth');
  });
});

describe('the browser library', () => {
  const make = () => { const storage = fakeStorage(); return { storage, lib: createLocalLibrary({ storage, newId: counter('p'), now: clock() }) }; };

  it('creates, lists newest first, loads, saves, renames and deletes', async () => {
    const { lib } = make();
    const a = await lib.create(doc('Flat 1', 2));
    const b = await lib.create(doc('Flat 2'));
    expect(a).toMatchObject({ id: 'p1', name: 'Flat 1', roomCount: 2 });
    expect((await lib.list()).map((e) => e.name)).toEqual(['Flat 2', 'Flat 1']); // b was created later
    const loaded = await lib.load('p1');
    expect(loaded.project.rooms).toHaveLength(2);
    expect(loaded.project.name).toBe('Flat 1');
    const saved = await lib.save('p1', { ...doc('Flat 1', 3) });
    expect(saved.roomCount).toBe(3);
    expect((await lib.list()).map((e) => e.name)).toEqual(['Flat 1', 'Flat 2']); // saving moves it to the top
    const renamed = await lib.rename('p2', '  Beach   house ');
    expect(renamed.name).toBe('Beach house');
    expect((await lib.load('p2')).project.name).toBe('Beach house');
    await lib.remove('p2');
    expect((await lib.list()).map((e) => e.id)).toEqual(['p1']);
    await expect(lib.load('p2')).rejects.toMatchObject({ code: 'not_found' });
    expect(b.id).toBe('p2');
  });

  it('uses the first room\'s name for a project without one, and a default when it has no rooms', async () => {
    const { lib } = make();
    expect((await lib.create({ ...makeProject([makeRoom({ name: 'Hall' })]) })).name).toBe('Hall');
    expect((await lib.create(makeProject([]))).name).toBe('Untitled project');
  });

  it('saving with a stale expectedUpdatedAt is a conflict that names the current version; the right one succeeds', async () => {
    const { lib } = make();
    const a = await lib.create(doc('Flat'));
    const second = await lib.save('p1', doc('Flat 2 rooms', 2), a.updatedAt);
    await expect(lib.save('p1', doc('Mine'), a.updatedAt)).rejects.toMatchObject({ code: 'conflict', current: { id: 'p1', updatedAt: second.updatedAt } });
    await expect(lib.save('p1', doc('Mine'), second.updatedAt)).resolves.toBeTruthy();
    await expect(lib.save('nope', doc('x'))).rejects.toMatchObject({ code: 'not_found' });
    await expect(lib.rename('nope', 'x')).rejects.toMatchObject({ code: 'not_found' });
    await expect(lib.remove('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reports a full browser in plain words', async () => {
    const storage = fakeStorage();
    const lib = createLocalLibrary({ storage, newId: counter(), now: clock() });
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    await expect(lib.create(doc('x'))).rejects.toMatchObject({ code: 'storage', message: expect.stringMatching(/no room left/) });
  });

  it('survives a damaged index or data: the list is empty, the project is "invalid" or missing', async () => {
    const { storage, lib } = make();
    storage.setItem(LIBRARY_INDEX_KEY, '{ not json');
    expect(await lib.list()).toEqual([]);
    storage.setItem(LIBRARY_INDEX_KEY, '"a string"');
    expect(await lib.list()).toEqual([]);
    const e = await lib.create(doc('x'));
    storage.setItem(`${LIBRARY_INDEX_KEY}:${e.id}`, 'garbage');
    await expect(lib.load(e.id)).rejects.toMatchObject({ code: 'invalid' });
    storage.removeItem(`${LIBRARY_INDEX_KEY}:${e.id}`);
    await expect(lib.load(e.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('imports the single project older versions kept in this browser, once, and only if it has rooms', async () => {
    const { storage, lib } = make();
    expect(await lib.importLegacy()).toBeNull(); // nothing there
    storage.setItem(STORAGE_KEY, serializeProject(makeProject([])));
    expect(await lib.importLegacy()).toBeNull(); // empty project: nothing worth keeping
    storage.setItem(STORAGE_KEY, 'broken');
    expect(await lib.importLegacy()).toBeNull();
    storage.setItem(STORAGE_KEY, serializeProject(makeProject([makeRoom({ name: 'Old room' })])));
    const e = await lib.importLegacy();
    expect(e).toMatchObject({ name: 'Old room', roomCount: 1 });
    expect(await lib.importLegacy()).toBeNull(); // library no longer empty
  });
});

describe('the Vault account client', () => {
  interface Call { url: string; method: string; headers: Record<string, string>; body?: unknown }
  const fake = (responses: Array<{ status?: number; body?: unknown } | Error>) => {
    const calls: Call[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined });
      const r = responses.shift() ?? { status: 200, body: {} };
      if (r instanceof Error) throw r;
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
    };
    return { calls, fetchFn };
  };
  const wire = { id: 7, name: 'Flat', roomCount: 2, updatedAt: '2026-10-03T12:00:00.000Z' };
  const lib = (f: FetchLike, token: string | null = 'tok'): ProjectLibrary => createServerLibrary(f, () => token);

  it('lists, loads, creates, saves, renames and deletes through /api/room-projects with the bearer token', async () => {
    const { calls, fetchFn } = fake([
      { body: { projects: [wire, { ...wire, id: 8, updatedAt: '2026-10-03T13:00:00.000Z' }] } },
      { body: { project: { ...wire, data: JSON.parse(serializeProject(doc('Stored name'))) } } },
      { body: { project: wire } }, { body: { project: wire } }, { body: { project: { ...wire, name: 'New' } } }, { body: { ok: true } },
    ]);
    const l = lib(fetchFn);
    expect((await l.list()).map((e) => e.id)).toEqual(['8', '7']); // ids are strings; newest first
    const loaded = await l.load('7');
    expect(loaded.project.name).toBe('Flat'); // the account's name wins over the copy inside the data
    expect(loaded.entry.id).toBe('7');
    await l.create(doc('Flat'));
    await l.save('7', doc('Flat'), '2026-10-03T12:00:00.000Z');
    expect((await l.rename('7', ' New ')).name).toBe('New');
    await l.remove('7');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/room-projects', 'GET /api/room-projects/7', 'POST /api/room-projects', 'PUT /api/room-projects/7', 'PUT /api/room-projects/7', 'DELETE /api/room-projects/7',
    ]);
    for (const c of calls) expect(c.headers.Authorization).toBe('Bearer tok');
    expect(calls[2].body).toMatchObject({ name: 'Flat', data: { schemaVersion: 1 } });
    expect(calls[3].body).toMatchObject({ expectedUpdatedAt: '2026-10-03T12:00:00.000Z' });
    expect(calls[4].body).toEqual({ name: 'New' }); // rename sends no data
  });

  it('maps failures to codes with plain messages: signed out, expired session, not found, conflict, rejected, server error, offline', async () => {
    const cases: Array<[Parameters<typeof fake>[0], string | null, string]> = [
      [[], null, 'unauthorised'],
      [[{ status: 401, body: { error: 'x' } }], 'tok', 'unauthorised'],
      [[{ status: 404, body: { error: 'That project was not found.' } }], 'tok', 'not_found'],
      [[{ status: 409, body: { error: 'changed', current: wire } }], 'tok', 'conflict'],
      [[{ status: 400, body: { error: 'Bad name' } }], 'tok', 'invalid'],
      [[{ status: 500, body: {} }], 'tok', 'network'],
      [[new Error('Failed to fetch')], 'tok', 'network'],
    ];
    for (const [responses, token, code] of cases) {
      const { fetchFn } = fake(responses);
      await expect(lib(fetchFn, token).list()).rejects.toMatchObject({ code });
    }
    const { fetchFn } = fake([{ status: 409, body: { error: 'changed', current: wire } }]);
    const err = await lib(fetchFn).save('7', doc('x'), 'old').catch((e: LibraryError) => e);
    expect((err as LibraryError).current).toMatchObject({ id: '7', roomCount: 2 });
  });

  it('a stored project that cannot be read is "invalid"; an empty or odd body does not crash', async () => {
    const { fetchFn } = fake([{ body: { project: { ...wire, data: { not: 'a project' } } } }, { status: 200, body: null }]);
    await expect(lib(fetchFn).load('7')).rejects.toMatchObject({ code: 'invalid' });
    await expect(lib(fetchFn).list()).resolves.toEqual([]);
  });
});

describe('choosing where to save', () => {
  const entry = (id: string): LibraryEntry => ({ id, name: id, roomCount: 1, updatedAt: '2026-10-03T00:00:00.000Z' });
  const signedIn = () => { const s = fakeStorage(); s.setItem(VAULT_AUTH_KEY, JSON.stringify({ state: { token: 't' } })); return s; };
  const ok: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ projects: [entry('1')] }) });

  it('not signed in → this browser, with a note saying how to get the account', async () => {
    const c = await chooseLibrary({ storage: fakeStorage(), fetch: ok, newId: counter() });
    expect(c.library.kind).toBe('local');
    expect(c.note).toMatch(/this browser only/i);
  });
  it('signed in and Vault answers → the account', async () => {
    const c = await chooseLibrary({ storage: signedIn(), fetch: ok, newId: counter() });
    expect(c.library.kind).toBe('server');
    expect(c.note).toMatch(/Vault account/);
  });
  it('signed in but the session has ended, or Vault is unreachable → this browser, with the reason', async () => {
    const expired: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const down: FetchLike = async () => { throw new Error('offline'); };
    expect((await chooseLibrary({ storage: signedIn(), fetch: expired, newId: counter() })).note).toMatch(/session has ended/i);
    const d = await chooseLibrary({ storage: signedIn(), fetch: down, newId: counter() });
    expect(d.library.kind).toBe('local');
    expect(d.note).toMatch(/could not be reached/i);
  });
  it('no fetch available → this browser', async () => {
    expect((await chooseLibrary({ storage: signedIn(), fetch: undefined, newId: counter() })).library.kind).toBe('local');
  });
});

// ------------------------------------------------------------------ the controller

function rig(opts: { storage?: ReturnType<typeof fakeStorage>; seed?: Project[]; failSave?: () => Error | null } = {}) {
  const storage = opts.storage ?? fakeStorage();
  const local = createLocalLibrary({ storage, newId: counter('lib'), now: clock() });
  const library = {
    ...local,
    async save(id: string, p: Project, expected?: string) {
      const err = opts.failSave?.();
      if (err) throw err;
      return local.save(id, p, expected);
    },
  };
  const project = createProjectStore(null);
  const store = createLibraryStore();
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const notes: string[] = [];
  let loaded = 0;
  const idGen = counter('n');
  const ctl = new ProjectsController({
    project, store, storage, newId: idGen,
    choose: async () => ({ library, note: 'Saved in this browser only.' }),
    newEmpty: (name) => ({ ...makeProject([]), id: idGen(), name }),
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    notify: (text) => { notes.push(text); },
    onLoaded: () => { loaded++; },
  });
  const fire = async (): Promise<void> => { for (const t of timers.splice(0)) if (t.live) t.fn(); await settle(); };
  const edit = (): void => { project.getState().updateSilently((p) => ({ ...p, savedViews: [...(p.savedViews ?? []), { id: `v${Math.random()}`, name: 'v', cameraPosition: [0, 0, 0], target: [0, 0, 0], projection: 'perspective' }] })); };
  return { storage, local, library, project, store, ctl, timers, notes, fire, edit, loaded: () => loaded, pending: () => timers.filter((t) => t.live) };
}

describe('starting up', () => {
  it('with nothing saved: creates "Untitled project", opens it, ready and saved', async () => {
    const r = rig();
    await r.ctl.init();
    expect(r.store.getState()).toMatchObject({ ready: true, status: 'saved', kind: 'local' });
    expect(r.store.getState().entries).toHaveLength(1);
    expect(r.store.getState().entries[0].name).toBe('Untitled project');
    expect(r.project.getState().document!.rooms).toEqual([]);
    expect(r.store.getState().currentId).toBe(r.store.getState().entries[0].id);
    expect(r.loaded()).toBe(1);
  });

  it('imports the project this browser already had and opens it', async () => {
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEY, serializeProject(makeProject([makeRoom({ name: 'My old room' })])));
    const r = rig({ storage });
    await r.ctl.init();
    expect(r.store.getState().entries.map((e) => e.name)).toEqual(['My old room']);
    expect(r.project.getState().document!.rooms[0].name).toBe('My old room');
  });

  it('reopens the project that was open last time, else the most recent', async () => {
    const r = rig();
    await r.local.create(doc('First'));
    const second = await r.local.create(doc('Second'));
    await r.local.create(doc('Third'));
    r.storage.setItem(CURRENT_KEY, second.id);
    await r.ctl.init();
    expect(r.project.getState().document!.name).toBe('Second');
    const r2 = rig({ storage: r.storage });
    r2.storage.setItem(CURRENT_KEY, 'gone');
    await r2.ctl.init();
    expect(r2.project.getState().document!.name).toBe('Third');
  });

  it('work started before the library answered is kept as a new project, not replaced', async () => {
    const r = rig();
    r.project.getState().load(doc('Draft in progress'));
    const done = r.ctl.init();
    r.project.getState().updateSilently((p) => ({ ...p, name: 'Draft in progress!' })); // an edit while the list is loading
    await done;
    expect(r.project.getState().document!.name).toBe('Draft in progress!');
    expect(r.store.getState().entries.map((e) => e.name)).toEqual(['Draft in progress!']);
    expect(r.store.getState().currentId).toBe(r.store.getState().entries[0].id);
  });

  it('restores unsaved changes left in this browser from a session that ended early, and saves them', async () => {
    const storage = fakeStorage();
    const r0 = rig({ storage });
    const e = await r0.local.create(doc('Plan', 1));
    storage.setItem(CURRENT_KEY, e.id);
    storage.setItem(DIRTY_KEY, e.id);
    storage.setItem(STORAGE_KEY, serializeProject({ ...doc('Plan', 1), rooms: doc('Plan', 3).rooms }));
    const r = rig({ storage });
    await r.ctl.init();
    expect(r.project.getState().document!.rooms).toHaveLength(3);
    expect(r.notes.join(' ')).toMatch(/Restored your unsaved changes/);
    expect(r.store.getState().status).toBe('unsaved');
    r.ctl.attach();
    await r.fire();
    expect((await r.local.load(e.id)).project.rooms).toHaveLength(3);
  });

  it('a draft that belongs to another project is ignored', async () => {
    const storage = fakeStorage();
    const r0 = rig({ storage });
    const e = await r0.local.create(doc('Plan', 1));
    storage.setItem(CURRENT_KEY, e.id);
    storage.setItem(DIRTY_KEY, 'some-other-id');
    storage.setItem(STORAGE_KEY, serializeProject(doc('Other', 4)));
    const r = rig({ storage });
    await r.ctl.init();
    expect(r.project.getState().document!.rooms).toHaveLength(1);
  });
});

describe('autosave and manual save', () => {
  it('an edit marks the project unsaved; autosave runs after the pause; one burst of edits is one save', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    r.edit(); r.edit(); r.edit();
    expect(r.store.getState().status).toBe('unsaved');
    expect(r.storage.getItem(DIRTY_KEY)).toBe(r.store.getState().currentId);
    expect(r.pending()).toHaveLength(1); // earlier timers were cancelled
    expect(r.pending()[0].ms).toBe(AUTOSAVE_MS);
    await r.fire();
    expect(r.store.getState().status).toBe('saved');
    expect(r.storage.getItem(DIRTY_KEY)).toBeNull();
    const saved = (await r.local.load(r.store.getState().currentId!)).project;
    expect(saved.savedViews).toHaveLength(3);
  });

  it('loading a project is not an edit', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    await r.local.create(doc('Other'));
    await r.ctl.refresh();
    await r.ctl.open(r.store.getState().entries.find((e) => e.name === 'Other')!.id);
    expect(r.store.getState().status).toBe('saved');
    expect(r.pending()).toHaveLength(0);
  });

  it('Save now saves immediately and cancels the pending autosave', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    r.edit();
    await r.ctl.saveNow();
    expect(r.store.getState().status).toBe('saved');
    expect(r.pending()).toHaveLength(0);
  });

  it('an edit made while a save is running leaves the project unsaved and saves again', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    r.edit();
    const saving = r.ctl.saveNow();
    r.edit(); // lands while the first save is in flight
    await saving;
    expect(r.store.getState().status).toBe('unsaved');
    await r.fire();
    expect(r.store.getState().status).toBe('saved');
    expect((await r.local.load(r.store.getState().currentId!)).project.savedViews).toHaveLength(2);
  });

  it('a network failure shows "Could not save", keeps the changes marked, and retries later', async () => {
    let fail: Error | null = new LibraryError('network', 'Could not reach Vault.');
    const r = rig({ failSave: () => fail });
    await r.ctl.init();
    r.ctl.attach();
    r.edit();
    await r.ctl.saveNow();
    expect(r.store.getState()).toMatchObject({ status: 'error', error: 'Could not reach Vault.' });
    expect(r.storage.getItem(DIRTY_KEY)).toBe(r.store.getState().currentId);
    expect(r.pending().map((t) => t.ms)).toEqual([RETRY_MS]);
    fail = null;
    await r.fire();
    expect(r.store.getState().status).toBe('saved');
  });

  it('a failure that retrying cannot fix (signed out, browser full) does not loop', async () => {
    const r = rig({ failSave: () => new LibraryError('unauthorised', 'Your Vault session has ended.') });
    await r.ctl.init();
    r.ctl.attach();
    r.edit();
    await r.ctl.saveNow();
    expect(r.store.getState()).toMatchObject({ status: 'error', error: 'Your Vault session has ended.' });
    expect(r.pending()).toHaveLength(0);
  });

  it('an unexpected error is reported in plain words', async () => {
    const r = rig({ failSave: () => new TypeError('boom') });
    await r.ctl.init();
    r.ctl.attach();
    r.edit();
    await r.ctl.saveNow();
    expect(r.store.getState().error).toBe('Could not save the project.');
  });
});

describe('two windows editing the same project', () => {
  async function conflicted() {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    const id = r.store.getState().currentId!;
    await r.local.save(id, doc('Saved by the other window', 4)); // changes updatedAt behind our back
    r.edit();
    await r.ctl.saveNow();
    return { r, id };
  }

  it('pauses autosave and asks which version to keep', async () => {
    const { r } = await conflicted();
    expect(r.store.getState().status).toBe('conflict');
    expect(r.store.getState().error).toMatch(/another window/);
    r.edit();
    expect(r.store.getState().status).toBe('conflict'); // still waiting for the owner
    expect(r.pending()).toHaveLength(0);
  });

  it('"Reload theirs" takes the saved version and drops local changes', async () => {
    const { r } = await conflicted();
    await r.ctl.reloadTheirs();
    expect(r.store.getState().status).toBe('saved');
    expect(r.project.getState().document!.rooms).toHaveLength(4);
  });

  it('"Overwrite with mine" saves what is open over the other version', async () => {
    const { r, id } = await conflicted();
    await r.ctl.overwriteMine();
    expect(r.store.getState().status).toBe('saved');
    expect((await r.local.load(id)).project.rooms).toHaveLength(0);
  });

  it('will not switch projects while a save problem is unresolved (so nothing is lost)', async () => {
    const { r } = await conflicted();
    const other = await r.local.create(doc('Other'));
    await r.ctl.refresh();
    await r.ctl.open(other.id);
    expect(r.store.getState().currentId).not.toBe(other.id);
    expect(r.notes.join(' ')).toMatch(/Resolve the save problem/);
    await r.ctl.newProject('Nope');
    expect(r.store.getState().entries.some((e) => e.name === 'Nope')).toBe(false);
  });
});

describe('create, open, rename, duplicate, delete', () => {
  it('New project saves the open one first, then opens a fresh named one', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    const first = r.store.getState().currentId!;
    r.edit();
    await r.ctl.newProject('  Beach   house ');
    expect(r.store.getState().currentId).not.toBe(first);
    expect(r.project.getState().document!.name).toBe('Beach house');
    expect(r.project.getState().document!.rooms).toEqual([]);
    expect((await r.local.load(first)).project.savedViews).toHaveLength(1); // saved before switching
    expect(r.store.getState().entries.map((e) => e.name).sort()).toEqual(['Beach house', 'Untitled project']);
    expect(r.storage.getItem(CURRENT_KEY)).toBe(r.store.getState().currentId);
    await r.ctl.newProject('');
    expect(r.store.getState().entries.filter((e) => e.name === 'Untitled project').length).toBe(2);
  });

  it('Open switches to another project; opening the current one does nothing', async () => {
    const r = rig();
    await r.ctl.init();
    const other = await r.local.create(doc('Other', 2));
    await r.ctl.refresh();
    await r.ctl.open(other.id);
    expect(r.project.getState().document!.rooms).toHaveLength(2);
    const loadedBefore = r.loaded();
    await r.ctl.open(other.id);
    expect(r.loaded()).toBe(loadedBefore);
  });

  it('opening a project that has vanished says so, drops it from the list, and opens another', async () => {
    const r = rig();
    await r.ctl.init();
    const ghost = await r.local.create(doc('Ghost'));
    await r.ctl.refresh();
    await r.local.remove(ghost.id); // deleted elsewhere
    await r.ctl.open(ghost.id);
    expect(r.notes.join(' ')).toMatch(/no longer in your library/);
    expect(r.store.getState().entries.some((e) => e.id === ghost.id)).toBe(false);
  });

  it('renaming the open project updates the list and the project, and does not look like an unsaved edit or cause a conflict', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    const id = r.store.getState().currentId!;
    await r.ctl.rename(id, 'Flat 4');
    expect(r.store.getState().entries[0].name).toBe('Flat 4');
    expect(r.project.getState().document!.name).toBe('Flat 4');
    expect(r.store.getState().status).toBe('saved');
    expect(r.pending()).toHaveLength(0);
    r.edit();
    await r.ctl.saveNow(); // would be a conflict if the rename's timestamp had not been taken
    expect(r.store.getState().status).toBe('saved');
  });

  it('renaming another project only changes its entry', async () => {
    const r = rig();
    await r.ctl.init();
    const other = await r.local.create(doc('Other'));
    await r.ctl.refresh();
    await r.ctl.rename(other.id, 'Renamed');
    expect(r.store.getState().entries.find((e) => e.id === other.id)!.name).toBe('Renamed');
    expect(r.project.getState().document!.name).not.toBe('Renamed');
  });

  it('duplicating makes an independent "(copy)" with new ids and leaves the open project alone', async () => {
    const r = rig();
    await r.ctl.init();
    const other = await r.local.create(doc('Plan', 2));
    await r.ctl.refresh();
    const openId = r.store.getState().currentId;
    await r.ctl.duplicate(other.id);
    const copy = r.store.getState().entries.find((e) => e.name === 'Plan (copy)')!;
    expect(copy).toBeTruthy();
    expect(copy.roomCount).toBe(2);
    const a = (await r.local.load(other.id)).project;
    const b = (await r.local.load(copy.id)).project;
    expect(b.id).not.toBe(a.id);
    expect(b.rooms.map((x) => x.id).some((id) => a.rooms.some((y) => y.id === id))).toBe(false);
    expect(r.store.getState().currentId).toBe(openId);
  });

  it('duplicating the open project copies what is on screen, including unsaved work', async () => {
    const r = rig();
    await r.ctl.init();
    r.ctl.attach();
    r.edit();
    const id = r.store.getState().currentId!;
    await r.ctl.duplicate(id);
    const copy = r.store.getState().entries.find((e) => e.name === 'Untitled project (copy)')!;
    expect((await r.local.load(copy.id)).project.savedViews).toHaveLength(1);
  });

  it('deleting another project keeps the open one; deleting the open one opens the next, or a new empty one when none is left', async () => {
    const r = rig();
    await r.ctl.init();
    const open = r.store.getState().currentId!;
    const other = await r.local.create(doc('Other'));
    await r.ctl.refresh();
    await r.ctl.remove(other.id);
    expect(r.store.getState().currentId).toBe(open);
    expect(r.store.getState().entries).toHaveLength(1);
    await r.ctl.remove(open);
    expect(r.store.getState().entries).toHaveLength(1); // a fresh empty project replaced it
    expect(r.store.getState().currentId).not.toBe(open);
    expect(r.project.getState().document!.name).toBe('Untitled project');
    const keep = await r.local.create(doc('Keep'));
    await r.ctl.refresh();
    await r.ctl.remove(r.store.getState().currentId!);
    expect(r.store.getState().currentId).toBe(keep.id);
  });

  it('a failed delete or rename tells the owner and changes nothing', async () => {
    const r = rig();
    await r.ctl.init();
    await r.ctl.remove('nope');
    await r.ctl.rename('nope', 'x');
    await r.ctl.duplicate('nope');
    expect(r.notes.filter((n) => /no longer in your library/.test(n)).length).toBe(3);
    expect(r.store.getState().entries).toHaveLength(1);
  });

  it('Import adds a project from a file and opens it', async () => {
    const r = rig();
    await r.ctl.init();
    await r.ctl.importProject(doc('From a file', 3));
    expect(r.project.getState().document!.name).toBe('From a file');
    expect(r.project.getState().document!.rooms).toHaveLength(3);
    expect(r.store.getState().entries.some((e) => e.name === 'From a file')).toBe(true);
  });

  it('everything is a quiet no-op before a library is chosen', async () => {
    const r = rig();
    await r.ctl.saveNow();
    await r.ctl.rename('x', 'y');
    await r.ctl.duplicate('x');
    await r.ctl.remove('x');
    await r.ctl.refresh();
    await r.ctl.reloadTheirs();
    await r.ctl.overwriteMine();
    expect(r.store.getState().entries).toEqual([]);
  });

  it('detach stops watching and cancels the autosave', async () => {
    const r = rig();
    await r.ctl.init();
    const detach = r.ctl.attach();
    r.edit();
    expect(r.pending()).toHaveLength(1);
    detach();
    expect(r.pending()).toHaveLength(0);
    r.edit();
    expect(r.pending()).toHaveLength(0);
  });
});
