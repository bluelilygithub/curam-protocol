import { describe, expect, it } from 'vitest';
import { blobToDataUrl, createImageStore, dataUrlToBlob, isLocalRef, isServerRef, type BlobStore, type FetchBin } from '../src/state/images';

const memStore = (): BlobStore & { map: Map<string, Blob> } => {
  const map = new Map<string, Blob>();
  return { map, put: async (id, b) => { map.set(id, b); }, get: async (id) => map.get(id) ?? null };
};
const jpeg = (): Blob => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });

function setup(kind: 'server' | 'local' | null, token: string | null = 'tok') {
  const calls: Array<{ url: string; method: string; auth?: string; type?: string; size?: number }> = [];
  const server = new Map<string, Blob>();
  let n = 0;
  let down = false;
  const f: FetchBin = async (url, init) => {
    if (down) throw new Error('offline');
    calls.push({ url, method: init?.method ?? 'GET', auth: init?.headers?.Authorization, type: init?.headers?.['Content-Type'], size: init?.body?.size });
    if (init?.method === 'POST') { const id = `srv-${++n}`; server.set(id, init.body as Blob); return { ok: true, status: 200, blob: async () => new Blob(), json: async () => ({ image: { id } }) }; }
    const ref = decodeURIComponent(url.split('/').pop() ?? '');
    const b = server.get(ref);
    return { ok: !!b, status: b ? 200 : 404, blob: async () => b ?? new Blob(), json: async () => ({ error: 'nope' }) };
  };
  const local = memStore();
  const state = { kind, token };
  let ids = 0;
  const store = createImageStore({ kind: () => state.kind, token: () => state.token, fetch: f, local, newId: () => `n${++ids}`, objectUrl: (b) => `blob:${b.size}` });
  return { store, calls, server, local, state, setDown: (v: boolean) => { down = v; } };
}

describe('image store', () => {
  it('signed in: uploads once to the account with the token and the right content type', async () => {
    const { store, calls, server } = setup('server');
    const r = await store.put(jpeg());
    expect(r.where).toBe('server');
    expect(isServerRef(r.ref)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: '/api/garden-projects/images', method: 'POST', auth: 'Bearer tok', type: 'image/jpeg' });
    expect(server.size).toBe(1);
  });

  it('signed out or local library: stays in this browser, no network', async () => {
    const { store, calls, local } = setup('local', null);
    const r = await store.put(jpeg());
    expect(isLocalRef(r.ref)).toBe(true);
    expect(calls).toHaveLength(0);
    expect(local.map.size).toBe(1);
  });

  it('account unreachable: falls back to the browser and says so', async () => {
    const t = setup('server');
    t.setDown(true);
    const r = await t.store.put(jpeg());
    expect(r.where).toBe('local');
    expect(r.note).toMatch(/kept in this browser/);
  });

  it('a browser picture is promoted to the account once it can be, and not before', async () => {
    const t = setup('local', null);
    const r = await t.store.put(jpeg());
    expect(await t.store.promote(r.ref)).toBe(r.ref); // still local
    t.state.kind = 'server'; t.state.token = 'tok';
    const up = await t.store.promote(r.ref);
    expect(isServerRef(up)).toBe(true);
    expect(await t.store.promote(up)).toBe(up); // already on the account: nothing sent
    expect(t.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('promote leaves the reference alone if the upload fails', async () => {
    const t = setup('local', null);
    const r = await t.store.put(jpeg());
    t.state.kind = 'server'; t.state.token = 'tok';
    t.setDown(true);
    expect(await t.store.promote(r.ref)).toBe(r.ref);
  });

  it('url() fetches a picture once per reference', async () => {
    const t = setup('server');
    const r = await t.store.put(jpeg());
    const u1 = await t.store.url(r.ref);
    const u2 = await t.store.url(r.ref);
    expect(u1).toBe(u2);
    expect(t.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  it('a missing picture gives a plain error, not a crash', async () => {
    const t = setup('server');
    await expect(t.store.blob('srv-999')).rejects.toThrow(/not found/);
    await expect(t.store.blob('loc-zzz')).rejects.toThrow(/no longer in this browser/);
  });
});

describe('embedded picture helpers', () => {
  it('round-trips a picture through a data URL', async () => {
    const url = await blobToDataUrl(jpeg());
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const back = dataUrlToBlob(url);
    expect(back?.size).toBe(7);
    expect(back?.type).toBe('image/jpeg');
  });
  it('refuses anything that is not a jpeg, png or webp data URL', () => {
    expect(dataUrlToBlob('data:text/html;base64,PGI+')).toBeNull();
    expect(dataUrlToBlob('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(dataUrlToBlob('nope')).toBeNull();
  });
});
