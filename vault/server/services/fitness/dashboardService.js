'use strict';

/** Loads the person's weeks for the dashboard (a handful of queries, not one per week) and hands them to dashboard.js. */

const { pool } = require('../../db');
const P = require('./profileService');
const D = require('./dashboard');
const L = require('./library');

const parse = (v, fb) => (v == null ? fb : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return fb; } })() : v);

const { mondayOf } = require('./phases');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function loadWeeks(userId, fromWeekStart) {
  const { rows: weeks } = await pool.query(
    `SELECT id, to_char("weekStart",'YYYY-MM-DD') AS "weekStart", "isDeload", targets, "restDays"
       FROM fitness_weeks WHERE "userId"=$1 AND "weekStart" >= $2 ORDER BY "weekStart"`,
    [userId, fromWeekStart],
  );
  if (!weeks.length) return [];
  const ids = weeks.map((w) => w.id);
  const { rows: sessions } = await pool.query(
    `SELECT s.id, s."weekId", s.day, s.status, s.components, l.effort
       FROM fitness_planned_sessions s LEFT JOIN fitness_session_logs l ON l."plannedSessionId" = s.id
      WHERE s."userId"=$1 AND s."weekId" = ANY($2::int[]) ORDER BY s.day, s.id`,
    [userId, ids],
  );
  const { rows: extras } = await pool.query(
    `SELECT domain, "actualMinutes" AS minutes, effort, to_char("loggedOn",'YYYY-MM-DD') AS date
       FROM fitness_session_logs WHERE "userId"=$1 AND "plannedSessionId" IS NULL AND "loggedOn" >= $2`,
    [userId, fromWeekStart],
  );
  return weeks.map((w) => {
    const end = addDays(w.weekStart, 6);
    return {
      weekStart: w.weekStart,
      isDeload: w.isDeload,
      targets: parse(w.targets, {}),
      restDays: parse(w.restDays, []),
      sessions: sessions.filter((s) => s.weekId === w.id).map((s) => ({ ...s, components: parse(s.components, []) })),
      extras: extras.filter((x) => x.date >= w.weekStart && x.date <= end),
    };
  });
}

/** Logged weights per exercise and weigh-ins since a date (the window's start, or ever for 'all'). */
async function loadProgress(userId, fromDate) {
  const { rows: loads } = await pool.query(
    `SELECT e.slug, e."weightKg"::float AS kg, to_char(l."loggedOn",'YYYY-MM-DD') AS "on", l.effort
       FROM fitness_exercise_logs e JOIN fitness_session_logs l ON l.id = e."sessionLogId"
      WHERE e."userId"=$1 AND e."weightKg" IS NOT NULL AND l.status IN ('done','partial') AND l."loggedOn" >= $2
      ORDER BY l."loggedOn", e.id`,
    [userId, fromDate],
  );
  const { rows: weights } = await pool.query(
    `SELECT "weightKg"::float AS kg, to_char("measuredOn",'YYYY-MM-DD') AS "on"
       FROM health_weight_log WHERE "userId"=$1 AND "measuredOn" >= $2 ORDER BY "measuredOn", id`,
    [userId, fromDate],
  );
  return { loads, weights };
}

async function getDashboard(userId, range) {
  const r = ['4', '12', 'all'].includes(String(range)) ? String(range) : '12';
  const state = await P.getState(userId);
  const today = state.today;
  // 'all' reads up to five years back; the others only need enough history for the trend and the balance chart
  const back = r === 'all' ? 7 * 260 : 7 * 40;
  const weeks = await loadWeeks(userId, addDays(today, -back));
  // the charts follow the toggle: 4 or 12 weeks back from this week's Monday, or everything
  const windowStart = r === 'all' ? '1900-01-01' : addDays(mondayOf(today), -7 * (Number(r) - 1));
  const { loads, weights } = await loadProgress(userId, windowStart);
  const bySlug = L.getLibrary().bySlug;
  return D.buildDashboard({ weeks, milestones: state.goal?.milestones || [], today, range: r, loads, weights, nameOf: (s) => bySlug.get(s)?.name || s });
}

module.exports = { getDashboard, loadWeeks };
