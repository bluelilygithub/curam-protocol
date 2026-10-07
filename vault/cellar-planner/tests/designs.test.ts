import { describe, expect, it } from 'vitest';
import { AUTOSAVE_MS } from '@planner-core/library/projectsController';
import { designCodec, DESIGN_INDEX_KEY, DRAFT_KEY, type FetchLike } from '../src/app/designLibrary';
import { createDesigns } from '../src/app/designs';
import { sampleProject, serializeApp, testCaseProject } from '../src/app/model';
import { createAppStore } from '../src/app/store';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};
let n = 0;
const ids = () => `id${++n}`;

/** A timer the test drives by hand, so autosave is deterministic. */
function clock() {
  const queue: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  return {
    schedule: (fn: () => void, ms: number) => { const t = { at: now + ms, fn }; queue.push(t); return () => { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); }; },
    async advance(ms: number) {
      now += ms;
      for (const t of queue.filter((x) => x.at <= now)) { queue.splice(queue.indexOf(t), 1); t.fn(); }
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** An in-memory stand-in for /api/cellar-projects with the real route's 404 / 409 behaviour. */
function fakeServer() {
  const rows = new Map<number, { name: string; data: unknown; updatedAt: number; runCount: number; rackUnits: number; estimated: boolean }>();
  let seq = 0, t = Date.UTC(2026, 9, 20);
  const calls: string[] = [];
  const wire = (id: number) => { const r = rows.get(id)!; return { id, name: r.name, runCount: r.runCount, rackUnits: r.rackUnits, estimated: r.estimated, updatedAt: new Date(r.updatedAt).toISOString() }; };
  const stats = (d: { runs: Array<{ units: number }>; estimated?: unknown[] }) => ({ runCount: d.runs.length, rackUnits: d.runs.reduce((a, r) => a + r.units, 0), estimated: (d.estimated?.length ?? 0) > 0 });
  const fetchFn: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const id = Number(url.split('/').pop());
    const body = init?.body ? (JSON.parse(init.body) as { name?: string; data?: { runs: Array<{ units: number }>; estimated?: unknown[] }; expectedUpdatedAt?: string }) : {};
    const reply = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json });
    if (method === 'GET' && url.endsWith('/api/cellar-projects')) return reply(200, { projects: [...rows.keys()].map(wire) });
    if (method === 'GET') return rows.has(id) ? reply(200, { project: { ...wire(id), data: rows.get(id)!.data } }) : reply(404, { error: 'That design was not found.' });
    if (method === 'POST') { const nid = ++seq; rows.set(nid, { name: body.name!, data: body.data, updatedAt: (t += 1000), ...stats(body.data!) }); return reply(200, { project: wire(nid) }); }
    if (method === 'PUT') {
      const r = rows.get(id);
      if (!r) return reply(404, { error: 'That design was not found.' });
      if (body.expectedUpdatedAt && new Date(r.updatedAt).toISOString() !== body.expectedUpdatedAt) return reply(409, { error: 'This design was changed in another window or tab.', current: wire(id) });
      if (body.name) r.name = body.name;
      if (body.data) Object.assign(r, { data: body.data, ...stats(body.data) });
      r.updatedAt = (t += 1000);
      return reply(200, { project: wire(id) });
    }
    if (method === 'DELETE') { rows.delete(id); return reply(200, { ok: true }); }
    return reply(500, {});
  };
  return { rows, calls, fetchFn, bump: (id: number) => { rows.get(id)!.updatedAt += 5000; } };
}
const signedIn = (s: ReturnType<typeof mem>) => s.setItem('vault-auth', JSON.stringify({ state: { token: 'tok' } }));

function setup(opts: { signedIn?: boolean; server?: ReturnType<typeof fakeServer>; storage?: ReturnType<typeof mem> } = {}) {
  const storage = opts.storage ?? mem();
  if (opts.signedIn) signedIn(storage);
  const server = opts.server ?? fakeServer();
  const store = createAppStore(sampleProject());
  const timer = clock();
  const notes: string[] = [];
  const designs = createDesigns({ store, storage, fetch: opts.signedIn ? server.fetchFn : undefined, newId: ids, notify: (t) => notes.push(t), schedule: timer.schedule });
  return { storage, server, store, timer, notes, designs, lib: () => designs.library.getState() };
}

