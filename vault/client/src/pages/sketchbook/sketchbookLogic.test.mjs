// Run: node client/src/pages/sketchbook/sketchbookLogic.test.mjs
import assert from 'node:assert/strict';
import { filterSketches, when, fileBase, versionLabel, lookLabel, costText, EXPORT_FORMATS } from './sketchbookLogic.mjs';

const items = [
  { id: 1, title: 'Dog chasing a ball', description: 'a brown dog in a park' },
  { id: 2, title: 'Supply and demand', description: 'a market stall with a long queue' },
];
assert.equal(filterSketches(items, '').length, 2);
assert.deepEqual(filterSketches(items, 'DOG park').map((s) => s.id), [1]);
assert.deepEqual(filterSketches(items, 'queue stall').map((s) => s.id), [2]);
assert.equal(filterSketches(items, 'dog queue').length, 0);

const now = new Date('2026-11-08T12:00:00').getTime();
assert.equal(when('not a date', now), '');
assert.equal(when(new Date('2026-11-07T08:00:00').toISOString(), now), 'yesterday');
assert.equal(when(new Date('2026-11-05T08:00:00').toISOString(), now), '3 days ago');

assert.equal(fileBase('Dog chasing a ball!'), 'dog-chasing-a-ball');
assert.equal(fileBase('  Café Society  '), 'cafe-society');
assert.equal(fileBase('???'), 'sketch');
assert.equal(fileBase(null), 'sketch');
assert.ok(fileBase('x'.repeat(200)).length <= 60);

assert.equal(versionLabel({}), 'Earlier picture');
assert.equal(versionLabel({ note: 'make the dog bigger' }), 'Before: make the dog bigger');
assert.ok(versionLabel({ note: 'x'.repeat(200) }).length <= 80);

const options = { styles: [{ id: 'pen', label: 'Pen' }, { id: 'pencil', label: 'Pencil' }], penColors: [{ id: 'blue', label: 'Blue' }] };
assert.equal(lookLabel('pencil', 'blue', options), 'Pencil');
assert.equal(lookLabel('pen', 'blue', options), 'Pen (blue)');

assert.equal(costText(null), '');
assert.equal(costText({ local: true }), 'Free: drawn on this computer.');
assert.match(costText({ usd: 0.025, capUsd: 5, remainingUsd: 4.5 }), /About \$0\.025 for this picture\. \$4\.50 of today's \$5\.00 limit left\./);
assert.match(costText({ usd: 0.03, capUsd: 5, remainingUsd: 0 }), /limit for AI pictures \(\$5\.00\) is used up/);
assert.match(costText({ usd: 0.03, capUsd: null, remainingUsd: null }), /About \$0\.03 for this picture\.$/);

assert.deepEqual(EXPORT_FORMATS.map((f) => f.id), ['png', 'jpg', 'webp']);
console.log('sketchbookLogic: all passed');
