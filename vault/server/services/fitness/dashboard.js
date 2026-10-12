'use strict';

/**
 * Numbers behind the dashboard charts. Pure code (no database, no AI); dashboardService.js loads the data.
 *
 * Honest rules, in the same spirit as adaptation.js:
 *  - Rest is never counted against anyone, and "didn't do it" looks the same as unlogged on the charts' totals.
 *  - A week with less than half its sessions logged is "not enough to go on": it is shown, but never used for the balance
 *    chart or the projection, because an unlogged week is not a week of doing nothing.
 *  - The current week is shown "so far" and never used for trends.
 *  - A projection needs at least four usable (finished, logged, non-deload) weeks, and says so when it does not have them.
 */

const { weekDone, dayState } = require('./dayStatus');

const WHO_UPPER = 300;
const MIN_PROJECTION_WEEKS = 4;
const MAX_PROJECTION_WEEKS = 8;
const MIN_COVERAGE = 0.5;
const LOGGED = new Set(['done', 'partial', 'swapped', 'skipped']);

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * One week in a few numbers.
 * @param {{ weekStart:string, isDeload?:boolean, targets:object, restDays?:object[], sessions:object[], extras?:object[] }} w
 * @param {string} today ISO date
 */
function summariseWeek(w, today) {
  const sessions = w.sessions || [];
  const extras = w.extras || [];
  const live = sessions.filter((s) => s.status !== 'rest');
  const logged = live.filter((s) => LOGGED.has(s.status));
  const done = weekDone(sessions, extras);
  const sessionsDone = live.reduce((n, s) => n + (s.status === 'done' || s.status === 'swapped' ? 1 : s.status === 'partial' ? 0.5 : 0), 0);
  const coverage = live.length ? logged.length / live.length : 0;
  const t = w.targets || {};
  const finished = addDays(w.weekStart, 6) < today;
  const restByDay = new Map((w.restDays || []).map((r) => [r.day, r]));
  const days = [0, 1, 2, 3, 4, 5, 6].map((day) => {
    const date = addDays(w.weekStart, day);
    return {
      date,
      day,
      future: date > today,
      state: dayState({ sessions: sessions.filter((s) => s.day === day), restInfo: restByDay.get(day), extras: extras.filter((x) => x.date === date) }),
    };
  });
  return {
    weekStart: w.weekStart,
    isDeload: !!w.isDeload,
    current: w.weekStart <= today && !finished,
    finished,
    targets: { aerobicMinutes: t.aerobicMinutes ?? 0, strengthDays: t.strengthDays ?? 0, balanceDays: t.balanceDays ?? 0, mobilityDays: t.mobilityDays ?? 0 },
    done,
    sessionsPlanned: live.length,
    sessionsDone,
    coverage,
    usable: finished && !w.isDeload && live.length > 0 && coverage >= MIN_COVERAGE,
    days,
  };
}

/** Weeks inside the chosen window: '4', '12' or 'all'. Future weeks (a week made ahead) are left out. */
function windowWeeks(summaries, range, today) {
  const upToNow = summaries.filter((s) => s.weekStart <= today).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  if (range === 'all') return upToNow;
  const n = range === '4' ? 4 : 12;
  return upToNow.slice(-n);
}

/**
 * Done against target for each kind of work, over the last four finished weeks that were logged enough to count.
 * Cardio is minutes; the others are days.
 */
function domainBalance(summaries, { weeks = 4 } = {}) {
  const usable = summaries.filter((s) => s.finished && s.sessionsPlanned > 0 && s.coverage >= MIN_COVERAGE)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)).slice(-weeks);
  if (!usable.length) return { status: 'too_little', weeks: 0, domains: [] };
  const sum = (pick) => usable.reduce((n, s) => n + pick(s), 0);
  const defs = [
    { id: 'cardio', label: 'Cardio', unit: 'min', done: sum((s) => s.done.aerobicMinutes), target: sum((s) => s.targets.aerobicMinutes) },
    { id: 'strength', label: 'Strength', unit: 'days', done: sum((s) => s.done.strengthDays), target: sum((s) => s.targets.strengthDays) },
    { id: 'balance', label: 'Balance', unit: 'days', done: sum((s) => s.done.balanceDays), target: sum((s) => s.targets.balanceDays) },
    { id: 'mobility', label: 'Mobility', unit: 'days', done: sum((s) => s.done.mobilityDays), target: sum((s) => s.targets.mobilityDays) },
  ].filter((d) => d.target > 0);
  return {
    status: 'ok',
    weeks: usable.length,
    domains: defs.map((d) => ({ ...d, done: round1(d.done), target: round1(d.target), share: d.done / d.target })),
  };
}

