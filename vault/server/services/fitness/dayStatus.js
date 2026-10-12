'use strict';

/**
 * What a day (and a week) looks like once things are logged. Pure code, shared by the Week and Month views.
 *
 * Day states: done | partial | planned | skipped | rest | extra | none.
 *  - done:    every session that day is logged as done or swapped (swapped = did something else instead)
 *  - partial: some work logged, or a mix (partly done, or done and didn't-do-it), or only some sessions logged yet
 *  - planned: sessions waiting, none logged yet (neutral)
 *  - skipped: every session logged as "didn't do it" (neutral grey, never a failure)
 *  - rest:    a rest day (planned or flexible) or sessions logged as rest (calm, a good thing)
 *  - extra:   nothing planned but something else was done
 *  - none:    nothing planned, nothing logged
 */

const LOGGED = new Set(['done', 'partial', 'swapped', 'skipped']);
const DONE_LIKE = new Set(['done', 'swapped']);

function dayState({ sessions = [], restInfo = null, extras = [] }) {
  const live = sessions.filter((s) => s.status !== 'rest');
  if (!live.length) {
    if (restInfo || sessions.some((s) => s.status === 'rest')) return 'rest';
    return extras.length ? 'extra' : 'none';
  }
  const logged = live.filter((s) => LOGGED.has(s.status));
  if (!logged.length) return 'planned';
  if (logged.length < live.length) return 'partial';
  if (logged.every((s) => DONE_LIKE.has(s.status))) return 'done';
  if (logged.every((s) => s.status === 'skipped')) return 'skipped';
  return 'partial';
}

/**
 * What has been done so far this week, in the same units as the targets. Partly done counts as half; a swapped session counts
 * for what it was planned to be (the person did something instead); extras count for the kind of activity they were.
 * @returns {{ aerobicMinutes:number, strengthDays:number, balanceDays:number, mobilityDays:number }}
 */
function weekDone(sessions = [], extras = []) {
  let aerobic = 0;
  const days = { strength: new Map(), balance: new Map(), flexibility: new Map() };
  const bump = (domain, key, v) => { const m = days[domain]; if (m) m.set(key, Math.max(m.get(key) || 0, v)); };
  for (const s of sessions) {
    if (!(s.status === 'done' || s.status === 'swapped' || s.status === 'partial')) continue;
    const share = s.status === 'partial' ? 0.5 : 1;
    for (const c of s.components || []) {
      if (c.domain === 'cardio') aerobic += c.minutes * share;
      else bump(c.domain, `d${s.day}`, share);
    }
  }
  for (const x of extras) {
    if (x.domain === 'cardio' || !x.domain) aerobic += x.minutes || 0;
    else bump(x.domain, `x${x.date}`, 1);
  }
  const total = (m) => Math.round([...m.values()].reduce((n, v) => n + v, 0) * 2) / 2;
  return {
    aerobicMinutes: Math.round(aerobic),
    strengthDays: total(days.strength),
    balanceDays: total(days.balance),
    mobilityDays: total(days.flexibility),
  };
}

module.exports = { dayState, weekDone };
