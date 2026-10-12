'use strict';

/**
 * Who should get which reminder right now. Pure code (no database, no email), tested with exact times.
 *
 * Three emails, all opt-in and off by default, all in the person's own time zone (from Settings, never hardcoded):
 *  - morning:  today's plan, at their chosen time, only on a day that has sessions still to do;
 *  - catchup:  one gentle evening note when a session planned for today is not logged, at most once a day;
 *  - rerate:   a soft note when a re-rate is due and a firmer one later, each sent once per rating.
 * A reminder never says "missed" or "behind", never goes out on a rest day, stops after three weeks without any logging, and
 * a pause switch silences everything. At most two emails a day; the re-rate note only goes out on an otherwise quiet day.
 */

const DEFAULT_SETTINGS = {
  morning: { on: false, time: '07:00' },
  catchup: { on: false, time: '18:00' },
  rerate: { on: false },
  showInTasks: true,
  goalLink: false,
  pausedUntil: null,
};

const GRACE_HOURS = 3; // an hourly job that was late still sends, within this many hours of the chosen time
const DORMANT_AFTER_DAYS = 21;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Local date and minutes-since-midnight in a time zone. */
function localClock(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t).value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch {
    const iso = now.toISOString();
    return { date: iso.slice(0, 10), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

const toMinutes = (hhmm) => { const m = TIME_RE.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Settings from a stored value or a request body: known keys only, valid values only, everything else the default. */
function cleanSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const time = (v, fallback) => (typeof v === 'string' && TIME_RE.test(v) ? v : fallback);
  return {
    morning: { on: r.morning?.on === true, time: time(r.morning?.time, DEFAULT_SETTINGS.morning.time) },
    catchup: { on: r.catchup?.on === true, time: time(r.catchup?.time, DEFAULT_SETTINGS.catchup.time) },
    rerate: { on: r.rerate?.on === true },
    showInTasks: r.showInTasks !== false,
    goalLink: r.goalLink === true,
    pausedUntil: typeof r.pausedUntil === 'string' && DATE_RE.test(r.pausedUntil) ? r.pausedUntil : null,
  };
}

const LIVE = (s) => s.status !== 'rest';
const TO_DO = (s) => s.status === 'planned' || s.status === 'moved';

/**
 * @param {object} p
 * @param {Date} p.now
 * @param {string} p.timeZone
 * @param {object} p.settings    cleaned settings
 * @param {{ lastSent?:Record<string,string> }} p.state
 * @param {{ status:string }[]} p.sessionsToday
 * @param {{ due:boolean, level?:string, weeks?:number, key?:string }} p.ratingDue   `key` identifies this rating cycle
 * @param {string|null} p.lastLoggedOn  the most recent day anything was logged
 * @param {boolean} [p.restDayToday]
 * @returns {{ kind:'morning'|'catchup'|'rerate', rerateLevel?:string }[]} what to send now, in order
 */
function dueReminders({ now, timeZone, settings, state = {}, sessionsToday = [], ratingDue = { due: false }, lastLoggedOn = null, restDayToday = false }) {
  const { date: today, minutes } = localClock(now, timeZone);
  if (settings.pausedUntil && settings.pausedUntil >= today) return [];
  if (lastLoggedOn && lastLoggedOn < addDays(today, -DORMANT_AFTER_DAYS)) return []; // quietly stop; logging again turns them back on
  const sent = state.lastSent || {};
  const reached = (hhmm) => { const t = toMinutes(hhmm); return t != null && minutes >= t && minutes < t + GRACE_HOURS * 60; };
  const live = sessionsToday.filter(LIVE);
  const out = [];

  if (settings.morning.on && !restDayToday && live.length && live.some(TO_DO) && sent.morning !== today && reached(settings.morning.time)) {
    out.push({ kind: 'morning' });
  }
  if (settings.catchup.on && !restDayToday && live.length && live.every(TO_DO) && sent.catchup !== today && reached(settings.catchup.time)) {
    out.push({ kind: 'catchup' });
  }
  if (settings.rerate.on && ratingDue.due && ratingDue.key && !out.length && !Object.values(sent).includes(today) && reached(settings.morning.time)) {
    const level = ratingDue.level === 'firm' ? 'firm' : 'soft';
    if (sent[`rerate:${ratingDue.key}:${level}`] == null) out.push({ kind: 'rerate', rerateLevel: level });
  }
  return out;
}

/** The new state after sending: remembered by day so nothing goes twice. */
function markSent(state, reminder, today, ratingKey = null) {
  const lastSent = { ...(state.lastSent || {}) };
  if (reminder.kind === 'rerate') lastSent[`rerate:${ratingKey}:${reminder.rerateLevel}`] = today;
  else lastSent[reminder.kind] = today;
  // keep the record small: drop re-rate keys other than the ones for this rating
  for (const k of Object.keys(lastSent)) if (k.startsWith('rerate:') && ratingKey && !k.startsWith(`rerate:${ratingKey}:`)) delete lastSent[k];
  return { ...state, lastSent };
}

module.exports = { DEFAULT_SETTINGS, GRACE_HOURS, DORMANT_AFTER_DAYS, cleanSettings, localClock, dueReminders, markSent };
