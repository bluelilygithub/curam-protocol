#!/usr/bin/env node
/**
 * Saving a debate (POST /api/debate/start with save: true) files it only under a project the caller
 * owns; adding rounds to a project-filed debate is limited to that project's owner. Another user gets
 * the same 404 as for a missing project, nothing is stored, and no model is called. The model service
 * is replaced by a fake, so nothing leaves the machine.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/debate.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP debate.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = 'ENV-KEY';

const assert = require('assert');
const http = require('http');
const express = require('express');

// Fake Gemini: counts model calls.
let modelCalls = 0;
const geminiPath = require.resolve('@google/generative-ai');
class FakeGenAI { getGenerativeModel() { return { generateContent: async () => { modelCalls++; return { response: { text: () => 'fake answer', usageMetadata: {} } }; } }; } }
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: { GoogleGenerativeAI: FakeGenAI } };
const { pool } = require('../db');

let A; let B; let projA; let projB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/debate', require('./debate'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const topic = (t) => `debate-${t}-${run}`;
const start = (as, extra) => call('POST', '/api/debate/start', as, { topic: topic(extra.t), modelA: 'gemini-test', modelB: 'gemini-test', save: true, ...extra.body });
const rows = async (t) => (await pool.query('SELECT "debateId", "projectId", rounds FROM debates WHERE topic=$1', [topic(t)])).rows;
const MISSING = { error: 'Not found' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("another user cannot file a debate under someone else's project: 404, nothing stored, no model called", async () => {
  const calls = modelCalls;
  const r = await start('B', { t: 'steal', body: { projectId: projA } });
  assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, MISSING);
  assert.strictEqual((await rows('steal')).length, 0, 'nothing was filed in the other project');
  assert.strictEqual(modelCalls, calls, 'no model was called for a stranger');
  const missing = await start('B', { t: 'missing', body: { projectId: 999999999 } });
  assert.strictEqual(missing.status, 404); assert.deepStrictEqual(missing.json, r.json, 'same answer as a missing project');
  assert.strictEqual((await rows('missing')).length, 0);
});

test('the owner can file a debate under their own project, or save one with no project', async () => {
  const own = await start(undefined, { t: 'own', body: { projectId: projA } });
  assert.strictEqual(own.status, 200, JSON.stringify(own.json));
  assert.ok(own.json.debateId);
  assert.strictEqual((await rows('own'))[0].projectId, projA);
  const loose = await start('B', { t: 'loose', body: {} });
  assert.strictEqual(loose.status, 200); assert.ok(loose.json.debateId);
  assert.strictEqual((await rows('loose'))[0].projectId, null);
  const mineB = await start('B', { t: 'bown', body: { projectId: projB } });
  assert.strictEqual(mineB.status, 200);
  assert.strictEqual((await rows('bown'))[0].projectId, projB);
});

test('without save, a project id is not used and nothing is stored (unchanged)', async () => {
  const r = await call('POST', '/api/debate/start', 'B', { topic: topic('nosave'), modelA: 'gemini-test', modelB: 'gemini-test', projectId: projA });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.debateId, null);
  assert.strictEqual((await rows('nosave')).length, 0);
  assert.strictEqual((await call('POST', '/api/debate/start', 'B', { topic: 'x' })).status, 400, 'input check unchanged');
});

test("adding a round: only the owner of the project a debate is filed under can add to it; others are skipped like a missing debate", async () => {
  const id = (await rows('own'))[0].debateId;
  const body = { debateId: id, topic: topic('own'), modelA: 'gemini-test', modelB: 'gemini-test', roundNumber: 2, responseA: 'a', responseB: 'b' };
  const before = JSON.parse((await rows('own'))[0].rounds).length;
  const intruder = await call('POST', '/api/debate/round', 'B', body);
  assert.strictEqual(intruder.status, 200, 'same reply as for any round');
  assert.strictEqual(JSON.parse((await rows('own'))[0].rounds).length, before, "B's round was not added to A's debate");
  const ghost = await call('POST', '/api/debate/round', 'B', { ...body, debateId: `no-such-${run}` });
  assert.strictEqual(ghost.status, 200);
  assert.strictEqual((await call('POST', '/api/debate/round', undefined, body)).status, 200);
  assert.strictEqual(JSON.parse((await rows('own'))[0].rounds).length, before + 1, 'the owner can add a round');
});

test('a debate saved with no project keeps taking rounds from whoever holds its id (unchanged: there is no owner to check)', async () => {
  const id = (await rows('loose'))[0].debateId;
  const r = await call('POST', '/api/debate/round', 'B', { debateId: id, topic: topic('loose'), modelA: 'gemini-test', modelB: 'gemini-test', roundNumber: 2, responseA: 'a', responseB: 'b' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse((await rows('loose'))[0].rounds).length, 2);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`db-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const proj = async (u, n) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [n, u])).rows[0].id;
  projA = await proj(A, 'A'); projB = await proj(B, 'B');
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
    await pool.query(`DELETE FROM debates WHERE topic LIKE $1`, [`debate-%-${run}`]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
