#!/usr/bin/env node
/**
 * Tasks and Goals use the shared recycle bin: a deleted task (with its subtasks, tags, comments, blocked-by links and files)
 * or goal (with its key results and the tasks linked to them) is kept 30 days and comes back whole; private; and its files go
 * only when the item is gone for good.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/tasksRecycleBin.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP tasksRecycleBin.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/tasks', require('./tasks'));
app.use('/api/goals', require('./goals'));
app.use('/api/recycle-bin', require('./recycleBin'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-task-bin-'));
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const task = async (title, user, extra = {}) => (await one(
  `INSERT INTO tasks (title, notes, "userId", "parentTaskId", "dueDate", "shareToken") VALUES ($1, 'a private note', $2, $3, $4, $5) RETURNING id`,
  [title, user, extra.parent || null, extra.due || null, extra.share || null])).id;
const file = async (user, entityId, name) => {
  const stored = path.join(dir, `${entityId}-${name}`);
  fs.writeFileSync(stored, 'file body');
  return (await one(`INSERT INTO attachments ("userId","entityType","entityId",filename,"storedPath","mimeType","sizeBytes") VALUES ($1,'task',$2,$3,$4,'text/plain',9) RETURNING id`, [user, entityId, name, stored])).id;
};
const inBin = async (binId, as) => (await call('GET', '/api/recycle-bin', undefined, as)).json.items.some((i) => i.id === binId);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a deleted task goes to the bin whole and Undo brings back the task, subtasks, tags, comments, links, share link and files', async () => {
  const parent = await task('Quote the Hendersons', A, { due: '2026-11-30', share: `share-${run}` });
  const sub = await task('Measure up', A, { parent });
  const blocker = await task('Get the plans', A);
  await pool.query('INSERT INTO task_tags ("taskId", tag) VALUES ($1,$2),($1,$3),($4,$2)', [parent, 'urgent', 'home', sub]);
  await pool.query(`INSERT INTO task_comments ("taskId", type, content) VALUES ($1,'user','Called them'),($2,'system','Marked started')`, [parent, sub]);
  await pool.query('INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2)', [parent, blocker]);
  const fileId = await file(A, parent, 'plan.txt');
  const subFileId = await file(A, sub, 'tape.txt');
  const stored = (await one('SELECT "storedPath" FROM attachments WHERE id=$1', [fileId])).storedPath;

  const del = await call('DELETE', `/api/tasks/${parent}`);
  assert.strictEqual(del.status, 200);
  assert.ok(del.json.binId && del.json.retentionDays === 30);
  assert.strictEqual((await q('SELECT 1 FROM tasks WHERE id = ANY($1::int[])', [[parent, sub]])).length, 0, 'task and subtask are gone from Tasks');
  assert.strictEqual((await q('SELECT 1 FROM task_dependencies WHERE "taskId"=$1', [parent])).length, 0);
  assert.ok(fs.existsSync(stored), 'the file stays on disk while the task waits in the bin');
  const item = (await call('GET', '/api/recycle-bin')).json.items.find((i) => i.id === del.json.binId);
  assert.deepStrictEqual({ type: item.entityType, label: item.label, title: item.title, detail: item.detail },
    { type: 'task', label: 'Task', title: 'Quote the Hendersons', detail: 'Due 2026-11-30 · 1 subtask · 2 files' });

  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  const t = await one('SELECT * FROM tasks WHERE id=$1', [Number(back.json.entityId)]);
  assert.strictEqual(t.id, parent, 'the old number is reused');
  assert.deepStrictEqual({ title: t.title, notes: t.notes, dueDate: t.dueDate, userId: t.userId, shareToken: t.shareToken }, { title: 'Quote the Hendersons', notes: 'a private note', dueDate: '2026-11-30', userId: A, shareToken: `share-${run}` });
  const s = await one('SELECT * FROM tasks WHERE id=$1', [sub]);
  assert.strictEqual(s.parentTaskId, parent, 'the subtask is back under it');
  assert.deepStrictEqual((await q('SELECT tag FROM task_tags WHERE "taskId"=$1 ORDER BY tag', [parent])).map((r) => r.tag), ['home', 'urgent']);
  assert.deepStrictEqual((await q('SELECT tag FROM task_tags WHERE "taskId"=$1', [sub])).map((r) => r.tag), ['urgent']);
  assert.deepStrictEqual((await q('SELECT type, content FROM task_comments WHERE "taskId" = ANY($1::int[]) ORDER BY id', [[parent, sub]])).map((r) => `${r.type}:${r.content}`), ['user:Called them', 'system:Marked started']);
  assert.strictEqual((await q('SELECT 1 FROM task_dependencies WHERE "taskId"=$1 AND "blockedByTaskId"=$2', [parent, blocker])).length, 1, 'still blocked by the same task');
  assert.deepStrictEqual((await q(`SELECT id, "entityId" FROM attachments WHERE "entityType"='task' AND id = ANY($1::int[]) ORDER BY id`, [[fileId, subFileId]])).map((r) => r.entityId), [parent, sub], 'files point at their tasks again');
  assert.ok(!(await inBin(del.json.binId)), 'and it left the bin');
});

test('what changed while it was in the bin does not stop a restore: gone project, taken id, used share link, gone blocker', async () => {
  const proj = (await one(`INSERT INTO projects (name, "userId") VALUES ('Temp project', $1) RETURNING id`, [A])).id;
  const blocker = await task('Blocker', A);
  const id = await task('Linked task', A, { share: `again-${run}` });
  await pool.query('UPDATE tasks SET "projectId"=$1 WHERE id=$2', [proj, id]);
  await pool.query('INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2)', [id, blocker]);
  const del = await call('DELETE', `/api/tasks/${id}`);
  await pool.query('DELETE FROM projects WHERE id=$1', [proj]); // the project goes
  await call('DELETE', `/api/tasks/${blocker}`); // and so does the blocker
  const taker = await task('Took the number', A, { share: `again-${run}` }); // a new task uses the share link
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  const t = await one('SELECT * FROM tasks WHERE id=$1', [Number(back.json.entityId)]);
  assert.strictEqual(t.projectId, null, 'back without the deleted project');
  assert.strictEqual(t.shareToken, null, 'back without a share link that is now in use');
  assert.strictEqual((await q('SELECT 1 FROM task_dependencies WHERE "taskId"=$1', [t.id])).length, 0, 'and without a link to a task that is gone');
});

test('bulk delete bins one item per task (a subtask picked with its parent travels inside the parent) and each can be restored', async () => {
  const a = await task('Bulk one', A);
  const b = await task('Bulk two', A);
  const bSub = await task('Bulk two sub', A, { parent: b });
  const del = await call('DELETE', '/api/tasks/bulk', { ids: [a, b, bSub] });
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual(del.json.binIds.length, 2, 'two items, not three');
  assert.strictEqual((await q('SELECT 1 FROM tasks WHERE id = ANY($1::int[])', [[a, b, bSub]])).length, 0);
  for (const binId of del.json.binIds) assert.strictEqual((await call('POST', `/api/recycle-bin/${binId}/restore`)).status, 200);
  assert.strictEqual((await q('SELECT 1 FROM tasks WHERE id = ANY($1::int[])', [[a, b, bSub]])).length, 3);
  assert.strictEqual((await one('SELECT "parentTaskId" FROM tasks WHERE id=$1', [bSub])).parentTaskId, b);
  await pool.query('DELETE FROM tasks WHERE id = ANY($1::int[])', [[a, b, bSub]]);
});

test("stopping a series bins the task you deleted; the later repeats are removed for good", async () => {
  const group = `series-${run}`;
  const first = await task('Weekly report', A);
  const later = await task('Weekly report (next)', A);
  await pool.query('UPDATE tasks SET "recurrenceGroupId"=$1 WHERE id = ANY($2::int[])', [group, [first, later]]);
  const del = await call('DELETE', `/api/tasks/${first}?stopSeries=true`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await q('SELECT 1 FROM tasks WHERE id = ANY($1::int[])', [[first, later]])).length, 0);
  assert.ok(await inBin(del.json.binId), 'the deleted one can be restored');
  await call('DELETE', `/api/recycle-bin/${del.json.binId}`);
});

test("private: another person cannot delete, see or restore someone's task; a missing task is a 404 and nothing is binned", async () => {
  const mine = await task('Only mine', A);
  const before = (await call('GET', '/api/recycle-bin', undefined, 'B')).json.items.length;
  const r = await call('DELETE', `/api/tasks/${mine}`, undefined, 'B');
  assert.strictEqual(r.status, 404);
  assert.ok(await one('SELECT 1 FROM tasks WHERE id=$1', [mine]), 'still there');
  assert.strictEqual((await call('DELETE', '/api/tasks/999999999')).status, 404);
  const del = await call('DELETE', `/api/tasks/${mine}`);
  assert.ok(!(await inBin(del.json.binId, 'B')), 'not in their bin');
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('GET', '/api/recycle-bin', undefined, 'B')).json.items.length, before);
  await call('DELETE', `/api/recycle-bin/${del.json.binId}`);
});

test('the files go only when the task is gone for good (Delete forever), not while it is in the bin', async () => {
  const id = await task('With a file', A);
  const fid = await file(A, id, 'keep.txt');
  const stored = (await one('SELECT "storedPath" FROM attachments WHERE id=$1', [fid])).storedPath;
  const del = await call('DELETE', `/api/tasks/${id}`);
  assert.ok(fs.existsSync(stored));
  assert.strictEqual((await call('DELETE', `/api/recycle-bin/${del.json.binId}`)).status, 200);
  assert.ok(!fs.existsSync(stored), 'file removed from disk');
  assert.strictEqual((await q('SELECT 1 FROM attachments WHERE id=$1', [fid])).length, 0, 'and its row');
});

test('a deleted goal goes to the bin with its key results and Undo brings back the goal, key results and the links from tasks', async () => {
  const create = await call('POST', '/api/goals', { title: 'Grow the business', timeframe: '2026' });
  assert.ok([200, 201].includes(create.status), JSON.stringify(create.json));
  const goal = create.json.id;
  const kr1 = (await call('POST', `/api/goals/${goal}/key-results`, { title: 'Ten new clients', targetValue: 10 })).json.id;
  const kr2 = (await call('POST', `/api/goals/${goal}/key-results`, { title: 'Revenue', targetValue: 100000, unit: '$' })).json.id;
  const linked = await task('Call prospects', A);
  const other = await task('Not linked', A);
  await pool.query('UPDATE tasks SET "keyResultId"=$1 WHERE id=$2', [kr1, linked]);

  const del = await call('DELETE', `/api/goals/${goal}`);
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual((await q('SELECT 1 FROM objectives WHERE id=$1', [goal])).length, 0);
  assert.strictEqual((await q('SELECT 1 FROM key_results WHERE "objectiveId"=$1', [goal])).length, 0);
  assert.strictEqual((await one('SELECT "keyResultId" FROM tasks WHERE id=$1', [linked])).keyResultId, null, 'the task is unlinked, as before');
  const item = (await call('GET', '/api/recycle-bin')).json.items.find((i) => i.id === del.json.binId);
  assert.deepStrictEqual({ type: item.entityType, label: item.label, title: item.title, detail: item.detail },
    { type: 'goal', label: 'Goal', title: 'Grow the business', detail: '2 key results · 1 linked task' });

  // someone links the other task to a different key result meanwhile: restore must not take it away
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.strictEqual(Number(back.json.entityId), goal);
  const krs = await q('SELECT id, title, "targetValue", unit FROM key_results WHERE "objectiveId"=$1 ORDER BY id', [goal]);
  assert.deepStrictEqual(krs.map((k) => [k.id, k.title, k.targetValue, k.unit]), [[kr1, 'Ten new clients', 10, '%'], [kr2, 'Revenue', 100000, '$']]);
  assert.strictEqual((await one('SELECT "keyResultId" FROM tasks WHERE id=$1', [linked])).keyResultId, kr1, 'linked again');
  assert.strictEqual((await one('SELECT "keyResultId" FROM tasks WHERE id=$1', [other])).keyResultId, null);
  assert.strictEqual((await one('SELECT "userId" FROM objectives WHERE id=$1', [goal])).userId, A);
  assert.strictEqual((await call('DELETE', `/api/goals/${goal}`, undefined, 'B')).status, 404, "someone else cannot delete it");
  await pool.query('DELETE FROM objectives WHERE id=$1', [goal]);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`tb-${tag}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const x of tests) {
      try { await x.fn(); console.log(`  ok   ${x.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${x.name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
    }
  } finally {
    server.close();
    await pool.query(`DELETE FROM attachments WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM objectives WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM tasks WHERE "userId" = ANY($1::int[]) OR "parentTaskId" IN (SELECT id FROM tasks WHERE "userId" = ANY($1::int[]))`, [[A, B]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // the bin rows cascade from users
    await pool.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
