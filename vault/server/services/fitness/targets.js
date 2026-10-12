'use strict';

/**
 * Pure maths for the Fitness Planner: age, bands, weekly targets, the baseline comparison and the
 * 5-year milestone path. No database, no AI, no clock (callers pass "today"), so it is predictable and tested.
 */

const { DOMAINS, AGE_BANDS, DEFAULTS } = require('./config');

const MIN_AGE = 18;

/** 'YYYY-MM-DD' for a Date in a given IANA zone. */
function todayInZone(timeZone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Whole years between two 'YYYY-MM-DD' strings. */
function ageOn(dob, today) {
  if (!isIsoDate(dob) || !isIsoDate(today)) return null;
  const [dy, dm, dd] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - dy;
  if (tm < dm || (tm === dm && td < dd)) age -= 1;
  return age;
}

function bandForAge(age) {
  if (!Number.isFinite(age) || age < MIN_AGE) return null;
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max) || AGE_BANDS[AGE_BANDS.length - 1];
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function clampAmbition(a) {
  const n = Math.round(Number(a));
  return Number.isFinite(n) ? clamp(n, 1, 5) : 3;
}

/** End-state weekly targets for a band at an ambition level (1-5). */
function weeklyTargets(bandId, ambition, cfg = DEFAULTS) {
  const t = cfg.bandTargets[bandId];
  if (!t) throw new Error(`Unknown age band: ${bandId}`);
  const amb = clampAmbition(ambition);
  const f = (amb - 1) / 4;
  const aerobic = Math.min(t.aerobicCapModerate, Math.round((t.aerobicModerateMin + f * (t.aerobicModerateMax - t.aerobicModerateMin)) / 5) * 5);
  const high = amb >= 4;
  return {
    aerobicModerateMin: aerobic,
    strengthDays: high ? t.strengthDaysHigh : t.strengthDays,
    balanceDays: high ? t.balanceDaysHigh : t.balanceDays,
    mobilityDays: high ? t.mobilityDaysHigh : t.mobilityDays,
    multicomponent: !!t.multicomponent,
  };
}

function validRatings(r) {
  return !!r && DOMAINS.every((d) => Number.isInteger(r[d]) && r[d] >= 1 && r[d] <= 5);
}

/** Where each domain sits against the healthy range for the band. Neutral wording: building / in range / above. */
function compareToRange(bandId, scores, previous, cfg = DEFAULTS) {
  const range = cfg.healthyRange[bandId];
  return DOMAINS.map((d) => {
    const [low, high] = range[d];
    const now = scores[d];
    const status = now < low ? 'building' : now > high ? 'above' : 'in_range';
    return {
      domain: d,
      now,
      before: previous && Number.isInteger(previous[d]) ? previous[d] : null,
      low,
      high,
      status,
    };
  });
}

/** 5-year target rating per domain. See config.js for the rule. */
function targetRatings(bandId, scores, ambition, cfg = DEFAULTS) {
  const range = cfg.healthyRange[bandId];
  const bonus = cfg.ambitionRatingBonus[clampAmbition(ambition)] || 0;
  const out = {};
  for (const d of DOMAINS) {
    const base = Math.max(scores[d], range[d][0]);
    out[d] = Math.max(scores[d], clamp(base + bonus, 1, range.ceiling[d]));
  }
  return out;
}

function startingMinutes(scores, cfg = DEFAULTS) {
  return cfg.cardioRatingToMinutes[scores.cardio] ?? 0;
}

function addYears(isoDate, years) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  // 29 Feb rolls to 1 Mar in a non-leap year: pull back to 28 Feb.
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

/**
 * Five yearly milestones. `scores`/`previous` are 1-5 per domain. Returns plain data only; wording is added by
 * the caller (template or AI).
 */
function buildMilestones({ bandId, scores, previous, ambition, startsOn, horizonYears = 5 }, cfg = DEFAULTS) {
  if (!validRatings(scores)) throw new Error('scores must be integers 1-5 for every domain');
  const amb = clampAmbition(ambition);
  const end = weeklyTargets(bandId, amb, cfg);
  const endRatings = targetRatings(bandId, scores, amb, cfg);
  const regaining = !!previous && DOMAINS.some((d) => Number.isInteger(previous[d]) && previous[d] >= scores[d] + 1);
  const curve = regaining ? cfg.yearCurveRegain : cfg.yearCurve;
  const startMin = Math.min(startingMinutes(scores, cfg), end.aerobicModerateMin);

  const milestones = [];
  for (let y = 1; y <= horizonYears; y += 1) {
    const share = curve[Math.min(y, curve.length) - 1];
    const ratings = {};
    for (const d of DOMAINS) ratings[d] = Math.round(scores[d] + (endRatings[d] - scores[d]) * share);
    milestones.push({
      year: y,
      by: addYears(startsOn, y),
      ratings,
      weekly: {
        aerobicModerateMin: Math.round((startMin + (end.aerobicModerateMin - startMin) * share) / 5) * 5,
        strengthDays: y === 1 ? Math.min(end.strengthDays, 2) : end.strengthDays,
        balanceDays: y === 1 ? Math.min(end.balanceDays, Math.max(1, end.balanceDays - 1)) : end.balanceDays,
        mobilityDays: y === 1 ? Math.min(end.mobilityDays, 2) : end.mobilityDays,
      },
    });
  }
  return { ambition: amb, regaining, endRatings, endWeekly: end, startMinutes: startMin, milestones };
}

/** Plain differences between two plans, so a dial change can be explained with real numbers. */
function diffPlans(from, to) {
  const lastFrom = from.milestones[from.milestones.length - 1];
  const lastTo = to.milestones[to.milestones.length - 1];
  const ratingChanges = {};
  for (const d of DOMAINS) ratingChanges[d] = lastTo.ratings[d] - lastFrom.ratings[d];
  return {
    fromAmbition: from.ambition,
    toAmbition: to.ambition,
    aerobicMinutesPerWeek: lastTo.weekly.aerobicModerateMin - lastFrom.weekly.aerobicModerateMin,
    strengthDays: lastTo.weekly.strengthDays - lastFrom.weekly.strengthDays,
    balanceDays: lastTo.weekly.balanceDays - lastFrom.weekly.balanceDays,
    mobilityDays: lastTo.weekly.mobilityDays - lastFrom.weekly.mobilityDays,
    ratingChanges,
  };
}

/** Is a re-rating due? Weeks since last rating vs the configured soft/firm thresholds. */
function ratingDue(lastRatedOn, today, cfg = DEFAULTS) {
  if (!isIsoDate(lastRatedOn) || !isIsoDate(today)) return { due: false, level: null, weeks: null };
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastRatedOn}T00:00:00Z`)) / 86400000);
  const weeks = Math.floor(days / 7);
  if (weeks >= cfg.rerate.firmWeeks) return { due: true, level: 'firm', weeks };
  if (weeks >= cfg.rerate.softWeeks) return { due: true, level: 'soft', weeks };
  return { due: false, level: null, weeks };
}

module.exports = {
  MIN_AGE,
  todayInZone,
  isIsoDate,
  ageOn,
  bandForAge,
  clampAmbition,
  weeklyTargets,
  validRatings,
  compareToRange,
  targetRatings,
  buildMilestones,
  diffPlans,
  ratingDue,
  addYears,
};
