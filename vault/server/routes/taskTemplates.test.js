#!/usr/bin/env node
/**
 * Task templates: the asSeparateTasks option creates one task per step, in order, each linked to the
 * project and its client; every other template keeps creating one task with subtasks.
 * Integration test: needs a real Postgres. Uses throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/taskTemplates.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP taskTemplates.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let userA; let userB; let clientA; let projectA;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: true }; next(); });
app.use('/api/task-templates', require('./taskTemplates'));
app.use('/api/tasks', require('./tasks'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const STEPS = ['Confirm brief', 'Extract audio', 'Clone voice', 'Generate clips', 'Add captions'];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('an ordinary template still creates one task with its steps as subtasks', async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Plain', subtasks: STEPS })).json;
  assert.strictEqual(t.asSeparateTasks, false);
  const r = await call('POST', `/api/task-templates/${t.id}/apply`, { projectId: projectA });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.taskIds, undefined);
  const parent = (await pool.query(`SELECT title,"projectId","clientId" FROM tasks WHERE id=$1`, [r.json.taskId])).rows[0];
  assert.deepStrictEqual(parent, { title: 'Plain', projectId: projectA, clientId: clientA });
  assert.strictEqual((await pool.query(`SELECT COUNT(*)::int n FROM tasks WHERE "parentTaskId"=$1`, [r.json.taskId])).rows[0].n, STEPS.length);
});

test('asSeparateTasks: one task per step, in order, linked to the project and its client; no parent task', async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Video recreation', subtasks: STEPS, asSeparateTasks: true, tags: 'video' })).json;
  assert.strictEqual(t.asSeparateTasks, true);
  const before = (await pool.query(`SELECT COUNT(*)::int n FROM tasks WHERE "userId"=$1`, [userA])).rows[0].n;
  const r = await call('POST', `/api/task-templates/${t.id}/apply`, { projectId: projectA });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.taskIds.length, STEPS.length);
  assert.strictEqual(r.json.taskId, r.json.taskIds[0], 'taskId keeps the shape the Tasks page reads');
  assert.strictEqual((await pool.query(`SELECT COUNT(*)::int n FROM tasks WHERE "userId"=$1`, [userA])).rows[0].n, before + STEPS.length, 'steps only, no extra parent task');
  const rows = (await pool.query(`SELECT title,status,priority,"projectId","clientId","parentTaskId","userId","order",recurrence FROM tasks WHERE id = ANY($1::int[]) ORDER BY id`, [r.json.taskIds])).rows;
  assert.deepStrictEqual(rows.map((x) => x.title), STEPS);
  assert.deepStrictEqual(rows.map((x) => x.order), STEPS.map((_, i) => i));
  for (const x of rows) {
    assert.strictEqual(x.projectId, projectA); assert.strictEqual(x.clientId, clientA);
    assert.strictEqual(x.parentTaskId, null); assert.strictEqual(x.userId, userA);
    assert.strictEqual(x.status, 'todo'); assert.strictEqual(x.recurrence, 'none');
  }
  const tags = (await pool.query(`SELECT COUNT(*)::int n FROM task_tags WHERE "taskId" = ANY($1::int[]) AND tag='video'`, [r.json.taskIds])).rows[0].n;
  assert.strictEqual(tags, STEPS.length, 'template tags are copied to every step');
});

test('the tasks list returns the steps in step order (not newest first)', async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Ordered', subtasks: STEPS, asSeparateTasks: true })).json;
  const proj2 = (await pool.query(`INSERT INTO projects (name,"userId",model,"clientId") VALUES ('Ordering check',$1,'m',$2) RETURNING id`, [userA, clientA])).rows[0].id;
  assert.strictEqual((await call('POST', `/api/task-templates/${t.id}/apply`, { projectId: proj2 })).status, 200);
  const list = await call('GET', `/api/tasks?projectId=${proj2}`);
  assert.deepStrictEqual(list.json.map((x) => x.title), STEPS);
});

test('without a project the steps are still separate tasks, unlinked', async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Loose', subtasks: ['A', 'B'], asSeparateTasks: true })).json;
  const r = await call('POST', `/api/task-templates/${t.id}/apply`, {});
  assert.strictEqual(r.json.taskIds.length, 2);
  const rows = (await pool.query(`SELECT "projectId","clientId" FROM tasks WHERE id = ANY($1::int[])`, [r.json.taskIds])).rows;
  assert.ok(rows.every((x) => x.projectId === null && x.clientId === null));
});

test('editing a template keeps the option unless it is sent; it can be switched on and off', async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Toggle', subtasks: ['A'], asSeparateTasks: true })).json;
  assert.strictEqual((await call('PUT', `/api/task-templates/${t.id}`, { name: 'Toggle 2' })).json.asSeparateTasks, true);
  assert.strictEqual((await call('PUT', `/api/task-templates/${t.id}`, { asSeparateTasks: false })).json.asSeparateTasks, false);
  assert.strictEqual((await call('PUT', `/api/task-templates/${t.id}`, { asSeparateTasks: true })).json.asSeparateTasks, true);
});

test("another user's template or project is refused", async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Mine', subtasks: ['A'], asSeparateTasks: true })).json;
  assert.strictEqual((await call('POST', `/api/task-templates/${t.id}/apply`, {}, 'B')).status, 404);
  const bProject = (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ('B only',$1,'m') RETURNING id`, [userB])).rows[0].id;
  assert.strictEqual((await call('POST', `/api/task-templates/${t.id}/apply`, { projectId: bProject })).status, 400);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1,'x') RETURNING id`, [`tt-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  clientA = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'Client A') RETURNING id`, [userA])).rows[0].id;
  projectA = (await pool.query(`INSERT INTO projects (name,"userId",model,"clientId","projectType") VALUES ('A project',$1,'m',$2,'client') RETURNING id`, [userA, clientA])).rows[0].id;
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const t of tests) {
      try { await t.fn(); console.log(`  ok   ${t.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
    }
  } finally {
    server.close();
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[userA, userB]]); // everything above cascades from users
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
