import { describe, expect, it } from 'vitest';
import { MIN_QUERY, OSM_ATTRIBUTION, PlaceLookupError, createPlaceLookup } from '../src/state/geocode';

const signedIn = { getItem: (k: string) => (k === 'vault-auth' ? JSON.stringify({ state: { token: 'tok' } }) : null) };
const signedOut = { getItem: () => null };
const answer = { results: [{ label: 'Paddington, Brisbane, Queensland', lat: -27.46, lng: 153, state: 'QLD', postcode: '4064' }], attribution: OSM_ATTRIBUTION, cached: false };

function rig(storage = signedIn, ok = true) {
  const calls: Array<{ url: string; method: string; body: string; auth?: string }> = [];
  const fetchFn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    return { ok, status: ok ? 200 : 429, json: async () => (ok ? answer : { error: 'The place lookup service is busy. Try again in a minute.' }) };
  };
  return { calls, lookup: createPlaceLookup(storage, fetchFn) };
}

describe('place lookup (Nominatim policy, client side)', () => {
  it('goes to Vault\'s own endpoint with the token, never straight to OpenStreetMap', async () => {
    const { calls, lookup } = rig();
    const r = await lookup.search('Paddington QLD');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/geocode'); // no query string: what is looked up is not in the URL
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body)).toEqual({ q: 'Paddington QLD' });
    expect(calls[0].url).not.toMatch(/openstreetmap|nominatim|paddington/i);
    expect(calls[0].auth).toBe('Bearer tok');
    expect(r.attribution).toBe('© OpenStreetMap contributors');
  });

  it('text that is too short never makes a request (no search-as-you-type)', async () => {
    const { calls, lookup } = rig();
    for (const q of ['', '  ', 'p', 'pa']) await expect(lookup.search(q)).rejects.toBeInstanceOf(PlaceLookupError);
    expect(calls).toHaveLength(0);
    expect(MIN_QUERY).toBe(3);
  });

  it('the same search twice in a visit is one request', async () => {
    const { calls, lookup } = rig();
    await lookup.search('Paddington');
    await lookup.search('  paddington ');
    expect(calls).toHaveLength(1);
  });

  it('signed out: a plain message and no request', async () => {
    const { calls, lookup } = rig(signedOut);
    await expect(lookup.search('Paddington')).rejects.toThrow(/signed in to Vault/);
    expect(calls).toHaveLength(0);
  });

  it('the server\'s plain error message is passed on', async () => {
    const { lookup } = rig(signedIn, false);
    await expect(lookup.search('Paddington')).rejects.toThrow(/busy/);
  });
});