/** Least-squares line through (0..n-1, ys): { slope, intercept }. */
function fitLine(ys) {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

/**
 * Where recent weeks are heading, put beside the plan. Honest maths:
 *  - the fitted line through the last four to eight usable weeks (deload and thin weeks left out);
 *  - a falling or flat line is projected as holding steady at the AVERAGE of the last four usable weeks (what you have actually
 *    been doing lately: not an earlier, higher week, and not the bottom of a falling line);
 *  - the climb is held to the plan's own rule of about 10% a week, and the projection never goes beyond the plan itself: a few
 *    weeks of trend carried forward a year is a guess, so it can fall short of the plan or reach it, never claim to beat it;
 *  - fewer than four usable weeks gives no projection and says so.
 * @param {object[]} summaries from summariseWeek
 * @param {{ year:number, by:string, weekly:{aerobicModerateMin:number} }[]} milestones
 */
function projection(summaries, milestones, today) {
  const usable = summaries.filter((s) => s.usable).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)).slice(-MAX_PROJECTION_WEEKS);
  if (usable.length < MIN_PROJECTION_WEEKS) {
    return {
      status: 'too_little',
      usableWeeks: usable.length,
      needed: MIN_PROJECTION_WEEKS,
      sentence: `Log a few more weeks and a projection will appear here. It needs at least ${MIN_PROJECTION_WEEKS} logged weeks, and you have ${usable.length}.`,
      points: [],
    };
  }
  const ys = usable.map((s) => s.done.aerobicMinutes);
  const { slope, intercept } = fitLine(ys);
  const holding = slope <= 0;
  const recent = ys.slice(-MIN_PROJECTION_WEEKS);
  const recentAverage = recent.reduce((a, b) => a + b, 0) / recent.length;
  // climbing: the fitted value now (steadier than one week); holding: the recent actual average
  const level = holding ? recentAverage : Math.max(0, intercept + slope * (ys.length - 1));
  const maxClimb = Math.max(5, level * 0.1);
  const perWeek = Math.min(Math.max(slope, 0), maxClimb);
  const points = milestones.map((m) => {
    const weeksAhead = Math.max(0, (Date.parse(`${m.by}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86400000));
    const planned = m.weekly.aerobicModerateMin;
    const raw = level + perWeek * weeksAhead;
    const ceiling = Math.max(level, planned);
    return { year: m.year, by: m.by, planned, minutes: Math.round(Math.min(raw, ceiling)), atPlan: !holding && raw >= planned };
  });
  const y1 = points.find((p) => p.year === 1);
  const y5 = points.find((p) => p.year === 5) || points[points.length - 1];
  let sentence;
  if (!y1) sentence = '';
  else if (holding) {
    sentence = `At your recent pace you'd stay around ${Math.round(level)} min a week, against a plan of ${y1.planned} by Year 1.`;
  } else if (y1.atPlan) {
    sentence = `At your recent pace you'd reach your plan of ${y1.planned} min a week by Year 1.`;
  } else {
    sentence = `At your recent pace you'd reach about ${y1.minutes} min a week by Year 1, against a plan of ${y1.planned}.`;
  }
  if (y5 && y5 !== y1 && !holding) {
    sentence += y5.atPlan ? ` By Year ${y5.year} you'd be at your plan of ${y5.planned}.` : ` By Year ${y5.year}: about ${y5.minutes}, against ${y5.planned}.`;
  }
  sentence += " Weeks vary, so treat this as a rough guide, not a promise.";
  return {
    status: 'ok',
    usableWeeks: usable.length,
    level: Math.round(level),
    perWeek: round1(perWeek),
    holding,
    sentence,
    points,
  };
}

/** Everything the dashboard needs for a window, from week records (see dashboardService.js for where they come from). */
function buildDashboard({ weeks, milestones = [], today, range = '12' }) {
  const all = weeks.map((w) => summariseWeek(w, today));
  const shown = windowWeeks(all, range, today);
  const current = all.find((s) => s.current) || null;
  const calendarWeeks = windowWeeks(all, range === 'all' ? '12' : range, today).slice(-26);
  return {
    range,
    today,
    weeks: shown.map(({ days, ...rest }) => { void days; return rest; }),
    thisWeek: current && (({ days, ...rest }) => { void days; return rest; })(current),
    calendar: calendarWeeks.map((s) => ({ weekStart: s.weekStart, isDeload: s.isDeload, days: s.days })),
    balance: domainBalance(all),
    projection: projection(all, milestones, today),
  };
}

module.exports = { summariseWeek, windowWeeks, domainBalance, fitLine, projection, buildDashboard, WHO_UPPER, MIN_PROJECTION_WEEKS };
