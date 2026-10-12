'use strict';

/**
 * Pure rules for logging. No database. A log records what actually happened against what was planned.
 *
 * Statuses: done | partial | swapped | skipped | rest.
 *  - `rest` is intentional rest (including the flexible rest budget); `skipped` is "didn't do it". They are stored apart
 *    so planned-versus-done charts can be honest, and neither is ever shown as a failure.
 *  - A session that was never logged has no log at all ("not logged", neutral grey); nothing treats it as skipped.
 */

const { DOMAINS } = require('./config');
const { cleanFreeText } = require('./text');
const { addDays } = require('./phases');

const STATUSES = ['done', 'partial', 'swapped', 'skipped', 'rest'];
const BACKFILL_DAYS = 28;

class LogError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function intIn(v, lo, hi, label, { nullable = true } = {}) {
  if (v === '' || v == null) {
    if (nullable) return null;
    throw new LogError(`${label} is required`);
  }
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < lo || n > hi) throw new LogError(`${label} must be between ${lo} and ${hi}`);
  return n;
}

function decimalIn(v, lo, hi, label) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new LogError(`${label} must be between ${lo} and ${hi}`);
  return Math.round(n * 100) / 100;
}

/** Whole-number sets / reps / seconds and decimal kg / km for one exercise row. Every field is optional. */
function validateExerciseRows(rows) {
  if (rows == null) return [];
  if (!Array.isArray(rows) || rows.length > 40) throw new LogError('Exercise details are not valid');
  const seen = new Set();
  return rows.map((r) => {
    const position = intIn(r.position, 0, 100, 'Exercise position', { nullable: false });
    if (seen.has(position)) throw new LogError('Exercise details are repeated');
    seen.add(position);
    return {
      position,
      sets: intIn(r.sets, 0, 30, 'Sets'),
      reps: intIn(r.reps, 0, 300, 'Reps'),
      weightKg: decimalIn(r.weightKg, 0, 500, 'Weight (kg)'),
      distanceKm: decimalIn(r.distanceKm, 0, 1000, 'Distance (km)'),
      seconds: intIn(r.seconds, 0, 36000, 'Time (seconds)'),
    };
  });
}

/** A log for a planned session. Rest ignores minutes and effort: nothing was done, and that is fine. */
function validateSessionLog(body) {
  const b = body || {};
  if (!STATUSES.includes(b.status)) throw new LogError('Pick how it went');
  const rest = b.status === 'rest';
  return {
    status: b.status,
    actualMinutes: rest ? null : intIn(b.actualMinutes, 0, 600, 'Minutes'),
    effort: rest || b.status === 'skipped' ? null : intIn(b.effort, 1, 10, 'Effort'),
    note: cleanFreeText(b.note, 1000),
    activity: b.status === 'swapped' ? cleanFreeText(b.activity, 120) : null,
    exercises: rest || b.status === 'skipped' ? [] : validateExerciseRows(b.exercises),
  };
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Something done that was not in the plan: a walk, a swim, a class. */
function validateExtra(body, today) {
  const b = body || {};
  const loggedOn = b.date || today;
  if (!validDate(loggedOn)) throw new LogError('That date does not look right');
  if (loggedOn > today) throw new LogError('You can log what you have done, not what is coming');
  if (loggedOn < addDays(today, -BACKFILL_DAYS)) throw new LogError(`Back-fill goes up to ${BACKFILL_DAYS} days`);
  const title = cleanFreeText(b.title, 80);
  if (!title) throw new LogError('Say what you did');
  const domain = b.domain || 'cardio';
  if (!DOMAINS.includes(domain)) throw new LogError('Pick what kind of activity it was');
  return {
    loggedOn,
    title,
    domain,
    actualMinutes: intIn(b.actualMinutes, 1, 600, 'Minutes', { nullable: false }),
    effort: intIn(b.effort, 1, 10, 'Effort'),
    note: cleanFreeText(b.note, 1000),
  };
}

/** Can this planned session be logged yet? Today and earlier days only, within the back-fill window. */
function checkLoggable(sessionDate, today) {
  if (sessionDate > today) throw new LogError('Come back on the day, or move the session to today first');
  if (sessionDate < addDays(today, -BACKFILL_DAYS)) throw new LogError(`Back-fill goes up to ${BACKFILL_DAYS} days`);
}

/**
 * Sessions still waiting to be logged: planned (or moved) sessions on a day up to today, within the window, newest first.
 * @param {{ id:number, date:string, status:string }[]} sessions
 */
function catchUpList(sessions, today) {
  const oldest = addDays(today, -BACKFILL_DAYS);
  return sessions
    .filter((s) => (s.status === 'planned' || s.status === 'moved') && s.date <= today && s.date >= oldest)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}

/**
 * Turns the plan's text into starting values for the log form, so only differences need editing.
 * Sets and the LOW end of a reps range (what the plan guarantees); the low end of a hold; the minutes for cardio.
 * @returns {{ kind:'reps'|'hold'|'cardio'|'rounds', sets:number|null, reps:number|null, seconds:number|null, minutes:number|null }}
 */
function parsePrescription(text) {
  const t = String(text || '');
  const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  const minutes = num(/^(\d+)\s*minutes?\b/i);
  if (minutes != null) return { kind: 'cardio', sets: null, reps: null, seconds: null, minutes };
  const sets = num(/(\d+)\s*(?:sets?|rounds?|holds?|walks?|lengths?)\b/i);
  const seconds = num(/(\d+)(?:-\d+)?\s*seconds?\b/i);
  const reps = num(/(\d+)(?:-\d+)?\s*(?:slow\s+)?reps?\b/i) ?? num(/\bof\s+(\d+)(?:-\d+)?\s*(?:steps?|taps?)\b/i);
  if (/\breps?\b/i.test(t)) return { kind: 'reps', sets, reps, seconds: null, minutes: null };
  if (seconds != null) return { kind: 'hold', sets, reps: null, seconds, minutes: null };
  return { kind: 'rounds', sets, reps, seconds: null, minutes: null };
}

module.exports = {
  STATUSES, BACKFILL_DAYS, LogError,
  validateSessionLog, validateExtra, validateExerciseRows, checkLoggable, catchUpList, parsePrescription,
};
