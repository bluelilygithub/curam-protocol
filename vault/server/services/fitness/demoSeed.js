'use strict';

/**
 * Staging demo user matching the worked example in the spec: 60-year-old male, very fit in the past, currently
 * not exercising but relatively fit, no smoking or drinking, poor diet, nearly retired with flexible time,
 * gym + pool + bike + dumbbells + trails, no injuries.
 *
 * Idempotent: re-running refreshes the same user's Stage 1 data. Stage 3 extends this with a few weeks of mixed logs.
 * Uses the rule-based wording (no AI call), so seeding costs nothing and always works.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const C = require('./config');
const T = require('./targets');
const { buildMilestones } = T;
const P = require('./profileService');
const { fallbackText } = require('./goal');

const DEMO_EMAIL = process.env.FITNESS_DEMO_EMAIL || 'fitness-demo@curam.local';

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

  await P.saveProfile(userId, {
    dob, sex: 'male', heightCm: 178, weightKg: 86,
    equipment: ['gym', 'pool', 'bike', 'dumbbells', 'trails', 'bodyweight_home'],
    smoking: 'none', alcohol: 'none', dietQuality: 2,
    timeFlexibility: { mode: 'flexible', twiceDaily: true, notes: 'Nearly retired; most days are open.' },
    workAround: null,
    otherNotes: 'Very fit until about 50, mostly sedentary the last 2 years.',
  });

  await pool.query('DELETE FROM fitness_ratings WHERE "userId"=$1', [userId]);
  const scores = { cardio: 3, strength: 3, flexibility: 2, balance: 3 };
  const previous = { cardio: 5, strength: 4, flexibility: 3, balance: 4 };
  await P.saveRatings(userId, {
    kind: 'onboarding', scores, previousScores: previous, previousLabel: '10 years ago',
    note: 'Very fit until about 50, sedentary last 2 years.',
  });

  const state = await P.getState(userId);
  const plan = buildMilestones({ bandId: state.profile.bandId, scores, previous, ambition: C.DEFAULT_AMBITION, startsOn: today }, cfg);
  const text = fallbackText(plan, null);
  await pool.query(`DELETE FROM fitness_goals WHERE "userId"=$1`, [userId]);
  await P.saveGoal(userId, {
    ambition: plan.ambition,
    startsOn: today,
    milestones: plan.milestones.map((m, i) => ({ ...m, note: text.yearNotes[i] })),
    summary: { summary: text.summary, regaining: plan.regaining, endRatings: plan.endRatings, endWeekly: plan.endWeekly, startMinutes: plan.startMinutes, ambitionLabel: 'Balanced' },
    source: 'demo',
  });

  // A short weight history (kg), so the weight series has something to show.
  await pool.query(`DELETE FROM health_weight_log WHERE "userId"=$1 AND source='fitness-demo'`, [userId]);
  const weights = [[10, 89], [6, 88], [3, 87]];
  for (const [weeksAgo, kg] of weights) {
    const on = new Date(Date.parse(`${today}T00:00:00Z`) - weeksAgo * 7 * 86400000).toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO health_weight_log ("userId", "weightKg", "measuredOn", source) VALUES ($1,$2,$3,'fitness-demo')`,
      [userId, kg, on],
    );
  }

  return {
    ok: true,
    created,
    email: DEMO_EMAIL,
    password, // shown once, on creation only
    note: created ? 'Demo user created. Save the password now; it is not shown again.' : 'Demo user already existed; Stage 1 data refreshed (password unchanged).',
    stage: 'done',
    logs: 'Mixed logs arrive with Stage 3 (logging).',
  };
}

module.exports = { seedDemoUser, DEMO_EMAIL };
