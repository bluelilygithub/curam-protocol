'use strict';

/**
 * Tips after a session, the weekly reflection, and the "keep next week gentle" confirmation.
 * The wording comes from the model chosen in Settings (light tier) with the rule-based text as the fallback (coaching.js).
 * Everything is scoped by "userId".
 */

const { pool } = require('../../db');
const P = require('./profileService');
const Ph = require('./phases');
const C = require('./coaching');
const W = require('./weekService');
const { runJson, hashInput, GUARDRAILS } = require('./ai');

const { ValidationError } = P;
const parse = (v, fb) => (v == null ? fb : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return fb; } })() : v);
const TIP_TIMEOUT_MS = 15000;

/** Tips for one logged session. Stored on the log, so they appear again whenever the session is opened. */
async function tipsForSession(userId, sessionId) {
  const { rows } = await pool.query(
    `SELECT l.id, l.status, l.effort, l."actualMinutes", l."plannedMinutes", l.note, l.tips, l."tipsSource", l."tipsNote"
       FROM fitness_session_logs l WHERE l."plannedSessionId"=$1 AND l."userId"=$2`,
    [sessionId, userId],
  );
  const log = rows[0];
  if (!log) throw new ValidationError('Log the session first');
  if (!C.TIP_STATUSES.has(log.status)) return { tips: [], source: 'none' };
  if (log.tips) return { tips: parse(log.tips, []), source: log.tipsSource || 'stored', note: log.tipsNote || null };

  const { rows: ex } = await pool.query(
    `SELECT e.slug, e.block, e.sets, e.reps, e."weightKg"::float AS "weightKg"
       FROM fitness_exercise_logs e WHERE e."sessionLogId"=$1 AND e."userId"=$2 ORDER BY e.position`,
    [log.id, userId],
  );
  // what each lifted exercise weighed the time before
  const prev = new Map();
  if (ex.length) {
    const { rows: before } = await pool.query(
      `SELECT DISTINCT ON (slug) slug, "weightKg"::float AS w FROM fitness_exercise_logs
        WHERE "userId"=$1 AND slug = ANY($2::text[]) AND "weightKg" IS NOT NULL AND "sessionLogId" <> $3 ORDER BY slug, id DESC`,
      [userId, ex.map((e) => e.slug), log.id],
    );
    for (const b of before) prev.set(b.slug, b.w);
  }
  // exercises the person did not detail still count: use the plan's main exercises so a form cue is possible
  let exercises = ex.map((e) => ({ ...e, prevWeightKg: prev.get(e.slug) ?? null }));
  if (!exercises.length) {
    const { rows: planned } = await pool.query(`SELECT slug, block FROM fitness_planned_exercises WHERE "sessionId"=$1 AND "userId"=$2 AND block='main' ORDER BY position`, [sessionId, userId]);
    exercises = planned.map((p) => ({ slug: p.slug, block: 'main', weightKg: null, prevWeightKg: null, sets: null, reps: null }));
  }

  const state = await P.getState(userId);
  const ctx = { status: log.status, effort: log.effort, exercises, steps: state.lifestyle?.dumbbellKg || [] };
  const facts = C.tipFacts(ctx);
  const input = {
    kind: 'session-tips',
    status: log.status,
    effort: log.effort,
    minutes: { planned: log.plannedMinutes, actual: log.actualMinutes },
    exercises: facts,
    note: log.note || null,
  };
  const system = `${GUARDRAILS}\nYou write one or two very short, practical tips for next time, about THIS session only. Each tip is one sentence. Use only the exercise names and facts given. If effort is 9 or 10, suggest the easier version when one is given. If a weight is given and effort is 5 or less, you may suggest a small increase; if effort is 8 or more, suggest staying put. A form cue must come from "commonMistake". Never mention what was not done.`;
  const prompt = `Write the tips.\n\nDATA:\n${JSON.stringify(input)}\n\nReturn JSON:\n{"tips": [string, string]}`;
  const res = await runJson({
    userId, kind: 'tips', input, system, prompt, validate: C.validateTips,
    fallback: () => ({ tips: C.ruleTips(ctx, log.id) }), tier: 'light', maxTokens: 500, timeoutMs: TIP_TIMEOUT_MS,
  });
  const tips = res.value.tips;
  // keep why a tip is plain (no model set, or the model's reply was not usable) so the screen can say so
  await pool.query(
    'UPDATE fitness_session_logs SET tips=$3, "tipsSource"=$4, "tipsNote"=$5 WHERE id=$1 AND "userId"=$2',
    [log.id, userId, JSON.stringify(tips), res.source, res.note || null],
  );
  return { tips, source: res.source, note: res.note || null };
}

/** A short look back at a finished week. Null when nothing was logged in it. */
async function reflectionForWeek(userId, weekStart, { refresh = false } = {}) {
  const state = await P.getState(userId);
  const start = Ph.mondayOf(weekStart);
  if (start >= Ph.mondayOf(state.today)) throw new ValidationError('A reflection looks back, so it starts once the week is over');
  const week = await W.getWeek(userId, start);
  if (!week.exists) return { reflection: null };
  const facts = C.reflectionFacts(week);
  if (!facts.sessionsLogged && !facts.extras) return { reflection: null };

  const hash = hashInput(facts);
  const { rows } = await pool.query(
    `SELECT reflection, "reflectionHash" FROM fitness_weeks WHERE "userId"=$1 AND "weekStart"=$2`, [userId, start],
  );
  if (!refresh && rows[0]?.reflection && rows[0].reflectionHash === hash) return { reflection: rows[0].reflection, weekStart: start };

  const system = `${GUARDRAILS}\nYou write a two or three sentence reflection on one finished week of a personal fitness program, using only the facts given. Be warm and plain. Mention what was done and one gentle thing to carry forward. Never mention anything that was not done, and do not use the words skipped, missed, failed or behind. Rest is a good thing.`;
  const prompt = `Reflect on the week.\n\nDATA:\n${JSON.stringify(facts)}\n\nReturn JSON:\n{"reflection": string (max 400 chars)}`;
  const res = await runJson({
    userId, kind: 'reflection', input: facts, system, prompt, validate: C.validateReflection,
    fallback: () => ({ reflection: C.reflectionFallback(facts) }), tier: 'light', maxTokens: 500, timeoutMs: TIP_TIMEOUT_MS, refresh,
  });
  const text = res.value.reflection;
  if (text) await pool.query(`UPDATE fitness_weeks SET reflection=$3, "reflectionHash"=$4 WHERE "userId"=$1 AND "weekStart"=$2`, [userId, start, text, hash]);
  return { reflection: text, weekStart: start };
}

/**
 * The person said yes to a gentler next week (after a note about pain, dizziness or chest symptoms).
 * Never automatic. Sets the one week to ease and rebuilds it if it already exists and nothing in it has been done.
 */
async function easeNextWeek(userId) {
  const state = await P.getState(userId);
  const next = Ph.addDays(Ph.mondayOf(state.today), 7);
  const { rowCount } = await pool.query('UPDATE fitness_profiles SET "easeWeek"=$2, "updatedAt"=NOW() WHERE "userId"=$1', [userId, next]);
  if (!rowCount) throw new ValidationError('Finish your profile first');
  let rebuilt = false;
  try {
    const exists = await W.getWeek(userId, next);
    if (exists.exists) { await W.ensureWeek(userId, { start: next, refresh: true }); rebuilt = true; }
  } catch { /* a week that already has activity is left as it is */ }
  return { ok: true, easeWeek: next, rebuilt };
}

module.exports = { tipsForSession, reflectionForWeek, easeNextWeek };
