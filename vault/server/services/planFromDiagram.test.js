'use strict';
// node server/services/planFromDiagram.test.js   (no database needed)
const assert = require('node:assert/strict');
const d = require('./planFromDiagram');

const N = (id, label, shape = 'box') => ({ id, label, shape });
const E = (from, to, label = '') => ({ from, to, ...(label ? { label } : {}) });
const titles = (draft) => draft.steps.map((s) => s.title);
const waits = (draft, ref) => draft.steps.find((s) => s.ref === ref).waitsOn;

// ---- a straight line: each box waits on the one before ----
{
  const r = d.buildDraft({ nodes: [N('n1', 'Book visit'), N('n2', 'Visit site'), N('n3', 'Send quote')], edges: [E('n1', 'n2'), E('n2', 'n3')] });
  assert.deepEqual(titles(r), ['Book visit', 'Visit site', 'Send quote']);
  assert.deepEqual(waits(r, 'n1'), []);
  assert.deepEqual(waits(r, 'n2'), ['n1']);
  assert.deepEqual(waits(r, 'n3'), ['n2']);
  assert.equal(r.droppedLoops, 0);
  assert.deepEqual(r.leftOut, []);
  assert.ok(r.steps.every((s) => !s.isMilestone));
}

// ---- decisions are assumed to be yes: the No branch, and what only it leads to, is left out ----
{
  const flow = { nodes: [N('n1', 'Send quote'), N('n2', 'Customer accepts?', 'decision'), N('n3', 'Start the job'), N('n4', 'Close the job', 'start-end'), N('n5', 'File the paperwork')],
    edges: [E('n1', 'n2'), E('n2', 'n3', 'Yes'), E('n2', 'n4', 'No'), E('n4', 'n5')] };
  const r = d.buildDraft(flow);
  assert.deepEqual(titles(r), ['Send quote', 'Customer accepts?', 'Start the job']);
  assert.deepEqual(r.leftOut, ['Close the job', 'File the paperwork']);                      // the No branch and the step only it leads to
  assert.equal(r.steps.find((s) => s.ref === 'n2').isMilestone, true);                      // a decision is a point in time, not work
  assert.equal(r.steps.find((s) => s.ref === 'n3').notes, 'After "Customer accepts?": Yes'); // where the step came from is kept
  const all = d.buildDraft(flow, { includeNo: true });
  assert.deepEqual(titles(all), ['Send quote', 'Customer accepts?', 'Start the job', 'Close the job', 'File the paperwork']);
  assert.deepEqual(all.leftOut, []);
}

// ---- "no" is recognised in the ways people write it; other labels are kept ----
for (const label of ['No', 'no', 'N', 'No, try again', 'Rejected', 'Declined', 'Denied', 'Failed', 'Cancelled', 'Not approved']) {
  const r = d.buildDraft({ nodes: [N('a', 'Check?', 'decision'), N('b', 'Next'), N('c', 'Other')], edges: [E('a', 'b'), E('a', 'c', label)] });
  assert.deepEqual(r.leftOut, ['Other'], `"${label}" is a No branch`);
}
for (const label of ['Yes', 'Approved', 'Maybe', 'Over $500', 'Nothing to report', '']) {
  const r = d.buildDraft({ nodes: [N('a', 'Check?', 'decision'), N('b', 'Next'), N('c', 'Other')], edges: [E('a', 'b'), E('a', 'c', label)] });
  assert.deepEqual(r.leftOut, [], `"${label}" is kept`);                                   // "Nothing" starts with "not" but not as a word
}
{
  // only an arrow leaving a DECISION is a No branch; a box whose arrow says "no" is left alone
  const r = d.buildDraft({ nodes: [N('a', 'Do it'), N('b', 'Then this')], edges: [E('a', 'b', 'no')] });
  assert.deepEqual(titles(r), ['Do it', 'Then this']);
}

// ---- a join: reachable by the Yes path, so it stays, and does not wait on the step that was left out ----
{
  const r = d.buildDraft({ nodes: [N('a', 'OK?', 'decision'), N('x', 'Yes path'), N('y', 'No path'), N('z', 'Finish')], edges: [E('a', 'x', 'Yes'), E('a', 'y', 'No'), E('x', 'z'), E('y', 'z')] });
  assert.deepEqual(titles(r), ['OK?', 'Yes path', 'Finish']);
  assert.deepEqual(waits(r, 'z'), ['x']);
  assert.deepEqual(r.leftOut, ['No path']);
}

// ---- a loop ("no, ask again") is left out and counted; the forward arrows stay whatever order they came in ----
{
  const r = d.buildDraft({ nodes: [N('n1', 'Send invoice'), N('n2', 'Deposit paid?', 'decision'), N('n3', 'Start work')],
    edges: [E('n2', 'n1', 'No'), E('n1', 'n2'), E('n2', 'n3', 'Yes')] });
  assert.equal(r.droppedLoops, 1);
  assert.deepEqual(titles(r), ['Send invoice', 'Deposit paid?', 'Start work']);
  assert.deepEqual(waits(r, 'n1'), []);                                                     // the loop arrow did not make Send invoice wait on the decision
  assert.deepEqual(waits(r, 'n2'), ['n1']);
  assert.deepEqual(waits(r, 'n3'), ['n2']);
  // a loop with no label at all is still a loop
  assert.equal(d.buildDraft({ nodes: [N('a', 'One'), N('b', 'Two')], edges: [E('a', 'b'), E('b', 'a')] }).droppedLoops, 1);
}

