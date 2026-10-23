#!/usr/bin/env node
/**
 * Tasks: every route that addresses a task, subtask, comment or dependency by id works only on the
 * caller's own tasks: share links, copy, bulk edit, bulk delete, reorder, comments, subtasks and
 * dependencies. Another user gets the same 404 (or the same empty result) as for a record that does not
 * exist, and nothing is read, changed, deleted or created. A template-made subtask (no user id of its
 * own) counts as its parent's owner's.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/tasksOwnership.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP tasksOwnership.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/tasks', require('./tasks'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const t = {}; // ids of the seeded rows
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const taskRow = async (id) => (await q('SELECT * FROM tasks WHERE id=$1', [id]))[0];
const count = async (sql, p) => (await q(sql, p))[0].n;
const NF = { error: 'not found' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('subtasks: the owner sees them (including a template-made one); another user gets the missing-task empty list', async () => {
  const own = await call('GET', `/api/tasks/${t.parentA}/subtasks`);
  assert.deepStrictEqual(own.json.map((s) => s.title).sort(), ['A-SUB-TEMPLATE']);
  const other = await call('GET', `/api/tasks/${t.parentA}/subtasks`, 'B');
  const missing = await call('GET', '/api/tasks/999999999/subtasks', 'B');
  assert.deepStrictEqual(other.json, []);
  assert.deepStrictEqual(other.json, missing.json);
});

test('adding a subtask: another user gets 404 and nothing is created; the owner can, including under a template-made subtask', async () => {
  const before = await count('SELECT COUNT(*)::int n FROM tasks WHERE "parentTaskId"=$1', [t.parentA]);
  const r = await call('POST', `/api/tasks/${t.parentA}/subtasks`, 'B', { title: 'planted' });
  assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, { error: 'parent not found' });
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM tasks WHERE "parentTaskId"=$1', [t.parentA]), before);
  assert.deepStrictEqual((await call('POST', '/api/tasks/999999999/subtasks', 'B', { title: 'x' })).json, r.json, 'same answer as a missing task');
  const ok = await call('POST', `/api/tasks/${t.parentA}/subtasks`, undefined, { title: 'mine' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await call('POST', `/api/tasks/${t.subA}/subtasks`, undefined, { title: 'nested' })).status, 200, 'owner via the parent chain');
});

test('share link: another user cannot create or revoke one; nothing is published; the owner can', async () => {
  const r = await call('POST', `/api/tasks/${t.parentA}/share`, 'B');
  assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, NF);
  assert.strictEqual((await taskRow(t.parentA)).shareToken, null, 'no public link was created');
  assert.deepStrictEqual((await call('POST', '/api/tasks/999999999/share', 'B')).json, r.json);
  const own = await call('POST', `/api/tasks/${t.parentA}/share`);
  assert.strictEqual(own.status, 200); assert.ok(own.json.token);
  const del = await call('DELETE', `/api/tasks/${t.parentA}/share`, 'B');
  assert.strictEqual(del.status, 404);
  assert.strictEqual((await taskRow(t.parentA)).shareToken, own.json.token, 'the owner\'s link is still live');
  assert.deepStrictEqual((await call('DELETE', `/api/tasks/${t.parentA}/share`)).json, { ok: true });
  assert.strictEqual((await taskRow(t.parentA)).shareToken, null);
});

test("copy: another user cannot copy someone else's task into their account; the owner can", async () => {
  const before = await count('SELECT COUNT(*)::int n FROM tasks WHERE "userId"=$1', [B]);
  const r = await call('POST', `/api/tasks/${t.parentA}/duplicate`, 'B');
  assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, NF);
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM tasks WHERE "userId"=$1', [B]), before, 'nothing was copied');
  assert.deepStrictEqual((await call('POST', '/api/tasks/999999999/duplicate', 'B')).json, r.json);
  const own = await call('POST', `/api/tasks/${t.parentA}/duplicate`);
  assert.strictEqual(own.status, 200); assert.ok(/\(copy\)/.test(own.json.title));
});

test('bulk edit: only the caller\'s own tasks change; someone else\'s are ignored, exactly as missing ids are', async () => {
  const r = await call('PUT', '/api/tasks/bulk', 'B', { ids: [t.parentA, t.otherA, 999999999], updates: { priority: 'low', status: 'in-progress' } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.updated, 0);
  for (const id of [t.parentA, t.otherA]) { const row = await taskRow(id); assert.strictEqual(row.priority, 'medium'); assert.strictEqual(row.status, 'todo'); }
  const mixed = await call('PUT', '/api/tasks/bulk', 'B', { ids: [t.parentA, t.taskB], updates: { priority: 'high' } });
  assert.strictEqual(mixed.json.updated, 1);
  assert.strictEqual((await taskRow(t.taskB)).priority, 'high');
  assert.strictEqual((await taskRow(t.parentA)).priority, 'medium');
  const own = await call('PUT', '/api/tasks/bulk', undefined, { ids: [t.parentA, t.subA], updates: { priority: 'low' } });
  assert.strictEqual(own.json.updated, 2, 'the owner, including a template-made subtask');
  assert.strictEqual((await taskRow(t.subA)).priority, 'low');
});

test('reorder: another user cannot change the order of someone else\'s tasks; the owner can', async () => {
  const before = (await taskRow(t.otherA)).order;
  const r = await call('PUT', '/api/tasks/reorder', 'B', { items: [{ id: t.otherA, order: 77 }, { id: t.taskB, order: 5 }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await taskRow(t.otherA)).order, before, "A's order is unchanged");
  assert.strictEqual((await taskRow(t.taskB)).order, 5, 'B\'s own task did reorder');
  await call('PUT', '/api/tasks/reorder', undefined, { items: [{ id: t.otherA, order: 41 }] });
  assert.strictEqual((await taskRow(t.otherA)).order, 41);
});

test('comments: another user cannot read, add or delete comments on someone else\'s task; the owner can (also on a template-made subtask)', async () => {
  assert.deepStrictEqual((await call('GET', `/api/tasks/${t.parentA}/comments`, 'B')).json, [], 'same empty list as a missing task');
  const add = await call('POST', `/api/tasks/${t.parentA}/comments`, 'B', { content: 'planted' });
  assert.strictEqual(add.status, 404); assert.deepStrictEqual(add.json, NF);
  assert.strictEqual(await count(`SELECT COUNT(*)::int n FROM task_comments WHERE "taskId"=$1 AND content='planted'`, [t.parentA]), 0);
  const del = await call('DELETE', `/api/tasks/comments/${t.commentA}`, 'B');
  assert.strictEqual(del.status, 404); assert.deepStrictEqual(del.json, NF);
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM task_comments WHERE id=$1', [t.commentA]), 1, 'the comment is still there');
  assert.deepStrictEqual((await call('DELETE', '/api/tasks/comments/999999999', 'B')).json, del.json, 'same answer as a missing comment');
  assert.deepStrictEqual((await call('GET', `/api/tasks/${t.parentA}/comments`)).json.map((c) => c.content), ['A-COMMENT']);
  assert.strictEqual((await call('POST', `/api/tasks/${t.subA}/comments`, undefined, { content: 'on the sub' })).status, 200);
  assert.deepStrictEqual((await call('DELETE', `/api/tasks/comments/${t.commentA}`)).json, { ok: true });
});

test('dependencies: another user cannot read, add or remove them; links between two people\'s tasks cannot be made; the owner can', async () => {
  assert.deepStrictEqual((await call('GET', `/api/tasks/${t.otherA}/dependencies`, 'B')).json, { blockers: [], dependents: [] });
  const own = await call('GET', `/api/tasks/${t.otherA}/dependencies`);
  assert.deepStrictEqual(own.json.blockers.map((x) => x.id), [t.parentA]);
  const before = await count('SELECT COUNT(*)::int n FROM task_dependencies', []);
  for (const [as, task, blocker] of [['B', t.otherA, t.taskB], ['B', t.taskB, t.otherA], [undefined, t.otherA, t.taskB], [undefined, t.taskB, t.otherA]]) {
    const r = await call('POST', `/api/tasks/${task}/dependencies`, as, { blockedByTaskId: blocker });
    assert.strictEqual(r.status, 404, `${as || 'A'}: ${task} blocked by ${blocker}`); assert.deepStrictEqual(r.json, NF);
  }
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM task_dependencies', []), before, 'no link was made');
  const del = await call('DELETE', `/api/tasks/${t.otherA}/dependencies/${t.parentA}`, 'B');
  assert.strictEqual(del.status, 404);
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM task_dependencies WHERE "taskId"=$1', [t.otherA]), 1, 'the owner\'s link is still there');
  assert.strictEqual((await call('POST', `/api/tasks/${t.parentA}/dependencies`, undefined, { blockedByTaskId: t.subA })).status, 200, 'the owner can link their own tasks');
});

test('an old link from one person\'s task to another person\'s is never shown to either side', async () => {
  await pool.query('INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2)', [t.otherA, t.taskB]);
  const a = await call('GET', `/api/tasks/${t.otherA}/dependencies`);
  assert.ok(!a.json.blockers.some((x) => x.id === t.taskB), "B's task is not listed to A");
  const b = await call('GET', `/api/tasks/${t.taskB}/dependencies`, 'B');
  assert.ok(!b.json.dependents.some((x) => x.id === t.otherA), "A's task is not listed to B");
});

test('bulk delete: another user deletes nothing, not the tasks, their subtasks or their attachments; the owner can', async () => {
  const snapshot = async () => JSON.stringify([await count('SELECT COUNT(*)::int n FROM tasks WHERE id = ANY($1::int[])', [[t.deleteA, t.deleteSubA]]), await count(`SELECT COUNT(*)::int n FROM attachments WHERE "entityType"='task' AND "entityId"=$1`, [t.deleteA])]);
  const before = await snapshot();
  const r = await call('DELETE', '/api/tasks/bulk', 'B', { ids: [t.deleteA, t.deleteSubA, 999999999] });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.deleted, 0);
  assert.strictEqual(await snapshot(), before, 'tasks, subtask and attachment are all still there');
  const mixed = await call('DELETE', '/api/tasks/bulk', 'B', { ids: [t.deleteA, t.deleteB] });
  assert.strictEqual(mixed.json.deleted, 1);
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM tasks WHERE id=$1', [t.deleteB]), 0, "B's own task went");
  assert.strictEqual(await snapshot(), before, "A's stayed");
  const own = await call('DELETE', '/api/tasks/bulk', undefined, { ids: [t.deleteA] });
  assert.strictEqual(own.json.deleted, 1);
  assert.strictEqual(await count('SELECT COUNT(*)::int n FROM tasks WHERE id = ANY($1::int[])', [[t.deleteA, t.deleteSubA]]), 0, 'the owner removed the task and its subtask');
  assert.strictEqual(await count(`SELECT COUNT(*)::int n FROM attachments WHERE "entityType"='task' AND "entityId"=$1`, [t.deleteA]), 1, 'its attachment record stays while the task waits in the recycle bin (removed when it is deleted forever: tasksRecycleBin.test.js)');
  assert.strictEqual(await count(`SELECT COUNT(*)::int n FROM recycle_bin WHERE "userId"=$1 AND "entityType"='task' AND "entityId"=$2`, [A, String(t.deleteA)]), 1, 'and the task is in the bin');
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`tk-${tag}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const task = async (title, user, parent = null) => (await q(`INSERT INTO tasks (title,notes,"userId","parentTaskId") VALUES ($1,'a private note',$2,$3) RETURNING id`, [title, user, parent]))[0].id;
  t.parentA = await task('A-PARENT', A);
  t.subA = await task('A-SUB-TEMPLATE', null, t.parentA); // made by a template: no user id of its own
  t.otherA = await task('A-OTHER', A);
  t.taskB = await task('B-TASK', B);
  t.commentA = (await q(`INSERT INTO task_comments ("taskId",content) VALUES ($1,'A-COMMENT') RETURNING id`, [t.parentA]))[0].id;
  await pool.query('INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2)', [t.otherA, t.parentA]);
  t.deleteA = await task('A-TO-DELETE', A);
  t.deleteSubA = await task('A-TO-DELETE-SUB', null, t.deleteA);
  t.deleteB = await task('B-TO-DELETE', B);
  await pool.query(`INSERT INTO attachments ("userId","entityType","entityId",filename,"storedPath") VALUES ($1,'task',$2,'a.txt','/nowhere/a.txt')`, [A, t.deleteA]);
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const x of tests) {
      try { await x.fn(); console.log(`  ok   ${x.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${x.name}\n       ${e.message}`); }
    }
  } finally {
    server.close();
    await pool.query(`DELETE FROM attachments WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM tasks WHERE "userId" = ANY($1::int[]) OR "parentTaskId" IN (SELECT id FROM tasks WHERE "userId" = ANY($1::int[]))`, [[A, B]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
