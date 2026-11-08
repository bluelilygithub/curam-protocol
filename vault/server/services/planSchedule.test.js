'use strict';
// node server/services/planSchedule.test.js   (no database needed)
// 2026-12-07 is a Monday; 2026-12-12 and 12-13 are the weekend.
const assert = require('node:assert/strict');
const p = require('./planSchedule');

// ---- working-day arithmetic ----
assert.equal(p.nextWorkDay('2026-12-12'), '2026-12-14');           // Saturday -> Monday
assert.equal(p.nextWorkDay('2026-12-12', 'all'), '2026-12-12');    // seven-day week
assert.equal(p.prevWorkDay('2026-12-13'), '2026-12-11');           // Sunday -> Friday
assert.equal(p.addWorkDays('2026-12-07', 4), '2026-12-11');
assert.equal(p.addWorkDays('2026-12-07', 5), '2026-12-14');        // skips the weekend
assert.equal(p.subWorkDays('2026-12-14', 1), '2026-12-11');
assert.equal(p.workDaysInclusive('2026-12-07', '2026-12-14'), 6);
assert.equal(p.workDaysInclusive('2026-12-14', '2026-12-07'), 0);
assert.equal(p.endOf('2026-12-07', 3), '2026-12-09');
assert.equal(p.endOf('2026-12-11', 2), '2026-12-14');              // Friday + 2 days ends Monday
assert.equal(p.endOf('2026-12-07', 0), '2026-12-07');              // a milestone ends the day it starts
assert.equal(p.endOf('2026-12-07', 3, 'all'), '2026-12-09');
assert.equal(p.endOf('2026-12-11', 3, 'all'), '2026-12-13');
assert.ok(p.isISO('2026-02-28') && !p.isISO('2026-02-30') && !p.isISO('26-1-1') && !p.isISO(null));

const S = (id, durationDays, extra = {}) => ({ id, parentStepId: null, startDate: null, durationDays, isMilestone: false, ...extra });

// ---- a small plan: A (2d) then B (3d); C (1d) on its own ----
{
  const r = p.schedule({ steps: [S(1, 2), S(2, 3), S(3, 1)], deps: [{ stepId: 2, blockedByStepId: 1 }], startDate: '2026-12-07' });
  assert.deepEqual([r.steps.get(1).start, r.steps.get(1).end], ['2026-12-07', '2026-12-08']);
  assert.deepEqual([r.steps.get(2).start, r.steps.get(2).end], ['2026-12-09', '2026-12-11']);   // starts the day after A ends
  assert.deepEqual([r.steps.get(3).start, r.steps.get(3).end], ['2026-12-07', '2026-12-07']);   // not waiting on anything
  assert.equal(r.projectStart, '2026-12-07');
  assert.equal(r.projectEnd, '2026-12-11');
  assert.equal(r.workDays, 5);
  assert.equal(r.fit, null);                                                                      // no target end date given
}

// ---- fit: over, exactly on, and with room to spare ----
{
  const base = { steps: [S(1, 2), S(2, 3)], deps: [{ stepId: 2, blockedByStepId: 1 }], startDate: '2026-12-07' };
  assert.deepEqual(p.schedule({ ...base, targetEndDate: '2026-12-10' }).fit, { fits: false, overByWorkDays: 1, slackWorkDays: 0 });
  assert.deepEqual(p.schedule({ ...base, targetEndDate: '2026-12-11' }).fit, { fits: true, overByWorkDays: 0, slackWorkDays: 0 });
  assert.deepEqual(p.schedule({ ...base, targetEndDate: '2026-12-15' }).fit, { fits: true, overByWorkDays: 0, slackWorkDays: 2 });
}

// ---- a step crossing a weekend; a seven-day week does not skip it ----
{
  const steps = [S(1, 3), S(2, 3)];
  const deps = [{ stepId: 2, blockedByStepId: 1 }];
  const wk = p.schedule({ steps, deps, startDate: '2026-12-09' });
  assert.deepEqual([wk.steps.get(1).start, wk.steps.get(1).end], ['2026-12-09', '2026-12-11']);
  assert.deepEqual([wk.steps.get(2).start, wk.steps.get(2).end], ['2026-12-14', '2026-12-16']);
  const all = p.schedule({ steps, deps, startDate: '2026-12-09', workWeek: 'all' });
  assert.deepEqual([all.steps.get(2).start, all.steps.get(2).end], ['2026-12-12', '2026-12-14']);
}

