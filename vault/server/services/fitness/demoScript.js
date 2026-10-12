'use strict';

/**
 * The made-up history for the staging demo user: four past weeks, mixed on purpose, so the reflection, the history, the
 * weekly totals and the day colours all have something real to show. Pure data and rules; demoSeed.js applies it.
 *
 * Outcomes are given by KIND of session (strength, cardio, any), not by position, so a lighter week still gets them:
 * Week 0 (oldest): every session done, comfortable.
 * Week 1: one partly done (cut short, a note), one rest taken, the rest done.
 * Week 2: one "didn't do it", one swapped for a swim, a strength session with a note about knee pain, plus an extra walk.
 * Week 3 (last week): done, a little harder, weights up a kilogram; plus some active chores.
 */

const L = require('./library');

const WEEKS = 4;

// `pick` chooses which still-unassigned session gets the outcome: 'strength' | 'cardio' | 'first' | 'second' | 'last' | 'any'.
// Everything not listed is "done" with the effort taken from `efforts` in date order.
const WEEK_PLANS = [
  { efforts: [4, 5, 4, 5, 4], specials: [] },
  {
    efforts: [5, 5, 4, 5, 4],
    specials: [
      { pick: 'second', status: 'partial', effort: 6, minutes: 20, note: 'Cut it short, a busy morning.' },
      { pick: 'last', status: 'rest', note: 'Slept badly. Took it easy.' },
    ],
  },
  {
    efforts: [5, 5, 5, 5, 5],
    specials: [
      { pick: 'strength', status: 'done', effort: 6, note: 'Left knee pain on stairs afterwards.' },
      { pick: 'cardio', status: 'swapped', effort: 5, minutes: 40, activity: 'Swam instead of the ride' },
      { pick: 'last', status: 'skipped' },
    ],
  },
  { efforts: [6, 7, 5, 7, 6], specials: [] },
];

// Something done that was not planned: [week, day offset from Monday, what, minutes, effort, domain]
const EXTRAS = [
  [2, 4, 'Long walk with a friend', 45, 3, 'cardio'],
  [3, 5, 'Gardening or active chores', 30, 3, 'cardio'],
];

// Weigh-ins on the Sunday of each week.
const WEIGHTS = [86.0, 85.6, 85.3, 85.0];

const hasDomain = (s, d) => (s.components || []).some((c) => c.domain === d);

/**
 * The log to apply to each session of a demo week, in the same order as `sessions` (which must be in date order).
 * @returns {object[]} one script per session: { status, effort?, minutes?, note?, activity? }
 */
function assignWeek(sessions, weekIdx) {
  const plan = WEEK_PLANS[weekIdx % WEEK_PLANS.length];
  const out = new Array(sessions.length).fill(null);
  const free = () => sessions.map((_, i) => i).filter((i) => out[i] == null);
  const choose = (pick) => {
    const open = free();
    if (!open.length) return -1;
    const byKind = (d) => open.find((i) => hasDomain(sessions[i], d));
    const rules = {
      strength: () => byKind('strength'),
      cardio: () => open.find((i) => hasDomain(sessions[i], 'cardio')),
      first: () => open[0],
      second: () => open[1] ?? open[0],
      last: () => open[open.length - 1],
      any: () => open[0],
    };
    return (rules[pick] || rules.any)() ?? open[0];
  };
  for (const sp of plan.specials) {
    const i = choose(sp.pick);
    if (i >= 0) { const { pick, ...rest } = sp; void pick; out[i] = rest; }
  }
  let e = 0;
  for (let i = 0; i < sessions.length; i += 1) {
    if (out[i] == null) { out[i] = { status: 'done', effort: plan.efforts[e % plan.efforts.length] }; e += 1; }
  }
  return out;
}

/** Kilograms for a loaded exercise, rising a kilogram from the third week. */
function weightFor(weekIdx) {
  return weekIdx >= 2 ? 7 : 6;
}

/** The log body for one session, from its demo outcome and what the session actually contains. */
function bodyFor(script, session, weekIdx) {
  const lib = L.getLibrary().bySlug;
  const body = { status: script.status, note: script.note || null };
  if (script.status === 'rest' || script.status === 'skipped') return body;
  body.actualMinutes = script.minutes ?? session.totalMinutes;
  body.effort = script.effort ?? null;
  if (script.activity) body.activity = script.activity;
  // exercise detail for the main work: the plan's own sets and reps, and a weight where the exercise is loaded
  if (script.status === 'done') {
    body.exercises = session.exercises.filter((x) => x.block === 'main').map((x) => ({
      position: x.position,
      sets: x.prefill?.sets ?? null,
      reps: x.prefill?.reps ?? null,
      seconds: x.prefill?.seconds ?? null,
      weightKg: lib.get(x.slug)?.loadGuide && x.prefill?.kind === 'reps' ? weightFor(weekIdx) : null,
    }));
  }
  return body;
}

module.exports = { WEEKS, WEEK_PLANS, EXTRAS, WEIGHTS, assignWeek, weightFor, bodyFor };
