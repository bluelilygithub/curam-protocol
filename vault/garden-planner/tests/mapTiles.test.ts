import { describe, expect, it, vi } from 'vitest';
import { createMapTiles } from '../src/map/tiles';

const store = (token: string | null) => ({ getItem: (k: string) => (k === 'vault-auth' && token ? JSON.stringify({ state: { token } }) : null) });
type Init = { headers: Record<string, string> };
const blob = () => new Blob([new Uint8Array([1, 2, 3])]);
const ok = (body: unknown) => async (_u: string, _i: Init) => ({ ok: true, status: 200, json: async () => body, blob: async () => blob() });
const decode = async () => ({ fake: 'bitmap' }) as unknown as CanvasImageSource;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('map tile loader', () => {
  it('signed out: the map is off with a plain reason and nothing is fetched', async () => {
    const f = vi.fn(ok({}));
    const m = createMapTiles(store(null), f, decode);
    const s = await m.status();
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/Sign in/);
    expect(m.tile(17, 1, 1, () => undefined)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('not set up on the server: disabled with a reason; set up: attribution and max zoom come from the server', async () => {
    const off = createMapTiles(store('t'), ok({ enabled: false }), decode);
    expect((await off.status()).reason).toMatch(/MapTiler key/);
    const on = createMapTiles(store('t'), ok({ enabled: true, attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 19 }), decode);
    const s = await on.status();
    expect(s).toMatchObject({ enabled: true, maxZoom: 19, attribution: '© MapTiler © OpenStreetMap contributors' });
  });

  it('asks Vault (never MapTiler), with the Vault token, and shows a tile only once it has loaded', async () => {
    const f = vi.fn(ok({}));
    const m = createMapTiles(store('tok'), f, decode);
    const ready = vi.fn();
    expect(m.tile(17, 5, 6, ready)).toBeNull(); // not here yet: not drawn, fetch started
    await tick(); await tick();
    expect(f.mock.calls[0][0]).toBe('/api/map-tiles/17/5/6');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(f.mock.calls.every((c) => !String(c[0]).includes('maptiler'))).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(m.tile(17, 5, 6, ready)).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(1); // second look is from the cache
  });

  it('the same tile is not fetched twice while it is loading, and at most 6 load at once', async () => {
    let live = 0, peak = 0;
    const release: Array<() => void> = [];
    const f = vi.fn(async () => { live += 1; peak = Math.max(peak, live); await new Promise<void>((r) => release.push(r)); live -= 1; return { ok: true, status: 200, json: async () => ({}), blob: async () => blob() }; });
    const m = createMapTiles(store('t'), f as never, decode);
    for (let i = 0; i < 10; i += 1) { m.tile(17, i, 0, () => undefined); m.tile(17, i, 0, () => undefined); }
    await tick();
    expect(f).toHaveBeenCalledTimes(6);
    expect(peak).toBe(6);
    expect(m.pending()).toBe(10);
    while (release.length) { release.shift()!(); await tick(); await tick(); }
    expect(f).toHaveBeenCalledTimes(10);
  });

  it('a failed tile is not retried for 30 seconds, then it is', async () => {
    let t = 1000;
    const f = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}), blob: async () => blob() }));
    const m = createMapTiles(store('t'), f as never, decode, () => t);
    m.tile(17, 1, 1, () => undefined);
    await tick(); await tick();
    expect(m.hasFailures()).toBe(true);
    m.tile(17, 1, 1, () => undefined);
    await tick();
    expect(f).toHaveBeenCalledTimes(1);
    t += 31000;
    m.tile(17, 1, 1, () => undefined);
    await tick(); await tick();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('the cache is bounded', async () => {
    const m = createMapTiles(store('t'), ok({}), decode);
    for (let i = 0; i < 320; i += 1) { m.tile(17, i, 0, () => undefined); if (i % 6 === 5) { await tick(); await tick(); } }
    await tick(); await tick(); await tick();
    expect(m.tile(17, 0, 0, () => undefined)).toBeNull(); // the oldest was dropped
    expect(m.tile(17, 319, 0, () => undefined)).not.toBeNull();
  });
});
