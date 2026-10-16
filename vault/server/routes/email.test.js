#!/usr/bin/env node
/**
 * POST /api/email only sends a chat the caller owns. Someone else's chat gets the same answer as a
 * chat that does not exist, and no email is sent. Mail sending is replaced by a recorder here, so
 * this test never sends anything.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/email.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP email.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const sent = [];
// Replace the mail sender before the route loads, so nothing real can go out.
const sendEmailPath = require.resolve('../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async (opts) => { sent.push(opts); return { ok: true }; } };
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/email', require('./email'));

let base;
const post = async (body, as) => {
  const res = await fetch(`${base}/api/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

const run = Date.now();
const sid = { project: `em-proj-${run}`, general: `em-general-${run}`, unsaved: `em-unsaved-${run}` };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the owner can email a chat in their project, a general chat, and an unsaved chat in their project', async () => {
  for (const s of [sid.project, sid.general, sid.unsaved]) {
    const before = sent.length;
    const r = await post({ sessionId: s, to: 'me@example.test', subject: 'Mine' });
    assert.strictEqual(r.status, 200, `${s}: ${JSON.stringify(r.json)}`);
    assert.strictEqual(sent.length, before + 1);
    assert.strictEqual(sent[sent.length - 1].to, 'me@example.test');
    assert.ok(sent[sent.length - 1].html.includes('A-SECRET-TEXT'));
  }
});

test("another user cannot email someone else's chat: same 404 as a missing chat, nothing sent", async () => {
  const before = sent.length;
  const missing = await post({ sessionId: `no-such-${run}`, to: 'x@example.test' }, 'B');
  for (const s of [sid.project, sid.general, sid.unsaved]) {
    const r = await post({ sessionId: s, to: 'attacker@example.test', subject: 'stolen' }, 'B');
    assert.strictEqual(r.status, 404, s);
    assert.deepStrictEqual(r.json, missing.json, 'indistinguishable from a chat that does not exist');
  }
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(sent.length, before, 'no email was sent');
});

test('input checks are unchanged: sessionId and to are required', async () => {
  assert.strictEqual((await post({ to: 'a@example.test' })).status, 400);
  assert.strictEqual((await post({ sessionId: sid.project })).status, 400);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`em-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const proj = (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ('A project',$1,'m') RETURNING id`, [A])).rows[0].id;
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,'t',$3)`, [sid.project, proj, A]);
  await pool.query(`INSERT INTO sessions ("sessionId",title,"userId") VALUES ($1,'general',$2)`, [sid.general, A]);
  await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user','A-SECRET-TEXT')`, [sid.project, proj]);
  await pool.query(`INSERT INTO messages ("sessionId",role,content) VALUES ($1,'user','A-SECRET-TEXT')`, [sid.general]);
  await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user','A-SECRET-TEXT')`, [sid.unsaved, proj]); // no session row, but in A's project
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
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects and their messages cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