// ---- a plan that starts on a weekend starts on Monday ----
assert.equal(p.schedule({ steps: [S(1, 1)], startDate: '2026-12-12' }).steps.get(1).start, '2026-12-14');

// ---- pinned start: honoured, and flagged when it is earlier than a blocker allows ----
{
  const r = p.schedule({
    steps: [S(1, 3), S(2, 1, { startDate: '2026-12-08' }), S(3, 1, { startDate: '2026-12-21' })],
    deps: [{ stepId: 2, blockedByStepId: 1 }, { stepId: 3, blockedByStepId: 1 }], startDate: '2026-12-07',
  });
  assert.equal(r.steps.get(2).start, '2026-12-08');
  assert.equal(r.steps.get(2).conflict, true);       // A runs until the 9th, so the 8th is too early
  assert.equal(r.steps.get(3).start, '2026-12-21');  // later than needed is fine
  assert.equal(r.steps.get(3).conflict, false);
}

// ---- milestones take no time; the step after one starts the next working day ----
{
  const r = p.schedule({ steps: [S(1, 2), S(2, 5, { isMilestone: true }), S(3, 1)], deps: [{ stepId: 2, blockedByStepId: 1 }, { stepId: 3, blockedByStepId: 2 }], startDate: '2026-12-07' });
  assert.deepEqual([r.steps.get(2).start, r.steps.get(2).end], ['2026-12-09', '2026-12-09']);   // the 5 days are ignored for a milestone
  assert.equal(r.steps.get(3).start, '2026-12-10');
}

// ---- a group spans its children and takes no dependencies of its own ----
{
  const r = p.schedule({
    steps: [S(1, 0, { }), S(2, 2, { parentStepId: 1 }), S(3, 4, { parentStepId: 1 })],
    deps: [{ stepId: 3, blockedByStepId: 2 }], startDate: '2026-12-07',
  });
  assert.equal(r.steps.get(1).isGroup, true);
  assert.deepEqual([r.steps.get(1).start, r.steps.get(1).end], ['2026-12-07', '2026-12-14']);
  assert.equal(r.workDays, 6);
}

// ---- no start at all: nothing to place, said plainly rather than guessed ----
{
  const r = p.schedule({ steps: [S(1, 2)], deps: [] });
  assert.equal(r.scheduled, false);
  assert.equal(r.steps.get(1).start, null);
  assert.equal(p.schedule({ steps: [S(1, 2, { startDate: '2026-12-09' })] }).steps.get(1).start, '2026-12-09'); // a pinned step supplies the start
}

// ---- circles are refused, and caught before they are saved ----
assert.throws(() => p.schedule({ steps: [S(1, 1), S(2, 1)], deps: [{ stepId: 1, blockedByStepId: 2 }, { stepId: 2, blockedByStepId: 1 }], startDate: '2026-12-07' }), (e) => e.code === 'CYCLE');
{
  const deps = [{ stepId: 2, blockedByStepId: 1 }, { stepId: 3, blockedByStepId: 2 }];
  assert.equal(p.wouldCycle(deps, 1, 3), true);    // 3 waits on 2 waits on 1, so 1 waiting on 3 is a circle
  assert.equal(p.wouldCycle(deps, 1, 1), true);
  assert.equal(p.wouldCycle(deps, 3, 1), false);   // already implied, not a circle
  assert.equal(p.wouldCycle(deps, 4, 3), false);
}

// ---- working backwards from an end date ----
{
  const steps = [S(1, 2), S(2, 3)];
  const deps = [{ stepId: 2, blockedByStepId: 1 }];
  assert.equal(p.startFromEnd({ steps, deps, targetEndDate: '2026-12-18' }), '2026-12-14');   // five working days ending Friday the 18th
  const start = p.startFromEnd({ steps, deps, targetEndDate: '2026-12-18' });
  assert.equal(p.schedule({ steps, deps, startDate: start, targetEndDate: '2026-12-18' }).fit.fits, true);   // forward from there agrees
  assert.equal(p.schedule({ steps, deps, startDate: start, targetEndDate: '2026-12-18' }).projectEnd, '2026-12-18');
  assert.equal(p.startFromEnd({ steps: [], deps: [], targetEndDate: '2026-12-18' }), null);
  assert.equal(p.startFromEnd({ steps, deps, targetEndDate: 'soon' }), null);
}

console.log('planSchedule: all passed');
