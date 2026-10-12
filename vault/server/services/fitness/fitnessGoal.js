'use strict';

/**
 * This week's Fitness progress as a goal in the existing /goals module (objectives and key results), opt-in.
 *
 * One objective per person (`objectives.source = 'fitness'`) with two key results that follow the CURRENT week:
 *   - sessions done this week, against the sessions planned (partly done counts half; rest is not a session);
 *   - aerobic minutes this week, against the week's target.
 * Each fitness task is linked to the sessions key result (`tasks."keyResultId"`), so Goals shows its linked and completed tasks.
 * Numbers follow the week, so a new week starts at zero with no "failed" state: there is nothing to fall behind on, only this
 * week's picture. Switching it off removes the goal; no new tables.
 */

const { pool } = require('../../db');
const D = require('./dashboard');
const Ph = require('./phases');

const SESSIONS = 'fitness-sessions';
const MINUTES = 'fitness-minutes';

/** The two key results' numbers for a week summary (see dashboard.summariseWeek). */
function goalNumbers(week) {
  const half = (n) => Math.round(n * 2) / 2;
  return {
    sessions: { current: half(week.sessionsDone), target: week.sessionsPlanned },
    minutes: { current: Math.round(week.done.aerobicMinutes), target: Math.round(week.targets.aerobicMinutes) },
  };
}

async function settingOn(userId) {
  const { rows } = await pool.query('SELECT reminders FROM fitness_profiles WHERE "userId"=$1', [userId]);
  if (!rows[0]) return null;
  const r = typeof rows[0].reminders === 'string' ? JSON.parse(rows[0].reminders) : rows[0].reminders || {};
  return r.goalLink === true;
}

async function removeGoal(userId) {
  await pool.query(
    `UPDATE tasks SET "keyResultId"=NULL WHERE "userId"=$1 AND "fitnessSessionId" IS NOT NULL AND "keyResultId" IS NOT NULL`, [userId],
  );
  await pool.query(`DELETE FROM objectives WHERE "userId"=$1 AND source='fitness'`, [userId]);
}

async function ensureObjective(userId, title, description) {
  const { rows } = await pool.query(`SELECT id FROM objectives WHERE "userId"=$1 AND source='fitness' LIMIT 1`, [userId]);
  if (rows[0]) {
    await pool.query(`UPDATE objectives SET title=$2, description=$3, "updatedAt"=NOW() WHERE id=$1`, [rows[0].id, title, description]);
    return rows[0].id;
  }
  const ins = await pool.query(
    `INSERT INTO objectives (title, description, timeframe, color, "userId", source) VALUES ($1,$2,'Weekly',$3,$4,'fitness') RETURNING id`,
    [title, description, '#16a34a', userId],
  );
  return ins.rows[0].id;
}

async function upsertKeyResult(objectiveId, source, title, unit, current, target, dueDate) {
  const { rows } = await pool.query(`SELECT id FROM key_results WHERE "objectiveId"=$1 AND source=$2 LIMIT 1`, [objectiveId, source]);
  if (rows[0]) {
    await pool.query(
      `UPDATE key_results SET title=$2, unit=$3, "currentValue"=$4, "targetValue"=$5, "dueDate"=$6, "updatedAt"=NOW() WHERE id=$1`,
      [rows[0].id, title, unit, current, Math.max(target, 1), dueDate],
    );
    return rows[0].id;
  }
  const ins = await pool.query(
    `INSERT INTO key_results ("objectiveId", title, "targetValue", "currentValue", unit, "dueDate", source) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [objectiveId, title, Math.max(target, 1), current, unit, dueDate, source],
  );
  return ins.rows[0].id;
}

/**
 * Brings the person's Fitness goal in step with this week (or removes it when switched off). Safe to run any time.
 * @param {number} userId
 * @param {string} today ISO date in their time zone
 */
async function syncFitnessGoal(userId, today) {
  const on = await settingOn(userId);
  if (on === null) return { skipped: 'no profile' };
  if (!on) { await removeGoal(userId); return { skipped: 'switched off' }; }

  const { loadWeeks } = require('./dashboardService');
  const monday = Ph.mondayOf(today);
  const weeks = await loadWeeks(userId, monday);
  const w = weeks.find((x) => x.weekStart === monday);
  if (!w) return { skipped: 'no week yet' };
  const n = goalNumbers(D.summariseWeek(w, today));
  const end = Ph.addDays(monday, 6);

  const objective = await ensureObjective(
    userId,
    'Fitness: this week',
    'Follows your Fitness plan for the current week. It starts fresh each week, and rest days never count against you. Open Fitness for the full picture.',
  );
  const sessionsKr = await upsertKeyResult(objective, SESSIONS, 'Sessions done this week', 'sessions', n.sessions.current, n.sessions.target, end);
  await upsertKeyResult(objective, MINUTES, 'Aerobic minutes this week', 'min', n.minutes.current, n.minutes.target, end);
  await pool.query(
    `UPDATE tasks SET "keyResultId"=$2 WHERE "userId"=$1 AND "fitnessSessionId" IS NOT NULL AND "keyResultId" IS DISTINCT FROM $2`,
    [userId, sessionsKr],
  );
  return { objective, numbers: n };
}

module.exports = { goalNumbers, syncFitnessGoal, removeGoal };
