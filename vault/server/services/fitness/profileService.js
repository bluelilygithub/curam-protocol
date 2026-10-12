'use strict';

/**
 * Reads and writes the planner's per-user state: the shared health profile (age, sex, height, weight series),
 * the fitness-only lifestyle profile, rating history and the active goal.
 * Every query is scoped by "userId". Dates come back as 'YYYY-MM-DD' strings (cast in SQL).
 */

const { pool } = require('../../db');
const C = require('./config');
const T = require('./targets');
const { checkNotes } = require('./safety');
const { resolveUserTimezone, isValidTimezone } = require('./timezone');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function oneOf(value, options, label) {
  if (!options.some((o) => o.id === value)) throw new ValidationError(`${label} is not a valid option`);
  return value;
}

function cleanText(v, max) {
  if (v == null) return null;
  if (typeof v !== 'string') throw new ValidationError('Text fields must be text');
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function num(v, label, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}`);
  return Math.round(n * 10) / 10;
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
}

function validateHealth(body, today) {
  const dob = body.dob;
  if (!T.isIsoDate(dob)) throw new ValidationError('Date of birth is required (YYYY-MM-DD)');
  const age = T.ageOn(dob, today);
  if (age == null || age > 110) throw new ValidationError('Date of birth does not look right');
  if (age < T.MIN_AGE) throw new ValidationError('This planner is designed for adults aged 18 and over');
  return {
    dob,
    sex: oneOf(body.sex, C.SEX_OPTIONS, 'Sex'),
    heightCm: num(body.heightCm, 'Height (cm)', 100, 230),
    weightKg: num(body.weightKg, 'Weight (kg)', 30, 300),
  };
}

function validateLifestyle(body) {
  const equipment = Array.isArray(body.equipment) ? [...new Set(body.equipment)] : [];
  for (const e of equipment) oneOf(e, C.EQUIPMENT, 'Equipment');
  const tf = body.timeFlexibility || {};
  const diet = Math.round(Number(body.dietQuality));
  if (!Number.isFinite(diet) || diet < 1 || diet > 5) throw new ValidationError('Diet quality must be 1 to 5');
  return {
    equipment,
    smoking: oneOf(body.smoking, C.SMOKING, 'Smoking'),
    alcohol: oneOf(body.alcohol, C.ALCOHOL, 'Alcohol'),
    dietQuality: diet,
    timeFlexibility: {
      mode: tf.mode === 'fixed' ? 'fixed' : 'flexible',
      twiceDaily: !!tf.twiceDaily,
      notes: cleanText(tf.notes, 300),
    },
    workAround: cleanText(body.workAround, 1000),
    otherNotes: cleanText(body.otherNotes, 1000),
    weeklyMinutes: validateMinutes(body.weeklyMinutes),
  };
}

/** Typical active minutes in a week right now. Blank means "not given": the plan then estimates from the cardio rating. */
function validateMinutes(v) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 2000) throw new ValidationError('Weekly exercise minutes must be between 0 and 2000');
  return n;
}

function validateScores(obj, label) {
  if (!T.validRatings(obj)) throw new ValidationError(`${label} must rate every domain from 1 to 5`);
  return Object.fromEntries(C.DOMAINS.map((d) => [d, obj[d]]));
}

async function getHealthRow(userId) {
  const { rows } = await pool.query(
    `SELECT to_char(dob,'YYYY-MM-DD') AS dob, sex, "heightCm"::float AS "heightCm" FROM health_profiles WHERE "userId"=$1`,
    [userId],
  );
  return rows[0] || null;
}

async function getLatestWeight(userId) {
  const { rows } = await pool.query(
    `SELECT "weightKg"::float AS "weightKg", to_char("measuredOn",'YYYY-MM-DD') AS "measuredOn"
       FROM health_weight_log WHERE "userId"=$1 ORDER BY "measuredOn" DESC, id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function getFitnessRow(userId) {
  const { rows } = await pool.query(
    `SELECT equipment, smoking, alcohol, "dietQuality", "timeFlexibility", "workAround", "otherNotes",
            "currentWeeklyMinutes" AS "weeklyMinutes", "templateBand", "easeRequested", to_char("onboardedAt",'YYYY-MM-DD') AS "onboardedOn"
       FROM fitness_profiles WHERE "userId"=$1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, equipment: parseJson(r.equipment, []), timeFlexibility: parseJson(r.timeFlexibility, { mode: 'flexible', twiceDaily: false }) };
}

async function getLatestRating(userId) {
  const { rows } = await pool.query(
    `SELECT id, kind, scores, "previousScores", "previousLabel", note, to_char("ratedAt",'YYYY-MM-DD') AS "ratedOn"
       FROM fitness_ratings WHERE "userId"=$1 ORDER BY "ratedAt" DESC, id DESC LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, scores: parseJson(r.scores, null), previousScores: parseJson(r.previousScores, null) };
}

async function getRatingHistory(userId) {
  const { rows } = await pool.query(
    `SELECT id, kind, scores, "previousScores", "previousLabel", note, to_char("ratedAt",'YYYY-MM-DD') AS "ratedOn"
       FROM fitness_ratings WHERE "userId"=$1 ORDER BY "ratedAt" ASC, id ASC`,
    [userId],
  );
  return rows.map((r) => ({ ...r, scores: parseJson(r.scores, null), previousScores: parseJson(r.previousScores, null) }));
}

async function getActiveGoal(userId) {
  const { rows } = await pool.query(
    `SELECT id, ambition, "horizonYears", to_char("startsOn",'YYYY-MM-DD') AS "startsOn", milestones, summary, source,
            to_char("createdAt",'YYYY-MM-DD') AS "createdOn"
       FROM fitness_goals WHERE "userId"=$1 AND status='active' ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  const g = rows[0];
  if (!g) return null;
  return { ...g, milestones: parseJson(g.milestones, []), summary: parseJson(g.summary, {}) };
}

async function getGoalHistory(userId) {
  const { rows } = await pool.query(
    `SELECT id, ambition, status, "horizonYears", to_char("startsOn",'YYYY-MM-DD') AS "startsOn",
            to_char("createdAt",'YYYY-MM-DD') AS "createdOn"
       FROM fitness_goals WHERE "userId"=$1 ORDER BY id DESC LIMIT 50`,
    [userId],
  );
  return rows;
}

/** Whole current state for the client. Cheap: a handful of indexed reads, no AI. */
async function getState(userId) {
  const timezone = await resolveUserTimezone(userId);
  const today = T.todayInZone(timezone.timezone);
  const [health, weight, fit, rating, goal] = await Promise.all([
    getHealthRow(userId), getLatestWeight(userId), getFitnessRow(userId), getLatestRating(userId), getActiveGoal(userId),
  ]);

  const age = health?.dob ? T.ageOn(health.dob, today) : null;
  const band = age != null ? T.bandForAge(age) : null;

  let stage = 'profile';
  if (health && fit) stage = 'ratings';
  if (health && fit && rating) stage = 'baseline';
  if (health && fit && rating && goal) stage = 'done';

  const cfg = await C.loadConfig(pool);
  const due = rating ? T.ratingDue(rating.ratedOn, today, cfg) : { due: false, level: null, weeks: null };
  const safety = fit ? checkNotes(fit.workAround, fit.otherNotes) : { flags: [], suggestGp: false, offerEase: false, message: null };

  return {
    stage,
    today,
    timezone,
    profile: health ? {
      dob: health.dob, age, bandId: band?.id || null, bandLabel: band?.label || null, sex: health.sex, heightCm: health.heightCm,
      weightKg: weight?.weightKg ?? null, weightOn: weight?.measuredOn ?? null,
    } : null,
    lifestyle: fit ? {
      equipment: fit.equipment, smoking: fit.smoking, alcohol: fit.alcohol, dietQuality: fit.dietQuality,
      weeklyMinutes: fit.weeklyMinutes ?? null, timeFlexibility: fit.timeFlexibility, workAround: fit.workAround, otherNotes: fit.otherNotes,
      templateBand: fit.templateBand, easeRequested: !!fit.easeRequested,
    } : null,
    rating,
    ratingDue: due,
    goal,
    safety,
  };
}

async function saveProfile(userId, body) {
  const timezone = await resolveUserTimezone(userId);
  const today = T.todayInZone(timezone.timezone);
  const health = validateHealth(body, today);
  const life = validateLifestyle(body);
  const band = T.bandForAge(T.ageOn(health.dob, today));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO health_profiles ("userId", dob, sex, "heightCm") VALUES ($1,$2,$3,$4)
       ON CONFLICT ("userId") DO UPDATE SET dob=EXCLUDED.dob, sex=EXCLUDED.sex, "heightCm"=EXCLUDED."heightCm", "updatedAt"=NOW()`,
      [userId, health.dob, health.sex, health.heightCm],
    );
    const { rows: last } = await client.query(
      `SELECT "weightKg"::float AS w FROM health_weight_log WHERE "userId"=$1 ORDER BY "measuredOn" DESC, id DESC LIMIT 1`, [userId],
    );
    if (!last[0] || Math.abs(last[0].w - health.weightKg) >= 0.05) {
      await client.query(
        `INSERT INTO health_weight_log ("userId", "weightKg", "measuredOn", source) VALUES ($1,$2,$3,'fitness')`,
        [userId, health.weightKg, today],
      );
    }
    // The notes may have changed: a previous "ease" confirmation only stands while it still applies.
    const safety = checkNotes(life.workAround, life.otherNotes);
    const easeRequested = safety.offerEase ? !!body.easeRequested : false;
    await client.query(
      `INSERT INTO fitness_profiles ("userId", equipment, smoking, alcohol, "dietQuality", "timeFlexibility", "workAround", "otherNotes", "templateBand", "easeRequested", "currentWeeklyMinutes")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT ("userId") DO UPDATE SET equipment=EXCLUDED.equipment, smoking=EXCLUDED.smoking, alcohol=EXCLUDED.alcohol,
         "dietQuality"=EXCLUDED."dietQuality", "timeFlexibility"=EXCLUDED."timeFlexibility", "workAround"=EXCLUDED."workAround",
         "otherNotes"=EXCLUDED."otherNotes", "templateBand"=EXCLUDED."templateBand", "easeRequested"=EXCLUDED."easeRequested",
         "currentWeeklyMinutes"=EXCLUDED."currentWeeklyMinutes", "updatedAt"=NOW()`,
      [userId, JSON.stringify(life.equipment), life.smoking, life.alcohol, life.dietQuality, JSON.stringify(life.timeFlexibility),
        life.workAround, life.otherNotes, band?.id || null, easeRequested, life.weeklyMinutes],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (body.timezone != null) await saveTimezone(userId, body.timezone);
  return getState(userId);
}

async function saveTimezone(userId, tz) {
  const value = typeof tz === 'string' ? tz.trim() : '';
  if (!value) {
    await pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [userId, 'user_timezone']);
    return;
  }
  if (!isValidTimezone(value)) throw new ValidationError('That time zone is not recognised');
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,'user_timezone',$2)
     ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value`,
    [userId, value],
  );
}

async function saveRatings(userId, body) {
  const scores = validateScores(body.scores, 'Current ratings');
  const previous = body.previousScores ? validateScores(body.previousScores, 'Previous ratings') : null;
  const kind = body.kind === 'rerate' ? 'rerate' : 'onboarding';
  const { rows } = await pool.query(
    `INSERT INTO fitness_ratings ("userId", kind, scores, "previousScores", "previousLabel", note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [userId, kind, JSON.stringify(scores), previous ? JSON.stringify(previous) : null, cleanText(body.previousLabel, 60), cleanText(body.note, 1000)],
  );
  return rows[0].id;
}