describe('the design codec', () => {
  it('counts runs and units, flags best-guess values, and round-trips the file format', () => {
    const tc = testCaseProject();
    const extra = designCodec.extra(tc);
    expect(extra.runCount).toBe(tc.runs.length);
    expect(extra.rackUnits).toBe(tc.runs.reduce((a, r) => a + r.units, 0));
    expect(extra.estimated).toBe(true);
    expect(designCodec.extra(sampleProject())).toEqual({ runCount: 0, rackUnits: 0, estimated: false });
    expect(designCodec.fromData(designCodec.toData(tc))).toEqual(tc);
    expect(() => designCodec.fromData({ nope: 1 })).toThrow();
  });
  it('names are cleaned and never blank; wire rows become entries', () => {
    expect(designCodec.nameOf({ ...sampleProject(), name: '   ' })).toBe('Untitled design');
    expect(designCodec.nameOf({ ...sampleProject(), name: '  Back   cellar ' })).toBe('Back cellar');
    expect(designCodec.entryFromWire({ id: 4, name: 'x', runCount: '3', rackUnits: 6, estimated: true, updatedAt: '2026-01-01T00:00:00Z' }))
      .toEqual({ id: '4', name: 'x', runCount: 3, rackUnits: 6, estimated: true, updatedAt: '2026-01-01T00:00:00.000Z' });
  });
});

describe('saving to this browser (signed out)', () => {
  it('a new library opens the Test case as its first design and says it is this browser', async () => {
    const s = setup();
    s.designs.start();
    await s.designs.whenReady();
    expect(s.lib().kind).toBe('local');
    expect(s.lib().entries).toHaveLength(1);
    expect(s.lib().entries[0]!.name).toBe('Test case (estimated rack values)');
    expect(s.store.getState().project.runs.length).toBeGreaterThan(0);
    expect(s.lib().status).toBe('saved');
    expect(s.lib().note).toMatch(/this browser only/);
  });

  it('an edit is saved after the pause, not before, and the entry follows the design', async () => {
    const s = setup();
    s.designs.start();
    await s.designs.whenReady();
    s.store.getState().edit((p) => ({ ...p, runs: p.runs.slice(0, 1) }));
    expect(s.lib().status).toBe('unsaved');
    await s.timer.advance(AUTOSAVE_MS - 10);
    expect(s.lib().status).toBe('unsaved');
    await s.timer.advance(20);
    expect(s.lib().status).toBe('saved');
    expect(s.lib().entries[0]!.runCount).toBe(1);
    const stored = JSON.parse(s.storage.m.get(`${DESIGN_INDEX_KEY}:${s.lib().currentId}`)!) as { runs: unknown[] };
    expect(stored.runs).toHaveLength(1);
  });

  it('typing the name saves it without an undo step', async () => {
    const s = setup();
    s.designs.start();
    await s.designs.whenReady();
    s.store.getState().updateSilently((p) => ({ ...p, name: 'Wine room' }));
    expect(s.store.getState().past).toHaveLength(0);
    await s.timer.advance(AUTOSAVE_MS + 10);
    expect(s.lib().entries[0]!.name).toBe('Wine room');
  });

  it('the Test case and the blank sample are ADDED; the open design is not overwritten', async () => {
    const s = setup();
    s.designs.start();
    await s.designs.whenReady();
    const first = s.lib().currentId;
    s.store.getState().updateSilently((p) => ({ ...p, name: 'Keep me' }));
    await s.timer.advance(AUTOSAVE_MS + 10);
    await s.designs.controller.importProject(sampleProject());
    expect(s.lib().entries).toHaveLength(2);
    expect(s.lib().currentId).not.toBe(first);
    expect(s.store.getState().project.runs).toEqual([]);
    await s.designs.controller.open(first!);
    expect(s.store.getState().project.name).toBe('Keep me');
    expect(s.store.getState().project.runs.length).toBeGreaterThan(0);
  });

  it('New design is the blank sample under the given name; copy and delete work', async () => {
    const s = setup();
    s.designs.start();
    await s.designs.whenReady();
    await s.designs.controller.newProject('Garage cellar');
    expect(s.store.getState().project.name).toBe('Garage cellar');
    expect(s.store.getState().project.runs).toEqual([]);
    const id = s.lib().currentId!;
    await s.designs.controller.duplicate(id);
    expect(s.lib().entries.map((e) => e.name)).toContain('Garage cellar (copy)');
    await s.designs.controller.remove(id);
    expect(s.lib().entries.find((e) => e.id === id)).toBeUndefined();
    expect(s.lib().currentId).not.toBe(id);
  });

  it('opens the design that was open last time', async () => {
    const storage = mem();
    const a = setup({ storage });
    a.designs.start();
    await a.designs.whenReady();
    await a.designs.controller.newProject('Second');
    const b = setup({ storage });
    b.designs.start();
    await b.designs.whenReady();
    expect(b.store.getState().project.name).toBe('Second');
    expect(b.lib().entries).toHaveLength(2);
  });

  it('the browser draft an older version kept becomes the first saved design', async () => {
    const storage = mem();
    const draft = { ...testCaseProject(), name: 'My old draft' };
    storage.setItem(DRAFT_KEY, serializeApp(draft));
    const s = setup({ storage });
    s.designs.start();
    await s.designs.whenReady();
    expect(s.lib().entries.map((e) => e.name)).toEqual(['My old draft']);
    expect(s.store.getState().project.name).toBe('My old draft');
  });

  it('unsaved changes from a session that ended early are restored', async () => {
    const storage = mem();
    const a = setup({ storage });
    a.designs.start();
    await a.designs.whenReady();
    a.store.getState().edit((p) => ({ ...p, runs: p.runs.slice(0, 2) }));
    storage.setItem(DRAFT_KEY, serializeApp(a.store.getState().project)); // the app's own draft write, which the tab close did not lose
    const b = setup({ storage });
    b.designs.start();
    await b.designs.whenReady();
    expect(b.store.getState().project.runs).toHaveLength(2);
    expect(b.notes.join(' ')).toMatch(/Restored your unsaved changes/);
  });
});

