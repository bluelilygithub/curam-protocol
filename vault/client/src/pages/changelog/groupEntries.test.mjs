// node client/src/pages/changelog/groupEntries.test.mjs
import assert from 'node:assert/strict';
import { groupEntries, groupKey, weekStart, hasConcern } from './groupEntries.mjs';

const at = (s) => new Date(s).toISOString();
const entries = [
  { commit: 'a', committedAt: at('2026-11-07T10:00:00'), concerns: 'Costs money' },
  { commit: 'b', committedAt: at('2026-11-07T08:00:00'), concerns: 'None noted.' },
  { commit: 'c', committedAt: at('2026-11-06T09:00:00'), concerns: '' },
  { commit: 'd', committedAt: at('2026-11-01T09:00:00'), concerns: 'x' }, // a Sunday: belongs to the week starting Mon 26 Oct
  { commit: 'e', committedAt: at('2026-10-30T09:00:00'), concerns: 'x' },
  { commit: 'f', committedAt: at('2025-12-31T09:00:00'), concerns: 'x' },
];

const day = groupEntries(entries, 'day');
assert.deepEqual(day.map((g) => g.entries.map((e) => e.commit).join('')), ['ab', 'c', 'd', 'e', 'f'], 'by day, newest first');
const week = groupEntries(entries, 'week');
assert.deepEqual(week.map((g) => g.entries.map((e) => e.commit).join('')), ['abc', 'de', 'f'], 'Mon 2 Nov week, Mon 26 Oct week (Sunday 1 Nov and Fri 30 Oct), then 2025');
assert.match(week[0].label, /^Week of 2 Nov to 8 Nov 2026$/);
const month = groupEntries(entries, 'month');
assert.deepEqual(month.map((g) => g.key), ['2026-11', '2026-10', '2025-12']);
assert.match(month[0].label, /November 2026/);
const year = groupEntries(entries, 'year');
assert.deepEqual(year.map((g) => [g.key, g.entries.length]), [['2026', 5], ['2025', 1]]);
assert.equal(weekStart(new Date(2026, 10, 1)).getDate(), 26, 'Sunday goes back to the Monday before');
assert.equal(weekStart(new Date(2026, 10, 2)).getDate(), 2, 'Monday stays');
assert.equal(groupKey(at('2026-11-07T10:00:00'), 'nonsense'), '2026-11-07', 'unknown mode falls back to day');
assert.deepEqual(groupEntries([], 'week'), []);
assert.equal(hasConcern(entries[0]), true);
assert.equal(hasConcern(entries[1]), false, '"None noted" is not a concern');
assert.equal(hasConcern(entries[2]), false);
console.log('groupEntries tests passed');
