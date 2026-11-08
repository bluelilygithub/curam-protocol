'use strict';
// DATABASE_URL=... node server/routes/plans.db.test.js
// Real database, fake sign-in. Proves:
//   - a plan can be made, read, changed and listed; bad dates, bad status and an end date before the start are refused;
//   - steps: add, change, nest under a group, move, delete; a group takes no dependencies and a step with dependencies cannot become a group;
//   - dependencies: add, a circle and a step waiting on itself are refused; the schedule follows them and reports whether the plan fits;
//   - a plan with only an end date suggests the start that makes it finish on time;
//   - one person cannot see, change or delete another's plan or steps (404), nor link a step from another person's plan;
//   - plan steps never appear in the tasks table;
//   - a plan can be made from a diagram: the preview saves nothing, a decision is assumed to be Yes, loops are left out, the plan is linked to the diagram,
//     and a diagram that is not the caller's is refused;
//   - steps can be sent to Tasks: one step or all, a group becomes a parent task and its sub-steps subtasks, waits-on links become task
//     dependencies, a step already in Tasks is not sent twice, a deleted task lets the step be sent again, and another person cannot send;
//   - a plan can be made from a note: headings become groups, list items steps, a ticked check-box a done step, a length written on a line is used,
//     the order choice decides what waits on what, the preview saves nothing, and a note that is not the caller's is refused;
//   - delete goes to the recycle bin and Undo brings back the plan with its steps, groups and dependencies and the same dates.
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP plans.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const router = require('./plans');