describe('saving to the Vault account (signed in)', () => {
  it('uses the account, creates the first design there and saves edits with the saved-at check', async () => {
    const s = setup({ signedIn: true });
    s.designs.start();
    await s.designs.whenReady();
    expect(s.lib().kind).toBe('server');
    expect(s.lib().note).toBe('Saved to your Vault account.');
    expect(s.server.rows.size).toBe(1);
    s.store.getState().edit((p) => ({ ...p, runs: p.runs.slice(0, 1) }));
    await s.timer.advance(AUTOSAVE_MS + 10);
    expect(s.lib().status).toBe('saved');
    expect(s.server.calls.some((c) => c.startsWith('PUT '))).toBe(true);
    expect([...s.server.rows.values()][0]!.runCount).toBe(1);
  });

  it('a signed-in user with a browser draft and an empty account carries the draft over once', async () => {
    const storage = mem();
    storage.setItem(DRAFT_KEY, serializeApp({ ...testCaseProject(), name: 'From this browser' }));
    const s = setup({ signedIn: true, storage });
    s.designs.start();
    await s.designs.whenReady();
    expect([...s.server.rows.values()].map((r) => r.name)).toEqual(['From this browser']);
  });

  it('a save after another window changed the design pauses with a conflict; Keep mine saves over, Use the saved one reloads', async () => {
    const s = setup({ signedIn: true });
    s.designs.start();
    await s.designs.whenReady();
    const id = Number([...s.server.rows.keys()][0]);
    s.server.bump(id); // saved elsewhere
    s.store.getState().edit((p) => ({ ...p, runs: p.runs.slice(0, 1) }));
    await s.timer.advance(AUTOSAVE_MS + 10);
    expect(s.lib().status).toBe('conflict');
    expect(s.lib().error).toMatch(/another window/);
    // more edits while paused do not save
    const puts = s.server.calls.filter((c) => c.startsWith('PUT ')).length;
    s.store.getState().edit((p) => ({ ...p, runs: p.runs.slice(0, 1) }));
    await s.timer.advance(AUTOSAVE_MS * 3);
    expect(s.server.calls.filter((c) => c.startsWith('PUT ')).length).toBe(puts);
    await s.designs.controller.overwriteMine();
    expect(s.lib().status).toBe('saved');
    expect([...s.server.rows.values()][0]!.runCount).toBe(1);

    // and the other choice
    s.server.bump(id);
    s.store.getState().edit((p) => ({ ...p, runs: [] }));
    await s.timer.advance(AUTOSAVE_MS + 10);
    expect(s.lib().status).toBe('conflict');
    await s.designs.controller.reloadTheirs();
    expect(s.lib().status).toBe('saved');
    expect(s.store.getState().project.runs).toHaveLength(1); // what the account had
  });

  it('when Vault cannot be reached it falls back to this browser and says so', async () => {
    const storage = mem();
    signedIn(storage);
    const store = createAppStore(sampleProject());
    const designs = createDesigns({ store, storage, fetch: async () => { throw new Error('offline'); }, newId: ids, notify: () => undefined, schedule: clock().schedule });
    designs.start();
    await designs.whenReady();
    expect(designs.library.getState().kind).toBe('local');
    expect(designs.library.getState().note).toMatch(/could not be reached/);
  });
});
