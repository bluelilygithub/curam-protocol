'use strict';

// node server/services/noteViews.test.js   (part of npm run test:notes)

const assert = require('assert');
const { normalizeFilters, normalizeName, MAX_NAME, MAX_SEARCH } = require('./noteViews');

// a full, valid view passes through unchanged (tags tidied)
assert.deepStrictEqual(
  normalizeFilters({ search: '  quote ', preset: '30d', custom: { from: '2026-01-01' }, field: 'created', projectId: '12', clientId: 7, tags: ['#Budget', 'budget', 'Q3'], groupMode: 'tag' }),
  { search: 'quote', preset: '30d', custom: { from: '', to: '' }, field: 'created', projectId: '12', clientId: '7', tags: ['budget', 'q3'], groupMode: 'tag' },
  'custom dates are only kept for the custom preset',
);
assert.deepStrictEqual(normalizeFilters({ preset: 'custom', custom: { from: '2026-10-01', to: '2026-10-31' } }).custom, { from: '2026-10-01', to: '2026-10-31' });
assert.deepStrictEqual(normalizeFilters({ preset: 'custom', custom: { from: '2026-02-30', to: 'junk' } }).custom, { from: '', to: '' }, 'impossible or junk dates are dropped');

// an empty or unknown view becomes the plain defaults, never something odd
const plain = { search: '', preset: 'all', custom: { from: '', to: '' }, field: 'updated', projectId: '', clientId: '', tags: [], groupMode: 'date' };
assert.deepStrictEqual(normalizeFilters({}), plain);
assert.deepStrictEqual(normalizeFilters({ preset: 'forever', field: 'deleted', groupMode: 'colour', projectId: 'abc', clientId: '1; DROP', tags: 'nope', search: 5 }), plain);

// not an object -> null so the route can say 400
for (const bad of [null, undefined, 'x', 5, [], [1]]) assert.strictEqual(normalizeFilters(bad), null);

// nothing extra is kept
assert.deepStrictEqual(Object.keys(normalizeFilters({ evil: '<script>', preset: 'today', __proto__: { x: 1 } })).sort(), Object.keys(plain).sort());

// limits
assert.strictEqual(normalizeFilters({ search: 'x'.repeat(1000) }).search.length, MAX_SEARCH);
assert.strictEqual(normalizeFilters({ tags: Array.from({ length: 50 }, (_, i) => `t${i}`) }).tags.length, 20);
assert.strictEqual(normalizeFilters({ projectId: '0012' }).projectId, '12', 'ids are plain numbers');
assert.strictEqual(normalizeFilters({ projectId: '1234567890' }).projectId, '', 'too long to be a real id');

// names
assert.strictEqual(normalizeName('  Acme   last  month '), 'Acme last month');
assert.strictEqual(normalizeName('x'.repeat(100)).length, MAX_NAME);
assert.strictEqual(normalizeName('   '), '');
assert.strictEqual(normalizeName(null), '');
assert.strictEqual(normalizeName(42), '');
assert.strictEqual(normalizeName('line\nbreak\ttab'), 'line break tab');

console.log('noteViews tests passed');
