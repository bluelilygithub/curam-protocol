'use strict';
// node server/services/domainSets.test.js   (no database)
const assert = require('assert');
const { cleanSetData, cleanSetName, summarise, MAX_SET_BYTES, shapeStatus, cleanRequirements, labelOf, GENERATE_MAX_AGE, ownVariants, missingTlds, ENDINGS } = require('./domainSets');

const sug = (name, avail) => ({ name, results: [{ domain: `${name}.com`, tld: 'com', available: avail }, { domain: `${name}.io`, tld: 'io', available: false }] });

// a normal set comes through whole
{
  const d = cleanSetData({
    description: '  Wine fridges for hotels ', suggestions: [sug('vinoire', true), sug('chillar', false)],
    preferred: 'vinoire', shortlist: ['vinoire', 'chillar'],
    results: { score: { overall_score: 82 }, social: { availability: {} } }, errors: { overview: 'No taken domain to profile' }, runAt: '2026-11-04T01:00:00Z',
  });
  assert.strictEqual(d.description, 'Wine fridges for hotels');
  assert.strictEqual(d.suggestions.length, 2);
  assert.strictEqual(d.suggestions[0].hasAvailable, true);
  assert.strictEqual(d.preferred, 'vinoire');
  assert.deepStrictEqual(d.shortlist, ['vinoire', 'chillar']);
  assert.deepStrictEqual(Object.keys(d.results), ['score', 'social']);
  assert.deepStrictEqual(d.tableNames, []);
  assert.strictEqual(d.errors.overview, 'No taken domain to profile');
  assert.strictEqual(d.runAt, '2026-11-04T01:00:00.000Z');
}
// the page keeps the whole generator answer; the list inside it is what is stored
assert.strictEqual(cleanSetData({ suggestions: { suggestions: [sug('a', true)], source: 'llm' } }).suggestions.length, 1);
// a preferred name or shortlist entry that is not one of the names is dropped
{
  const d = cleanSetData({ suggestions: [sug('vinoire', true)], preferred: 'sneaky', shortlist: ['vinoire', 'sneaky'] });
  assert.strictEqual(d.preferred, '');
  assert.deepStrictEqual(d.shortlist, ['vinoire']);
}
// with no suggestions (a name typed by hand) the preferred name is kept
assert.strictEqual(cleanSetData({ preferred: 'mybrand' }).preferred, 'mybrand');
// unknown keys, bad shapes and over-long text are dealt with, not stored
{
  const d = cleanSetData({ evil: '<script>', description: 'x'.repeat(9000), suggestions: 'no', results: { score: 'text', bogus: { a: 1 } }, shortlist: 'x' });
  assert.ok(!('evil' in d));
  assert.strictEqual(d.description.length, 4000);
  assert.deepStrictEqual(d.suggestions, []);
  assert.deepStrictEqual(d.results, {}, 'a string is not a result and an unknown tool is ignored');
  assert.deepStrictEqual(d.shortlist, []);
}
assert.doesNotThrow(() => cleanSetData(null));
assert.strictEqual(cleanSetData({ runAt: 'nonsense' }).runAt, null);
// one huge result is replaced; a set that is still too big is refused
{
  const big = { filler: 'x'.repeat(150 * 1024) };
  assert.deepStrictEqual(cleanSetData({ results: { score: big } }).results.score, { truncated: true });
  const many = {};
  for (const k of ['score', 'compare', 'overview', 'social', 'pricing', 'handles']) many[k] = { filler: 'y'.repeat(95 * 1024) };
  assert.throws(() => cleanSetData({ results: many }), /too large/);
  assert.ok(MAX_SET_BYTES > 100 * 1024);
}
// the side-by-side table: three names at most, only names the set has, and the handle checks are kept
{
  const d = cleanSetData({
    suggestions: [sug('a', true), sug('b', true), sug('c', true), sug('d', true)], tableNames: ['a', 'b', 'ghost', 'a', 'c', 'd'],
    results: { handles: { a: { availability: { instagram: { available: true } } } } },
  });
  assert.deepStrictEqual(d.tableNames, ['a', 'b', 'c']);
  assert.ok(d.results.handles.a.availability.instagram);
  assert.deepStrictEqual(cleanSetData({ tableNames: ['x'] }).tableNames, [], 'with no suggestions there is nothing to choose from');
}
// names
assert.strictEqual(cleanSetName('  Wine   fridges \n'), 'Wine fridges');
assert.throws(() => cleanSetName('   '), /Give the set a name/);
assert.strictEqual(cleanSetName('x'.repeat(300)).length, 120);
// the list line
{
  const s = summarise({ id: 3, name: 'N', preferred: 'vinoire', data: { suggestions: [1, 2], shortlist: [1], results: { score: {}, social: {} } }, updatedAt: 'u', createdAt: 'c' });
  assert.deepStrictEqual(s, { id: 3, name: 'N', preferred: 'vinoire', updatedAt: 'u', createdAt: 'c', names: 2, shortlist: 1, results: 2 });
}


