import assert from 'node:assert';
import { rangeFor, parseDay, dateBucket, groupNotes, filtersSummary } from './noteGroups.mjs';

const now = new Date(2026, 9, 23, 15, 30); // Fri 23 Oct 2026, 3:30 pm local
const at = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();

// parseDay
assert.strictEqual(parseDay('2026-10-23').getDate(), 23);
assert.strictEqual(parseDay('2026-02-31'), null, 'an impossible date is rejected');
assert.strictEqual(parseDay(''), null);
assert.strictEqual(parseDay('23/10/2026'), null);

// ranges: local midnight to the next local midnight, `to` exclusive
const today = rangeFor('today', {}, now);
assert.strictEqual(today.from, new Date(2026, 9, 23).toISOString());
assert.strictEqual(today.to, new Date(2026, 9, 24).toISOString());
assert.strictEqual(rangeFor('7d', {}, now).from, new Date(2026, 9, 17).toISOString(), '7 days = today and the 6 before');
assert.strictEqual(rangeFor('30d', {}, now).from, new Date(2026, 8, 24).toISOString());
assert.strictEqual(rangeFor('year', {}, now).from, new Date(2026, 0, 1).toISOString());
assert.deepStrictEqual(rangeFor('all', {}, now), {});
assert.deepStrictEqual(rangeFor('nonsense', {}, now), {});
// custom: the "to" day is included; one end may be blank; swapped ends are fixed
assert.deepStrictEqual(rangeFor('custom', { from: '2026-10-01', to: '2026-10-05' }, now), { from: new Date(2026, 9, 1).toISOString(), to: new Date(2026, 9, 6).toISOString() });
assert.deepStrictEqual(rangeFor('custom', { from: '2026-10-01' }, now), { from: new Date(2026, 9, 1).toISOString() });
assert.deepStrictEqual(rangeFor('custom', { to: '2026-10-05' }, now), { to: new Date(2026, 9, 6).toISOString() });
assert.deepStrictEqual(rangeFor('custom', { from: '2026-10-05', to: '2026-10-01' }, now), rangeFor('custom', { from: '2026-10-01', to: '2026-10-05' }, now));
assert.deepStrictEqual(rangeFor('custom', { from: 'junk' }, now), {}, 'junk is ignored, not sent');

// date buckets
assert.strictEqual(dateBucket(at(2026, 9, 23, 0), now).label, 'Today');
assert.strictEqual(dateBucket(at(2026, 9, 22, 23), now).label, 'Yesterday');
assert.strictEqual(dateBucket(at(2026, 9, 18), now).label, 'Previous 7 days');
assert.strictEqual(dateBucket(at(2026, 9, 2), now).label, 'Previous 30 days');
assert.strictEqual(dateBucket(at(2026, 7, 14), now).label, 'August 2026');
assert.strictEqual(dateBucket(at(2025, 11, 31), now).label, 'December 2025');
assert.strictEqual(dateBucket('garbage', now).label, 'Undated');

// grouping by date keeps order and puts each note once
const notes = [
  { id: 1, updated_at: at(2026, 9, 23, 9) },
  { id: 2, updated_at: at(2026, 9, 23, 8) },
  { id: 3, updated_at: at(2026, 9, 22) },
  { id: 4, updated_at: at(2026, 8, 1) },
  { id: 5, updated_at: at(2026, 7, 30) },
  { id: 6, updated_at: at(2026, 7, 2) },
];
const byDate = groupNotes(notes, { mode: 'date', now });
assert.deepStrictEqual(byDate.map((g) => [g.label, g.notes.map((n) => n.id)]), [
  ['Today', [1, 2]], ['Yesterday', [3]], ['September 2026', [4]], ['August 2026', [5, 6]],
]);
// by created date uses created_at
const byCreated = groupNotes([{ id: 1, updated_at: at(2026, 9, 23), created_at: at(2026, 0, 5) }], { mode: 'date', field: 'created', now });
assert.strictEqual(byCreated[0].label, 'January 2026');

// grouping by project / client: named groups in order of first (newest) note, catch-all last
const owned = [
  { id: 1, project_id: null, project_name: null, client_id: 7, client_name: 'Acme' },
  { id: 2, project_id: 3, project_name: 'Launch', client_id: null, client_name: null },
  { id: 3, project_id: 4, project_name: 'Admin', client_id: 7, client_name: 'Acme' },
  { id: 4, project_id: 3, project_name: 'Launch', client_id: null, client_name: null },
];
assert.deepStrictEqual(groupNotes(owned, { mode: 'project' }).map((g) => [g.label, g.notes.map((n) => n.id)]), [
  ['Launch', [2, 4]], ['Admin', [3]], ['No project', [1]],
]);
assert.deepStrictEqual(groupNotes(owned, { mode: 'client' }).map((g) => [g.label, g.notes.map((n) => n.id)]), [
  ['Acme', [1, 3]], ['No client', [2, 4]],
]);
assert.deepStrictEqual(groupNotes(null), []);
assert.deepStrictEqual(groupNotes([]), []);

// summary
assert.strictEqual(filtersSummary({ preset: 'all' }), '');
assert.strictEqual(filtersSummary({ preset: '7d', search: 'tax' }), 'matching "tax", 7 days');
assert.strictEqual(filtersSummary({ preset: 'custom', custom: { from: '2026-10-01', to: '2026-10-05' } }), '2026-10-01 to 2026-10-05');

console.log('ok - note groups: date ranges, date/project/client sections');
