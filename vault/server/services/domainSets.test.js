'use strict';
// node server/services/domainSets.test.js   (no database)
const assert = require('assert');
const { cleanSetData, cleanSetName, summarise, MAX_SET_BYTES } = require('./domainSets');

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

console.log('domainSets tests passed');
