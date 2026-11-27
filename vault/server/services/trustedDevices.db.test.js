#!/usr/bin/env node
/**
 * Two-step login, Milestone 2 (docs/two-step-login.md): remembered devices, and a new password forgetting them.
 * Mail and the Suggestions inbox are replaced by recorders. Integration test: needs a real Postgres; throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/services/trustedDevices.db.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP trustedDevices.db.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.AUTH_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const assert = require('assert');
const http = require('http');
const express = require('express');

const sent = [];
const sendEmailPath = require.resolve('../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async (opts) => { sent.push(opts); return { ok: true }; } };
const suggestPath = require.resolve('./SuggestionService');
require.cache[suggestPath] = { id: suggestPath, filename: suggestPath, loaded: true, exports: {
  capture: async () => ({ id: 1 }), makeFingerprint: (s, k) => `${s}:${k}`, getPrimaryAdminUserId: async () => 999999,
} };

const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const devices = require('./trustedDevices');

const run = Date.now();
const mail = (tag) => `td-test-${tag}-${run}@example.test`;
let adminId;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api/user', requireAuth, require('../routes/user'));
app.use('/api/admin', (req, _res, next) => { req.user = { id: adminId, isAdmin: true }; next(); }, requireAdmin, require('../routes/admin'));
app.use('/api', requireAuth, (req, res) => res.json({ ok: true }));

let base;
let ipSeq = 0;
async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}
const lastCode = () => sent[sent.length - 1].subject.slice(0, 6);
const PW = 'pass-word-123';

async function makeUser(tag, extra = {}) {
  const email = mail(tag);
  const { rows } = await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,$2,$3) RETURNING id`,
    [email, await bcrypt.hash(PW, 4), !!extra.isAdmin]);
  return { id: rows[0].id, email, isAdmin: !!extra.isAdmin };
}
const cookieOf = (setCookie) => (setCookie || '').split(';')[0]; // "vault_device=<token>"
const login = (u, cookie, password = PW) => call('POST', '/api/auth/login', { email: u.email, password }, cookie ? { Cookie: cookie } : {});

/** Full sign-in with the emailed code; returns { token, cookie }. */
async function signInWithCode(u, rememberDevice = true) {
  const r = await login(u);
  assert.ok(r.json.challengeId, JSON.stringify(r.json));
  const v = await call('POST', '/api/auth/challenge/verify', { challengeId: r.json.challengeId, code: lastCode(), rememberDevice });
  assert.strictEqual(v.status, 200, JSON.stringify(v.json));
  return { token: v.json.token, cookie: cookieOf(v.setCookie), setCookie: v.setCookie };
}
const deviceCount = async (userId) => (await pool.query('SELECT COUNT(*)::int n FROM auth_trusted_devices WHERE "userId"=$1', [userId])).rows[0].n;
const sessionCount = async (userId) => (await pool.query('SELECT COUNT(*)::int n FROM auth_sessions WHERE "userId"=$1', [userId])).rows[0].n;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('remembering a device sets a safe cookie, stores only its hash, and the next sign-in skips the code', async () => {
  const u = await makeUser('remember');
  const first = await login(u);
  assert.strictEqual(first.json.rememberDays, 30);
  const v = await call('POST', '/api/auth/challenge/verify', { challengeId: first.json.challengeId, code: lastCode(), rememberDevice: true });
  const sc = v.setCookie;
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/auth', `Max-Age=${30 * 86400}`]) assert.ok(sc.includes(flag), `cookie has ${flag}: ${sc}`);
  const token = cookieOf(sc).split('=')[1];
  const row = (await pool.query('SELECT "tokenHash", label, "expiresAt" FROM auth_trusted_devices WHERE "userId"=$1', [u.id])).rows[0];
  assert.ok(row.tokenHash !== token && row.tokenHash.length === 64, 'stored hashed');
  assert.strictEqual(row.label, 'Chrome on Windows');
  const days = (new Date(row.expiresAt) - Date.now()) / 86400000;
  assert.ok(Math.abs(days - 30) < 0.01, `30 days, got ${days}`);
  const before = sent.length;
  const again = await login(u, cookieOf(sc));
  assert.ok(again.json.token && !again.json.challengeId, 'no code on a remembered device');
  assert.strictEqual(sent.length, before, 'no email sent');
});

test('not remembering: no cookie, no device row, and the next sign-in asks for a code again', async () => {
  const u = await makeUser('noremember');
  const s = await signInWithCode(u, false);
  assert.strictEqual(s.setCookie, null);
  assert.strictEqual(await deviceCount(u.id), 0);
  assert.ok((await login(u)).json.challengeId);
});

test("one user's device cookie does nothing for another user", async () => {
  const a = await makeUser('owner');
  const b = await makeUser('other');
  const { cookie } = await signInWithCode(a);
  const r = await login(b, cookie);
  assert.ok(r.json.challengeId && !r.json.token, 'b still needs a code');
});

