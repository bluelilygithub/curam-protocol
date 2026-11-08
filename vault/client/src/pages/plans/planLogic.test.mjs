// node client/src/pages/plans/planLogic.test.mjs
import assert from 'node:assert/strict';
import { fmtDay, fitMessage, orderedRows, timelineTasks, timelineRange, filterPlans, progressText, waitOptions } from './planLogic.mjs';

assert.equal(fmtDay('2026-12-07'), 'Mon 7 Dec');
assert.equal(fmtDay('2026-01-01'), 'Thu 1 Jan');
assert.equal(fmtDay(null), '');
assert.equal(fmtDay('soon'), '');

const plan = { targetEndDate: '2026-12-11' };
assert.equal(fitMessage(plan, null).tone, 'warn');                                         // a circle
assert.match(fitMessage(plan, null).text, /circle/);
assert.match(fitMessage({}, { scheduled: false }).text, /Add a start date/);
{
  const m = fitMessage(plan, { scheduled: false, suggestedStart: '2026-12-04' });
  assert.equal(m.useStart, '2026-12-04');
  assert.match(m.text, /start on Fri 4 Dec/);
}
assert.equal(fitMessage(plan, { scheduled: true, projectStart: null, projectEnd: null, workDays: 0, fit: null }).text, 'Add a step to see when the plan finishes.'); // dated plan, no steps yet
assert.match(fitMessage({}, { scheduled: true, projectEnd: '2026-12-14', workDays: 6, fit: null }).text, /Finishes Mon 14 Dec, 6 working days/);
assert.match(fitMessage({}, { scheduled: true, projectEnd: '2026-12-08', workDays: 1, fit: null }).text, /1 working day from/);
assert.equal(fitMessage(plan, { scheduled: true, projectEnd: '2026-12-09', workDays: 3, fit: { fits: true, slackWorkDays: 2, overByWorkDays: 0 } }).tone, 'ok');
assert.match(fitMessage(plan, { scheduled: true, projectEnd: '2026-12-09', workDays: 3, fit: { fits: true, slackWorkDays: 2, overByWorkDays: 0 } }).text, /2 working days before Fri 11 Dec/);
assert.match(fitMessage(plan, { scheduled: true, projectEnd: '2026-12-11', workDays: 5, fit: { fits: true, slackWorkDays: 0, overByWorkDays: 0 } }).text, /Fits exactly/);
{
  const m = fitMessage(plan, { scheduled: true, projectEnd: '2026-12-14', workDays: 6, fit: { fits: false, slackWorkDays: 0, overByWorkDays: 1 } });
  assert.equal(m.tone, 'warn');
  assert.match(m.text, /Over by 1 working day\./);
}

const steps = [
  { id: 1, title: 'A', parentStepId: null, status: 'todo', isMilestone: false },
  { id: 2, title: 'B', parentStepId: 1, status: 'done', isMilestone: false },
  { id: 3, title: 'C', parentStepId: null, status: 'todo', isMilestone: true },
  { id: 4, title: 'D', parentStepId: 1, status: 'todo', isMilestone: false },
  { id: 5, title: 'orphan', parentStepId: 99, status: 'todo', isMilestone: false },   // parent is gone: shown at the top level, not lost
];
assert.deepEqual(orderedRows(steps).map((r) => [r.step.id, r.depth, r.isGroup]), [[1, 0, true], [2, 1, false], [4, 1, false], [3, 0, false], [5, 0, false]]);

const deps = [{ stepId: 3, blockedByStepId: 2 }, { stepId: 3, blockedByStepId: 4 }];
const schedule = { scheduled: true, projectStart: '2026-12-07', projectEnd: '2026-12-10', steps: { 2: { start: '2026-12-07', end: '2026-12-08' }, 3: { start: '2026-12-10', end: '2026-12-10' } } };
const tl = timelineTasks(steps, deps, schedule);
assert.deepEqual(tl.find((t) => t.id === 3).blockerIds, [2, 4]);
assert.equal(tl.find((t) => t.id === 3).isMilestone, true);
assert.equal(tl.find((t) => t.id === 2).startDate, '2026-12-07');
assert.equal(tl.find((t) => t.id === 4).dueDate, null);                                  // not placed yet: the Timeline lists it as unscheduled
assert.equal(tl.find((t) => t.id === 2).parentTaskId, 1);

assert.deepEqual(timelineRange({ targetEndDate: '2026-12-18' }, schedule), { startDate: '2026-12-07', targetEndDate: '2026-12-18' });   // the end date is later: show the gap
assert.deepEqual(timelineRange({ targetEndDate: '2026-12-08' }, schedule), { startDate: '2026-12-07', targetEndDate: '2026-12-10' });   // the work runs past it: show the work
assert.equal(timelineRange({}, { scheduled: false, projectStart: null }), null);

const items = [{ title: 'Kitchen reno', description: 'tiles and plumbing' }, { title: 'Website', description: '' }];
assert.equal(filterPlans(items, '').length, 2);
assert.deepEqual(filterPlans(items, 'kitchen plumb').map((p) => p.title), ['Kitchen reno']);
assert.equal(filterPlans(items, 'kitchen website').length, 0);

assert.equal(progressText({ stepCount: 0, doneCount: 0 }), 'No steps yet');
assert.equal(progressText({ stepCount: 8, doneCount: 3 }), '3 of 8 done');

assert.deepEqual(waitOptions(steps[2], steps, deps).map((s) => s.id), [5]);              // not itself, not group A (it has sub-steps), not B or D (already chosen)

console.log('planLogic: all passed');
