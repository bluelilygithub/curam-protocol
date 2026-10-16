#!/usr/bin/env node
/**
 * Files attached to a chat: both the chat and the file must be the caller's. Attaching someone else's
 * file (whose text would then go into the caller's prompts), attaching to someone else's chat, and
 * listing or detaching from someone else's chat all behave like the record does not exist.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/sessionFiles.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP sessionFiles.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
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
app.use('/api/session-files', require('./sessionFiles'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const ids = {};
const attached = async (session, file) => (await pool.query('SELECT COUNT(*)::int n FROM session_files WHERE "sessionId"=$1 AND "fileId"=$2', [session, file])).rows[0].n;
const MISSING = { error: 'Not found' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("another user cannot attach someone else's file to their own chat (its text would go into their prompts)", async () => {
  const r = await call('POST', `/api/session-files/${ids.sessB}`, 'B', { fileId: ids.fileA });
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(r.json, MISSING);
  assert.strictEqual(await attached(ids.sessB, ids.fileA), 0, 'nothing was attached');
  assert.deepStrictEqual((await call('GET', `/api/session-files/${ids.sessB}`, 'B')).json, [], 'their chat shows no foreign file');
});

test("another user cannot attach anything to someone else's chat, and a missing file or chat gives the same answer", async () => {
  const r = await call('POST', `/api/session-files/${ids.sessA}`, 'B', { fileId: ids.fileB });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(await attached(ids.sessA, ids.fileB), 0);
  const missingFile = await call('POST', `/api/session-files/${ids.sessB}`, 'B', { fileId: 999999999 });
  const missingChat = await call('POST', `/api/session-files/nope-${run}`, 'B', { fileId: ids.fileB });
  assert.deepStrictEqual(missingFile.json, r.json); assert.strictEqual(missingFile.status, 404);
  assert.deepStrictEqual(missingChat.json, r.json); assert.strictEqual(missingChat.status, 404);
  assert.strictEqual((await call('POST', `/api/session-files/${ids.sessB}`, 'B', {})).status, 400, 'input check unchanged');
});

test("listing and detaching: another user sees an empty list and cannot remove files from someone else's chat", async () => {
  const own = await call('GET', `/api/session-files/${ids.sessA}`);
  assert.deepStrictEqual(own.json.map((f) => f.name), ['A-FILE.txt']);
  const other = await call('GET', `/api/session-files/${ids.sessA}`, 'B');
  const missing = await call('GET', `/api/session-files/nope-${run}`, 'B');
  assert.deepStrictEqual(other.json, []);
  assert.deepStrictEqual(other.json, missing.json);
  const del = await call('DELETE', `/api/session-files/${ids.sessA}/${ids.fileA}`, 'B');
  assert.strictEqual(del.status, 404);
  assert.strictEqual(await attached(ids.sessA, ids.fileA), 1, 'the attachment is still there');
});

test("the owner can attach, list and detach their own files in their own chats", async () => {
  const add = await call('POST', `/api/session-files/${ids.sessB}`, 'B', { fileId: ids.fileB });
  assert.deepStrictEqual(add.json, { ok: true });
  assert.strictEqual(await attached(ids.sessB, ids.fileB), 1);
  assert.deepStrictEqual((await call('GET', `/api/session-files/${ids.sessB}`, 'B')).json.map((f) => f.name), ['B-FILE.txt']);
  assert.deepStrictEqual((await call('DELETE', `/api/session-files/${ids.sessB}/${ids.fileB}`, 'B')).json, { ok: true });
  assert.strictEqual(await attached(ids.sessB, ids.fileB), 0);
  // a general chat (no project) works the same
  assert.deepStrictEqual((await call('POST', `/api/session-files/${ids.sessAGen}`, undefined, { fileId: ids.fileA })).json, { ok: true });
  assert.strictEqual(await attached(ids.sessAGen, ids.fileA), 1);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`sf-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const proj = async (u, n) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [n, u])).rows[0].id;
  const pA = await proj(A, 'A'); const pB = await proj(B, 'B');
  ids.sessA = `sf-a-${run}`; ids.sessAGen = `sf-agen-${run}`; ids.sessB = `sf-b-${run}`;
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'A',$3)`, [ids.sessA, pA, A]);
  await pool.query(`INSERT INTO sessions ("sessionId",title,"userId") VALUES ($1,'A general',$2)`, [ids.sessAGen, A]);
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'B',$3)`, [ids.sessB, pB, B]);
  const file = async (p, n) => (await pool.query(`INSERT INTO files ("projectId",name,path,"extractedText") VALUES ($1,$2,'/nowhere/x','SECRET-TEXT') RETURNING id`, [p, n])).rows[0].id;
  ids.fileA = await file(pA, 'A-FILE.txt'); ids.fileB = await file(pB, 'B-FILE.txt');
  await pool.query(`INSERT INTO session_files ("sessionId","fileId") VALUES ($1,$2)`, [ids.sessA, ids.fileA]);
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
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects and their files cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