test('an expired or made-up device cookie is ignored', async () => {
  const u = await makeUser('expired');
  const { cookie } = await signInWithCode(u);
  await pool.query(`UPDATE auth_trusted_devices SET "expiresAt"=NOW() - INTERVAL '1 second' WHERE "userId"=$1`, [u.id]);
  assert.ok((await login(u, cookie)).json.challengeId);
  assert.ok((await login(u, 'vault_device=' + 'a'.repeat(64))).json.challengeId);
  assert.ok((await login(u, 'other=1; vault_device=')).json.challengeId);
});

test('a remembered device does not get round a wrong password', async () => {
  const u = await makeUser('wrongpw');
  const { cookie } = await signInWithCode(u);
  assert.strictEqual((await login(u, cookie, 'wrong-password-9')).status, 401);
});

test('changing your own password keeps this session, ends the others, and forgets every device', async () => {
  const u = await makeUser('change');
  const one = await signInWithCode(u);
  const two = await signInWithCode(u);
  assert.strictEqual(await deviceCount(u.id), 2);
  const r = await call('POST', '/api/user/change-password', { currentPassword: PW, newPassword: 'new-pass-word-1' }, { Authorization: `Bearer ${one.token}` });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual((await call('GET', '/api/x', null, { Authorization: `Bearer ${one.token}` })).status, 200, 'this session stays');
  assert.strictEqual((await call('GET', '/api/x', null, { Authorization: `Bearer ${two.token}` })).status, 401, 'the other one ends');
  assert.strictEqual(await deviceCount(u.id), 0);
  assert.ok((await login(u, one.cookie, 'new-pass-word-1')).json.challengeId, 'the device needs a code again');
});

test('a password reset ends every session and forgets every device', async () => {
  const u = await makeUser('reset');
  const s = await signInWithCode(u);
  await call('POST', '/api/auth/reset-password-request', { email: u.email });
  const token = (await pool.query('SELECT token FROM password_resets WHERE email=$1', [u.email])).rows[0].token;
  assert.strictEqual((await call('POST', '/api/auth/reset-password-confirm', { token, password: 'reset-pass-word-1' })).status, 200);
  assert.strictEqual(await sessionCount(u.id), 0);
  assert.strictEqual(await deviceCount(u.id), 0);
  assert.ok((await login(u, s.cookie, 'reset-pass-word-1')).json.challengeId);
});

test('an admin setting a password ends every session and forgets every device', async () => {
  const u = await makeUser('adminset');
  await signInWithCode(u);
  assert.strictEqual((await call('PUT', `/api/admin/users/${u.id}/password`, { password: 'admin-set-pass-1' })).status, 200);
  assert.strictEqual(await sessionCount(u.id), 0);
  assert.strictEqual(await deviceCount(u.id), 0);
});

test('admins are remembered for 7 days, members for 30', async () => {
  assert.strictEqual(devices.deviceDays({ isAdmin: true }), 7);
  assert.strictEqual(devices.deviceDays({ isAdmin: false }), 30);
  const a = await makeUser('admin7', { isAdmin: true });
  const req = { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Mac OS X 14_0) Safari/605.1' }, ip: '10.0.0.1' };
  const cookie = await devices.trustDevice(pool, req, a);
  assert.ok(cookie.includes(`Max-Age=${7 * 86400}`));
  const row = (await pool.query('SELECT label, "expiresAt" FROM auth_trusted_devices WHERE "userId"=$1', [a.id])).rows[0];
  assert.strictEqual(row.label, 'Safari on Mac');
  const days = (new Date(row.expiresAt) - Date.now()) / 86400000;
  assert.ok(Math.abs(days - 7) < 0.01, `7 days, got ${days}`);
});

test('the clean-up removes challenges over a day old and expired devices, and nothing else', async () => {
  const u = await makeUser('cleanup');
  await signInWithCode(u);
  await pool.query(`INSERT INTO auth_login_challenges (id,"userId",method,"expiresAt","createdAt") VALUES ($1,$2,'email',NOW(),NOW() - INTERVAL '25 hours'), ($3,$2,'email',NOW() + INTERVAL '5 minutes',NOW())`,
    [`old-${run}`, u.id, `new-${run}`]);
  await devices.trustDevice(pool, { headers: {}, ip: null }, u);
  await pool.query(`UPDATE auth_trusted_devices SET "expiresAt"=NOW() - INTERVAL '1 minute' WHERE id=(SELECT MAX(id) FROM auth_trusted_devices WHERE "userId"=$1)`, [u.id]);
  assert.strictEqual(await deviceCount(u.id), 2);
  await require('../cron/authCleanupCron').run();
  const ids = (await pool.query('SELECT id FROM auth_login_challenges WHERE "userId"=$1', [u.id])).rows.map((r) => r.id);
  assert.ok(!ids.includes(`old-${run}`) && ids.includes(`new-${run}`));
  assert.strictEqual(await deviceCount(u.id), 1, 'the live device stays');
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
    await pool.query(`DELETE FROM password_resets WHERE email LIKE $1`, [`td-test-%-${run}@example.test`]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`td-test-%-${run}@example.test`]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
