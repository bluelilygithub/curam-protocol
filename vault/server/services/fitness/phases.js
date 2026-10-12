'use strict';

/**
 * Turns the 5-year goal into weeks. Pure: dates are 'YYYY-MM-DD' strings, weeks start on Monday.
 * Blocks are 5 weeks (4 building + a deload in week 5). Block targets come from interpolating the goal's yearly
 * milestones by date; each generated week stores a snapshot of its block, phase and targets.
 */

const P = require('./progression');
const { DEFAULTS } = require('./config');

const DAY_MS = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

function addDays(iso, n) {
  return fromMs(toMs(iso) + n * DAY_MS);
}

/** Monday = 0 ... Sunday = 6 */
function dayOfWeek(iso) {
  return (new Date(toMs(iso)).getUTCDay() + 6) % 7;
}

function mondayOf(iso) {
  return addDays(iso, -dayOfWeek(iso));
}

function weeksBetween(aIso, bIso) {
  return Math.floor((toMs(bIso) - toMs(aIso)) / (7 * DAY_MS));
}

/** Aerobic minutes the plan has reached on a date: straight line from the start through each year-end milestone. */
function aerobicAt(goal, iso) {
  const pts = [{ t: toMs(goal.startsOn), v: goal.summary?.startMinutes ?? 0 }];
  for (const m of goal.milestones) pts.push({ t: toMs(m.by), v: m.weekly.aerobicModerateMin });
  const t = toMs(iso);
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i += 1) {
    if (t <= pts[i].t) {
      const f = (t - pts[i - 1].t) / (pts[i].t - pts[i - 1].t);
      return pts[i - 1].v + (pts[i].v - pts[i - 1].v) * f;
    }
  }
  return pts[pts.length - 1].v;
}

/** The goal year (milestone) a date falls in; the last one after year 5. */
function milestoneAt(goal, iso) {
  const t = toMs(iso);
  return goal.milestones.find((m) => t <= toMs(m.by)) || goal.milestones[goal.milestones.length - 1];
}

/**
 * @param {object} goal    { startsOn, summary:{startMinutes}, milestones:[{by, phase, weekly}] }
 * @param {string} weekStart Monday 'YYYY-MM-DD'
 * @returns block position of that week
 */
function blockInfo(goal, weekStart) {
  const first = mondayOf(goal.startsOn);
  const since = Math.max(0, weeksBetween(first, weekStart));
  const blockIndex = Math.floor(since / P.BLOCK_WEEKS);
  const blockWeek = (since % P.BLOCK_WEEKS) + 1;
  const blockStart = addDays(first, blockIndex * P.BLOCK_WEEKS * 7);
  const blockEnd = addDays(blockStart, (P.BLOCK_WEEKS - 1) * 7);
  return { weeksSinceStart: since, blockIndex, blockWeek, isDeload: blockWeek === P.BLOCK_WEEKS, blockStart, blockEnd };
}

/**
 * Targets for one week.
 * @param {object} p
 * @param {object} p.goal
 * @param {string} p.weekStart
 * @param {number|null} p.prevBuildMinutes  aerobic minutes of the last build week already generated
 * @param {boolean} p.easeRequested          person confirmed gentler first weeks
 * @param {number} p.currentMinutes          entered weekly minutes (0 if unknown)
 */
function targetsForWeek({ goal, weekStart, prevBuildMinutes = null, easeRequested = false, easeWeek = null, currentMinutes = 0 }, cfg = DEFAULTS) {
  void cfg;
  const info = blockInfo(goal, weekStart);
  const ms = milestoneAt(goal, weekStart);
  // Gentler weeks the person agreed to: the first weeks if they asked at the start, and the one week they confirmed after a note.
  const eased = (!!easeRequested && info.weeksSinceStart < P.EASE_WEEKS) || (easeWeek != null && easeWeek === weekStart);
  const floor = Math.min(P.STARTER_MINUTES, ms.weekly.aerobicModerateMin);
  const aerobic = P.aerobicForWeek({
    blockWeek: info.blockWeek,
    aerobicStart: Math.max(floor, aerobicAt(goal, info.blockStart)),
    aerobicEnd: Math.max(floor, aerobicAt(goal, info.blockEnd)),
    prevBuild: prevBuildMinutes,
    firstWeekFloor: currentMinutes,
    eased,
  });
  const days = ms.weekly;
  const strengthDays = info.isDeload && days.strengthDays >= 3 ? days.strengthDays - 1 : days.strengthDays;
  return {
    ...info,
    eased,
    easier: eased || info.isDeload,
    phase: ms.phase || { id: 'build', label: 'Build', focus: '' },
    goalYear: ms.year,
    targets: {
      aerobicMinutes: aerobic.minutes,
      strengthDays,
      balanceDays: days.balanceDays,
      mobilityDays: days.mobilityDays,
    },
    isBuild: aerobic.isBuild,
  };
}

module.exports = { addDays, dayOfWeek, mondayOf, weeksBetween, aerobicAt, milestoneAt, blockInfo, targetsForWeek };
