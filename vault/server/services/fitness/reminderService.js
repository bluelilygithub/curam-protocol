'use strict';

/**
 * Reminder settings and sending. Settings and the "what was already sent" memory live in one JSON column on the person's
 * fitness profile (`fitness_profiles.reminders`), so no new table. All times are in their Settings time zone.
 */

const crypto = require('crypto');
const { pool } = require('../../db');
const P = require('./profileService');
const Ph = require('./phases');
const R = require('./reminders');
const { buildEmail } = require('./reminderEmails');
const sendEmail = require('../../utils/sendEmail');
const { captureIf, makeFingerprint } = require('../SuggestionService');

const { ValidationError } = P;
const parse = (v, fb) => (v == null ? fb : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return fb; } })() : v);
const KINDS = ['morning', 'catchup', 'rerate'];

function appUrl() {
  return String(process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

async function readRow(userId) {
  const { rows } = await pool.query('SELECT reminders FROM fitness_profiles WHERE "userId"=$1', [userId]);
  if (!rows[0]) return null;
  const raw = parse(rows[0].reminders, {});
  return { settings: R.cleanSettings(raw), state: raw.state && typeof raw.state === 'object' ? raw.state : {} };
}

async function writeRow(userId, settings, state) {
  await pool.query('UPDATE fitness_profiles SET reminders=$2 WHERE "userId"=$1', [userId, JSON.stringify({ ...settings, state })]);
}

async function ensureToken(userId, row) {
  if (row.state.unsubToken) return row.state.unsubToken;
  const token = crypto.randomBytes(18).toString('hex');
  row.state = { ...row.state, unsubToken: token };
  await writeRow(userId, row.settings, row.state);
  return token;
}

async function getReminders(userId) {
  const row = await readRow(userId);
  if (!row) return { hasProfile: false, settings: R.cleanSettings({}), emailConfigured: await sendEmail.isConfigured() };
  return { hasProfile: true, settings: row.settings, emailConfigured: await sendEmail.isConfigured() };
}

async function saveReminders(userId, body) {
  const row = await readRow(userId);
  if (!row) throw new ValidationError('Finish setting up your profile first');
  const next = R.cleanSettings(body);
  await writeRow(userId, next, row.state);
  // switching "show in Tasks" on or off takes effect straight away
  require('./fitnessTasks').syncSoon(userId);
  return { hasProfile: true, settings: next, emailConfigured: await sendEmail.isConfigured() };
}

function urlsFor(userId, token, kind) {
  const base = `${appUrl()}/api/fitness/unsubscribe?u=${userId}&t=${token}`;
  return { app: `${appUrl()}/fitness`, unsub: `${base}&k=${kind}`, all: `${base}&k=all` };
}

/** Today's sessions, the week note and whether today is a rest day, in the person's own date. */
async function todayFacts(userId, today) {
  const monday = Ph.mondayOf(today);
  const day = Ph.dayOfWeek(today);
  const { rows: w } = await pool.query(
    `SELECT id, "weekNote", "restDays" FROM fitness_weeks WHERE "userId"=$1 AND "weekStart"=$2`, [userId, monday],
  );
  if (!w[0]) return { sessions: [], weekNote: null, restDay: false };
  const { rows } = await pool.query(
    `SELECT title, slot, status, "plannedMinutes", "warmupMin", "cooldownMin" FROM fitness_planned_sessions
      WHERE "weekId"=$1 AND "userId"=$2 AND day=$3 ORDER BY id`, [w[0].id, userId, day],
  );
  return {
    sessions: rows.map((s) => ({ title: s.title, slot: s.slot, status: s.status, totalMinutes: s.plannedMinutes + s.warmupMin + s.cooldownMin })),
    weekNote: w[0].weekNote || null,
    restDay: parse(w[0].restDays, []).some((r) => r.day === day),
  };
}

async function activityFacts(userId) {
  const { rows: log } = await pool.query(`SELECT to_char(MAX("loggedOn"),'YYYY-MM-DD') AS d FROM fitness_session_logs WHERE "userId"=$1`, [userId]);
  const { rows: rating } = await pool.query(`SELECT to_char(MAX("ratedAt"),'YYYY-MM-DD') AS d FROM fitness_ratings WHERE "userId"=$1`, [userId]);
  return { lastLoggedOn: log[0]?.d || null, ratingKey: rating[0]?.d || null };
}

async function sendOne(userId, email, kind, extra, row, token) {
  const built = buildEmail(kind, { ...extra, urls: urlsFor(userId, token, kind) });
  return sendEmail({ to: email, subject: built.subject, html: built.html });
}

/**
 * The hourly job: for everyone with a reminder switched on, send what is due now. Never throws; a failure for one person
 * goes to the Suggestions inbox and the loop carries on.
 */
async function runReminders(now = new Date()) {
  const { rows: people } = await pool.query(
    `SELECT f."userId", u.email FROM fitness_profiles f JOIN users u ON u.id = f."userId"
      WHERE f.reminders @> '{"morning":{"on":true}}' OR f.reminders @> '{"catchup":{"on":true}}' OR f.reminders @> '{"rerate":{"on":true}}'`,
  );
  const result = { people: people.length, sent: 0, failed: 0 };
  for (const person of people) {
    try {
      const row = await readRow(person.userId);
      if (!row) continue;
      const state = await P.getState(person.userId);
      const tz = state.timezone.timezone;
      const today = R.localClock(now, tz).date;
      const facts = await todayFacts(person.userId, today);
      const activity = await activityFacts(person.userId);
      const startsOn = state.goal?.startsOn || null;
      const lastActive = [activity.lastLoggedOn, startsOn].filter(Boolean).sort().pop() || null;
      const due = R.dueReminders({
        now, timeZone: tz, settings: row.settings, state: row.state, sessionsToday: facts.sessions,
        ratingDue: { ...state.ratingDue, key: activity.ratingKey }, lastLoggedOn: lastActive, restDayToday: facts.restDay,
      });
      for (const reminder of due) {
        const token = await ensureToken(person.userId, row);
        const res = await sendOne(person.userId, person.email, reminder.kind, {
          sessions: facts.sessions.filter((s) => s.status === 'planned' || s.status === 'moved'),
          weekNote: facts.weekNote, weeks: state.ratingDue.weeks, level: reminder.rerateLevel,
        }, row, token);
        if (res?.skipped) continue;
        row.state = R.markSent(row.state, reminder, today, activity.ratingKey);
        await writeRow(person.userId, row.settings, row.state);
        result.sent += 1;
      }
    } catch (err) {
      result.failed += 1;
      console.warn(`[fitness/reminders] user ${person.userId}: ${err.message}`);
      await captureIf(true, {
        userId: person.userId, source: 'fitnessReminders', category: 'alert',
        fingerprint: makeFingerprint('fitnessReminders', `send:${person.userId}`),
        title: 'A Fitness reminder email could not be sent', body: err.message, context: 'server/services/fitness/reminderService.js',
      }).catch(() => {});
    }
  }
  return result;
}

/** "Send me a test": the real email for this person, to their own address, ignoring times and the once-a-day rule. */
async function sendTest(userId, kind) {
  if (!KINDS.includes(kind)) throw new ValidationError('Pick a kind of email to test');
  const row = await readRow(userId);
  if (!row) throw new ValidationError('Finish setting up your profile first');
  if (!(await sendEmail.isConfigured())) throw new ValidationError('Email is not set up on this server yet');
  const { rows: u } = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
  const state = await P.getState(userId);
  const facts = await todayFacts(userId, state.today);
  const token = await ensureToken(userId, row);
  const sessions = facts.sessions.length ? facts.sessions : [{ title: 'Example session', slot: 'morning', totalMinutes: 40 }];
  const res = await sendOne(userId, u[0].email, kind, { sessions, weekNote: facts.weekNote, weeks: state.ratingDue.weeks ?? 5, level: state.ratingDue.level || 'soft' }, row, token);
  if (res?.skipped) throw new ValidationError('Email is switched off on this server');
  return { sentTo: u[0].email };
}

/** The link in every email. Public (no login), proved by the person's random token. */
async function unsubscribe(userId, token, kind) {
  const id = Number(userId);
  if (!Number.isInteger(id) || !token) return false;
  const row = await readRow(id);
  const given = Buffer.from(String(token));
  const real = Buffer.from(String(row?.state?.unsubToken || ''));
  if (!row || given.length !== real.length || !crypto.timingSafeEqual(given, real)) return false;
  const s = { ...row.settings };
  if (kind === 'all') { s.morning = { ...s.morning, on: false }; s.catchup = { ...s.catchup, on: false }; s.rerate = { on: false }; }
  else if (KINDS.includes(kind)) s[kind] = { ...s[kind], on: false };
  else return false;
  await writeRow(id, s, row.state);
  return true;
}

module.exports = { getReminders, saveReminders, runReminders, sendTest, unsubscribe, KINDS };
