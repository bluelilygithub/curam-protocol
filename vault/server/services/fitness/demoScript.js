'use strict';

/**
 * The made-up history for the staging demo user, in three scenarios. Pure data and rules; demoSeed.js applies it.
 * Outcomes are given by KIND of session (strength, cardio, any), not by position, so a lighter week still gets them.
 *
 *  mixed (12 past weeks, so every dashboard chart has data): eight lead-in weeks of mostly done with the odd partly done, rest or
 *    "didn't do it" (no notes), then four weeks with the full mix. First of those four: every session done, comfortable. Next: one
 *    partly done (a note), one rest taken. Next: one "didn't do it", one swapped for a swim, a strength session with a note about
 *    knee pain, plus an extra walk. Last week: done, a little harder.
 *  easy (7 past weeks): every session done at effort 3-4 throughout. Block weeks 1-4 build, 5 is a deload, 6-7 build, so the
 *    week being made now (a building week) steps up: shows the "nudge up" and its wording.
 *  tough (7 past weeks): normal until the last two building weeks, which are all done at effort 8-9. The week being made now eases:
 *    shows the "lighter week" wording.
 */

const L = require('./library');

const SCENARIOS = ['mixed', 'easy', 'tough'];
const WEEKS_BY_SCENARIO = { mixed: 12, easy: 7, tough: 7 };
const LEAD_IN = 8; // the mixed scenario's quieter weeks before the four with the full mix
const WEEKS = WEEKS_BY_SCENARIO.mixed; // kept for older callers

const ALL_DONE = (efforts) => ({ efforts, specials: [] });

// `pick` chooses which still-unassigned session gets the outcome: 'strength' | 'cardio' | 'first' | 'second' | 'last' | 'any'.
// Everything not listed is "done" with the effort taken from `efforts` in date order.
// Eight lead-in weeks: mostly done, effort drifting up, the odd partly done / rest / "didn't do it", never a note.
const LEAD_IN_PLANS = [
  ALL_DONE([5, 5, 6, 5, 5]),
  ALL_DONE([5, 6, 5, 5, 6]),
  { efforts: [5, 5, 5, 5, 5], specials: [{ pick: 'second', status: 'partial', effort: 6, minutes: 20 }] },
  ALL_DONE([5, 5, 6, 5, 6]),
  { efforts: [5, 5, 5, 5, 5], specials: [{ pick: 'last', status: 'rest' }] },
  ALL_DONE([4, 5, 5, 4, 5]), // a deload week in the plan
  { efforts: [5, 5, 6, 5, 5], specials: [{ pick: 'last', status: 'skipped' }] },
  ALL_DONE([5, 6, 5, 6, 5]),
];

const PLANS = {
  mixed: [
    ...LEAD_IN_PLANS,
    ALL_DONE([4, 5, 4, 5, 4]),
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
    ALL_DONE([6, 7, 5, 7, 6]),
  ],
  easy: Array.from({ length: 7 }, () => ALL_DONE([3, 4, 3, 4, 3])),
  tough: [
    ALL_DONE([5, 5, 4, 5, 5]),
    ALL_DONE([5, 6, 5, 5, 6]),
    ALL_DONE([5, 5, 5, 6, 5]),
    ALL_DONE([6, 5, 6, 5, 6]),
    ALL_DONE([4, 4, 3, 4, 4]), // the deload week
    ALL_DONE([8, 9, 8, 8, 9]),
    ALL_DONE([9, 8, 9, 8, 8]),
  ],
};
const WEEK_PLANS = PLANS.mixed; // kept for older callers

// Something done that was not planned (mixed scenario only): [week, day offset from Monday, what, minutes, effort, domain]
const EXTRAS = [
  [LEAD_IN + 2, 4, 'Long walk with a friend', 45, 3, 'cardio'],
  [LEAD_IN + 3, 5, 'Gardening or active chores', 30, 3, 'cardio'],
];

// Weigh-ins on the Sunday of each week.
const WEIGHTS = [87.4, 87.1, 86.8, 86.6, 86.3, 86.0, 85.6, 85.3, 85.0, 84.8, 84.7, 84.5];

const hasDomain = (s, d) => (s.components || []).some((c) => c.domain === d);

/**
 * The log to apply to each session of a demo week, in the same order as `sessions` (which must be in date order).
 * @returns {object[]} one script per session: { status, effort?, minutes?, note?, activity? }
 */
function assignWeek(sessions, weekIdx, scenario = 'mixed') {
  const plans = PLANS[scenario] || PLANS.mixed;
  const plan = plans[weekIdx % plans.length];
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
  return weekIdx >= LEAD_IN ? 8 : weekIdx >= 3 ? 7 : 6;
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

module.exports = { LEAD_IN, SCENARIOS, WEEKS_BY_SCENARIO, WEEKS, PLANS, WEEK_PLANS, EXTRAS, WEIGHTS, assignWeek, weightFor, bodyFor };