// ── how fresh a check is ──
// the generator may reuse an answer for minutes, never for weeks (the old prefer_cache was a 30-day cache)
assert.ok(GENERATE_MAX_AGE > 0 && GENERATE_MAX_AGE <= 3600);
{
  const now = new Date('2026-11-04T01:02:03Z');
  const shaped = shapeStatus('vinoire', { results: [
    { domain: 'vinoire.com', tld: 'com', available: false, source: 'cache', latency_ms: 4 },
    { domain: 'vinoire.io', tld: 'io', available: true, source: 'rdap' },
    { domain: 'vinoire.ai', tld: 'ai', available: 'maybe' },
  ] }, now);
  assert.strictEqual(shaped.checkedAt, '2026-11-04T01:02:03.000Z');
  assert.deepStrictEqual(shaped.results.map((r) => [r.tld, r.available, r.source]), [['com', false, 'cache'], ['io', true, 'rdap'], ['ai', null, '']]);
  assert.strictEqual(shaped.hasAvailable, true);
  assert.ok(!('latency_ms' in shaped.results[0]), 'only the fields the page uses are kept');
  assert.deepStrictEqual(shapeStatus('x', null, now).results, [], 'no answer gives no endings, never "free"');
  assert.strictEqual(shapeStatus('x', {}, now).hasAvailable, false);
  // what was checked, and when, survives saving
  const kept = cleanSetData({ suggestions: [shaped] }).suggestions[0];
  assert.strictEqual(kept.checkedAt, '2026-11-04T01:02:03.000Z');
  assert.strictEqual(kept.results[0].source, 'cache');
  assert.strictEqual(cleanSetData({ suggestions: [{ name: 'a', results: [], checkedAt: 'rubbish' }] }).suggestions[0].checkedAt, null);
}
assert.strictEqual(labelOf('Blue Lily & Co!'), 'bluelilyco');
assert.strictEqual(labelOf('-my-brand-'), 'my-brand');
assert.strictEqual(labelOf('x'.repeat(100)).length, 63);
assert.strictEqual(labelOf(null), '');
// requirements: endings and platforms that must be free
assert.deepStrictEqual(cleanRequirements({ tlds: ['COM.au', 'com.au', ' io '], platforms: ['Instagram', 'instagram', 'TikTok'] }), { tlds: ['com.au', 'io'], platforms: ['instagram', 'tiktok'] });
assert.deepStrictEqual(cleanRequirements(null), { tlds: [], platforms: [] });
assert.deepStrictEqual(cleanRequirements({ tlds: 'com' }), { tlds: [], platforms: [] });
assert.deepStrictEqual(cleanSetData({ requirements: { tlds: ['com'], platforms: ['x'] } }).requirements, { tlds: ['com'], platforms: ['x'] });
assert.deepStrictEqual(cleanSetData({}).requirements, { tlds: [], platforms: [] });

// ── names the person already has (a book title, an artist) are always checked ──
assert.ok(ENDINGS.includes('org'), '.org is one of the endings checked');
assert.deepStrictEqual(ownVariants('The Staircase Suitcase\nDorothy Stoner'), [
  { name: 'thestaircasesuitcase', label: 'The Staircase Suitcase' },
  { name: 'staircasesuitcase', label: 'The Staircase Suitcase' },
  { name: 'dorothystoner', label: 'Dorothy Stoner' },
]);
assert.deepStrictEqual(ownVariants('Dorothy Stoner, The Staircase Suitcase; Blue-Lily & Co').map((v) => v.name), ['dorothystoner', 'thestaircasesuitcase', 'staircasesuitcase', 'blue-lilyco']);
assert.deepStrictEqual(ownVariants('The'), [], 'a lone article is not a name');
assert.deepStrictEqual(ownVariants('  \n ; '), []);
assert.deepStrictEqual(ownVariants(null), []);
assert.strictEqual(ownVariants('x'.repeat(80)).length, 0, 'too long for a domain label');
assert.strictEqual(ownVariants('a\nb\nc\nd\ne\nf\ng').length, 0, 'one letter is too short');
assert.strictEqual(ownVariants('one one one\ntwo two two\nthree three\nfour four\nfive five\nsix six six').length, 5, 'at most five names');
// a name with a typed label keeps it, and is marked as the person's own
{
  const kept = cleanSetData({ suggestions: [{ name: 'thestaircasesuitcase', label: 'The Staircase Suitcase', own: true, results: [] }, { name: 'plain', results: [] }], ownNames: 'The Staircase Suitcase' });
  assert.strictEqual(kept.suggestions[0].label, 'The Staircase Suitcase');
  assert.strictEqual(kept.suggestions[0].own, true);
  assert.ok(!('own' in kept.suggestions[1]));
  assert.strictEqual(kept.ownNames, 'The Staircase Suitcase');
}
// the data service may skip endings it was asked for (and may write them with a dot): ask again for those only
assert.deepStrictEqual(missingTlds({ results: [{ tld: 'com' }, { tld: '.com.au' }, { tld: 'io' }] }, ['com', 'com.au', 'org', 'io']), ['org']);
assert.deepStrictEqual(missingTlds({ results: [] }, ['com', 'org']), ['com', 'org']);
assert.deepStrictEqual(missingTlds(null, ['org']), ['org']);
assert.deepStrictEqual(missingTlds({ results: [{ tld: 'COM' }] }, ['com']), []);
assert.strictEqual(shapeStatus('x', { results: [{ domain: 'x.org', tld: '.org', available: true }] }).results[0].tld, 'org', 'a leading dot is dropped');

console.log('domainSets tests passed');
