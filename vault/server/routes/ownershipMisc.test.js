#!/usr/bin/env node
/**
 * Three small ownership gaps: goal key results (edit/delete), project re-ordering, and saving a comparison
 * under a project. Another user gets the same 404 as for a missing record (or, for re-ordering, the same
 * "skipped like a missing id"), and nothing is changed.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/ownershipMisc.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP ownershipMisc.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
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
app.use('/api/goals', require('./goals'));
app.use('/api/projects', require('./projects'));
app.use('/api/compare', require('./compare'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const ids = {};
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("goal key results: another user cannot edit or delete someone else's; same 404 as a missing key result; owner can", async () => {
  const edit = await call('PUT', `/api/goals/key-results/${ids.krA}`, 'B', { title: 'B WAS HERE', currentValue: 99 });
  assert.strictEqual(edit.status, 404); assert.deepStrictEqual(edit.json, { error: 'Key result not found' });
  const row = (await q('SELECT title, "currentValue" FROM key_results WHERE id=$1', [ids.krA]))[0];
  assert.strictEqual(row.title, 'A-KR'); assert.strictEqual(Number(row.currentValue), 0);
  const del = await call('DELETE', `/api/goals/key-results/${ids.krA}`, 'B');
  assert.strictEqual(del.status, 404); assert.deepStrictEqual(del.json, edit.json);
  assert.strictEqual((await q('SELECT COUNT(*)::int n FROM key_results WHERE id=$1', [ids.krA]))[0].n, 1, 'the key result is still there');
  assert.strictEqual((await q('SELECT "keyResultId" k FROM tasks WHERE id=$1', [ids.taskA]))[0].k, ids.krA, "A's task is still linked to it");
  const missing = await call('PUT', '/api/goals/key-results/999999999', 'B', { title: 'x' });
  assert.deepStrictEqual(missing.json, edit.json);
  const own = await call('PUT', `/api/goals/key-results/${ids.krA}`, undefined, { title: 'A-KR-renamed' });
  assert.strictEqual(own.status, 200); assert.strictEqual(own.json.title, 'A-KR-renamed');
  assert.deepStrictEqual((await call('DELETE', `/api/goals/key-results/${ids.krA}`)).json, { ok: true });
  assert.strictEqual((await q('SELECT "keyResultId" k FROM tasks WHERE id=$1', [ids.taskA]))[0].k, null);
});

test("project re-ordering: only the caller's own projects change; someone else's id is skipped like a missing one", async () => {
  const sortOf = async (id) => (await q('SELECT "sortOrder" s FROM projects WHERE id=$1', [id]))[0].s;
  const before = await sortOf(ids.projA);
  const r = await call('PATCH', '/api/projects/reorder', 'B', { ids: [ids.projA, ids.projB, 999999999] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await sortOf(ids.projA), before, "A's sort order is unchanged");
  assert.strictEqual(await sortOf(ids.projB), 1, "B's own project was re-ordered");
  const own = await call('PATCH', '/api/projects/reorder', undefined, { ids: [ids.projB, ids.projA] });
  assert.strictEqual(own.status, 200);
  assert.strictEqual(await sortOf(ids.projA), 1, 'the owner re-orders their own');
  assert.strictEqual(await sortOf(ids.projB), 1, "and B's is untouched by A's request");
  assert.strictEqual((await call('PATCH', '/api/projects/reorder', undefined, { ids: 'nope' })).status, 400, 'input check unchanged');
});

test("saving a comparison: another user cannot file one under someone else's project; the owner and an unfiled save still work", async () => {
  const marker = `cmp-${run}`;
  const saved = async () => (await q('SELECT "projectId" FROM comparisons WHERE "docAName"=$1', [marker]));
  const r = await call('POST', '/api/compare/save', 'B', { projectId: ids.projA, docAName: marker, docBName: 'b', mode: 'diff', model: 'm', result: 'r' });
  assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, { error: 'Not found' });
  assert.strictEqual((await saved()).length, 0, 'nothing was filed in the other project');
  const missing = await call('POST', '/api/compare/save', 'B', { projectId: 999999999, docAName: marker, result: 'r' });
  assert.deepStrictEqual(missing.json, r.json); assert.strictEqual(missing.status, 404);
  assert.strictEqual((await call('POST', '/api/compare/save', undefined, { projectId: ids.projA, docAName: marker, result: 'r' })).status, 200);
  assert.strictEqual((await call('POST', '/api/compare/save', 'B', { docAName: marker, result: 'r' })).status, 200, 'no project: unchanged');
  assert.deepStrictEqual((await saved()).map((x) => x.projectId).sort(), [null, ids.projA].sort());
  assert.strictEqual((await call('POST', '/api/compare/save', 'B', { docAName: marker })).status, 400, 'input check unchanged');
  await pool.query('DELETE FROM comparisons WHERE "docAName"=$1', [marker]);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`om-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const proj = async (u, n, sort) => (await q(`INSERT INTO projects (name,"userId",model,"sortOrder") VALUES ($1,$2,'m',$3) RETURNING id`, [n, u, sort]))[0].id;
  ids.projA = await proj(A, 'A', 7); ids.projB = await proj(B, 'B', 9);
  const obj = (await q(`INSERT INTO objectives (title,"userId") VALUES ('A-GOAL',$1) RETURNING id`, [A]))[0].id;
  ids.obj = obj;
  ids.krA = (await q(`INSERT INTO key_results ("objectiveId",title,"targetValue","currentValue") VALUES ($1,'A-KR',10,0) RETURNING id`, [obj]))[0].id;
  ids.taskA = (await q(`INSERT INTO tasks (title,"userId","keyResultId") VALUES ('A-TASK',$1,$2) RETURNING id`, [A, ids.krA]))[0].id;
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
    await pool.query(`DELETE FROM tasks WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM key_results WHERE "objectiveId" = $1`, [ids.obj]);
    await pool.query(`DELETE FROM objectives WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
