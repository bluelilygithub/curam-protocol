import { beforeEach, describe, expect, it } from 'vitest';
import { clearSuggestCache, MIN_LETTERS, parsePlaces, shortLabel, suggestPlaces, suggestUrl, SuggestError } from '../src/placeSearch';

const feature = (name: string, lng: number, lat: number) => ({ place_name: name, center: [lng, lat], geometry: { type: 'Point', coordinates: [lng, lat] } });
const ok = (features: unknown[]) => async () => ({ ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features }) }) as unknown as Response;

beforeEach(() => clearSuggestCache());

describe('the request', () => {
  it('asks for autocomplete, a handful of places, and biases towards where the map is looking', () => {
    const u = new URL(suggestUrl('Hawthorne Park', 'KEY', [153.0251, -27.4698]));
    expect(u.origin + u.pathname).toBe('https://api.maptiler.com/geocoding/Hawthorne%20Park.json');
    expect(u.searchParams.get('autocomplete')).toBe('true');
    expect(u.searchParams.get('limit')).toBe('5');
    expect(u.searchParams.get('proximity')).toBe('153.0251,-27.4698');
    expect(u.searchParams.get('key')).toBe('KEY');
  });
  it('encodes what was typed (nothing typed can change the request), and leaves proximity out without a position', () => {
    const u = suggestUrl('a/b?c=d#e', 'K');
    expect(u).toContain('/geocoding/a%2Fb%3Fc%3Dd%23e.json?');
    expect(new URL(u).searchParams.has('proximity')).toBe(false);
    expect(new URL(suggestUrl('x', 'K', [NaN, 1])).searchParams.has('proximity')).toBe(false);
  });
});

describe('what comes back', () => {
  it('the first three parts of the name, and the point as longitude and latitude', () => {
    const p = parsePlaces({ features: [feature('Hawthorne Park, Hawthorne, Brisbane, Queensland, Australia', 153.05, -27.47)] });
    expect(p).toEqual([{ label: 'Hawthorne Park, Hawthorne, Brisbane', lng: 153.05, lat: -27.47 }]);
    expect(shortLabel('A, B')).toBe('A, B');
    expect(shortLabel(' A ,  , B , C , D ')).toBe('A, B, C');
  });
  it('falls back to the geometry when there is no centre, and to the short name when there is no full one', () => {
    const p = parsePlaces({ features: [{ text: 'Toowong', geometry: { coordinates: [152.98, -27.48] } }] });
    expect(p).toEqual([{ label: 'Toowong', lng: 152.98, lat: -27.48 }]);
  });
  it('drops anything without a name or a usable point, and a repeated name', () => {
    const p = parsePlaces({ features: [
      feature('Good Place', 1, 2), feature('good place', 3, 4), { place_name: 'No point' }, { center: [1, 2] }, feature('Off the map', 500, 2),
      feature('Bad lat', 1, 99), { place_name: 'Strings', center: ['1', '2'] }, null, 7,
    ] });
    expect(p.map((x) => x.label)).toEqual(['Good Place']);
  });
  it('keeps at most five', () => {
    expect(parsePlaces({ features: Array.from({ length: 10 }, (_, i) => feature(`Place ${i}`, i, i)) })).toHaveLength(5);
  });
  it('anything that is not a feature list is no places', () => {
    for (const j of [null, undefined, 'x', 3, {}, { features: 'no' }, { features: null }]) expect(parsePlaces(j)).toEqual([]);
  });
});

describe('asking', () => {
  it('under three letters never asks', async () => {
    let calls = 0;
    const f = async () => { calls += 1; return ok([])(); };
    for (const q of ['', ' ', 'a', 'ab', '  ab ']) expect(await suggestPlaces(q, 'K', null, undefined, f as unknown as typeof fetch)).toEqual([]);
    expect(MIN_LETTERS).toBe(3);
    expect(calls).toBe(0);
  });
  it('asks once, and a repeat of the same words near the same place is answered from memory for ten minutes', async () => {
    let calls = 0;
    let t = 1000;
    const f = async () => { calls += 1; return ok([feature('Toowong, Brisbane', 152.98, -27.48)])(); };
    const run = (q: string, near: [number, number] | null = [153.0, -27.5]) => suggestPlaces(q, 'K', near, undefined, f as unknown as typeof fetch, () => t);
    const a = await run('Toowong');
    const b = await run('  toowong ');
    expect(b).toEqual(a);
    expect(calls).toBe(1);
    await run('Toowong', [153.04, -27.5]); // the map is looking at about the same place (to 0.1 degree): still one
    expect(calls).toBe(1);
    await run('Toowong', [154.5, -27.5]); // somewhere else: a new question
    expect(calls).toBe(2);
    t += 9 * 60 * 1000;
    await run('Toowong');
    expect(calls).toBe(2);
    t += 2 * 60 * 1000;
    await run('Toowong');
    expect(calls).toBe(3);
  });
  it('passes the abort signal on, and an abort is not reported as a failure', async () => {
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const f = async (_u: string, init?: RequestInit) => { seen = init?.signal ?? undefined; throw Object.assign(new Error('x'), { name: 'AbortError' }); };
    await expect(suggestPlaces('Toowong', 'K', null, ctl.signal, f as unknown as typeof fetch)).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toBe(ctl.signal);
  });
  it('says plainly when it cannot be reached, is refused, or answers badly, and does not remember a failure', async () => {
    const down = async () => { throw new Error('offline'); };
    await expect(suggestPlaces('Toowong', 'K', null, undefined, down as unknown as typeof fetch)).rejects.toBeInstanceOf(SuggestError);
    const refused = async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response;
    await expect(suggestPlaces('Toowong', 'K', null, undefined, refused as unknown as typeof fetch)).rejects.toThrow(/not available right now/);
    const junk = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) as unknown as Response;
    await expect(suggestPlaces('Toowong', 'K', null, undefined, junk as unknown as typeof fetch)).rejects.toThrow(/unreadable/);
    let calls = 0;
    const good = async () => { calls += 1; return ok([feature('Toowong', 1, 2)])(); };
    expect(await suggestPlaces('Toowong', 'K', null, undefined, good as unknown as typeof fetch)).toHaveLength(1);
    expect(calls).toBe(1);
  });
  it('without a key there is nothing to ask', async () => {
    await expect(suggestPlaces('Toowong', null, null)).rejects.toBeInstanceOf(SuggestError);
    expect(await suggestPlaces('ab', null, null)).toEqual([]); // too short is still just empty
  });
});
