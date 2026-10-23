import assert from 'node:assert';
import { reminderState, formatReminder, quickOptions, toLocalInput, fromLocalInput, dueCount } from './noteReminders.mjs';

const now = new Date(2026, 9, 23, 10, 15); // Fri 23 Oct 2026, 10:15 am local
const local = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min);

// state
assert.strictEqual(reminderState(null, now), 'none');
assert.strictEqual(reminderState({}, now), 'none');
assert.strictEqual(reminderState({ remind_at: local(2026, 10, 23, 12).toISOString() }, now), 'upcoming');
assert.strictEqual(reminderState({ remind_at: local(2026, 10, 23, 9).toISOString() }, now), 'due');
assert.strictEqual(reminderState({ remind_at: now.toISOString() }, now), 'due', 'the moment itself is due');
assert.strictEqual(reminderState({ remind_at: local(2026, 10, 22).toISOString(), reminder_done_at: local(2026, 10, 22, 10).toISOString() }, now), 'done');
assert.strictEqual(reminderState({ remind_at: 'junk' }, now), 'none');

// wording
assert.strictEqual(formatReminder(local(2026, 10, 23, 15, 5).toISOString(), now), 'Today, 3:05 pm');
assert.strictEqual(formatReminder(local(2026, 10, 24, 9).toISOString(), now), 'Tomorrow, 9:00 am');
assert.strictEqual(formatReminder(local(2026, 10, 22, 17).toISOString(), now), 'Yesterday, 5:00 pm');
assert.strictEqual(formatReminder(local(2026, 10, 30, 0, 5).toISOString(), now), 'Fri 30 Oct, 12:05 am');
assert.strictEqual(formatReminder(local(2027, 1, 5, 12).toISOString(), now), 'Tue 5 Jan 2027, 12:00 pm', 'the year is shown when it is not this year');
assert.strictEqual(formatReminder('garbage', now), '');

// quick options: all in the future, sensible labels
const opts = quickOptions(now);
assert.deepStrictEqual(opts.map((o) => o.id), ['hour', 'evening', 'tomorrow', 'monday']);
assert.ok(opts.every((o) => o.at > now), 'every option is in the future');
assert.strictEqual(opts[0].at.getTime(), now.getTime() + 3600 * 1000);
assert.strictEqual(toLocalInput(opts[1].at), '2026-10-23T17:00');
assert.strictEqual(toLocalInput(opts[2].at), '2026-10-24T09:00');
assert.strictEqual(toLocalInput(opts[3].at), '2026-10-26T09:00', 'next Monday from a Friday');
// "this evening" is only offered while 5 pm is at least half an hour away
assert.ok(!quickOptions(local(2026, 10, 23, 16, 45)).some((o) => o.id === 'evening'));
assert.ok(quickOptions(local(2026, 10, 23, 16, 30)).some((o) => o.id === 'evening'));
assert.ok(!quickOptions(local(2026, 10, 23, 20, 0)).some((o) => o.id === 'evening'));
// next Monday is never today
assert.strictEqual(toLocalInput(quickOptions(local(2026, 10, 26, 8, 0)).find((o) => o.id === 'monday').at), '2026-11-02T09:00');
assert.strictEqual(toLocalInput(quickOptions(local(2026, 10, 25, 8, 0)).find((o) => o.id === 'monday').at), '2026-10-26T09:00', 'Sunday -> the next day');
// across a month and a year end
assert.strictEqual(toLocalInput(quickOptions(local(2026, 12, 31, 18, 0)).find((o) => o.id === 'tomorrow').at), '2027-01-01T09:00');

// the datetime-local box
assert.strictEqual(toLocalInput(local(2026, 1, 5, 7, 3)), '2026-01-05T07:03');
assert.strictEqual(toLocalInput('junk'), '');
assert.strictEqual(fromLocalInput('2026-10-24T09:30').getHours(), 9);
assert.strictEqual(fromLocalInput('2026-10-24T09:30').getMinutes(), 30);
for (const bad of ['', null, '2026-10-24', '2026-02-30T09:00', 'tomorrow']) assert.strictEqual(fromLocalInput(bad), null, String(bad));
assert.strictEqual(toLocalInput(fromLocalInput('2026-10-24T23:59')), '2026-10-24T23:59', 'round trip');

assert.strictEqual(dueCount([{ remind_at: local(2026, 10, 23, 9).toISOString() }, { remind_at: local(2026, 10, 24).toISOString() }, {}], now), 1);
assert.strictEqual(dueCount(undefined, now), 0);

console.log('ok - note reminders: state, wording, quick times, datetime-local');