// ---- a start shape is not work; an end shape is a milestone ----
{
  const r = d.buildDraft({ nodes: [N('s', 'Start', 'start-end'), N('a', 'Do the work'), N('e', 'Done', 'start-end')], edges: [E('s', 'a'), E('a', 'e')] });
  assert.deepEqual(titles(r), ['Do the work', 'Done']);
  assert.deepEqual(waits(r, 'a'), []);                                                      // so the work begins on the plan's first day
  assert.equal(r.steps[1].isMilestone, true);
  assert.deepEqual(r.leftOut, []);                                                          // dropping Start is not "left out"
  // an oval that does not say start is kept, as a milestone
  const k = d.buildDraft({ nodes: [N('s', 'Customer calls', 'start-end'), N('a', 'Book a visit')], edges: [E('s', 'a')] });
  assert.deepEqual(titles(k), ['Customer calls', 'Book a visit']);
  assert.equal(k.steps[0].isMilestone, true);
}

// ---- the input is checked ----
assert.throws(() => d.buildDraft(null), /could not be read/);
assert.throws(() => d.buildDraft({ nodes: [N('a', 'Only one')], edges: [] }), /at least two boxes/);
assert.throws(() => d.buildDraft({ nodes: [N('a', 'One'), N('b', 'Two')], edges: [] }), /at least two boxes/);
assert.throws(() => d.buildDraft({ nodes: [N('a', 'One'), N('b', 'Two')], edges: [E('a', 'a'), E('a', 'ghost')] }), /at least two boxes/);   // self loops and arrows to nothing are ignored
assert.throws(() => d.buildDraft({ nodes: Array.from({ length: d.MAX_NODES + 1 }, (_, i) => N(`n${i}`, 'x')), edges: [E('n0', 'n1')] }), (e) => e.status === 413);
assert.throws(() => d.buildDraft({ nodes: [N('a', 'One'), N('b', 'Two')], edges: Array.from({ length: d.MAX_EDGES + 1 }, () => E('a', 'b')) }), (e) => e.status === 413);
{
  const r = d.buildDraft({ nodes: [N('a', '  Wire\u0000  the\n house  '), N('b', 'x'.repeat(200), 'hexagon'), N('a', 'duplicate id')], edges: [E('a', 'b'), E('a', 'b'), E('a', 'b', 'again')] });
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[0].title, 'Wire the house');
  assert.equal(r.steps[1].title.length, 60);
  assert.equal(r.steps[1].isMilestone, false);                                             // an unknown shape is a box
  assert.deepEqual(waits(r, 'b'), ['a']);                                                  // three arrows the same way are one
}

// ---- lengths: one working day unless told, none for a milestone, and nonsense is refused ----
{
  const draft = d.buildDraft({ nodes: [N('a', 'Dig'), N('m', 'Inspect?', 'decision'), N('b', 'Pour')], edges: [E('a', 'm'), E('m', 'b')] });
  const steps = d.applyDurations(draft.steps, { a: 3, m: 9, b: '2' });
  assert.deepEqual(steps.map((s) => s.durationDays), [3, 0, 2]);                           // the milestone ignores the 9
  assert.deepEqual(d.applyDurations(draft.steps, {}).map((s) => s.durationDays), [1, 0, 1]);
  assert.deepEqual(d.applyDurations(draft.steps, null).map((s) => s.durationDays), [1, 0, 1]);
  for (const bad of [0, -1, 1.5, 'x', 4000]) assert.throws(() => d.applyDurations(draft.steps, { a: bad }), /Days for "Dig"/);
}

// ---- where it lands: the same rules as a saved plan (2026-12-07 is a Monday) ----
{
  const draft = d.buildDraft({ nodes: [N('s', 'Start', 'start-end'), N('a', 'Demolition'), N('b', 'Plumbing'), N('c', 'Signed off?', 'decision'), N('e', 'Finish', 'start-end')],
    edges: [E('s', 'a'), E('a', 'b'), E('b', 'c'), E('c', 'e', 'Yes')] });
  const steps = d.applyDurations(draft.steps, { a: 2, b: 3 });
  const r = d.place(steps, { startDate: '2026-12-07', targetEndDate: '2026-12-11' });
  assert.deepEqual(r.steps.a, { start: '2026-12-07', end: '2026-12-08' });
  assert.deepEqual(r.steps.b, { start: '2026-12-09', end: '2026-12-11' });
  assert.deepEqual(r.steps.c, { start: '2026-12-11', end: '2026-12-11' });                 // the decision lands on the day plumbing ends, adding no day
  assert.deepEqual(r.steps.e, { start: '2026-12-11', end: '2026-12-11' });
  assert.equal(r.projectEnd, '2026-12-11');
  assert.equal(r.fit.fits, true);
  assert.equal(d.place(steps, { startDate: '2026-12-07', targetEndDate: '2026-12-10' }).fit.overByWorkDays, 1);
  assert.equal(d.place(steps, { targetEndDate: '2026-12-18' }).suggestedStart, '2026-12-14');   // five working days ending Friday the 18th
  assert.equal(d.place(steps, {}).scheduled, false);
  assert.equal(d.place(steps, { startDate: '2026-12-07', workWeek: 'all' }).steps.b.end, '2026-12-11');
}

console.log('planFromDiagram: all passed');
