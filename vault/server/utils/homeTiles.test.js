'use strict';
// node server/utils/homeTiles.test.js
const assert = require('node:assert/strict');
const { cleanHomeTiles } = require('./homeTiles');

const ok = cleanHomeTiles({ sets: [{ id: 'x', label: 'whatever', groups: [
  { id: 'g1', label: '  Money  ', itemIds: ['finance', 'shares', 'finance'] },
  { id: 'g2', label: '', itemIds: ['shares', 'notes', 'bad id!'] },
] }] });
assert.deepEqual(ok, { sets: [{ id: 'home', label: 'Home', groups: [
  { id: 'g1', label: 'Money', itemIds: ['finance', 'shares'] },
  { id: 'g2', label: 'Apps', itemIds: ['notes'] },
] }] }, 'trimmed, a blank name becomes Apps, an app is only in one place, junk ids dropped');
assert.deepEqual(cleanHomeTiles({ sets: [{ groups: [] }] }).sets[0].groups, [], 'no groups is allowed');
for (const bad of [null, {}, { sets: [] }, { sets: [{ groups: [] }, { groups: [] }] }, { sets: [{ groups: 'x' }] },
  { sets: [{ groups: [{ id: '<script>', itemIds: [] }] }] }, { sets: [{ groups: [{ id: 'g1' }] }] }]) {
  assert.equal(cleanHomeTiles(bad), null, JSON.stringify(bad));
}
console.log('homeTiles: ok');
