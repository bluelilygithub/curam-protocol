// node client/src/pages/domains/clearance.test.mjs   (is a suggested name actually clear, and how old is the check)
import assert from 'node:assert';
import { clearance, filterSuggestions, ageLabel, isStale, freshness, oldestCheck, findPlatform, applyVerification } from './clearance.mjs';

const R = (tld, available, source = 'rdap') => ({ domain: `x.${tld}`, tld, available, source });
const sug = (name, results, checkedAt = '2026-11-04T00:00:00Z') => ({ name, results, checkedAt });
const handles = (o) => ({ availability: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { available: v }])) });

// no requirements: nothing to judge
assert.strictEqual(clearance(sug('a', []), undefined, { tlds: [], platforms: [] }).status, 'none');
assert.strictEqual(clearance(sug('a', []), undefined, null).status, 'none');

// clear only when every requirement is positively free
{
  const s = sug('a', [R('com.au', true), R('com', false)]);
  const req = { tlds: ['com.au'], platforms: ['instagram', 'tiktok'] };
  assert.strictEqual(clearance(s, handles({ instagram: true, tiktok: true }), req).status, 'clear');
  // one taken makes it blocked, and says which
  const b = clearance(s, handles({ instagram: false, tiktok: true }), req);
  assert.strictEqual(b.status, 'blocked');
  assert.deepStrictEqual(b.failed, ['Instagram is taken']);
  // an ending that is taken blocks it
  assert.deepStrictEqual(clearance(s, handles({ instagram: true, tiktok: true }), { tlds: ['com'], platforms: [] }).failed, ['.com is taken']);
}
// not checked, or unknown, is never free
{
  const s = sug('a', [R('com.au', true)]);
  const u = clearance(s, undefined, { tlds: ['com.au'], platforms: ['instagram'] });
  assert.strictEqual(u.status, 'unconfirmed');
  assert.deepStrictEqual(u.unconfirmed, ['Instagram has not been checked']);
  assert.strictEqual(clearance(s, handles({ instagram: null }), { tlds: [], platforms: ['instagram'] }).status, 'unconfirmed');
  // an ending that was never returned is not confirmed either
  assert.strictEqual(clearance(sug('a', []), undefined, { tlds: ['io'], platforms: [] }).status, 'unconfirmed');
  assert.strictEqual(clearance(sug('a', [R('io', null)]), undefined, { tlds: ['io'], platforms: [] }).status, 'unconfirmed');
  // blocked wins over unconfirmed
  assert.strictEqual(clearance(sug('a', [R('com', false)]), undefined, { tlds: ['com'], platforms: ['instagram'] }).status, 'blocked');
}
// the service may call it twitter or x, in any case
assert.deepStrictEqual(findPlatform({ Twitter: { available: true } }, 'twitter'), { available: true });
assert.deepStrictEqual(findPlatform({ X: { available: false } }, 'twitter'), { available: false });
assert.strictEqual(findPlatform({}, 'instagram'), null);
assert.strictEqual(findPlatform(null, 'instagram'), null);

// filters
{
  const list = [
    sug('free', [R('com.au', true), R('com', true)]),
    sug('taken', [R('com', false), R('com.au', false)]),
    sug('io-only', [R('io', true)]),
  ];
  const req = { tlds: ['com.au'], platforms: [] };
  assert.deepStrictEqual(filterSuggestions(list, 'all', req, {}).map((s) => s.name), ['free', 'taken', 'io-only']);
  assert.deepStrictEqual(filterSuggestions(list, 'main-free', req, {}).map((s) => s.name), ['free']);
  assert.deepStrictEqual(filterSuggestions(list, 'not-blocked', req, {}).map((s) => s.name), ['free', 'io-only'], 'only a taken required ending blocks; unknown stays');
  assert.deepStrictEqual(filterSuggestions(list, 'clear', req, {}).map((s) => s.name), ['free']);
  // with a platform required, a name whose handles are not checked is not "clear"
  const req2 = { tlds: ['com.au'], platforms: ['instagram'] };
  assert.deepStrictEqual(filterSuggestions(list, 'clear', req2, {}).map((s) => s.name), []);
  assert.deepStrictEqual(filterSuggestions(list, 'clear', req2, { free: handles({ instagram: true }) }).map((s) => s.name), ['free']);
  assert.deepStrictEqual(filterSuggestions(null, 'clear', req, {}), []);
}
// how old a check is
{
  const now = new Date('2026-11-04T12:00:00Z');
  assert.strictEqual(ageLabel('2026-11-04T11:59:40Z', now), 'just now');
  assert.strictEqual(ageLabel('2026-11-04T11:55:00Z', now), '5 min ago');
  assert.strictEqual(ageLabel('2026-11-04T09:00:00Z', now), '3 h ago');
  assert.strictEqual(ageLabel('2026-11-01T12:00:00Z', now), '3 days ago');
  assert.strictEqual(ageLabel(null, now), '');
  assert.strictEqual(isStale('2026-11-04T09:00:00Z', now), false);
  assert.strictEqual(isStale('2026-11-02T09:00:00Z', now), true);
  assert.strictEqual(isStale(null, now), true, 'no time means we cannot say it is fresh');
}
// where an answer came from
assert.strictEqual(freshness(sug('a', [R('com', true, 'rdap'), R('io', true, 'rdap')])), 'live');
assert.strictEqual(freshness(sug('a', [R('com', true, 'rdap'), R('io', true, 'cache')])), 'saved');
assert.strictEqual(freshness(sug('a', [])), 'unknown');
assert.strictEqual(oldestCheck([sug('a', [], '2026-11-04T10:00:00Z'), sug('b', [], '2026-11-03T10:00:00Z')]), '2026-11-03T10:00:00Z');
assert.strictEqual(oldestCheck([sug('a', [], null)]), null);

// verification replaces the old answers for the verified names only, and adds their handles
{
  const ws = { suggestions: [sug('Blue Lily', [R('com', true, 'cache')], '2026-10-01T00:00:00Z'), sug('other', [R('com', true, 'cache')], '2026-10-01T00:00:00Z')], results: { handles: { other: { availability: {} } } } };
  const out = applyVerification(ws, [{ name: 'bluelily', domains: { name: 'bluelily', results: [R('com', false, 'rdap')], checkedAt: '2026-11-04T00:00:00Z', hasAvailable: false }, social: { availability: { instagram: { available: true } } } }]);
  assert.strictEqual(out.suggestions[0].name, 'Blue Lily', 'the name the person sees is kept');
  assert.strictEqual(out.suggestions[0].results[0].available, false, 'the live answer replaces the saved one');
  assert.strictEqual(out.suggestions[0].checkedAt, '2026-11-04T00:00:00Z');
  assert.strictEqual(out.suggestions[1].results[0].source, 'cache', 'names not verified are left as they were');
  assert.ok(out.handles['Blue Lily'].availability.instagram);
  assert.ok(out.handles.other, 'earlier handle checks are kept');
  // a failed verification leaves the old answer
  assert.strictEqual(applyVerification(ws, [{ name: 'bluelily', domains: null, domainsError: 'boom' }]).suggestions[0].results[0].source, 'cache');
}

console.log('clearance tests passed');
