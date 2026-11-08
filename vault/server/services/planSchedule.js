'use strict';

// Plans: the date rules, with no database. Dates are 'YYYY-MM-DD' strings and all arithmetic is done in UTC so a daylight-saving change can
// never move a step by a day. See docs/plans.md.
//
//   schedule({ steps, deps, startDate, targetEndDate, workWeek })  -> where every step lands, when the plan ends, and whether it fits
//   startFromEnd({ steps, deps, targetEndDate, workWeek })         -> the start date that makes the plan finish on the end date
//
// A step has { id, parentStepId, startDate (a pinned start, or null for "as soon as it can"), durationDays, isMilestone }.
// A step with children is a group: it has no length of its own, it spans its children. Dependencies are { stepId, blockedByStepId }
// and only join steps that are not groups.

const DAY = 86400000;

const toDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toISO = (d) => d.toISOString().slice(0, 10);
const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(toDate(s)) === s;
const plusDays = (iso, n) => toISO(new Date(toDate(iso).getTime() + n * DAY));
const isWorkDay = (d, workWeek) => workWeek === 'all' || (d.getUTCDay() !== 0 && d.getUTCDay() !== 6);

/** The same day if it is a working day, otherwise the next one. */
function nextWorkDay(iso, workWeek = 'weekdays') {
  let d = toDate(iso);
  while (!isWorkDay(d, workWeek)) d = new Date(d.getTime() + DAY);
  return toISO(d);
}

/** The same day if it is a working day, otherwise the one before. */
function prevWorkDay(iso, workWeek = 'weekdays') {
  let d = toDate(iso);
  while (!isWorkDay(d, workWeek)) d = new Date(d.getTime() - DAY);
  return toISO(d);
}

/** Move forward n working days, starting from the first working day on or after `iso`. */
function addWorkDays(iso, n, workWeek = 'weekdays') {
  let d = toDate(nextWorkDay(iso, workWeek));
  for (let left = n; left > 0;) { d = new Date(d.getTime() + DAY); if (isWorkDay(d, workWeek)) left--; }
  return toISO(d);
}

/** Move back n working days, starting from the last working day on or before `iso`. */
function subWorkDays(iso, n, workWeek = 'weekdays') {
  let d = toDate(prevWorkDay(iso, workWeek));
  for (let left = n; left > 0;) { d = new Date(d.getTime() - DAY); if (isWorkDay(d, workWeek)) left--; }
  return toISO(d);
}

/** How many working days from a to b, both counted. 0 when b is before a. */
function workDaysInclusive(a, b, workWeek = 'weekdays') {
  if (toDate(b) < toDate(a)) return 0;
  let n = 0;
  for (let d = toDate(a); d <= toDate(b); d = new Date(d.getTime() + DAY)) if (isWorkDay(d, workWeek)) n++;
  return n;
}

/** The last day of a step that starts on `start` and takes `durationDays` working days. A milestone (0 days) ends the day it starts. */
function endOf(start, durationDays, workWeek = 'weekdays') {
  const n = Math.max(0, Math.round(Number(durationDays) || 0));
  return n <= 1 ? start : addWorkDays(start, n - 1, workWeek);
}

const maxISO = (a, b) => (a >= b ? a : b);
const minISO = (a, b) => (a <= b ? a : b);

class CycleError extends Error {
  constructor() { super('These steps wait on each other in a circle, so they can never start.'); this.code = 'CYCLE'; }
}

