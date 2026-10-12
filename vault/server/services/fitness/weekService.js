'use strict';

/**
 * Weeks, sessions and rest, stored per user. Everything is scoped by "userId". The week the person is in (and the next one)
 * is created on demand; past weeks are only ever read. Regenerating is refused once any session has been acted on.
 */

const { pool } = require('../../db');
const L = require('./library');
const S = require('./schedule');
const Ph = require('./phases');
const P = require('./profileService');
const { generateWeekPlan } = require('./weekGenerator');
const { sessionSafetyLines } = require('./safety');

const { ValidationError } = P;
const EDITABLE = new Set(['planned', 'moved']);

const parse = (v, fb) => (v == null ? fb : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return fb; } })() : v);
const sumMinutes = (components) => components.reduce((n, c) => n + c.minutes, 0);

async function loadWeekRow(userId, weekStart) {
  const { rows } = await pool.query(
    `SELECT id, "goalId", to_char("weekStart",'YYYY-MM-DD') AS "weekStart", "blockIndex", "blockWeek", phase, "isDeload", eased,
            targets, "restBudget", "restDays", "weekNote", notes, "generatedBy", model, generation
       FROM fitness_weeks WHERE "userId"=$1 AND "weekStart"=$2`,
    [userId, weekStart],
  );
  return rows[0] || null;
}

async function loadSessions(weekId, userId) {
  const { rows: sess } = await pool.query(
    `SELECT id, "sessionKey", day, slot, kind, "kindIndex", title, components, "plannedMinutes", "warmupMin", "cooldownMin",
            outdoor, status, "movedFrom"
       FROM fitness_planned_sessions WHERE "weekId"=$1 AND "userId"=$2 ORDER BY day, id`,
    [weekId, userId],
  );
  const { rows: ex } = await pool.query(
    `SELECT "sessionId", block, position, slug, pattern, nth, prescription
       FROM fitness_planned_exercises WHERE "userId"=$1 AND "sessionId" = ANY($2::int[]) ORDER BY "sessionId", position`,
    [userId, sess.map((s) => s.id)],
  );
  const lib = L.getLibrary().bySlug;
  const bySession = new Map();
  for (const e of ex) {
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId).push({ ...e, name: lib.get(e.slug)?.name || e.slug });
  }
  const order = { morning: 0, midday: 1, evening: 2 };
  return sess
    .map((s) => ({
      ...s,
      components: parse(s.components, []),
      movedFrom: parse(s.movedFrom, null),
      totalMinutes: s.plannedMinutes + s.warmupMin + s.cooldownMin,
      exercises: bySession.get(s.id) || [],
    }))
    .sort((a, b) => a.day - b.day || order[a.slot] - order[b.slot] || a.id - b.id);
}

async function loadHidden(userId) {
  const { rows } = await pool.query('SELECT slug FROM fitness_hidden_exercises WHERE "userId"=$1', [userId]);
  return new Set(rows.map((r) => r.slug));
}

