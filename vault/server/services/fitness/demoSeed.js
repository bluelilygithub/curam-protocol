'use strict';

/**
 * Staging demo user matching the worked example in the spec: 60-year-old male, very fit in the past, currently
 * not exercising but relatively fit, no smoking or drinking, poor diet, nearly retired with flexible time,
 * gym + pool + bike + dumbbells + trails, no injuries.
 *
 * Creates the user if needed, and every run RESETS their fitness data: the goal starts four weeks ago, four past weeks are
 * planned, and a mixed set of logs is applied (see demoScript.js): done, partly done, rest, a "didn't do it", a swap, extra
 * activity, weights, and one note about knee pain. The current week is made on demand when the demo user opens Today.
 * Uses the rule-based planner (no model call), so seeding costs nothing and always works.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const C = require('./config');
const T = require('./targets');
const Ph = require('./phases');
const P = require('./profileService');
const W = require('./weekService');
const LS = require('./logService');
const DS = require('./demoScript');
const { bodyFor } = DS;
const { fallbackText } = require('./goal');

const DEMO_EMAIL = process.env.FITNESS_DEMO_EMAIL || 'fitness-demo@curam.local';
const SCORES = { cardio: 3, strength: 3, flexibility: 2, balance: 3 };
const PREVIOUS = { cardio: 5, strength: 4, flexibility: 3, balance: 4 };

async function wipe(userId) {
  await pool.query('DELETE FROM fitness_weeks WHERE "userId"=$1', [userId]); // sessions, exercises and their logs go with them
  await pool.query('DELETE FROM fitness_session_logs WHERE "userId"=$1', [userId]); // extras
  await pool.query('DELETE FROM fitness_hidden_exercises WHERE "userId"=$1', [userId]);
  await pool.query(`UPDATE fitness_profiles SET "easeWeek"=NULL, prefs='{}' WHERE "userId"=$1`, [userId]);
}

async function seedDemoUser() {
  const cfg = await C.loadConfig(pool);

  let created = false;
  let password = null;
  let { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [DEMO_EMAIL]);
  if (!rows[0]) {
    password = crypto.randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(password, 12);
    ({ rows } = await pool.query('INSERT INTO users (email, "passwordHash") VALUES ($1,$2) RETURNING id', [DEMO_EMAIL, hash]));
    created = true;
  }
  const userId = rows[0].id;

  // Born 60 years and ~2 months ago, so the age band is stable for the life of a demo.
  const { timezone } = await require('./timezone').resolveUserTimezone(userId);
  const today = T.todayInZone(timezone);
  const dob = new Date(Date.parse(`${T.addYears(today, -60)}T00:00:00Z`) - 60 * 86400000).toISOString().slice(0, 10);
  const startsOn = Ph.addDays(Ph.mondayOf(today), -7 * DS.WEEKS);

  await P.saveProfile(userId, {
    dob, sex: 'male', heightCm: 178, weightKg: 86,
    equipment: ['gym', 'pool', 'bike', 'dumbbells', 'trails', 'bodyweight_home'],
    weeklyMinutes: 0, smoking: 'none', alcohol: 'none', dietQuality: 2,
    timeFlexibility: { mode: 'flexible', twiceDaily: true, notes: 'Nearly retired; most days are open.' },
    workAround: null,
    otherNotes: 'Very fit until about 50, mostly sedentary the last 2 years.',
  });

  // ratings and goal date from the start of the demo history
  await pool.query('DELETE FROM fitness_ratings WHERE "userId"=$1', [userId]);
  await P.saveRatings(userId, {
    kind: 'onboarding', scores: SCORES, previousScores: PREVIOUS, previousLabel: '10 years ago',
    note: 'Very fit until about 50, sedentary last 2 years.',
  });
  await pool.query(`UPDATE fitness_ratings SET "ratedAt"=$2 WHERE "userId"=$1`, [userId, `${startsOn}T08:00:00Z`]);

  const state = await P.getState(userId);
  const plan = T.buildMilestones({ bandId: state.profile.bandId, scores: SCORES, previous: PREVIOUS, ambition: C.DEFAULT_AMBITION, startsOn, currentMinutes: 0 }, cfg);
  const text = fallbackText(plan, null);
  await pool.query('DELETE FROM fitness_goals WHERE "userId"=$1', [userId]);
  await P.saveGoal(userId, {
    ambition: plan.ambition,
    startsOn,
    milestones: plan.milestones,
    summary: { summary: text.summary, regaining: plan.regaining, endRatings: plan.endRatings, endWeekly: plan.endWeekly, startMinutes: plan.startMinutes, now: plan.now, ambitionLabel: 'Balanced' },
    source: 'demo',
  });

  // four past weeks of plans, then a mixed set of logs
  await wipe(userId);
  const counts = { weeks: 0, sessions: 0, done: 0, partial: 0, swapped: 0, rest: 0, skipped: 0, extras: 0, kneeNote: 0 };
  for (let i = 0; i < DS.WEEKS; i += 1) {
    const start = Ph.addDays(startsOn, 7 * i);
    await W.ensureWeek(userId, { start, allowPast: true, useAi: false });
    counts.weeks += 1;
    const week = await W.getWeek(userId, start);
    const sessions = [...week.sessions].sort((a, b) => a.day - b.day || a.id - b.id);

    const scripts = DS.assignWeek(sessions, i);
    const planned = sessions.map((s, idx) => ({ s, script: scripts[idx] }));
    for (const { s, script } of planned) {
      const body = bodyFor(script, s, i);
      await LS.logSession(userId, s.id, body, { skipWindow: true });
      counts.sessions += 1;
      counts[body.status] = (counts[body.status] || 0) + 1;
      if (body.note && /knee/i.test(body.note)) counts.kneeNote += 1;
    }
  }
  for (const [weekIdx, dayOffset, title, minutes, effort, domain] of DS.EXTRAS) {
    const date = Ph.addDays(startsOn, 7 * weekIdx + dayOffset);
    if (date >= today) continue;
    await LS.logExtra(userId, { title, actualMinutes: minutes, effort, domain, date }, { skipWindow: true });
    counts.extras += 1;
  }

  // weigh-ins: the Sunday of each of the four weeks
  await pool.query(`DELETE FROM health_weight_log WHERE "userId"=$1 AND source='fitness-demo'`, [userId]);
  for (let i = 0; i < DS.WEEKS; i += 1) {
    const on = Ph.addDays(startsOn, 7 * i + 6);
    if (on >= today) continue;
    await pool.query(
      `INSERT INTO health_weight_log ("userId", "weightKg", "measuredOn", source) VALUES ($1,$2,$3,'fitness-demo')`,
      [userId, DS.WEIGHTS[i], on],
    );
  }

  return {
    ok: true,
    created,
    email: DEMO_EMAIL,
    password, // shown once, on creation only
    startsOn,
    counts,
    note: created
      ? 'Demo user created with four past weeks of mixed logs. Save the password now; it is not shown again.'
      : 'Demo data reset: four past weeks of plans and mixed logs. The password is unchanged.',
    stage: 'done',
  };
}

module.exports = { seedDemoUser, DEMO_EMAIL };