/** Make `milestones` the active goal; any earlier active goal becomes 'superseded' (kept as history). */
async function saveGoal(userId, { ambition, startsOn, milestones, summary, source }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE fitness_goals SET status='superseded' WHERE "userId"=$1 AND status='active'`, [userId]);
    const { rows } = await client.query(
      `INSERT INTO fitness_goals ("userId", ambition, status, "horizonYears", "startsOn", milestones, summary, source)
       VALUES ($1,$2,'active',5,$3,$4,$5,$6) RETURNING id`,
      [userId, ambition, startsOn, JSON.stringify(milestones), JSON.stringify(summary), source],
    );
    await client.query(`UPDATE fitness_profiles SET "onboardedAt"=COALESCE("onboardedAt", NOW()) WHERE "userId"=$1`, [userId]);
    await client.query('COMMIT');
    return rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retake the wizard. Default is gentle: the lifestyle answers are removed (so onboarding shows again, pre-filled from
 * what you said before) and the active goal is kept as history. `clear` also wipes ratings, goals, cached wording and
 * the shared date of birth / sex / height. The weight history is kept unless `clearWeight` is also set, because the
 * future diet app shares it.
 */
async function resetWizard(userId, { clear = false, clearWeight = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM fitness_profiles WHERE "userId"=$1', [userId]);
    if (clear) {
      await client.query('DELETE FROM fitness_goals WHERE "userId"=$1', [userId]);
      await client.query('DELETE FROM fitness_ratings WHERE "userId"=$1', [userId]);
      await client.query('DELETE FROM fitness_ai_cache WHERE "userId"=$1', [userId]);
      await client.query('DELETE FROM health_profiles WHERE "userId"=$1', [userId]);
      if (clearWeight) await client.query('DELETE FROM health_weight_log WHERE "userId"=$1', [userId]);
    } else {
      await client.query(`UPDATE fitness_goals SET status='superseded' WHERE "userId"=$1 AND status='active'`, [userId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getState(userId);
}

/** Inputs the AI services need, assembled from stored state. Throws if onboarding is incomplete. */
async function getPlanningInputs(userId) {
  const state = await getState(userId);
  if (!state.profile || !state.lifestyle || !state.rating) throw new ValidationError('Finish your profile and ratings first');
  if (!state.profile.bandId) throw new ValidationError('This planner is designed for adults aged 18 and over');
  const { lifestyle, profile } = state;
  const lifestyleSummary = {
    equipment: lifestyle.equipment, smoking: lifestyle.smoking, alcohol: lifestyle.alcohol, dietQuality: lifestyle.dietQuality,
    timeFlexibility: lifestyle.timeFlexibility,
  };
  const notes = [lifestyle.workAround, lifestyle.otherNotes, state.rating.note].filter(Boolean).join(' | ') || null;
  return { state, profile: { ...profile, lifestyleSummary }, currentMinutes: lifestyle.weeklyMinutes ?? null, scores: state.rating.scores, previous: state.rating.previousScores, previousLabel: state.rating.previousLabel, notes };
}

module.exports = {
  ValidationError,
  getState,
  getRatingHistory,
  getGoalHistory,
  getActiveGoal,
  saveProfile,
  saveTimezone,
  saveRatings,
  saveGoal,
  resetWizard,
  getPlanningInputs,
  validateScores,
};
