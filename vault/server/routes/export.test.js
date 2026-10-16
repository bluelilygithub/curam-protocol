#!/usr/bin/env node
/**
 * Exports (chat JSON, chat PDF, project JSON, project list) cover only the caller's own chats and
 * projects. Someone else's, or one that does not exist, gets the same 404.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/export.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP export.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/export', require('./export'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* not JSON */ }
  return { status: res.status, json, type: res.headers.get('content-type') || '', bytes: buf.length, text: buf.toString('utf8') };
}

const run = Date.now();
const sid = { aProj: `ex-a-proj-${run}`, aGeneral: `ex-a-gen-${run}`, aUnsaved: `ex-a-unsaved-${run}`, bProj: `ex-b-proj-${run}` };
let projA; let projB;
const MISSING = { error: 'Not found' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("chat JSON: the owner gets their own chats (in a project, general, and unsaved); another user gets the missing-chat 404", async () => {
  for (const s of [sid.aProj, sid.aGeneral, sid.aUnsaved]) {
    const r = await call('GET', `/api/export/chat/${s}`);
    assert.strictEqual(r.status, 200, s);
    assert.ok(r.text.includes('A-SECRET-MESSAGE'));
  }
  const missing = await call('GET', `/api/export/chat/nope-${run}`);
  assert.strictEqual(missing.status, 404);
  for (const s of [sid.aProj, sid.aGeneral, sid.aUnsaved]) {
    const r = await call('GET', `/api/export/chat/${s}`, 'B');
    assert.strictEqual(r.status, 404, s);
    assert.deepStrictEqual(r.json, MISSING);
    assert.ok(!r.text.includes('A-SECRET'), 'no content leaks');
  }
  assert.deepStrictEqual(missing.json, MISSING, 'same answer as a chat that does not exist');
});

test('chat PDF: the owner gets a PDF; another user gets the same 404 as for a chat with no messages', async () => {
  const own = await call('POST', '/api/export/chat/pdf', undefined, { sessionId: sid.aProj });
  assert.strictEqual(own.status, 200);
  assert.ok(own.type.includes('application/pdf') && own.bytes > 500);
  const missing = await call('POST', '/api/export/chat/pdf', undefined, { sessionId: `nope-${run}` });
  assert.strictEqual(missing.status, 404);
  for (const s of [sid.aProj, sid.aGeneral, sid.aUnsaved]) {
    const r = await call('POST', '/api/export/chat/pdf', 'B', { sessionId: s });
    assert.strictEqual(r.status, 404, s);
    assert.deepStrictEqual(r.json, missing.json);
  }
  assert.strictEqual((await call('POST', '/api/export/chat/pdf', 'B', {})).status, 400, 'input check unchanged');
});

test('project export: the owner gets the project, its files and messages; another user gets the missing-project 404', async () => {
  const own = await call('GET', `/api/export/project/${projA}`);
  assert.strictEqual(own.status, 200);
  assert.strictEqual(own.json.project.name, `A-PROJECT-${run}`);
  assert.ok(own.json.messages.length >= 2 && own.json.files.length === 1);
  const other = await call('GET', `/api/export/project/${projA}`, 'B');
  assert.strictEqual(other.status, 404);
  assert.deepStrictEqual(other.json, MISSING);
  assert.ok(!other.text.includes('A-SECRET'));
  assert.deepStrictEqual((await call('GET', '/api/export/project/999999999')).json, other.json);
});

test("project list: each user gets only their own projects, never everyone's", async () => {
  const a = await call('GET', '/api/export/projects');
  const b = await call('GET', '/api/export/projects', 'B');
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(a.json.map((p) => p.name), [`A-PROJECT-${run}`]);
  assert.deepStrictEqual(b.json.map((p) => p.name), [`B-PROJECT-${run}`]);
  assert.ok(!b.text.includes('A-PROJECT'));
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`ex-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const mkProj = async (u, name) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [name, u])).rows[0].id;
  projA = await mkProj(A, `A-PROJECT-${run}`); projB = await mkProj(B, `B-PROJECT-${run}`);
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'t',$3)`, [sid.aProj, projA, A]);
  await pool.query(`INSERT INTO sessions ("sessionId",title,"userId") VALUES ($1,'general',$2)`, [sid.aGeneral, A]);
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'t',$3)`, [sid.bProj, projB, B]);
  await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user','A-SECRET-MESSAGE')`, [sid.aProj, projA]);
  await pool.query(`INSERT INTO messages ("sessionId",role,content) VALUES ($1,'user','A-SECRET-MESSAGE')`, [sid.aGeneral]);
  await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user','A-SECRET-MESSAGE')`, [sid.aUnsaved, projA]); // no session row, in A's project
  await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user','B-MESSAGE')`, [sid.bProj, projB]);
  await pool.query(`INSERT INTO files ("projectId",name,path) VALUES ($1,'A-SECRET-FILE.txt','/nowhere/x')`, [projA]);
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
    await pool.query(`DELETE FROM sessions WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects and their messages and files cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
