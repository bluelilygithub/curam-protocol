'use strict';

/**
 * Logging what actually happened. Everything is scoped by "userId". The planned session's own `status` is kept in step with
 * its log (done | partial | swapped | skipped | rest) so the week view and later charts read one place; the log holds the detail.
 * Sessions that were never logged have no log and stay `planned`: "not logged" is neutral, never skipped.
 */

const { pool } = require('../../db');
const P = require('./profileService');
const Ph = require('./phases');
const LG = require('./logging');
const { checkNotes } = require('./safety');

const { ValidationError } = P;

const parse = (v, fb) => (v == null ? fb : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return fb; } })() : v);

async function ownedPlanned(userId, sessionId) {
  const { rows } = await pool.query(
    `SELECT s.id, s."weekId", s.day, s.slot, s.status, s."movedFrom", s.title, s."plannedMinutes", s."warmupMin", s."cooldownMin",
            to_char(w."weekStart",'YYYY-MM-DD') AS "weekStart"
       FROM fitness_planned_sessions s JOIN fitness_weeks w ON w.id = s."weekId"
      WHERE s.id=$1 AND s."userId"=$2`,
    [sessionId, userId],
  );
  if (!rows[0]) { const e = new Error('Session not found'); e.status = 404; throw e; }
  return rows[0];
}

