'use strict';

/**
 * Weekly progression rules. Pure code so volume can never jump, whatever the model says.
 *  - Blocks are 5 weeks: weeks 1-4 build, week 5 is a deload.
 *  - Aerobic minutes rise by at most about 10% a week (or 15 minutes, whichever is larger, so someone starting from
 *    nothing can still begin) measured against the last BUILD week, never the deload.
 *  - Deload week: 70% of the last build week's aerobic minutes, easier variations.
 *  - "Ease my first weeks" (opt-in after a safety prompt): the first two weeks of a goal run at 80%, easier variations.
 */

const BLOCK_WEEKS = 5;
const MAX_WEEKLY_INCREASE = 0.10;
const MIN_STEP_MINUTES = 15;
const DELOAD_FACTOR = 0.7;
const EASE_FACTOR = 0.8;
const EASE_WEEKS = 2;
// A sensible, gentle week of cardio (for example three 15-20 minute walks). The yearly path alone would start near zero for
// someone who is not exercising, so the early blocks never sit below this (unless the year's own target is lower).
const STARTER_MINUTES = 60;
// With no earlier week to measure against, the first week adds at most 30 minutes to what the person already does (45 minimum).
const firstWeekCap = (currentMinutes) => Math.max((currentMinutes || 0) + 30, 45);

const round5 = (n) => Math.round(n / 5) * 5;

/** The most aerobic minutes allowed this week given last build week's minutes. */
function maxAllowed(prevBuildMinutes) {
  if (prevBuildMinutes == null) return Infinity;
  return Math.max(Math.round(prevBuildMinutes * (1 + MAX_WEEKLY_INCREASE)), prevBuildMinutes + MIN_STEP_MINUTES);
}

function capIncrease(prevBuildMinutes, proposed) {
  return Math.min(proposed, maxAllowed(prevBuildMinutes));
}

/**
 * @param {object} p
 * @param {number} p.blockWeek        1..5
 * @param {number} p.aerobicStart     block target at the start of the block (minutes)
 * @param {number} p.aerobicEnd       block target at the end of the block
 * @param {number|null} p.prevBuild   aerobic minutes of the last build week, or null for the very first week
 * @param {number} p.firstWeekFloor   gentle starting point when there is no previous week (e.g. current weekly minutes)
 * @param {boolean} p.eased           inside the ease window
 */
function aerobicForWeek({ blockWeek, aerobicStart, aerobicEnd, prevBuild, firstWeekFloor, eased }) {
  if (blockWeek === BLOCK_WEEKS) {
    const base = prevBuild ?? aerobicStart;
    return { minutes: round5(base * DELOAD_FACTOR), isBuild: false };
  }
  const k = Math.min(Math.max(blockWeek, 1), BLOCK_WEEKS - 1);
  let m = aerobicStart + ((aerobicEnd - aerobicStart) * (k - 1)) / (BLOCK_WEEKS - 2);
  if (prevBuild == null) m = Math.min(m, firstWeekCap(firstWeekFloor));
  m = capIncrease(prevBuild, m);
  if (eased) m *= EASE_FACTOR;
  return { minutes: round5(Math.max(0, m)), isBuild: true };
}

module.exports = {
  BLOCK_WEEKS, MAX_WEEKLY_INCREASE, MIN_STEP_MINUTES, DELOAD_FACTOR, EASE_FACTOR, EASE_WEEKS, STARTER_MINUTES, firstWeekCap,
  maxAllowed, capIncrease, aerobicForWeek, round5,
};