async function setHidden(userId, slug, hidden) {
  if (!L.getLibrary().bySlug.has(slug)) { const e = new Error('Exercise not found'); e.status = 404; throw e; }
  if (hidden) {
    await pool.query('INSERT INTO fitness_hidden_exercises ("userId", slug) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, slug]);
  } else {
    await pool.query('DELETE FROM fitness_hidden_exercises WHERE "userId"=$1 AND slug=$2', [userId, slug]);
  }
  return loadHidden(userId);
}

/** How many earlier weeks each exercise has been in the main work (for gates). */
async function loadExposure(userId, weekStart) {
  const { rows } = await pool.query(
    `SELECT e.slug, COUNT(DISTINCT s."weekId")::int AS weeks
       FROM fitness_planned_exercises e
       JOIN fitness_planned_sessions s ON s.id = e."sessionId"
       JOIN fitness_weeks w ON w.id = s."weekId"
      WHERE e."userId"=$1 AND e.block='main' AND w."weekStart" < $2
      GROUP BY e.slug`,
    [userId, weekStart],
  );
  return new Map(rows.map((r) => [r.slug, r.weeks]));
}

function shapeWeek(row, sessions, state) {
  const restDays = parse(row.restDays, []);
  const spent = restDays.filter((r) => r.kind === 'budget').length;
  const timezone = state.timezone.timezone;
  const hot = S.isHotMonth(row.weekStart, timezone);
  const lib = L.getLibrary().bySlug;
  for (const s of sessions) s.safety = sessionSafetyLines(s, lib, timezone);
  const soft = S.softNotes(
    sessions.map((s) => ({ ...s, strength: s.components.some((c) => c.domain === 'strength') })),
    { hotOutdoor: hot },
  );
  return {
    exists: true,
    week: {
      id: row.id,
      weekStart: row.weekStart,
      weekEnd: Ph.addDays(row.weekStart, 6),
      blockIndex: row.blockIndex,
      blockWeek: row.blockWeek,
      blockWeeks: 5,
      phase: parse(row.phase, {}),
      isDeload: row.isDeload,
      eased: row.eased,
      targets: parse(row.targets, {}),
      restBudget: row.restBudget,
      restBudgetUsed: spent,
      restDays,
      weekNote: row.weekNote,
      generatedBy: row.generatedBy,
      notes: parse(row.notes, []),
    },
    sessions,
    softNotes: soft,
    today: state.today,
    todayIndex: Ph.dayOfWeek(state.today),
    currentWeekStart: Ph.mondayOf(state.today),
  };
}

async function getWeek(userId, start) {
  const state = await P.getState(userId);
  const weekStart = Ph.mondayOf(start || state.today);
  const row = await loadWeekRow(userId, weekStart);
  const current = Ph.mondayOf(state.today);
  if (!row) {
    return { exists: false, weekStart, today: state.today, currentWeekStart: current, canGenerate: weekStart === current || weekStart === Ph.addDays(current, 7) };
  }
  return shapeWeek(row, await loadSessions(row.id, userId), state);
}

/** Last two weeks' exercises, for rotation. */
async function loadHistory(userId, weekStart) {
  const from = Ph.addDays(weekStart, -14);
  const { rows } = await pool.query(
    `SELECT w.id, to_char(w."weekStart",'YYYY-MM-DD') AS "weekStart" FROM fitness_weeks w
      WHERE w."userId"=$1 AND w."weekStart" >= $2 AND w."weekStart" < $3 ORDER BY w."weekStart" DESC`,
    [userId, from, weekStart],
  );
  const weeks = [];
  for (const w of rows) {
    const sessions = await loadSessions(w.id, userId);
    weeks.push({
      weeksAgo: Ph.weeksBetween(w.weekStart, weekStart),
      sessions: sessions.map((s) => ({
        kind: s.kind, kindIndex: s.kindIndex,
        exercises: s.exercises.map((e) => ({ block: e.block, slug: e.slug, pattern: e.pattern, nth: e.nth })),
      })),
    });
  }
  return { weeks };
}

async function previousBuildMinutes(userId, weekStart) {
  const { rows } = await pool.query(
    `SELECT targets FROM fitness_weeks WHERE "userId"=$1 AND "weekStart" < $2 AND "isDeload"=FALSE ORDER BY "weekStart" DESC LIMIT 1`,
    [userId, weekStart],
  );
  return rows[0] ? parse(rows[0].targets, {}).aerobicMinutes ?? null : null;
}

/** Create (or, on request, rebuild) the week. Returns the shaped week. */
async function ensureWeek(userId, { start, refresh = false } = {}) {
  const inp = await P.getPlanningInputs(userId);
  const { state } = inp;
  const goal = state.goal;
  if (!goal) throw new ValidationError('Set your 5-year goal first');
  const current = Ph.mondayOf(state.today);
  const weekStart = Ph.mondayOf(start || state.today);
  if (weekStart !== current && weekStart !== Ph.addDays(current, 7)) throw new ValidationError('Weeks are created for this week and next week only');

  const existing = await loadWeekRow(userId, weekStart);
  if (existing && !refresh) return shapeWeek(existing, await loadSessions(existing.id, userId), state);
  if (existing) {
    const acted = (await loadSessions(existing.id, userId)).some((s) => !EDITABLE.has(s.status));
    if (acted) throw new ValidationError('This week already has activity, so it is kept as it is.');
  }

  const info = Ph.targetsForWeek({
    goal, weekStart,
    prevBuildMinutes: await previousBuildMinutes(userId, weekStart),
    easeRequested: !!state.lifestyle?.easeRequested,
    currentMinutes: state.lifestyle?.weeklyMinutes ?? 0,
  });
  const generation = existing ? existing.generation + 1 : 0;
  const plan = await generateWeekPlan({
    userId, weekStart, info, generation, refresh: !!refresh, timezone: state.timezone.timezone,
    history: await loadHistory(userId, weekStart),
    person: {
      ratings: state.rating.scores,
      equipment: state.lifestyle.equipment,
      twiceDaily: !!state.lifestyle.timeFlexibility?.twiceDaily,
      workAround: inp.profile.workAround || null,
      hidden: await loadHidden(userId),
      exposure: await loadExposure(userId, weekStart),
      // an earlier, higher cardio rating stands in for "has run before" until we ask about running directly
      runningHistory: (state.rating.previousScores?.cardio ?? 0) >= 4,
    },
  });

  const client = await pool.connect();
  let weekId;
  try {
    await client.query('BEGIN');
    if (existing) {
      await client.query('DELETE FROM fitness_planned_sessions WHERE "weekId"=$1 AND "userId"=$2', [existing.id, userId]);
      await client.query(
        `UPDATE fitness_weeks SET "goalId"=$3, "blockIndex"=$4, "blockWeek"=$5, phase=$6, "isDeload"=$7, eased=$8, targets=$9,
                "restDays"=$10, "weekNote"=$11, notes=$12, "generatedBy"=$13, model=$14, generation=$15, "updatedAt"=NOW()
          WHERE id=$1 AND "userId"=$2`,
        [existing.id, userId, goal.id, info.blockIndex, info.blockWeek, JSON.stringify(info.phase), info.isDeload, info.eased,
          JSON.stringify(info.targets), JSON.stringify(plan.restDays), plan.weekNote, JSON.stringify(plan.notes), plan.generatedBy, plan.model, generation],
      );
      weekId = existing.id;
    } else {
      const ins = await client.query(
        `INSERT INTO fitness_weeks ("userId","goalId","weekStart","blockIndex","blockWeek",phase,"isDeload",eased,targets,"restDays","weekNote",notes,"generatedBy",model,generation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [userId, goal.id, weekStart, info.blockIndex, info.blockWeek, JSON.stringify(info.phase), info.isDeload, info.eased,
          JSON.stringify(info.targets), JSON.stringify(plan.restDays), plan.weekNote, JSON.stringify(plan.notes), plan.generatedBy, plan.model, generation],
      );
      weekId = ins.rows[0].id;
    }
    for (const s of plan.sessions) {
      const si = await client.query(
        `INSERT INTO fitness_planned_sessions ("weekId","userId","sessionKey",day,slot,kind,"kindIndex",title,components,"plannedMinutes","warmupMin","cooldownMin",outdoor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [weekId, userId, s.key, s.day, s.slot, s.kind, s.kindIndex ?? 0, s.title, JSON.stringify(s.components), sumMinutes(s.components), s.warmupMin, s.cooldownMin, s.outdoor],
      );
      for (const e of s.exercises) {
        await client.query(
          `INSERT INTO fitness_planned_exercises ("sessionId","userId",block,position,slug,pattern,nth,prescription) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [si.rows[0].id, userId, e.block, e.position, e.slug, e.pattern, e.nth, e.prescription],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const row = await loadWeekRow(userId, weekStart);
  const out = shapeWeek(row, await loadSessions(weekId, userId), state);
  out.aiNote = plan.aiNote;
  return out;
}

async function ownedSession(userId, sessionId) {
  const { rows } = await pool.query(
    `SELECT s.id, s."weekId", s.day, s.slot, s.status, s."movedFrom", to_char(w."weekStart",'YYYY-MM-DD') AS "weekStart"
       FROM fitness_planned_sessions s JOIN fitness_weeks w ON w.id = s."weekId" WHERE s.id=$1 AND s."userId"=$2`,
    [sessionId, userId],
  );
  if (!rows[0]) { const e = new Error('Session not found'); e.status = 404; throw e; }
  return rows[0];
}

/** Move a session to another day/slot. Never blocked: soft notes come back with the week. */
async function moveSession(userId, sessionId, { day, slot }) {
  const s = await ownedSession(userId, sessionId);
  if (!EDITABLE.has(s.status) && s.status !== 'rest') throw new ValidationError('This session already has activity, so it stays where it is.');
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new ValidationError('Pick a day of the week');
  if (!S.SLOTS.includes(slot)) throw new ValidationError('Pick morning, midday or evening');
  const original = parse(s.movedFrom, null) || { day: s.day, slot: s.slot };
  const back = original.day === day && original.slot === slot;
  await pool.query(
    `UPDATE fitness_planned_sessions SET day=$3, slot=$4, status=$5, "movedFrom"=$6 WHERE id=$1 AND "userId"=$2`,
    [sessionId, userId, day, slot, back ? 'planned' : 'moved', back ? null : JSON.stringify(original)],
  );
  return getWeek(userId, s.weekStart);
}

/** Take a rest day (spends the flexible rest budget; allowed past it, shown neutrally). */
async function takeRestDay(userId, { weekStart, day }) {
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new ValidationError('Pick a day of the week');
  const state = await P.getState(userId);
  const row = await loadWeekRow(userId, Ph.mondayOf(weekStart || state.today));
  if (!row) throw new ValidationError('That week has not been created yet');
  const sessions = await loadSessions(row.id, userId);
  const restDays = parse(row.restDays, []);
  if (restDays.some((r) => r.day === day)) return getWeek(userId, row.weekStart);

  const current = Ph.mondayOf(state.today);
  const minDay = row.weekStart > current ? 0 : row.weekStart === current ? Ph.dayOfWeek(state.today) + 1 : 7;
  const plan = S.planRestDay({
    sessions: sessions.map((s) => ({ key: String(s.id), day: s.day, slot: s.slot, status: s.status, components: s.components })),
    day, restDays, minDay, twiceDaily: !!state.lifestyle?.timeFlexibility?.twiceDaily,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of plan.moves) {
      const s = sessions.find((x) => String(x.id) === m.key);
      await client.query(
        `UPDATE fitness_planned_sessions SET day=$3, slot=$4, status='moved', "movedFrom"=$5 WHERE id=$1 AND "userId"=$2`,
        [s.id, userId, m.day, m.slot, JSON.stringify(parse(s.movedFrom, null) || { day: s.day, slot: s.slot })],
      );
    }
    for (const key of plan.rested) {
      const s = sessions.find((x) => String(x.id) === key);
      await client.query(
        `UPDATE fitness_planned_sessions SET status='rest', "movedFrom"=$3 WHERE id=$1 AND "userId"=$2`,
        [s.id, userId, JSON.stringify(parse(s.movedFrom, null) || { day: s.day, slot: s.slot })],
      );
    }
    restDays.push({ day, kind: 'budget' });
    await client.query('UPDATE fitness_weeks SET "restDays"=$3, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2', [row.id, userId, JSON.stringify(restDays)]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const out = await getWeek(userId, row.weekStart);
  out.restResult = { moved: plan.moves.length, rested: plan.rested.length };
  return out;
}

/** Change of mind: put the day back. Sessions that were let go return to the day they started on. */
async function undoRestDay(userId, { weekStart, day }) {
  const state = await P.getState(userId);
  const row = await loadWeekRow(userId, Ph.mondayOf(weekStart || state.today));
  if (!row) throw new ValidationError('That week has not been created yet');
  const restDays = parse(row.restDays, []).filter((r) => !(r.day === day && r.kind === 'budget'));
  await pool.query('UPDATE fitness_weeks SET "restDays"=$3, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2', [row.id, userId, JSON.stringify(restDays)]);
  await pool.query(
    `UPDATE fitness_planned_sessions
        SET status='planned', day=COALESCE(("movedFrom"->>'day')::int, day), slot=COALESCE("movedFrom"->>'slot', slot), "movedFrom"=NULL
      WHERE "weekId"=$1 AND "userId"=$2 AND status='rest' AND ("movedFrom"->>'day')::int = $3`,
    [row.id, userId, day],
  );
  return getWeek(userId, row.weekStart);
}

async function getToday(userId) {
  const state = await P.getState(userId);
  const data = await getWeek(userId, state.today);
  if (!data.exists) return { ...data, sessions: [], dayIndex: Ph.dayOfWeek(state.today) };
  const dayIndex = data.todayIndex;
  const rest = data.week.restDays.find((r) => r.day === dayIndex) || null;
  return {
    ...data,
    dayIndex,
    sessions: data.sessions.filter((s) => s.day === dayIndex && s.status !== 'rest'),
    letGo: data.sessions.filter((s) => s.day === dayIndex && s.status === 'rest'),
    restDay: rest && !data.sessions.some((s) => s.day === dayIndex && s.status !== 'rest') ? rest : null,
  };
}

module.exports = { getWeek, ensureWeek, moveSession, takeRestDay, undoRestDay, getToday, loadHistory, loadHidden, setHidden, loadExposure };