/** Create or replace the log for a planned session. Returns what the route needs to rebuild the week. */
async function logSession(userId, sessionId, body, { skipWindow = false } = {}) {
  const state = await P.getState(userId);
  const s = await ownedPlanned(userId, sessionId);
  const date = Ph.addDays(s.weekStart, s.day);
  if (skipWindow) { if (date > state.today) throw new LG.LogError('Come back on the day'); } else LG.checkLoggable(date, state.today);
  const v = LG.validateSessionLog(body);

  const { rows: planned } = await pool.query(
    'SELECT position, slug, block FROM fitness_planned_exercises WHERE "sessionId"=$1 AND "userId"=$2', [sessionId, userId],
  );
  const known = new Map(planned.map((e) => [e.position, e]));
  for (const row of v.exercises) if (!known.has(row.position)) throw new LG.LogError('That exercise is not part of this session');

  const safety = checkNotes(v.note);
  const client = await pool.connect();
  let logId;
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id FROM fitness_session_logs WHERE "plannedSessionId"=$1 AND "userId"=$2', [sessionId, userId]);
    const common = [v.status, s.title, v.activity, s.plannedMinutes, v.actualMinutes, v.effort, v.note, safety.flags.length ? JSON.stringify(safety) : null];
    if (existing[0]) {
      logId = existing[0].id;
      await client.query(
        `UPDATE fitness_session_logs SET status=$3, title=$4, activity=$5, "plannedMinutes"=$6, "actualMinutes"=$7, effort=$8, note=$9, safety=$10, tips=NULL, "updatedAt"=NOW()
          WHERE id=$1 AND "userId"=$2`,
        [logId, userId, ...common],
      );
      await client.query('DELETE FROM fitness_exercise_logs WHERE "sessionLogId"=$1', [logId]);
    } else {
      const ins = await client.query(
        `INSERT INTO fitness_session_logs ("userId","plannedSessionId","loggedOn",status,title,activity,"plannedMinutes","actualMinutes",effort,note,safety)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [userId, sessionId, date, ...common],
      );
      logId = ins.rows[0].id;
    }
    for (const r of v.exercises) {
      const e = known.get(r.position);
      await client.query(
        `INSERT INTO fitness_exercise_logs ("sessionLogId","userId",slug,block,position,sets,reps,"weightKg","distanceKm",seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [logId, userId, e.slug, e.block, r.position, r.sets, r.reps, r.weightKg, r.distanceKm, r.seconds],
      );
    }
    await client.query('UPDATE fitness_planned_sessions SET status=$3 WHERE id=$1 AND "userId"=$2', [sessionId, userId, v.status]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { logId, weekStart: s.weekStart, safety, status: v.status };
}

/** Take a log back: the session returns to planned (or moved), not logged. */
async function undoLog(userId, sessionId) {
  const s = await ownedPlanned(userId, sessionId);
  await pool.query('DELETE FROM fitness_session_logs WHERE "plannedSessionId"=$1 AND "userId"=$2', [sessionId, userId]);
  await pool.query(
    'UPDATE fitness_planned_sessions SET status=$3 WHERE id=$1 AND "userId"=$2',
    [sessionId, userId, s.movedFrom ? 'moved' : 'planned'],
  );
  return { weekStart: s.weekStart };
}

/** Something done that was not planned. */
async function logExtra(userId, body, { skipWindow = false } = {}) {
  const state = await P.getState(userId);
  const v = skipWindow ? LG.validateExtra(body, state.today, { windowDays: 400 }) : LG.validateExtra(body, state.today);
  const { rows } = await pool.query(
    `INSERT INTO fitness_session_logs ("userId","plannedSessionId","loggedOn",status,title,domain,"actualMinutes",effort,note,safety)
     VALUES ($1,NULL,$2,'done',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [userId, v.loggedOn, v.title, v.domain, v.actualMinutes, v.effort, v.note, (() => { const sf = checkNotes(v.note); return sf.flags.length ? JSON.stringify(sf) : null; })()],
  );
  return { id: rows[0].id, safety: checkNotes(v.note) };
}

async function deleteExtra(userId, logId) {
  const { rowCount } = await pool.query('DELETE FROM fitness_session_logs WHERE id=$1 AND "userId"=$2 AND "plannedSessionId" IS NULL', [logId, userId]);
  if (!rowCount) { const e = new Error('Log not found'); e.status = 404; throw e; }
}

/** Recent logs (planned or extra), newest first, for the history tiles. */
async function listLogs(userId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, "plannedSessionId", to_char("loggedOn",'YYYY-MM-DD') AS "loggedOn", status, title, activity, domain,
            "plannedMinutes", "actualMinutes", effort, note
       FROM fitness_session_logs WHERE "userId"=$1 ORDER BY "loggedOn" DESC, id DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 20, 1), 100)],
  );
  return rows.map((r) => ({ ...r, extra: r.plannedSessionId == null }));
}

/** Planned sessions still waiting to be logged, within the back-fill window. */
async function catchUp(userId) {
  const state = await P.getState(userId);
  const oldest = Ph.mondayOf(Ph.addDays(state.today, -LG.BACKFILL_DAYS));
  const { rows } = await pool.query(
    `SELECT s.id, s.day, s.slot, s.kind, s.title, s.components, s.status, s."plannedMinutes", s."warmupMin", s."cooldownMin",
            to_char(w."weekStart",'YYYY-MM-DD') AS "weekStart"
       FROM fitness_planned_sessions s JOIN fitness_weeks w ON w.id = s."weekId"
      WHERE s."userId"=$1 AND w."weekStart" >= $2 AND s.status IN ('planned','moved')`,
    [userId, oldest],
  );
  const withDates = rows.map((r) => ({ ...r, date: Ph.addDays(r.weekStart, r.day), components: parse(r.components, []), totalMinutes: r.plannedMinutes + r.warmupMin + r.cooldownMin }));
  return { today: state.today, sessions: LG.catchUpList(withDates, state.today) };
}

// ── weight (shared table health_weight_log; one weigh-in a day from this app) ──

async function logWeight(userId, { weightKg, date }) {
  const state = await P.getState(userId);
  const kg = Number(weightKg);
  if (!Number.isFinite(kg) || kg < 30 || kg > 300) throw new LG.LogError('Weight must be between 30 and 300 kg');
  const on = date || state.today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > state.today || on < Ph.addDays(state.today, -365)) throw new LG.LogError('That date does not look right');
  await pool.query(`DELETE FROM health_weight_log WHERE "userId"=$1 AND "measuredOn"=$2 AND source='fitness'`, [userId, on]);
  await pool.query(
    `INSERT INTO health_weight_log ("userId","weightKg","measuredOn",source) VALUES ($1,$2,$3,'fitness')`,
    [userId, Math.round(kg * 10) / 10, on],
  );
  return getWeights(userId);
}

async function getWeights(userId, limit = 12) {
  const { rows } = await pool.query(
    `SELECT "weightKg"::float AS "weightKg", to_char("measuredOn",'YYYY-MM-DD') AS "measuredOn", source
       FROM health_weight_log WHERE "userId"=$1 ORDER BY "measuredOn" DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

// ── small remembered preferences (cross-device) ──

const PREF_KEYS = {
  weightPrompt: (v) => typeof v === 'boolean',
  weightPromptDismissedFor: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  logDetailOpen: (v) => v && typeof v === 'object' && Object.values(v).every((x) => typeof x === 'boolean'),
};

async function setPrefs(userId, patch) {
  const { rows } = await pool.query('SELECT prefs FROM fitness_profiles WHERE "userId"=$1', [userId]);
  if (!rows[0]) throw new ValidationError('Finish your profile first');
  const prefs = parse(rows[0].prefs, {});
  for (const [k, v] of Object.entries(patch || {})) {
    if (!PREF_KEYS[k] || !PREF_KEYS[k](v)) throw new ValidationError(`Unknown preference: ${k}`);
    prefs[k] = k === 'logDetailOpen' ? { ...(prefs.logDetailOpen || {}), ...v } : v;
  }
  await pool.query('UPDATE fitness_profiles SET prefs=$2, "updatedAt"=NOW() WHERE "userId"=$1', [userId, JSON.stringify(prefs)]);
  return prefs;
}

module.exports = { logSession, undoLog, logExtra, deleteExtra, listLogs, catchUp, logWeight, getWeights, setPrefs };
