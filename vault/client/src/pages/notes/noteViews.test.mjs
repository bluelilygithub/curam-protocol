import assert from 'node:assert';
import { DEFAULT_FILTERS, snapshot, sameFilters, isPlain, describeFilters } from './noteViews.mjs';

// the plain state is plain, and any one change makes it not plain
assert.ok(isPlain(DEFAULT_FILTERS));
assert.ok(isPlain({}), 'missing fields mean the defaults');
for (const change of [{ search: 'a' }, { preset: '7d' }, { projectId: '3' }, { clientId: '4' }, { tags: ['x'] }, { groupMode: 'tag' }, { field: 'created' }, { reminder: 'due' }, { files: 'with' }, { files: 'without' }]) {
  assert.ok(!isPlain({ ...DEFAULT_FILTERS, ...change }), `not plain: ${JSON.stringify(change)}`);
}

// comparing ignores things that do not matter
assert.ok(sameFilters({ ...DEFAULT_FILTERS, tags: ['b', 'a'] }, { ...DEFAULT_FILTERS, tags: ['a', 'b', 'a'] }), 'tag order and repeats do not matter');
assert.ok(sameFilters({ ...DEFAULT_FILTERS, search: '  quote ' }, { ...DEFAULT_FILTERS, search: 'quote' }), 'spaces around the search do not matter');
assert.ok(sameFilters({ ...DEFAULT_FILTERS, preset: '30d', custom: { from: '2026-01-01', to: '' } }, { ...DEFAULT_FILTERS, preset: '30d' }), 'dates only count for "Pick dates"');
assert.ok(sameFilters({ ...DEFAULT_FILTERS, projectId: 5 }, { ...DEFAULT_FILTERS, projectId: '5' }), 'an id as a number or text is the same');
assert.ok(!sameFilters({ ...DEFAULT_FILTERS, preset: 'custom', custom: { from: '2026-01-01', to: '' } }, { ...DEFAULT_FILTERS, preset: 'custom', custom: { from: '2026-02-01', to: '' } }));
assert.ok(!sameFilters({ ...DEFAULT_FILTERS, tags: ['a'] }, { ...DEFAULT_FILTERS, tags: ['a', 'b'] }));

// unknown values fall back, so a bad saved value cannot break the screen
assert.deepStrictEqual(snapshot({ preset: 'forever', groupMode: 'colour', field: 'deleted', tags: 'nope', reminder: 'soon', files: 'maybe' }), snapshot(DEFAULT_FILTERS));

// in words
assert.strictEqual(describeFilters(DEFAULT_FILTERS), 'Every note, newest first');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, preset: '30d', tags: ['budget', 'q3'], clientId: '9', groupMode: 'tag' }, { clientName: 'Acme' }),
  '30 days · tagged budget + q3 · Acme · grouped by tag');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, search: 'quote', projectId: '2' }, { projectName: 'Website relaunch' }), '"quote" · Website relaunch');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, projectId: '2' }), 'a project', 'a project that is gone is still described');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, preset: 'custom', custom: { from: '2026-10-01', to: '2026-10-31' }, field: 'created' }), '2026-10-01 to 2026-10-31 · by created date');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, preset: 'custom', custom: { from: '2026-10-01', to: '' } }), 'from 2026-10-01');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, field: 'created' }), 'Every note, newest first', '"created" only matters with a date range');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, reminder: 'due', tags: ['work'] }), 'tagged work · reminders due');

console.log('ok - note views: compare current filters with a saved view, describe it in words');

assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, files: 'with', tags: ['work'] }), 'tagged work · with files');
assert.strictEqual(describeFilters({ ...DEFAULT_FILTERS, files: 'without' }), 'without files');
