'use strict';
const assert = require('assert');
const R = require('./noteRepeat');

const iso = (d) => (d ? d.toISOString() : null);
const BNE = 'Australia/Brisbane';   // UTC+10, no daylight saving
const SYD = 'Australia/Sydney';     // UTC+10, +11 in summer (clocks go forward the first Sunday of October)
const NY = 'America/New_York';

// ---- names
assert.deepStrictEqual(R.REPEATS, ['none', 'daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly']);
assert.strictEqual(R.parseRepeat('weekly'), 'weekly');
for (const bad of ['hourly', '', null, undefined, 5, 'WEEKLY']) assert.strictEqual(R.parseRepeat(bad), null, String(bad));
assert.strictEqual(R.cleanZone(SYD), SYD);
for (const bad of ['Mars/Olympus', '', null, 5, 'x'.repeat(100)]) assert.strictEqual(R.cleanZone(bad), 'UTC', String(bad));
assert.deepStrictEqual(Object.keys(R.LABELS), R.REPEATS, 'every repeat has a label');

// ---- local time and back
const w = R.wallOf(new Date('2026-10-23T23:30:00Z'), BNE);
assert.deepStrictEqual(w, { y: 2026, m: 10, d: 24, h: 9, mi: 30 }, 'Brisbane is ten hours ahead');
assert.strictEqual(iso(R.zonedToInstant(w, BNE)), '2026-10-23T23:30:00.000Z');
assert.strictEqual(R.dayOfMonth(new Date('2026-10-23T23:30:00Z'), BNE), 24, 'the local day, not the UTC day');

// ---- the simple repeats (9:00 am Brisbane = 23:00 UTC the day before)
const from = new Date('2026-10-22T23:00:00Z'); // Fri 23 Oct 2026, 9:00 am Brisbane
const day = R.dayOfMonth(from, BNE);
const next = (repeat, after = from, f = from, tz = BNE, d = day) => iso(R.nextOccurrence(f, repeat, tz, d, after));
assert.strictEqual(next('daily'), '2026-10-23T23:00:00.000Z', 'tomorrow, same time');
assert.strictEqual(next('weekly'), '2026-10-29T23:00:00.000Z');
assert.strictEqual(next('fortnightly'), '2026-11-05T23:00:00.000Z');
assert.strictEqual(next('monthly'), '2026-11-22T23:00:00.000Z');
assert.strictEqual(next('yearly'), '2027-10-22T23:00:00.000Z');
assert.strictEqual(next('weekdays'), '2026-10-25T23:00:00.000Z', 'Friday morning to Monday morning (Brisbane): the weekend is skipped');
assert.strictEqual(next('weekdays', new Date('2026-10-20T23:00:00Z'), new Date('2026-10-20T23:00:00Z')), '2026-10-21T23:00:00.000Z', 'a Wednesday goes to Thursday');
assert.strictEqual(R.nextOccurrence(from, 'none', BNE, day, from), null);
assert.strictEqual(R.nextOccurrence(from, 'sometimes', BNE, day, from), null);
assert.strictEqual(R.nextOccurrence('garbage', 'daily', BNE, 1, from), null);

// "after" later than the first step: counts on until it is past
assert.strictEqual(next('daily', new Date('2026-10-27T00:00:00Z')), '2026-10-27T23:00:00.000Z', 'the first one strictly after the time given');
assert.strictEqual(next('daily', new Date('2026-10-27T23:00:00Z')), '2026-10-28T23:00:00.000Z', 'strictly: not the one that is exactly then');

// ---- clocks change but the time on the wall does not
const sydFrom = new Date('2026-09-30T23:00:00Z'); // Thu 1 Oct 2026, 9:00 am Sydney (UTC+10)
assert.strictEqual(iso(R.nextOccurrence(sydFrom, 'weekly', SYD, 1, sydFrom)), '2026-10-07T22:00:00.000Z', 'after daylight saving starts 9 am is 22:00 UTC');
assert.strictEqual(R.wallOf(R.nextOccurrence(sydFrom, 'weekly', SYD, 1, sydFrom), SYD).h, 9);
const nyFrom = new Date('2026-10-30T13:00:00Z'); // Fri 30 Oct, 9:00 am New York (EDT, UTC-4)
const nyNext = R.nextOccurrence(nyFrom, 'weekly', NY, 30, nyFrom); // 6 Nov: clocks went back on 1 Nov
assert.strictEqual(iso(nyNext), '2026-11-06T14:00:00.000Z');
assert.strictEqual(R.wallOf(nyNext, NY).h, 9);
// the hour that does not exist (Sydney 2:30 am on 4 Oct 2026) moves on rather than breaking
const gap = R.zonedToInstant({ y: 2026, m: 10, d: 4, h: 2, mi: 30 }, SYD);
assert.ok(!Number.isNaN(gap.getTime()));
assert.strictEqual(R.wallOf(gap, SYD).d, 4);

// ---- the end of the month
const jan31 = new Date('2027-01-30T23:00:00Z'); // 31 Jan 2027, 9 am Brisbane
assert.strictEqual(iso(R.nextOccurrence(jan31, 'monthly', BNE, 31, jan31)), '2027-02-27T23:00:00.000Z', 'the 31st becomes the 28th in February');
const feb28 = new Date('2027-02-27T23:00:00Z');
assert.strictEqual(iso(R.nextOccurrence(feb28, 'monthly', BNE, 31, feb28)), '2027-03-30T23:00:00.000Z', 'and goes back to the 31st in March (kept day, not drifted)');
const feb29 = new Date('2028-02-28T23:00:00Z'); // 29 Feb 2028 (a leap year)
assert.strictEqual(iso(R.nextOccurrence(feb29, 'yearly', BNE, 29, feb29)), '2029-02-27T23:00:00.000Z', 'a yearly 29 February is the 28th in a common year');
const dec = new Date('2026-12-14T23:00:00Z'); // 15 Dec
assert.strictEqual(iso(R.nextOccurrence(dec, 'monthly', BNE, 15, dec)), '2027-01-14T23:00:00.000Z', 'December rolls into the next year');

// ---- catching up after a gap: the most recent one, not every one missed
const weekAgo = new Date('2026-10-01T23:00:00Z');
const now = new Date('2026-10-20T05:00:00Z');
assert.strictEqual(iso(R.latestOccurrence(weekAgo, 'weekly', BNE, 2, now)), '2026-10-15T23:00:00.000Z', 'the latest weekly one that has already come');
assert.strictEqual(iso(R.latestOccurrence(weekAgo, 'daily', BNE, 2, now)), '2026-10-19T23:00:00.000Z');
assert.strictEqual(iso(R.latestOccurrence(from, 'weekly', BNE, day, new Date('2026-10-23T00:00:00Z'))), iso(from), 'nothing newer has come: unchanged');
assert.strictEqual(iso(R.latestOccurrence(from, 'none', BNE, day, now)), iso(from));
assert.strictEqual(iso(R.latestOccurrence(new Date('2020-01-01T23:00:00Z'), 'daily', BNE, 2, new Date('2026-10-20T05:00:00Z'))), '2026-10-19T23:00:00.000Z', 'six years of a daily reminder is still quick and right');

console.log('noteRepeat tests passed');
