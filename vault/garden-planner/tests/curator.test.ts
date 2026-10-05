import { describe, expect, it, vi } from 'vitest';
import { inFilter, summaryText } from '../src/ui/CuratorModal';
import { createPlantPhotos, type AdminSummaryRow } from '../src/state/plantPhotos';

type Init = { headers: Record<string, string>; method?: string; body?: string };
const store = (token: string | null, isAdmin: boolean | undefined = true) => ({ getItem: (k: string) => (k === 'vault-auth' && token ? JSON.stringify({ state: { token, user: { id: 1, isAdmin } } }) : null) });
const reply = (body: unknown, status = 200) => vi.fn(async (_u: string, _i: Init) => ({ ok: status < 300, status, json: async () => body }));
const row = (o: Partial<AdminSummaryRow> = {}): AdminSummaryRow => ({ plantId: 'x', visible: 3, hidden: 0, defaults: 1, status: 'ok', fetchedAt: 1, ...o });

describe('curator client calls', () => {
  it('isAdmin reads the signed-in user; it only decides whether the button shows', () => {
    expect(createPlantPhotos(store('t', true), reply({})).isAdmin()).toBe(true);
    expect(createPlantPhotos(store('t', false), reply({})).isAdmin()).toBe(false);
    expect(createPlantPhotos({ getItem: () => JSON.stringify({ state: { token: 't', user: { id: 1 } } }) }, reply({})).isAdmin()).toBe(false); // no flag: not an admin
    expect(createPlantPhotos(store(null), reply({})).isAdmin()).toBe(false);
    expect(createPlantPhotos({ getItem: () => '{not json' }, reply({})).isAdmin()).toBe(false);
  });

  it('sends the right method, path, body and token for every action', async () => {
    const f = reply({ ok: true });
    const a = createPlantPhotos(store('tok'), f).admin;
    await a.hide('rosa-x', '12', true);
    await a.role('rosa-x', '12', 'flower');
    await a.setDefault('rosa-x', 'foliage', '12');
    await a.setDefault('rosa-x', 'foliage', null);
    await a.refresh('rosa-x');
    const seen = f.mock.calls.map((c) => [c[1].method, c[0], c[1].body, c[1].headers.Authorization, c[1].headers['Content-Type']]);
    expect(seen).toEqual([
      ['POST', '/api/plant-images/images/12/hide', '{"hidden":true}', 'Bearer tok', 'application/json'],
      ['POST', '/api/plant-images/images/12/role', '{"role":"flower"}', 'Bearer tok', 'application/json'],
      ['POST', '/api/plant-images/rosa-x/default', '{"role":"foliage","imageId":"12"}', 'Bearer tok', 'application/json'],
      ['POST', '/api/plant-images/rosa-x/default', '{"role":"foliage","imageId":null}', 'Bearer tok', 'application/json'],
      ['POST', '/api/plant-images/rosa-x/refresh', '{}', 'Bearer tok', 'application/json'],
    ]);
  });

  it('reads the overview and a plant\'s photos, including hidden ones', async () => {
    const f = vi.fn(async (u: string, _i: Init) => ({ ok: true, status: 200, json: async () => (u.endsWith('/summary') ? { plants: [row()] } : { images: [{ id: '1', hidden: true }] }) }));
    const a = createPlantPhotos(store('t'), f).admin;
    expect((await a.summary()).data).toEqual([row()]);
    expect((await a.all('rosa-x')).data).toEqual([{ id: '1', hidden: true }]);
    expect(f.mock.calls.map((c) => c[1].method)).toEqual(['GET', 'GET']);
  });

  it('a non-admin gets a plain message, signed out gets another, a server error keeps its message, and nothing throws', async () => {
    expect((await createPlantPhotos(store('t'), reply({ error: 'Admin only' }, 403)).admin.hide('p', '1', true)).error).toMatch(/Only a Vault admin/);
    expect((await createPlantPhotos(store(null), reply({})).admin.summary()).error).toMatch(/Sign in/);
    expect((await createPlantPhotos(store('t'), reply({ error: 'That photo was not found.' }, 404)).admin.hide('p', '1', true)).error).toBe('That photo was not found.');
    expect((await createPlantPhotos(store('t'), async () => { throw new Error('down'); }).admin.refresh('p')).error).toBe('Could not reach Vault.');
  });

  it('a change forgets what the plant card knew, so the card asks again', async () => {
    const f = vi.fn(async (u: string, i: Init) => ({ ok: true, status: 200, json: async () => (i.method === 'POST' ? { ok: true } : { status: 'ready', images: [{ id: '1', creator: 'Jo', licenceCode: 'CC BY 4.0', sourceUrl: 'https://s', imageUrl: 'https://i' }] }), u }));
    const p = createPlantPhotos(store('t'), f, async () => undefined);
    await p.get('rosa-x');
    await p.get('rosa-x');
    expect(f).toHaveBeenCalledTimes(1);
    await p.admin.hide('rosa-x', '1', true);
    await p.get('rosa-x');
    expect(f.mock.calls.filter((c) => c[1].method !== 'POST')).toHaveLength(2);
  });

  it('refresh-missing returns how many were queued', async () => {
    const r = await createPlantPhotos(store('t'), reply({ queued: 9 }, 202)).admin.refreshMissing();
    expect(r).toEqual({ ok: true, data: 9 });
  });
});

describe('curator list', () => {
  it('describes each plant plainly', () => {
    expect(summaryText(undefined)).toBe('not looked up yet');
    expect(summaryText(row({ status: null, visible: 0, hidden: 0, defaults: 0 }))).toBe('not looked up yet');
    expect(summaryText(row({ status: 'error', visible: 0, hidden: 0, defaults: 0 }))).toBe('lookup failed');
    expect(summaryText(row())).toBe('3 shown · 1/3 chosen');
    expect(summaryText(row({ hidden: 2, defaults: 3 }))).toBe('3 shown · 2 hidden · 3/3 chosen');
    expect(summaryText(row({ visible: 0, status: 'ok' }))).toBe('0 shown · 1/3 chosen');
  });

  it('filters find the plants that need attention', () => {
    const none = row({ visible: 0, defaults: 0 });
    const noDef = row({ defaults: 0 });
    const hid = row({ hidden: 1 });
    const failed = row({ status: 'error', visible: 0, defaults: 0 });
    const never = undefined;
    expect([never, none, noDef, hid, failed, row()].map((r) => inFilter(r, 'all'))).toEqual([true, true, true, true, true, true]);
    expect([never, none, noDef, hid, failed, row()].map((r) => inFilter(r, 'unlooked'))).toEqual([true, false, false, false, false, false]);
    expect([never, none, noDef, hid, failed, row()].map((r) => inFilter(r, 'none'))).toEqual([true, true, false, false, true, false]);
    expect([never, none, noDef, hid, failed, row()].map((r) => inFilter(r, 'nodefaults'))).toEqual([false, false, true, false, false, false]);
    expect([never, none, noDef, hid, failed, row()].map((r) => inFilter(r, 'hidden'))).toEqual([false, false, false, true, false, false]);
    expect([never, none, noDef, hid, failed, row()].map((r) => inFilter(r, 'failed'))).toEqual([false, false, false, false, true, false]);
  });
});
