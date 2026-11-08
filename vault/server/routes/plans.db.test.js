'use strict';
// DATABASE_URL=... node server/routes/plans.db.test.js
// Real database, fake sign-in. Proves:
//   - a plan can be made, read, changed and listed; bad dates, bad status and an end date before the start are refused;
//   - steps: add, change, nest under a group, move, delete; a group takes no dependencies and a step with dependencies cannot become a group;
//   - dependencies: add, a circle and a step waiting on itself are refused; the schedule follows them and reports whether the plan fits;
//   - a plan with only an end date suggests the start that makes it finish on time;
//   - one person cannot see, change or delete another's plan or steps (404), nor link a step from another person's plan;
//   - plan steps never appear in the tasks table;
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
    let r = await call(A, 'POST', '/', { title: 'Kitchen reno', startDate: '2026-12-07', targetEndDate: '2026-12-11' });
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
    assert.deepEqual([sc.steps[sign.id].start, sc.steps[sign.id].end], ['2026-12-14', '2026-12-14']);
    assert.equal(sc.projectEnd, '2026-12-14');
    assert.equal(sc.fit.fits, false);                                       // the plan wanted to be done by the 11th
    assert.equal(sc.fit.overByWorkDays, 1);
    assert.equal(r.body.deps.length, 2);

    // ---- a plan with only an end date suggests when to start ----
    r = await call(A, 'PUT', `/${planId}`, { startDate: null, targetEndDate: '2026-12-18' });
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.scheduled, false);
    assert.equal(r.body.schedule.suggestedStart, '2026-12-11');             // demolition 2 + plumbing 3 + sign-off 1 = six working days ending the 18th
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
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log('plans: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
