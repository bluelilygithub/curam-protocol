#!/usr/bin/env node
/**
 * Public sign-up is closed: POST /api/auth/register always returns 403, even with a valid INVITE_CODE,
 * and creates nothing. Accounts created by an administrator and Wellbeing participant invites still work,
 * from creation to a first sign-in. Mail sending is replaced by a recorder, so nothing is ever sent.
 * Integration test: needs a real Postgres. Uses throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/auth.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP auth.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
// A valid invite code is configured on purpose: sign-up must stay closed anyway.
process.env.INVITE_CODE = 'test-invite-code-123';

const assert = require('assert');
const http = require('http');
const express = require('express');
const sent = [];
const sendEmailPath = require.resolve('../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async (opts) => { sent.push(opts); return { ok: true }; } };
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const run = Date.now();
const mail = (tag) => `auth-test-${tag}-${run}@example.test`;
let adminId;
const app = express();
app.use(express.json());
app.use('/api/auth', require('./auth'));
// Admin routes are called as an administrator (or, with x-role: member, as an ordinary member), mounted the way index.js mounts them.
const asCaller = (req, _res, next) => { req.user = { id: adminId, isAdmin: req.headers['x-role'] !== 'member' }; next(); };
app.use('/api/admin', asCaller, requireAdmin, require('./admin'));
app.use('/api/wellbeing', asCaller, require('./wellbeing'));

let base;
async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const userCount = async (email) => (await pool.query('SELECT COUNT(*)::int n FROM users WHERE email=$1', [email])).rows[0].n;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('register always returns 403 and creates nothing, even with a valid invite code', async () => {
  const email = mail('closed');
  const r = await call('POST', '/api/auth/register', { email, password: 'a-good-password-1', inviteCode: process.env.INVITE_CODE });
  assert.strictEqual(r.status, 403);
  assert.ok(/closed/i.test(r.json.error));
  assert.strictEqual(await userCount(email), 0, 'no account was created');
  const live = (await pool.query(`SELECT COUNT(*)::int n FROM auth_sessions s JOIN users u ON u.id=s."userId" WHERE u.email=$1`, [email])).rows[0].n;
  assert.strictEqual(live, 0);
});

test('register is closed for every kind of request: wrong code, no code, empty body, odd types', async () => {
  const email = mail('closed2');
  const bodies = [
    { email, password: 'a-good-password-1', inviteCode: 'wrong' },
    { email, password: 'a-good-password-1' },
    { email, password: 'a-good-password-1', inviteCode: '' },
    { email, password: 'a-good-password-1', inviteCode: null },
    { email, password: 'a-good-password-1', inviteCode: [process.env.INVITE_CODE] },
    {},
  ];
  for (const b of bodies) {
    const r = await call('POST', '/api/auth/register', b);
    assert.strictEqual(r.status, 403, JSON.stringify(b));
  }
  assert.strictEqual(await userCount(email), 0);
});

test('signing in still works for an existing account; a wrong password is refused', async () => {
  const email = mail('existing');
  const bcrypt = require('bcryptjs');
  await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,$2)`, [email, await bcrypt.hash('existing-password-1', 4)]);
  const ok = await call('POST', '/api/auth/login', { email, password: 'existing-password-1' });
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.json.token && ok.json.user.email === email);
  assert.strictEqual((await call('POST', '/api/auth/login', { email, password: 'nope-nope-nope' })).status, 401);
});

test('an administrator can create an account, and its owner can then sign in', async () => {
  const email = mail('admin-made');
  const made = await call('POST', '/api/admin/users', { email, password: 'admin-made-pass-1' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.user.isAdmin, false);
  const login = await call('POST', '/api/auth/login', { email, password: 'admin-made-pass-1' });
  assert.strictEqual(login.status, 200);
  const me = await call('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${login.json.token}` });
  assert.strictEqual(me.json.user.email, email);
});

test('an ordinary member cannot create an account through the admin route', async () => {
  const email = mail('member-made');
  const r = await call('POST', '/api/admin/users', { email, password: 'member-made-pass-1' }, { 'x-role': 'member' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(await userCount(email), 0);
});

test('a Wellbeing invite still works end to end: account created, setup link sent, password set, first sign-in', async () => {
  const email = mail('wellbeing');
  const before = sent.length;
  const inv = await call('POST', '/api/wellbeing/admin/invite', { email });
  assert.strictEqual(inv.status, 200, JSON.stringify(inv.json));
  assert.strictEqual(inv.json.created, true);
  assert.strictEqual(sent.length, before + 1, 'one invite email');
  assert.strictEqual(sent[sent.length - 1].to, email);
  const u = (await pool.query('SELECT id, "isAdmin", "mustChangePassword" FROM users WHERE email=$1', [email])).rows[0];
  assert.ok(u && u.isAdmin === false && u.mustChangePassword === true);

  const early = await call('POST', '/api/auth/login', { email, password: 'whatever-password-1' });
  assert.strictEqual(early.status, 401); // the random placeholder password is unknown to anyone

  const token = (await pool.query('SELECT token FROM password_resets WHERE email=$1', [email])).rows[0].token;
  assert.ok(String(inv.json.link).includes(token), 'the emailed link carries the setup token');
  const set = await call('POST', '/api/auth/reset-password-confirm', { token, password: 'my-new-password-1' });
  assert.strictEqual(set.status, 200, JSON.stringify(set.json));
  const login = await call('POST', '/api/auth/login', { email, password: 'my-new-password-1' });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  assert.strictEqual((await pool.query('SELECT "mustChangePassword" m FROM users WHERE email=$1', [email])).rows[0].m, false);
});

test('only an administrator can send a Wellbeing invite', async () => {
  const email = mail('wb-member');
  const before = sent.length;
  const r = await call('POST', '/api/wellbeing/admin/invite', { email }, { 'x-role': 'member' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(await userCount(email), 0);
  assert.strictEqual(sent.length, before);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  adminId = (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',TRUE) RETURNING id`, [mail('the-admin')])).rows[0].id;
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
    await pool.query(`DELETE FROM password_resets WHERE email LIKE $1`, [`auth-test-%-${run}@example.test`]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`auth-test-%-${run}@example.test`]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