function schedule({ steps = [], deps = [], startDate = null, targetEndDate = null, workWeek = 'weekdays' } = {}) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const children = new Map();
  for (const s of steps) if (s.parentStepId != null && byId.has(s.parentStepId)) {
    if (!children.has(s.parentStepId)) children.set(s.parentStepId, []);
    children.get(s.parentStepId).push(s);
  }
  const isGroup = (s) => children.has(s.id);
  const leaves = steps.filter((s) => !isGroup(s));

  const blockers = new Map(leaves.map((s) => [s.id, []]));
  for (const d of deps) {
    if (blockers.has(d.stepId) && blockers.has(d.blockedByStepId)) blockers.get(d.stepId).push(d.blockedByStepId);
  }

  // Without a starting point there is nothing to place: the plan start, or failing that the earliest pinned step.
  const pinned = leaves.map((s) => s.startDate).filter(isISO).sort();
  const base = isISO(startDate) ? startDate : (pinned[0] || null);
  const out = new Map();
  if (!base) {
    for (const s of steps) out.set(s.id, { start: null, end: null, conflict: false, isGroup: isGroup(s) });
    return { steps: out, projectStart: null, projectEnd: null, workDays: 0, scheduled: false, fit: null };
  }

  // Place leaves in an order where every blocker comes first (Kahn); anything left over is a circle.
  const indegree = new Map(leaves.map((s) => [s.id, blockers.get(s.id).length]));
  const dependents = new Map(leaves.map((s) => [s.id, []]));
  for (const [id, list] of blockers) for (const b of list) dependents.get(b).push(id);
  const queue = leaves.filter((s) => indegree.get(s.id) === 0).map((s) => s.id);
  let placed = 0;
  while (queue.length) {
    const id = queue.shift();
    const s = byId.get(id);
    let earliest = nextWorkDay(base, workWeek);
    for (const b of blockers.get(id)) earliest = maxISO(earliest, nextWorkDay(plusDays(out.get(b).end, 1), workWeek));
    const pin = isISO(s.startDate) ? nextWorkDay(s.startDate, workWeek) : null;
    const start = pin || earliest;
    out.set(id, { start, end: endOf(start, s.isMilestone ? 0 : s.durationDays, workWeek), conflict: !!pin && pin < earliest, isGroup: false });
    placed++;
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (placed < leaves.length) throw new CycleError();

  // Groups span their children (children may be groups too).
  const span = (s) => {
    if (out.has(s.id)) return out.get(s.id);
    let start = null; let end = null;
    for (const c of children.get(s.id)) {
      const r = span(c);
      start = start ? minISO(start, r.start) : r.start;
      end = end ? maxISO(end, r.end) : r.end;
    }
    const r = { start, end, conflict: false, isGroup: true };
    out.set(s.id, r);
    return r;
  };
  for (const s of steps) span(s);

  let projectStart = null; let projectEnd = null;
  for (const s of leaves) {
    const r = out.get(s.id);
    projectStart = projectStart ? minISO(projectStart, r.start) : r.start;
    projectEnd = projectEnd ? maxISO(projectEnd, r.end) : r.end;
  }
  const workDays = projectStart ? workDaysInclusive(projectStart, projectEnd, workWeek) : 0;

  let fit = null;
  if (isISO(targetEndDate) && projectEnd) {
    if (projectEnd > targetEndDate) fit = { fits: false, overByWorkDays: workDaysInclusive(targetEndDate, projectEnd, workWeek) - 1, slackWorkDays: 0 };
    else fit = { fits: true, overByWorkDays: 0, slackWorkDays: workDaysInclusive(projectEnd, targetEndDate, workWeek) - 1 };
  }
  return { steps: out, projectStart, projectEnd, workDays, scheduled: true, fit };
}

/** Work backwards: the start date that makes the unpinned steps finish on `targetEndDate`. null when there is nothing to place. */
function startFromEnd({ steps = [], deps = [], targetEndDate, workWeek = 'weekdays' } = {}) {
  if (!isISO(targetEndDate)) return null;
  const probe = schedule({ steps: steps.map((s) => ({ ...s, startDate: null })), deps, startDate: '2001-01-01', workWeek }); // a Monday
  if (!probe.scheduled || !probe.projectStart) return null;
  return subWorkDays(targetEndDate, probe.workDays - 1, workWeek);
}

/** Would adding "stepId waits on blockedByStepId" make a circle? True when stepId can already be reached from blockedByStepId's side. */
function wouldCycle(deps, stepId, blockedByStepId) {
  if (stepId === blockedByStepId) return true;
  const waitsOn = new Map();
  for (const d of deps) { if (!waitsOn.has(d.stepId)) waitsOn.set(d.stepId, []); waitsOn.get(d.stepId).push(d.blockedByStepId); }
  // a circle appears if blockedByStepId already (directly or not) waits on stepId
  const seen = new Set(); const stack = [blockedByStepId];
  while (stack.length) {
    const id = stack.pop();
    if (id === stepId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of waitsOn.get(id) || []) stack.push(n);
  }
  return false;
}

module.exports = { isISO, plusDays, nextWorkDay, prevWorkDay, addWorkDays, subWorkDays, workDaysInclusive, endOf, schedule, startFromEnd, wouldCycle, CycleError };
