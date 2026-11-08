'use strict';
// node server/services/planFromNote.test.js   (no database needed)
const assert = require('node:assert/strict');
const n = require('./planFromNote');

const titles = (d) => d.steps.map((s) => s.title);
const step = (d, title) => d.steps.find((s) => s.title === title);
const refOf = (d, title) => step(d, title).ref;
const waitsOn = (d, title) => step(d, title).waitsOn.map((r) => d.steps.find((s) => s.ref === r).title);

// ---- lengths written on a line ----
assert.deepEqual(n.takeDuration('Order tiles (3 days)'), { title: 'Order tiles', days: 3 });
assert.deepEqual(n.takeDuration('Order tiles 3d'), { title: 'Order tiles', days: 3 });
assert.deepEqual(n.takeDuration('Pour slab - 2 weeks'), { title: 'Pour slab', days: 10 });          // a week is five working days
assert.deepEqual(n.takeDuration('Paint [1 day]'), { title: 'Paint', days: 1 });
assert.deepEqual(n.takeDuration('Wait for approval, ~2.5 days'), { title: 'Wait for approval', days: 3 });   // rounded up
assert.deepEqual(n.takeDuration('Call the 3 builders'), { title: 'Call the 3 builders', days: null }, 'a number in the middle is not a length');
assert.deepEqual(n.takeDuration('Day 2 plan'), { title: 'Day 2 plan', days: null });
assert.deepEqual(n.takeDuration('3 days'), { title: '3 days', days: null }, 'a line that is only a length keeps its words');
assert.deepEqual(n.takeDuration('Wait 0 days'), { title: 'Wait 0 days', days: null });
assert.equal(n.takeDuration('Big job 99999 days').days, 3650, 'capped');

// ---- a plain list: bullets run together ----
{
  const d = n.buildDraft('# Garden\n\n- Dig the bed (2 days)\n- Buy plants\n- Plant them 1d\n');
  assert.deepEqual(titles(d), ['Garden', 'Dig the bed', 'Buy plants', 'Plant them']);
  assert.equal(step(d, 'Garden').parentRef, null);
  assert.equal(step(d, 'Dig the bed').parentRef, refOf(d, 'Garden'), 'the heading is a group holding its items');
  assert.equal(step(d, 'Dig the bed').hintDays, 2);
  assert.equal(step(d, 'Plant them').hintDays, 1);
  assert.equal(step(d, 'Buy plants').hintDays, null);
  assert.deepEqual(d.steps.map((s) => s.waitsOn), [[], [], [], []], 'bullets run together');
}

// ---- numbered lists run in order, and the default is "as the lists say" ----
{
  const d = n.buildDraft('1. Survey the site\n2. Get a quote\n3. Sign the contract\n\n- Tidy the shed\n');
  assert.deepEqual(waitsOn(d, 'Survey the site'), []);
  assert.deepEqual(waitsOn(d, 'Get a quote'), ['Survey the site']);
  assert.deepEqual(waitsOn(d, 'Sign the contract'), ['Get a quote']);
  assert.deepEqual(waitsOn(d, 'Tidy the shed'), [], 'a bullet after a numbered list waits on nothing');
  assert.deepEqual(n.buildDraft('1) One\n2) Two\n').steps.map((s) => s.waitsOn.length), [0, 1], '1) works as well as 1.');
}

// ---- the three orders ----
{
  const text = '- A\n- B\n- C\n';
  assert.deepEqual(n.buildDraft(text, { order: 'lists' }).steps.map((s) => s.waitsOn.length), [0, 0, 0]);
  assert.deepEqual(n.buildDraft(text, { order: 'sequence' }).steps.map((s) => s.waitsOn.length), [0, 1, 1], 'one after another');
  assert.deepEqual(n.buildDraft('1. A\n2. B\n3. C\n', { order: 'parallel' }).steps.map((s) => s.waitsOn.length), [0, 0, 0], 'all together, even a numbered list');
  assert.throws(() => n.buildDraft(text, { order: 'sideways' }), /order is not known/);
}

// ---- check-boxes: a ticked one is already done; markers and picture lines are tidied ----
{
  const d = n.buildDraft('- [x] Book the venue {task:12}\n- [ ] Send invites (2 days)\n- [X] Pay deposit\n');
  assert.deepEqual(d.steps.map((s) => [s.title, s.status]), [['Book the venue', 'done'], ['Send invites', 'todo'], ['Pay deposit', 'done']]);
  assert.equal(step(d, 'Send invites').hintDays, 2);
  assert.equal(n.buildDraft('- Look at {picture:41} the plan\n- Next\n').steps[0].title, 'Look at the plan');
}