function serve() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/api/plans', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;

  const tag = `plans-test-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  require('../services/recycleBin/adapters');
  const bin = require('../services/recycleBin');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/api/plans`;
  const call = async (user, method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  try {
    // ---- a plan: make, refuse the wrong things, read, change ----
    let r = await call(A, 'POST', '/', { title: 'Kitchen reno', startDate: '2026-12-07', targetEndDate: '2026-12-10' });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    const planId = r.body.plan.id;
    assert.equal(r.body.plan.startDate, '2026-12-07');                       // a date stays a date, not a timestamp
    assert.equal(r.body.plan.workWeek, 'weekdays');
    assert.equal(r.body.schedule.scheduled, true);
    assert.equal((await call(A, 'POST', '/', { title: 'x', startDate: '07/12/2026' })).status, 400);
    assert.equal((await call(A, 'POST', '/', { title: 'x', startDate: '2026-12-07', targetEndDate: '2026-12-01' })).status, 400);
    assert.equal((await call(A, 'POST', '/', { title: 'x', status: 'finished' })).status, 400);
    assert.equal((await call(A, 'POST', '/', { title: 'x', workWeek: 'weekends' })).status, 400);
    assert.equal((await call(A, 'POST', '/', {})).body.plan.title, 'Untitled plan');

    // ---- steps ----
    const add = async (body, user = A) => call(user, 'POST', `/${planId}/steps`, body);
    assert.equal((await add({ title: '   ' })).status, 400);
    assert.equal((await add({ title: 'x', durationDays: -1 })).status, 400);
    assert.equal((await add({ title: 'x', durationDays: 1.5 })).status, 400);
    assert.equal((await add({ title: 'x', startDate: 'soon' })).status, 400);
    const demo = (await add({ title: 'Demolition', durationDays: 2 })).body.step;
    const plumb = (await add({ title: 'Plumbing', durationDays: 3 })).body.step;
    const sign = (await add({ title: 'Sign off', isMilestone: true, durationDays: 9 })).body.step;
    assert.equal(sign.durationDays, 0, 'a milestone takes no time, whatever days were sent');
    assert.equal(demo.startDate, null);

    // ---- dependencies ----
    const dep = (step, on, user = A) => call(user, 'POST', `/${planId}/steps/${step}/deps`, { blockedByStepId: on });
    assert.equal((await dep(plumb.id, demo.id)).status, 201);
    assert.equal((await dep(sign.id, plumb.id)).status, 201);
    assert.equal((await dep(demo.id, sign.id)).status, 409, 'a circle is refused');
    assert.equal((await dep(demo.id, demo.id)).status, 400, 'a step cannot wait on itself');
    assert.equal((await dep(plumb.id, 999999)).status, 404);

    r = await call(A, 'GET', `/${planId}`);
    const sc = r.body.schedule;
    assert.deepEqual([sc.steps[demo.id].start, sc.steps[demo.id].end], ['2026-12-07', '2026-12-08']);
    assert.deepEqual([sc.steps[plumb.id].start, sc.steps[plumb.id].end], ['2026-12-09', '2026-12-11']);
    assert.deepEqual([sc.steps[sign.id].start, sc.steps[sign.id].end], ['2026-12-11', '2026-12-11']);   // a milestone lands on the day the step before it ends
    assert.equal(sc.projectEnd, '2026-12-11');
    assert.equal(sc.fit.fits, false);                                       // the plan wanted to be done by the 10th
    assert.equal(sc.fit.overByWorkDays, 1);
    assert.equal(r.body.deps.length, 2);

    // ---- a plan with only an end date suggests when to start ----
    r = await call(A, 'PUT', `/${planId}`, { startDate: null, targetEndDate: '2026-12-18' });
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.scheduled, false);
    assert.equal(r.body.schedule.suggestedStart, '2026-12-14');             // demolition 2 + plumbing 3 + a sign-off that takes no time = five working days ending the 18th
    r = await call(A, 'PUT', `/${planId}`, { startDate: '2026-12-07', targetEndDate: '2026-12-18' });
    assert.equal(r.body.schedule.fit.fits, true);

    // ---- groups ----
    const group = (await add({ title: 'Wet areas' })).body.step;
    assert.equal((await call(A, 'PUT', `/${planId}/steps/${group.id}`, { parentStepId: group.id })).status, 400, 'not inside itself');
    assert.equal((await add({ title: 'Tiling', parentStepId: plumb.id })).status, 409, 'a step with dependencies cannot hold sub-steps');
    const tile = (await add({ title: 'Tiling', parentStepId: group.id, durationDays: 2 })).body.step;
    assert.equal(tile.parentStepId, group.id);
    assert.equal((await dep(tile.id, group.id)).status, 409, 'a group takes no dependencies');
    assert.equal((await call(A, 'PUT', `/${planId}/steps/${group.id}`, { parentStepId: tile.id })).status, 400, 'not inside its own sub-step');
    assert.equal((await add({ title: 'x', parentStepId: 999999 })).status, 400);
    r = await call(A, 'GET', `/${planId}`);
    assert.equal(r.body.schedule.steps[group.id].isGroup, true);
    assert.equal(r.body.schedule.steps[group.id].start, r.body.schedule.steps[tile.id].start);

    // ---- change a step ----
    r = await call(A, 'PUT', `/${planId}/steps/${tile.id}`, { durationDays: 4, status: 'done', startDate: '2026-12-21' });
    assert.equal(r.status, 200);
    assert.equal(r.body.step.startDate, '2026-12-21');
    assert.equal(r.body.step.status, 'done');
    assert.equal((await call(A, 'PUT', `/${planId}/steps/${tile.id}`, { status: 'finished' })).status, 400);

    // ---- another person: nothing is theirs ----
    assert.equal((await call(B, 'GET', `/${planId}`)).status, 404);
    assert.equal((await call(B, 'PUT', `/${planId}`, { title: 'mine now' })).status, 404);
    assert.equal((await call(B, 'DELETE', `/${planId}`)).status, 404);
    assert.equal((await add({ title: 'sneaky' }, B)).status, 404);
    assert.equal((await call(B, 'PUT', `/${planId}/steps/${demo.id}`, { title: 'sneaky' })).status, 404);
    assert.equal((await call(B, 'DELETE', `/${planId}/steps/${demo.id}`)).status, 404);
    assert.equal((await dep(sign.id, demo.id, B)).status, 404);
    assert.equal((await call(B, 'GET', '/')).body.plans.length, 0);
    const planB = (await call(B, 'POST', '/', { title: 'B plan' })).body.plan.id;
    const stepB = (await call(B, 'POST', `/${planB}/steps`, { title: 'B step' })).body.step;
    assert.equal((await call(A, 'POST', `/${planId}/steps/${demo.id}/deps`, { blockedByStepId: stepB.id })).status, 404, 'a step from another person\'s plan cannot be linked');
    assert.equal((await call(A, 'POST', `/${planId}/steps`, { title: 'x', parentStepId: stepB.id })).status, 400, 'nor used as a parent');
    assert.equal((await call(A, 'GET', `/${planId}`)).body.plan.title, 'Kitchen reno', 'nothing of A\'s changed');

    // ---- plan steps never reach the tasks table ----
    const { rows: stray } = await pool.query(`SELECT COUNT(*) AS n FROM tasks WHERE "userId" = ANY($1)`, [[A, B]]);
    assert.equal(Number(stray[0].n), 0);

    // ---- list ----
    r = await call(A, 'GET', '/');
    const listed = r.body.plans.find((p) => p.id === planId);
    assert.equal(listed.stepCount, 5);
    assert.equal(listed.doneCount, 1);

    // ---- remove a dependency, delete a step (its sub-steps go too) ----
    assert.equal((await call(A, 'DELETE', `/${planId}/steps/${sign.id}/deps/${plumb.id}`)).status, 200);
    assert.equal((await call(A, 'GET', `/${planId}`)).body.deps.length, 1);
    assert.equal((await call(A, 'DELETE', `/${planId}/steps/${group.id}`)).status, 200);
    r = await call(A, 'GET', `/${planId}`);
    assert.equal(r.body.steps.length, 3, 'the group and its sub-step are both gone');


    // ---- a plan from a diagram ----
    const mkDrawing = async (user, title) => (await pool.query(`INSERT INTO drawings ("userId", title, scene) VALUES ($1,$2,'{}') RETURNING id`, [user, title])).rows[0].id;
    const drawA = await mkDrawing(A, 'Quote to job');
    const drawB = await mkDrawing(B, 'B diagram');
    const diagram = {
      nodes: [
        { id: 'n1', label: 'Start', shape: 'start-end' }, { id: 'n2', label: 'Send quote', shape: 'box' }, { id: 'n3', label: 'Customer accepts?', shape: 'decision' },
        { id: 'n4', label: 'Book the job', shape: 'box' }, { id: 'n5', label: 'Close the job', shape: 'start-end' }, { id: 'n6', label: 'Do the job', shape: 'box' },
      ],
      edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4', label: 'Yes' }, { from: 'n3', to: 'n5', label: 'No' }, { from: 'n4', to: 'n6' }, { from: 'n6', to: 'n2', label: 'rework' }],
    };
    const dia = (extra = {}, user = A, path = '/from-diagram/preview') => call(user, 'POST', path, { diagram, ...extra });

    r = await dia({ startDate: '2026-12-07', targetEndDate: '2026-12-11', durations: { n2: 2, n4: 1, n6: 3 } });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.deepEqual(r.body.steps.map((s) => s.title), ['Send quote', 'Customer accepts?', 'Book the job', 'Do the job']);   // Start dropped, the No branch left out
    assert.deepEqual(r.body.leftOut, ['Close the job']);
    assert.equal(r.body.droppedLoops, 1);                                                                                 // "rework" goes back to Send quote
    assert.deepEqual(r.body.steps.map((s) => s.durationDays), [2, 0, 1, 3]);
    assert.equal(r.body.schedule.steps.n2.start, '2026-12-07');
    assert.equal(r.body.schedule.steps.n3.start, '2026-12-08');                                                           // the decision lands on the day the quote step ends
    assert.equal(r.body.schedule.projectEnd, '2026-12-14');                                                               // 2 + 1 + 3 = six working days from Monday
    assert.deepEqual([r.body.schedule.fit.fits, r.body.schedule.fit.overByWorkDays], [false, 1]);                          // one over the 11th
    assert.equal((await dia({ includeNo: true })).body.steps.length, 5, 'with the No branch included');
    assert.equal((await dia({ durations: { n2: 0 } })).status, 400, 'a length of 0 is refused');
    assert.equal((await dia({ startDate: 'soon' })).status, 400);
    assert.equal((await call(A, 'POST', '/from-diagram/preview', { diagram: { nodes: [], edges: [] } })).status, 400);
    assert.equal((await call(A, 'POST', '/from-diagram/preview', {})).status, 400);
    assert.equal((await call(A, 'GET', '/by-source?kind=drawing&id=' + drawA)).body.plans.length, 0, 'the preview saved nothing');

    r = await dia({ title: 'Quote to job plan', drawingId: drawA, startDate: '2026-12-07', targetEndDate: '2026-12-11', durations: { n2: 2, n6: 3 } }, A, '/from-diagram');
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    const made = r.body;
    assert.equal(made.plan.title, 'Quote to job plan');
    assert.equal(made.plan.sourceKind, 'drawing');
    assert.equal(made.plan.sourceId, String(drawA));
    assert.deepEqual(made.steps.map((s) => [s.title, s.durationDays, s.isMilestone]), [['Send quote', 2, false], ['Customer accepts?', 0, true], ['Book the job', 1, false], ['Do the job', 3, false]]);
    assert.equal(made.deps.length, 3);
    assert.equal(made.links.length, 1);
    assert.deepEqual([made.links[0].kind, made.links[0].refId, made.links[0].label], ['drawing', String(drawA), 'Quote to job']);
    assert.equal(made.schedule.projectEnd, '2026-12-14');
    assert.equal(made.steps.find((s) => s.title === 'Book the job').notes, 'After "Customer accepts?": Yes');
    r = await call(A, 'GET', '/by-source?kind=drawing&id=' + drawA);
    assert.deepEqual(r.body.plans.map((p) => p.id), [made.plan.id]);
    assert.equal((await call(B, 'GET', '/by-source?kind=drawing&id=' + drawA)).body.plans.length, 0, 'another person does not see plans made from this diagram');
    assert.equal((await call(A, 'GET', '/by-source?kind=drawing')).status, 400);

    // a diagram that is not the caller's, or does not exist, is refused and nothing is made
    const beforeCount = (await call(A, 'GET', '/')).body.plans.length;
    assert.equal((await dia({ drawingId: drawB }, A, '/from-diagram')).status, 404);
    assert.equal((await dia({ drawingId: 999999 }, A, '/from-diagram')).status, 404);
    assert.equal((await dia({ drawingId: 'abc' }, A, '/from-diagram')).status, 404);
    assert.equal((await dia({ durations: { n2: -3 }, drawingId: drawA }, A, '/from-diagram')).status, 400);
    assert.equal((await call(A, 'GET', '/')).body.plans.length, beforeCount, 'a refused request leaves no half-made plan');
    assert.equal((await call(B, 'GET', `/${made.plan.id}`)).status, 404);
    assert.equal((await dia({ title: 'no link' }, A, '/from-diagram')).body.links.length, 0, 'without a diagram there is no link');

    // ---- a plan from a note ----
    const mkNote = async (user, title, body) => (await pool.query('INSERT INTO notes (user_id, title, body) VALUES ($1,$2,$3) RETURNING id', [user, title, body])).rows[0].id;
    const noteBody = ['# Bathroom', '', '## Demolition', '- Strip the room (2 days)', '- [x] Remove the bath', '', '## Fit out', '1. Plumbing', '   - Run the pipes (3 days)', '2. Tiling 4d', '3. Milestone: Signed off', ''].join('\n');
    const noteA = await mkNote(A, 'Bathroom reno notes', noteBody);
    const noteB = await mkNote(B, 'B note', '- B step\n- B other');
    const fromNoteCall = (extra = {}, user = A, path = '/from-note/preview') => call(user, 'POST', path, { noteId: noteA, ...extra });

    r = await fromNoteCall({ startDate: '2026-12-07', targetEndDate: '2026-12-31' });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.deepEqual(r.body.steps.map((s) => s.title), ['Bathroom', 'Demolition', 'Strip the room', 'Remove the bath', 'Fit out', 'Plumbing', 'Run the pipes', 'Tiling', 'Signed off']);
    const pv = Object.fromEntries(r.body.steps.map((s) => [s.title, s]));
    assert.equal(pv.Bathroom.isGroup, true);
    assert.equal(pv['Strip the room'].parentRef, pv.Demolition.ref);
    assert.equal(pv['Strip the room'].durationDays, 2, 'a length written on the line is used');
    assert.equal(pv.Tiling.durationDays, 4);
    assert.equal(pv['Remove the bath'].status, 'done', 'a ticked check-box is done');
    assert.equal(pv['Signed off'].isMilestone, true);
    assert.equal(pv.Plumbing.isGroup, true);
    assert.deepEqual(pv.Tiling.waitsOn.sort(), [pv['Run the pipes'].ref], 'the numbered list runs in order, and waits for everything inside the step before');
    assert.deepEqual(pv['Signed off'].waitsOn, [pv.Tiling.ref]);
    assert.deepEqual(pv['Strip the room'].waitsOn, [], 'bullets run together');
    assert.equal(r.body.schedule.steps[pv['Strip the room'].ref].start, '2026-12-07');
    assert.equal(r.body.schedule.steps[pv.Tiling.ref].start, '2026-12-10', 'Tiling waits for the pipes (3 days from Mon 7), so it starts Thu 10');
    assert.equal(r.body.note.id, noteA);
    // the three orders
    assert.ok((await fromNoteCall({ order: 'sequence', startDate: '2026-12-07' })).body.steps.filter((s) => s.waitsOn.length).length > r.body.steps.filter((s) => s.waitsOn.length).length, 'one after another links more steps');
    assert.equal((await fromNoteCall({ order: 'parallel', startDate: '2026-12-07' })).body.steps.filter((s) => s.waitsOn.length).length, 0, 'all together links none');
    assert.equal((await fromNoteCall({ order: 'sideways' })).status, 400);
    // a length typed in the box overrides the note's; a group takes none
    assert.equal((await fromNoteCall({ durations: { [pv['Strip the room'].ref]: 5, [pv.Bathroom.ref]: 99 }, startDate: '2026-12-07' })).body.steps.find((s) => s.title === 'Strip the room').durationDays, 5);
    // refusals
    assert.equal((await fromNoteCall({}, A, '/from-note/preview')).status, 200);
    assert.equal((await call(A, 'POST', '/from-note/preview', { noteId: noteB })).status, 404, 'another person\'s note is not found');
    assert.equal((await call(A, 'POST', '/from-note/preview', { noteId: 999999 })).status, 404);
    assert.equal((await call(A, 'POST', '/from-note/preview', {})).status, 404);
    const plainNote = await mkNote(A, 'No list', 'Just words and no list.');
    assert.equal((await call(A, 'POST', '/from-note/preview', { noteId: plainNote })).status, 422);
    assert.equal((await call(A, 'GET', '/by-source?kind=note&id=' + noteA)).body.plans.length, 0, 'the preview saved nothing');

    r = await fromNoteCall({ title: 'Reno plan', startDate: '2026-12-07', targetEndDate: '2026-12-31' }, A, '/from-note');
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    const fromNoteMade = r.body;
    assert.equal(fromNoteMade.plan.title, 'Reno plan');
    assert.equal(fromNoteMade.plan.sourceKind, 'note');
    assert.equal(fromNoteMade.plan.sourceId, String(noteA));
    assert.equal(fromNoteMade.steps.length, 9);
    const made2 = Object.fromEntries(fromNoteMade.steps.map((s) => [s.title, s]));
    assert.equal(made2['Strip the room'].parentStepId, made2.Demolition.id, 'sub-steps point at their group');
    assert.equal(made2.Demolition.parentStepId, made2.Bathroom.id, 'groups nest');
    assert.equal(made2['Run the pipes'].parentStepId, made2.Plumbing.id);
    assert.equal(made2['Remove the bath'].status, 'done');
    assert.equal(made2['Signed off'].isMilestone, true);
    assert.equal(made2['Run the pipes'].durationDays, 3);
    assert.equal(fromNoteMade.deps.length, 2);
    assert.deepEqual(fromNoteMade.links.map((l) => [l.kind, l.refId, l.label]), [['note', String(noteA), 'Bathroom reno notes']]);
    assert.equal(fromNoteMade.schedule.steps[made2.Bathroom.id].isGroup, true);
    assert.deepEqual((await call(A, 'GET', '/by-source?kind=note&id=' + noteA)).body.plans.map((p) => p.id), [fromNoteMade.plan.id]);
    assert.equal((await call(B, 'GET', '/by-source?kind=note&id=' + noteA)).body.plans.length, 0, 'another person does not see plans made from this note');
    // nothing is made for a note that is not the caller's, or a bad request
    const beforeNotePlans = (await call(A, 'GET', '/')).body.plans.length;
    assert.equal((await call(A, 'POST', '/from-note', { noteId: noteB })).status, 404);
    assert.equal((await call(B, 'POST', '/from-note', { noteId: noteA })).status, 404, 'and B cannot make a plan from A\'s note');
    assert.equal((await call(A, 'POST', '/from-note', { noteId: noteA, durations: { n3: -1 } })).status, 400);
    assert.equal((await call(A, 'GET', '/')).body.plans.length, beforeNotePlans, 'a refused request leaves no half-made plan');
    assert.equal((await call(B, 'GET', `/${fromNoteMade.plan.id}`)).status, 404);
    // the plan keeps working like any other: send a sub-step to Tasks and it goes under its group's task when that is sent too
    r = await call(A, 'POST', `/${fromNoteMade.plan.id}/send-to-tasks`, { stepIds: [made2.Demolition.id, made2['Strip the room'].id].map(Number) });
    assert.equal(r.body.created.length, 2);
    await pool.query('DELETE FROM tasks WHERE "userId" = $1', [A]); // leave none behind for the next section's count

    // ---- send to Tasks ----
    const tplan = (await call(A, 'POST', '/', { title: 'Garden', startDate: '2026-12-07', targetEndDate: '2026-12-31' })).body.plan.id;
    const tadd = async (body) => (await call(A, 'POST', `/${tplan}/steps`, body)).body.step;
    const dig = await tadd({ title: 'Dig', durationDays: 2, notes: 'Mind the pipes' });
    const grp = await tadd({ title: 'Planting' });
    const sow = await tadd({ title: 'Sow', parentStepId: grp.id, durationDays: 3 });
    const ready = await tadd({ title: 'Garden ready', isMilestone: true });
    assert.equal((await call(A, 'POST', `/${tplan}/steps/${sow.id}/deps`, { blockedByStepId: dig.id })).status, 201);
    assert.equal((await call(A, 'POST', `/${tplan}/steps/${ready.id}/deps`, { blockedByStepId: sow.id })).status, 201);
    const send = (body, user = A, id = tplan) => call(user, 'POST', `/${id}/send-to-tasks`, body);
    const taskRow = async (id) => (await pool.query('SELECT title, notes, status, "parentTaskId", "dueDate", "estimatedMinutes", "isMilestone", "userId" FROM tasks WHERE id = $1', [id])).rows[0];

    assert.equal((await send({})).status, 400, 'nothing chosen');
    assert.equal((await send({ stepIds: [999999] })).status, 404);
    assert.equal((await send({ stepIds: [stepB.id] })).status, 404, 'a step from another plan is not found');
    assert.equal((await send({ all: true }, B)).status, 404, 'another person cannot send');
    assert.equal((await send({ stepIds: [dig.id] }, B)).status, 404);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM tasks WHERE "userId" = $1', [A])).rows[0].n), 0, 'refused requests made nothing');

    // one step
    r = await send({ stepIds: [dig.id] });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    assert.equal(r.body.created.length, 1);
    const digTask = r.body.created[0].taskId;
    let row = await taskRow(digTask);
    assert.equal(row.title, 'Dig');
    assert.equal(row.dueDate, '2026-12-08');                          // the step's last day, as text
    assert.equal(row.estimatedMinutes, 960);                          // 2 days x 8 hours
    assert.equal(row.isMilestone, 0);
    assert.equal(row.status, 'todo');
    assert.equal(row.userId, A);
    assert.equal(row.parentTaskId, null);
    assert.match(row.notes, /^From the plan "Garden"\./);
    assert.match(row.notes, /Mind the pipes/);
    const link = (await pool.query(`SELECT kind, "refId", "stepId" FROM plan_links WHERE "planId" = $1 AND kind = 'task'`, [tplan])).rows;
    assert.deepEqual(link, [{ kind: 'task', refId: String(digTask), stepId: dig.id }]);
    assert.equal((await call(A, 'GET', `/${tplan}`)).body.tasks[dig.id].taskId, digTask);

    // the same step again is not sent twice
    r = await send({ stepIds: [dig.id] });
    assert.equal(r.status, 201);
    assert.equal(r.body.created.length, 0);
    assert.equal(r.body.skipped.length, 1);

    // the whole plan: the rest are made, the one already there is skipped
    r = await send({ all: true });
    assert.equal(r.body.created.length, 3);
    assert.equal(r.body.skipped.length, 1);
    assert.equal(r.body.dependencies, 2);
    const taskOfStep = Object.fromEntries([...r.body.created, { stepId: dig.id, taskId: digTask }].map((c) => [c.stepId, c.taskId]));
    row = await taskRow(taskOfStep[grp.id]);
    assert.equal(row.estimatedMinutes, null, 'a group has no length of its own');
    assert.equal(row.parentTaskId, null);
    assert.equal(row.dueDate, '2026-12-11');                          // a group ends when its last sub-step does
    row = await taskRow(taskOfStep[sow.id]);
    assert.equal(row.parentTaskId, taskOfStep[grp.id], 'a sub-step is a subtask of its group\'s task');
    assert.equal(row.estimatedMinutes, 1440);
    assert.equal(row.dueDate, '2026-12-11');
    row = await taskRow(taskOfStep[ready.id]);
    assert.equal(row.isMilestone, 1);
    assert.equal(row.estimatedMinutes, null);
    const tdeps = (await pool.query('SELECT "taskId", "blockedByTaskId" FROM task_dependencies WHERE "taskId" = ANY($1)', [Object.values(taskOfStep)])).rows;
    assert.deepEqual(tdeps.map((d) => [d.taskId, d.blockedByTaskId]).sort(), [[taskOfStep[sow.id], digTask], [taskOfStep[ready.id], taskOfStep[sow.id]]].sort(), 'waits-on became task dependencies');
    assert.equal(Object.keys((await call(A, 'GET', `/${tplan}`)).body.tasks).length, 4);

    // another person sees none of it
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM tasks WHERE "userId" = $1 AND notes LIKE 'From the plan%'`, [B])).rows[0].n), 0);

    // a task that was deleted: the step is no longer "in Tasks" and can be sent again, with one link, not two
    await pool.query('DELETE FROM tasks WHERE id = $1', [digTask]);
    assert.equal((await call(A, 'GET', `/${tplan}`)).body.tasks[dig.id], undefined);
    r = await send({ stepIds: [dig.id] });
    assert.equal(r.body.created.length, 1);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM plan_links WHERE "planId" = $1 AND kind = 'task' AND "stepId" = $2`, [tplan, dig.id])).rows[0].n), 1, 'the stale link was replaced');

    // a task's status flows back to its plan step (and nothing else does)
    const planTasksSvc = require('../services/planTasks');
    const stepStatus = async (id) => (await pool.query('SELECT status FROM plan_steps WHERE id = $1', [id])).rows[0].status;
    const sowTask = taskOfStep[sow.id];
    assert.equal(await stepStatus(sow.id), 'todo');
    assert.equal(await planTasksSvc.syncStepFromTask(sowTask, 'done'), 1);
    assert.equal(await stepStatus(sow.id), 'done');
    assert.equal(await planTasksSvc.syncStepFromTask(sowTask, 'done'), 0, 'already that status: nothing to change');
    assert.equal(await planTasksSvc.syncStepFromTask(sowTask, 'in-progress'), 1);
    assert.equal(await stepStatus(sow.id), 'in-progress');
    assert.equal(await planTasksSvc.syncStepFromTask(sowTask, 'finished'), 0, 'an unknown status is ignored');
    assert.equal(await stepStatus(sow.id), 'in-progress');
    assert.equal(await planTasksSvc.syncStepFromTask(999999999, 'done'), 0, 'a task that did not come from a plan changes nothing');
    assert.equal(await stepStatus(ready.id), 'todo', 'other steps are untouched');
    const sowAfter = (await call(A, 'GET', `/${tplan}`)).body.steps.find((st) => st.id === sow.id);
    assert.equal(sowAfter.durationDays, 3, 'only the status came back, not any other field');
    assert.equal((await call(A, 'GET', `/${tplan}`)).body.tasks[sow.id].status, 'todo', 'and the task itself is as it was');

    // the Tasks calendar layer: unfinished steps not in Tasks, on their last day; sent, finished and group steps are left out
    const calPlan = (await call(A, 'POST', '/', { title: 'Calendar plan', startDate: '2026-12-07' })).body.plan.id;
    const cadd = async (body) => (await call(A, 'POST', `/${calPlan}/steps`, body)).body.step;
    const cg = await cadd({ title: 'Phase' });
    const c1 = await cadd({ title: 'First', durationDays: 2, parentStepId: cg.id });
    const c2 = await cadd({ title: 'Second', durationDays: 1 });
    const c3 = await cadd({ title: 'Third', durationDays: 1 });
    await call(A, 'POST', `/${calPlan}/steps/${c2.id}/deps`, { blockedByStepId: c1.id });
    await call(A, 'PUT', `/${calPlan}/steps/${c3.id}`, { status: 'done' });
    r = await call(A, 'GET', '/calendar?from=2026-12-01&to=2026-12-31');
    assert.equal(r.status, 200);
    const mine = r.body.steps.filter((e) => e.planId === calPlan);
    assert.deepEqual(mine.map((e) => [e.title, e.endDate]).sort(), [['First', '2026-12-08'], ['Second', '2026-12-09']], 'the group and the finished step are left out');
    assert.equal(mine.find((e) => e.title === 'Second').planTitle, 'Calendar plan');
    assert.equal((await call(A, 'GET', '/calendar?from=2026-12-09&to=2026-12-31')).body.steps.filter((e) => e.planId === calPlan).length, 1, 'a range keeps only steps ending inside it');
    assert.equal((await call(A, 'GET', '/calendar?from=soon')).status, 400);
    assert.equal((await call(B, 'GET', '/calendar')).body.steps.length, 0, 'another person sees none of it');
    assert.equal((await call(A, 'GET', '/calendar')).body.steps.some((e) => e.planId === tplan), false, 'every step of the Garden plan is already in Tasks, so none is shown twice');
    await call(A, 'POST', `/${calPlan}/send-to-tasks`, { stepIds: [c2.id] });
    assert.equal((await call(A, 'GET', '/calendar')).body.steps.filter((e) => e.planId === calPlan).length, 1, 'a step sent to Tasks shows as the task, not twice');
    await call(A, 'PUT', `/${calPlan}`, { status: 'archived' });
    assert.equal((await call(A, 'GET', '/calendar')).body.steps.filter((e) => e.planId === calPlan).length, 0, 'an archived plan is not on the calendar');

    // a plan with no dates: the task is made without a due date, and the answer says so
    const loose = (await call(A, 'POST', '/', { title: 'No dates yet' })).body.plan.id;
    await call(A, 'POST', `/${loose}/steps`, { title: 'Think about it' });
    r = await send({ all: true }, A, loose);
    assert.equal(r.body.created.length, 1);
    assert.equal(r.body.undated, 1);
    assert.equal((await taskRow(r.body.created[0].taskId)).dueDate, null);
    assert.equal((await send({ all: true }, A, (await call(A, 'POST', '/', { title: 'Empty' })).body.plan.id)).status, 400, 'a plan with no steps has nothing to send');

    // ---- delete -> recycle bin -> Undo brings it back with steps, dependencies and the same dates ----
    assert.equal((await dep(sign.id, plumb.id)).status, 201);
    const before = (await call(A, 'GET', `/${planId}`)).body;
    r = await call(A, 'DELETE', `/${planId}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.binId);
    assert.equal((await call(A, 'GET', `/${planId}`)).status, 404);
    assert.equal((await bin.list(B)).filter((i) => i.entityType === 'plan').length, 0, 'another person\'s recycle bin is empty');
    await bin.restoreItem(A, r.body.binId);
    const after = (await call(A, 'GET', `/${planId}`)).body;
    assert.equal(after.plan.title, 'Kitchen reno');
    assert.equal(after.plan.startDate, before.plan.startDate);
    assert.equal(after.plan.targetEndDate, before.plan.targetEndDate);
    assert.deepEqual(after.steps.map((s) => [s.title, s.durationDays, s.isMilestone]), before.steps.map((s) => [s.title, s.durationDays, s.isMilestone]));
    assert.equal(after.deps.length, 2);
    assert.deepEqual(after.schedule.projectEnd, before.schedule.projectEnd);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1)', [[A, B]]).catch(() => {});
    await pool.query('DELETE FROM drawings WHERE "userId" = ANY($1)', [[A, B]]).catch(() => {});
    await pool.query('DELETE FROM notes WHERE user_id = ANY($1)', [[A, B]]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log('plans: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
