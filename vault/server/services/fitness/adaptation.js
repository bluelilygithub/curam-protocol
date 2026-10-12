'use strict';

/**
 * Fitting the plan to how things are going. Pure code (no database, no AI), tested with exact thresholds.
 *
 * Looks at the finished weeks before the one being made and decides: nudge up, ease, or hold.
 *  - Only LOGGED sessions are counted. Done = 1, partly done = half, swapped = done (they did something instead),
 *    "didn't do it" = 0. Rest sessions, rest days and unlogged sessions are never counted: rest is not skipping.
 *  - A week needs at least half of its sessions logged to count at all, otherwise there is not enough to go on.
 *  - Deload weeks are skipped (they are light on purpose), and a deload week is never adapted.
 *  - Nudge up needs effort recorded on at least half the logged sessions: no information is not "easy".
 *  - Easing comes first if both apply, and a nudge waits three weeks after an ease.
 * The wording is about fitting the plan to life; it never mentions skipping.
 */

const { BANNED } = require('./coaching');

const { DEFAULTS } = require('./config');

const DEFAULT_RULES = DEFAULTS.adaptation;

const LOGGED = new Set(['done', 'partial', 'swapped', 'skipped']);
const DONE_LIKE = new Set(['done', 'partial', 'swapped']);

const MESSAGES = {
  easy_streak: 'The last few weeks have felt comfortable, so this week steps up a little.',
  low_done: 'The last couple of weeks looked busy, so this week is a bit lighter. Go at the pace your life allows.',
  high_effort: 'The last two weeks felt hard, so this week is a bit lighter to let you recover.',
};

/**
 * One finished week in a few numbers.
 * @param {{ sessions: { status:string, effort:number|null }[] }} week
 */
function summariseWeek(week, rules = DEFAULT_RULES) {
  const considered = week.sessions.filter((s) => s.status !== 'rest'); // rest is never counted either way
  const logged = considered.filter((s) => LOGGED.has(s.status));
  const coverage = considered.length ? logged.length / considered.length : 0;
  const doneScore = logged.reduce((n, s) => n + (s.status === 'done' || s.status === 'swapped' ? 1 : s.status === 'partial' ? 0.5 : 0), 0);
  const efforts = logged.filter((s) => DONE_LIKE.has(s.status) && s.effort != null).map((s) => s.effort);
  const doneLike = logged.filter((s) => DONE_LIKE.has(s.status));
  return {
    weekStart: week.weekStart || null,
    isDeload: !!week.isDeload,
    considered: considered.length,
    logged: logged.length,
    coverage,
    sufficient: coverage >= rules.minCoverage && logged.length > 0,
    doneShare: logged.length ? doneScore / logged.length : null,
    averageEffort: efforts.length ? efforts.reduce((a, b) => a + b, 0) / efforts.length : null,
    effortCoverage: doneLike.length ? efforts.length / doneLike.length : 0,
  };
}

/**
 * @param {object} p
 * @param {{ weekStart:string, isDeload:boolean, decision?:string|null, sessions:object[] }[]} p.weeks finished weeks before this one, oldest first
 * @param {boolean} p.isDeload whether the week being made is a deload week
 * @returns {{ decision:'nudge'|'ease'|'hold', reason:string, message:string|null, volumeFactor:number, levelDelta:number, metrics:object[] }}
 */
function decide({ weeks, isDeload = false }, rules = DEFAULT_RULES) {
  const hold = (reason, metrics = []) => ({ decision: 'hold', reason, message: null, volumeFactor: 1, levelDelta: 0, metrics });
  const summaries = weeks.map((w) => ({ ...summariseWeek(w, rules), decision: w.decision || null }));
  if (isDeload) return hold('deload');
  const builds = summaries.filter((s) => !s.isDeload);

  // easing first: two building weeks that felt hard, or two that were mostly not done
  const e = rules.ease;
  const lastE = builds.slice(-e.weeks);
  if (lastE.length === e.weeks && lastE.every((s) => s.sufficient)) {
    const hardWeeks = lastE.every((s) => s.averageEffort != null && s.averageEffort >= e.minEffort);
    const lightWeeks = lastE.every((s) => s.doneShare != null && s.doneShare < e.maxDone);
    if (hardWeeks || lightWeeks) {
      const reason = hardWeeks ? 'high_effort' : 'low_done';
      return { decision: 'ease', reason, message: MESSAGES[reason], volumeFactor: e.volumeFactor, levelDelta: e.levelDelta, floorOfLastBuild: e.floorOfLastBuild, metrics: lastE };
    }
  }

  // a nudge up: three building weeks, mostly done, comfortable, with effort actually recorded; and not soon after an ease
  const n = rules.nudge;
  const lastN = builds.slice(-n.weeks);
  const recent = summaries.slice(-n.quietWeeksAfterEase);
  const easedRecently = recent.some((s) => s.decision === 'ease');
  if (lastN.length === n.weeks && !easedRecently && lastN.every((s) => s.sufficient
    && s.doneShare >= n.minDone
    && s.averageEffort != null && s.averageEffort <= n.maxEffort
    && s.effortCoverage >= n.minEffortCoverage)) {
    return { decision: 'nudge', reason: 'easy_streak', message: MESSAGES.easy_streak, volumeFactor: n.volumeFactor, levelDelta: n.levelDelta, metrics: lastN };
  }

  const anySufficient = builds.some((s) => s.sufficient);
  return hold(anySufficient ? 'steady' : 'not_enough_to_go_on', builds.slice(-n.weeks));
}

/**
 * Applies a decision to a week's aerobic minutes. Safety limits always win: the 10% weekly step, the end-state target for the
 * person's age band (the largest year-end target in the goal), and never below 60% of the last build week when easing.
 */
function adjustAerobic(minutes, decision, { prevBuildMinutes = null, ceiling = Infinity } = {}) {
  const round5 = (v) => Math.round(v / 5) * 5;
  if (decision.decision === 'nudge') {
    const stepCap = prevBuildMinutes == null ? Infinity : Math.max(Math.round(prevBuildMinutes * 1.1), prevBuildMinutes + 15);
    return Math.min(round5(minutes * decision.volumeFactor), stepCap, ceiling);
  }
  if (decision.decision === 'ease') {
    const floor = prevBuildMinutes == null ? 0 : round5(prevBuildMinutes * (decision.floorOfLastBuild ?? 0.6));
    return Math.min(minutes, Math.max(round5(minutes * decision.volumeFactor), floor));
  }
  return minutes;
}

module.exports = { DEFAULT_RULES, MESSAGES, summariseWeek, decide, adjustAerobic, BANNED };
