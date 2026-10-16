#!/usr/bin/env node
/**
 * Bookmarks belong to whoever owns the chat they are in. Each user sees, counts and toggles only their
 * own; someone else's behave exactly like ones that do not exist.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/bookmarks.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP bookmarks.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
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
app.use('/api/bookmarks', require('./bookmarks'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const run = Date.now();
const ids = {};
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const bookmarkCount = async (messageId) => (await pool.query('SELECT COUNT(*)::int n FROM bookmarks WHERE "messageId"=$1', [messageId])).rows[0].n;

test("list and count: each user sees only the bookmarks in their own chats (project chats and general chats)", async () => {
  const a = await call('GET', '/api/bookmarks');
  const b = await call('GET', '/api/bookmarks', 'B');
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(a.json.map((x) => x.content).sort(), ['A-GENERAL-MESSAGE', 'A-PROJECT-MESSAGE']);
  assert.deepStrictEqual(b.json.map((x) => x.content), ['B-MESSAGE']);
  assert.ok(!b.text.includes('A-PROJECT-MESSAGE') && !b.text.includes('A-GENERAL-MESSAGE'));
  assert.strictEqual((await call('GET', '/api/bookmarks/count')).json.count, 2);
  assert.strictEqual((await call('GET', '/api/bookmarks/count', 'B')).json.count, 1);
});

test("per-chat list: the owner gets their bookmarked message ids; another user gets the same empty list as for a missing chat", async () => {
  const own = await call('GET', `/api/bookmarks/session/${ids.sessA}`);
  assert.deepStrictEqual(own.json, [ids.msgA]);
  const other = await call('GET', `/api/bookmarks/session/${ids.sessA}`, 'B');
  const missing = await call('GET', `/api/bookmarks/session/nope-${run}`, 'B');
  assert.deepStrictEqual(other.json, []);
  assert.deepStrictEqual(other.json, missing.json);
});

test("toggle: another user cannot add or remove a bookmark on someone else's message; nothing changes", async () => {
  const beforeA = await bookmarkCount(ids.msgA);       // A's message is bookmarked
  const unmarkedA = ids.msgAUnmarked;                  // A's message that is not
  const r1 = await call('POST', `/api/bookmarks/${ids.msgA}`, 'B', { sessionId: ids.sessA });
  assert.strictEqual(r1.status, 404); assert.deepStrictEqual(r1.json, { error: 'Not found' });
  assert.strictEqual(await bookmarkCount(ids.msgA), beforeA, "A's bookmark was not removed");
  const r2 = await call('POST', `/api/bookmarks/${unmarkedA}`, 'B', { sessionId: ids.sessA });
  assert.strictEqual(r2.status, 404);
  assert.strictEqual(await bookmarkCount(unmarkedA), 0, 'no bookmark was planted on the message');
  const missing = await call('POST', '/api/bookmarks/999999999', 'B', { sessionId: 'x' });
  assert.strictEqual(missing.status, 404);
  assert.deepStrictEqual(missing.json, r1.json, 'same answer as a missing message');
});

test("toggle: the owner can bookmark and unbookmark their own message; the chat id in the request cannot be forged", async () => {
  const on = await call('POST', `/api/bookmarks/${ids.msgBUnmarked}`, 'B', { sessionId: ids.sessA }); // B names A's chat in the body
  assert.deepStrictEqual(on.json, { bookmarked: true });
  const row = (await pool.query('SELECT "sessionId" FROM bookmarks WHERE "messageId"=$1', [ids.msgBUnmarked])).rows[0];
  assert.strictEqual(row.sessionId, ids.sessB, "stored against the message's real chat, not the one in the body");
  assert.deepStrictEqual((await call('GET', `/api/bookmarks/session/${ids.sessA}`)).json, [ids.msgA], "A's chat list is unaffected");
  assert.deepStrictEqual((await call('POST', `/api/bookmarks/${ids.msgBUnmarked}`, 'B', { sessionId: ids.sessB })).json, { bookmarked: false });
  assert.strictEqual(await bookmarkCount(ids.msgBUnmarked), 0);
  assert.strictEqual((await call('POST', `/api/bookmarks/${ids.msgAUnmarked}`, undefined, {})).status, 400, 'input check unchanged');
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`bm-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const proj = async (u, n) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [n, u])).rows[0].id;
  const pA = await proj(A, 'A'); const pB = await proj(B, 'B');
  ids.sessA = `bm-a-${run}`; ids.sessAGen = `bm-agen-${run}`; ids.sessB = `bm-b-${run}`;
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'A chat',$3)`, [ids.sessA, pA, A]);
  await pool.query(`INSERT INTO sessions ("sessionId",title,"userId") VALUES ($1,'A general',$2)`, [ids.sessAGen, A]);
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'B chat',$3)`, [ids.sessB, pB, B]);
  const msg = async (s, p, c) => (await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user',$3) RETURNING id`, [s, p, c])).rows[0].id;
  ids.msgA = await msg(ids.sessA, pA, 'A-PROJECT-MESSAGE');
  ids.msgAUnmarked = await msg(ids.sessA, pA, 'A-UNMARKED');
  const msgAGen = await msg(ids.sessAGen, null, 'A-GENERAL-MESSAGE');
  const msgB = await msg(ids.sessB, pB, 'B-MESSAGE');
  ids.msgBUnmarked = await msg(ids.sessB, pB, 'B-UNMARKED');
  for (const [m, s] of [[ids.msgA, ids.sessA], [msgAGen, ids.sessAGen], [msgB, ids.sessB]]) await pool.query(`INSERT INTO bookmarks ("messageId","sessionId") VALUES ($1,$2)`, [m, s]);
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
    await pool.query(`DELETE FROM messages WHERE "sessionId" = ANY($1::text[])`, [[ids.sessAGen]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects, their messages and bookmarks cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
