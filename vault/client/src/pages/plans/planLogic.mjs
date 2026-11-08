// Plans: the page's small rules, kept out of the components so they can be tested (node client/src/pages/plans/planLogic.test.mjs).
// Dates are 'YYYY-MM-DD' strings throughout; they are formatted by hand so the time zone can never move one by a day.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-12-07' -> 'Mon 7 Dec'. Anything else -> ''. */
export function fmtDay(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The one line under the plan's dates: does it fit, by how much, or what is still needed to say. */
export function fitMessage(plan, schedule) {
  if (!schedule) return { tone: 'warn', text: 'Some steps wait on each other in a circle, so nothing can be dated. Remove one of the links.' };
  if (!schedule.scheduled) {
    if (schedule.suggestedStart) return { tone: 'info', text: `Add a start date to see dates. To finish by ${fmtDay(plan.targetEndDate)}, start on ${fmtDay(schedule.suggestedStart)}.`, useStart: schedule.suggestedStart };
    return { tone: 'info', text: 'Add a start date to see when each step lands.' };
  }
  if (!schedule.projectEnd) return { tone: 'info', text: 'Add a step to see when the plan finishes.' }; // a start date but no steps yet
  const ends = fmtDay(schedule.projectEnd);
  const length = plural(schedule.workDays, 'working day', 'working days');
  if (!schedule.fit) return { tone: 'info', text: `Finishes ${ends}, ${length} from the first step.` };
  if (schedule.fit.fits) {
    const slack = schedule.fit.slackWorkDays;
    return { tone: 'ok', text: slack ? `Fits. Finishes ${ends}, ${plural(slack, 'working day', 'working days')} before ${fmtDay(plan.targetEndDate)}.` : `Fits exactly. Finishes ${ends}, the day it is due.` };
  }
  return { tone: 'warn', text: `Over by ${plural(schedule.fit.overByWorkDays, 'working day', 'working days')}. The steps finish ${ends}; the end date is ${fmtDay(plan.targetEndDate)}. Shorten a step, run two at once, or move the end date.` };
}

/** Steps in the order a table shows them: each group directly followed by its sub-steps. */
export function orderedRows(steps) {
  const byParent = new Map();
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    const key = s.parentStepId != null && ids.has(s.parentStepId) ? s.parentStepId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(s);
  }
  const rows = [];
  const walk = (pid, depth) => { for (const s of byParent.get(pid) || []) { rows.push({ step: s, depth, isGroup: byParent.has(s.id) }); walk(s.id, depth + 1); } };
  walk(null, 0);
  return rows;
}

/** How many working days from a to b, both counted ('every day' counts them all). 0 when b is before a. Used when a bar's edge is dragged. */
export function workDaysInclusive(a, b, workWeek = 'weekdays') {
  const parse = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b))) return 0;
  let n = 0;
  for (let t = parse(a); t <= parse(b); t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (workWeek === 'all' || (dow !== 0 && dow !== 6)) n++;
  }
  return n;
}

/**
 * What a bar dropped on the Timeline means for a step: a move pins the step's start to the day it was dropped on; dragging the right edge sets
 * its length to the working days from its start to where the edge was left (never less than one). null when nothing changed.
 */
export function dragToStepChange(step, change, mode, workWeek = 'weekdays') {
  if (!step || !change) return null;
  if (mode === 'move') return change.startDate && change.startDate !== step.startDate ? { startDate: change.startDate } : null;
  const days = Math.max(1, workDaysInclusive(change.startDate, change.endDate, workWeek));
  return days !== step.durationDays ? { durationDays: days } : null;
}

/** What the Timeline (shared with Tasks) expects, one row per step. A group's dates come from its sub-steps, so it is locked (cannot be dragged). */
export function timelineTasks(steps, deps, schedule) {
  const placed = schedule?.steps || {};
  const parents = new Set(steps.filter((s) => s.parentStepId != null).map((s) => s.parentStepId));
  return steps.map((s) => ({
    locked: parents.has(s.id),
    id: s.id, title: s.title, status: s.status,
    startDate: placed[s.id]?.start || null,
    dueDate: placed[s.id]?.end || null,
    isMilestone: !!s.isMilestone,
    parentTaskId: s.parentStepId ?? null,
    estimatedMinutes: null,
    blockerIds: deps.filter((d) => d.stepId === s.id).map((d) => d.blockedByStepId),
  }));
}

/** The date range the Timeline draws: the work itself, widened to take in the end date if that is later (so "over" is visible). */
export function timelineRange(plan, schedule) {
  if (!schedule?.projectStart) return null;
  let end = schedule.projectEnd;
  if (plan.targetEndDate && plan.targetEndDate > end) end = plan.targetEndDate;
  return { startDate: schedule.projectStart, targetEndDate: end };
}

export function filterPlans(items, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((p) => { const hay = `${p.title} ${p.description || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

export function progressText(p) {
  if (!p.stepCount) return 'No steps yet';
  return `${p.doneCount} of ${p.stepCount} done`;
}

/** The steps another step could wait on: not itself, not a group, not already chosen. */
export function waitOptions(step, steps, deps) {
  const groups = new Set(steps.filter((s) => s.parentStepId != null).map((s) => s.parentStepId));
  const chosen = new Set(deps.filter((d) => d.stepId === step.id).map((d) => d.blockedByStepId));
  return steps.filter((s) => s.id !== step.id && !groups.has(s.id) && !chosen.has(s.id));
}