// ---- sections and nesting ----
{
  const text = [
    '# Bathroom', '', '## Demolition', '- Strip the room (2 days)', '- Remove the bath', '',
    '## Fit out', '1. Plumbing', '   - Run the pipes (3 days)', '   - Test for leaks', '2. Tiling (4 days)', '3. Milestone: Signed off', '',
  ].join('\n');
  const d = n.buildDraft(text);
  assert.deepEqual(titles(d), ['Bathroom', 'Demolition', 'Strip the room', 'Remove the bath', 'Fit out', 'Plumbing', 'Run the pipes', 'Test for leaks', 'Tiling', 'Signed off']);
  assert.equal(step(d, 'Demolition').parentRef, refOf(d, 'Bathroom'), 'a sub-heading sits inside its heading');
  assert.equal(step(d, 'Strip the room').parentRef, refOf(d, 'Demolition'));
  assert.equal(step(d, 'Plumbing').parentRef, refOf(d, 'Fit out'));
  assert.equal(step(d, 'Run the pipes').parentRef, refOf(d, 'Plumbing'), 'an indented item is a sub-step, so Plumbing becomes a group');
  assert.equal(step(d, 'Run the pipes').hintDays, 3);
  assert.equal(step(d, 'Plumbing').hintDays, null, 'a group has no length of its own');
  assert.equal(step(d, 'Signed off').isMilestone, true);
  assert.equal(step(d, 'Tiling').hintDays, 4);
  // 2. Tiling waits on EVERYTHING inside 1. Plumbing; 3. waits on 2.
  assert.deepEqual(waitsOn(d, 'Tiling').sort(), ['Run the pipes', 'Test for leaks']);
  assert.deepEqual(waitsOn(d, 'Signed off'), ['Tiling']);
  assert.deepEqual(waitsOn(d, 'Run the pipes'), [], 'bullets inside Plumbing run together');
  assert.deepEqual(d.steps.filter((s) => d.steps.some((c) => c.parentRef === s.ref)).map((s) => s.waitsOn.length), [0, 0, 0, 0], 'groups never wait on anything themselves');
}

// ---- one after another also runs sections in order ----
{
  const d = n.buildDraft('## One\n- a\n- b\n## Two\n- c\n', { order: 'sequence' });
  assert.deepEqual(waitsOn(d, 'b'), ['a']);
  assert.deepEqual(waitsOn(d, 'c'), ['b'], 'the second section waits for everything in the first');
  assert.deepEqual(n.buildDraft('## One\n- a\n- b\n## Two\n- c\n').steps.map((s) => s.waitsOn.length), [0, 0, 0, 0, 0], 'by default sections and bullets run together');
}

// ---- what is left out ----
{
  const d = n.buildDraft('# Plan for the week\nSome words about it.\n\n## Notes to self\nJust a paragraph here.\n\n## To do\n- Real step\n\n> a quote\n\n```\n- not a step\n```\n');
  assert.deepEqual(titles(d), ['Plan for the week', 'To do', 'Real step'], 'a heading with nothing under it is dropped; code and quotes are ignored');
  assert.equal(d.emptyHeadings, 1);
  assert.throws(() => n.buildDraft('Just a paragraph of words with no list at all.'), (e) => e.status === 422 && /list in the note/.test(e.message));
  assert.throws(() => n.buildDraft('# Only a heading\nand words'), (e) => e.status === 422);
  assert.throws(() => n.buildDraft(''), (e) => e.status === 422);
  assert.throws(() => n.buildDraft(null), (e) => e.status === 422);
  assert.throws(() => n.buildDraft(Array.from({ length: n.MAX_STEPS + 1 }, (_, i) => `- step ${i}`).join('\n')), (e) => e.status === 413);
  assert.equal(n.buildDraft(Array.from({ length: n.MAX_STEPS }, (_, i) => `- step ${i}`).join('\n')).steps.length, n.MAX_STEPS);
}

// ---- tidy names ----
{
  const d = n.buildDraft('- **Call** the [builder](https://x.test) about `quote`\n-   Spaced    out   name   \n- *   \n- ' + 'x'.repeat(300) + '\n');
  assert.equal(d.steps[0].title, 'Call the builder about quote');
  assert.equal(d.steps[1].title, 'Spaced out name');
  assert.equal(d.steps[2].title, 'x'.repeat(120), 'an empty bullet is skipped and a long name is cut');
  assert.equal(d.steps.length, 3);
  assert.equal(n.buildDraft('- one\n\t- two\n').steps[1].parentRef, 'n1', 'a tab indents');
  assert.equal(n.buildDraft('- a\r\n- b\r\n').steps.length, 2, 'Windows line endings are fine');
}

console.log('planFromNote: all passed');
