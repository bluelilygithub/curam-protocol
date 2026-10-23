'use strict';

// Repeating reminders on notes: how often, and when the next one is. A repeat keeps the same wall-clock time in the person's own time zone
// (a 9:00 am weekly reminder stays at 9:00 am when the clocks change), so every step is made on the local calendar and only then turned back
// into an instant. Monthly and yearly repeats keep the day of the month the reminder was set on (the 31st becomes the last day of a shorter
// month, then goes back to the 31st), which is why that day is stored with the reminder.
// Pure, no database: node server/services/noteRepeat.test.js

const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'];
const MAX_STEPS = 6000; // far more than any real catch-up (a daily reminder ignored for sixteen years)

/** A known repeat, or null for anything else. */
const parseRepeat = (v) => (typeof v === 'string' && REPEATS.includes(v) ? v : null);

/** A usable IANA time zone name, or 'UTC' when the browser sent nothing sensible. */
function cleanZone(tz) {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }); return tz.trim(); } catch { return 'UTC'; }
}

const formatters = new Map();
function partsFormatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  return formatters.get(tz);
}

/** The local calendar and clock reading of an instant in a zone: { y, m (1-12), d, h, mi }. */
function wallOf(date, tz) {
  const o = Object.fromEntries(partsFormatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day), h: Number(o.hour), mi: Number(o.minute) };
}

function offsetMinutes(ms, tz) {
  const o = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour), Number(o.minute), Number(o.second));
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60000;
}

/** The instant at which a zone's clock reads this wall time. A time that does not exist (the hour skipped when clocks go forward) moves on by that hour. */
function zonedToInstant(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  let ms = guess - offsetMinutes(guess, tz) * 60000;
  ms = guess - offsetMinutes(ms, tz) * 60000;
  return new Date(ms);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The local day of the month an instant falls on in a zone (stored so a monthly reminder can return to the 31st). */
const dayOfMonth = (date, tz) => wallOf(date, cleanZone(tz)).d;

/** One step on from a wall time. `day` is the day of the month to keep for monthly and yearly repeats. Never returns the same time. */
function stepWall(w, repeat, day) {
  const base = new Date(Date.UTC(w.y, w.m - 1, w.d));
  const add = (n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
  if (repeat === 'daily') return add(1);
  if (repeat === 'weekly') return add(7);
  if (repeat === 'fortnightly') return add(14);
  if (repeat === 'weekdays') {
    let n = 1;
    while ([0, 6].includes(new Date(Date.UTC(w.y, w.m - 1, w.d + n)).getUTCDay())) n += 1; // skip Saturday and Sunday
    return add(n);
  }
  const want = Number(day) >= 1 && Number(day) <= 31 ? Number(day) : w.d;
  if (repeat === 'monthly' || repeat === 'yearly') {
    const months = repeat === 'monthly' ? 1 : 12;
    const total = w.y * 12 + (w.m - 1) + months;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return { ...w, y, m, d: Math.min(want, daysInMonth(y, m)) };
  }
  throw new Error(`cannot repeat "${repeat}"`);
}

/**
 * The first time of the repeat that is strictly after `after`, counting on from `from` (the reminder's current time).
 * Returns null for 'none' or an unknown repeat.
 */
function nextOccurrence(from, repeat, tz, day, after) {
  if (!parseRepeat(repeat) || repeat === 'none') return null;
  const zone = cleanZone(tz);
  const start = new Date(from);
  const limit = new Date(after).getTime();
  if (Number.isNaN(start.getTime()) || Number.isNaN(limit)) return null;
  let wall = wallOf(start, zone);
  let at = start;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    wall = stepWall(wall, repeat, day);
    at = zonedToInstant(wall, zone);
    if (at.getTime() > limit && at.getTime() > start.getTime()) return at;
  }
  return null;
}

/**
 * The latest time of the repeat that is at or before `now` (counting on from `from`), or `from` itself when the next one has not arrived.
 * A reminder that was missed for several periods lands on the most recent one, not on every one it missed.
 */
function latestOccurrence(from, repeat, tz, day, now) {
  const zone = cleanZone(tz);
  let current = new Date(from);
  if (!parseRepeat(repeat) || repeat === 'none' || Number.isNaN(current.getTime())) return current;
  let wall = wallOf(current, zone);
  for (let i = 0; i < MAX_STEPS; i += 1) {
    wall = stepWall(wall, repeat, day);
    const at = zonedToInstant(wall, zone);
    if (at.getTime() > new Date(now).getTime() || at.getTime() <= current.getTime()) return current;
    current = at;
  }
  return current;
}

const LABELS = { none: 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', fortnightly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };

module.exports = { REPEATS, LABELS, parseRepeat, cleanZone, wallOf, zonedToInstant, dayOfMonth, nextOccurrence, latestOccurrence };
