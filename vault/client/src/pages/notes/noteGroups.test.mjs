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

// pinned notes lead in their own section in every mode and are not repeated below
const withPin = [
  { id: 1, updated_at: at(2026, 9, 23, 9) },
  { id: 2, updated_at: at(2026, 7, 2), pinned_at: at(2026, 9, 1) },
  { id: 3, updated_at: at(2026, 9, 22), pinned_at: at(2026, 9, 5) },
];
assert.deepStrictEqual(groupNotes(withPin, { mode: 'date', now }).map((g) => [g.label, g.notes.map((n) => n.id)]), [['Pinned', [2, 3]], ['Today', [1]]]);
assert.deepStrictEqual(groupNotes([{ id: 9, pinned_at: at(2026, 9, 1), project_id: 3, project_name: 'Launch' }], { mode: 'project' }).map((g) => g.label), ['Pinned']);
assert.deepStrictEqual(groupNotes(notes, { mode: 'date', now }).map((g) => g.label), ['Today', 'Yesterday', 'September 2026', 'August 2026'], 'no pinned section when nothing is pinned');

// grouping by tag: a note shows under each of its tags, untagged last, pinned still first
const tagged = [
  { id: 1, tags: ['budget', 'tax time'] },
  { id: 2, tags: [] },
  { id: 3, tags: ['budget'] },
  { id: 4, tags: ['ideas'], pinned_at: at(2026, 9, 1) },
];
assert.deepStrictEqual(groupNotes(tagged, { mode: 'tag' }).map((g) => [g.label, g.notes.map((n) => n.id)]), [
  ['Pinned', [4]], ['budget', [1, 3]], ['tax time', [1]], ['Untagged', [2]],
]);
assert.deepStrictEqual(groupNotes([{ id: 5 }], { mode: 'tag' }).map((g) => g.label), ['Untagged'], 'a row with no tags field is untagged');

// reminders that are due lead, above pinned; one that is done or still to come is an ordinary note
const rnow = new Date(2026, 9, 23, 12, 0);
const withReminders = [
  { id: 1, updated_at: at(2026, 9, 23, 9), remind_at: at(2026, 9, 23, 8) },                                  // due
  { id: 2, updated_at: at(2026, 9, 22), pinned_at: at(2026, 9, 1), remind_at: at(2026, 9, 23, 9) },          // due and pinned: due wins, shown once
  { id: 3, updated_at: at(2026, 9, 21), pinned_at: at(2026, 9, 2) },                                          // pinned
  { id: 4, updated_at: at(2026, 9, 20), remind_at: at(2026, 9, 25, 9) },                                      // still to come
  { id: 5, updated_at: at(2026, 9, 19), remind_at: at(2026, 9, 20, 9), reminder_done_at: at(2026, 9, 20, 10) }, // done
];
const g = groupNotes(withReminders, { mode: 'date', now: rnow });
assert.deepStrictEqual(g.slice(0, 2).map((x) => [x.label, x.notes.map((n) => n.id)]), [['Reminders due', [1, 2]], ['Pinned', [3]]]);
assert.deepStrictEqual(g.slice(2).flatMap((x) => x.notes.map((n) => n.id)).sort(), [4, 5], 'upcoming and done reminders are ordinary notes');
assert.strictEqual(g.flatMap((x) => x.notes).length, 5, 'each note appears once');
assert.deepStrictEqual(groupNotes(withReminders, { mode: 'tag', now: rnow })[0].label, 'Reminders due', 'in every grouping');

// summary
assert.strictEqual(filtersSummary({ preset: 'all' }), '');
assert.strictEqual(filtersSummary({ preset: '7d', search: 'tax' }), 'matching "tax", 7 days');
assert.strictEqual(filtersSummary({ preset: 'all', tags: ['budget', 'q3'] }), 'tagged budget + q3');
assert.strictEqual(filtersSummary({ preset: 'all', reminder: 'due' }), 'reminders due');
assert.strictEqual(filtersSummary({ preset: 'custom', custom: { from: '2026-10-01', to: '2026-10-05' } }), '2026-10-01 to 2026-10-05');

console.log('ok - note groups: date ranges, date/project/client sections');

assert.strictEqual(filtersSummary({ preset: 'all', files: 'with' }), 'with attached files');
assert.strictEqual(filtersSummary({ preset: 'all', files: '' }), '');
