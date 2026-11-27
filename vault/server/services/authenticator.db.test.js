#!/usr/bin/env node
/**
 * Two-step login, Milestone 3 (docs/two-step-login.md): admin authenticator (TOTP), forced enrolment, backup codes,
 * admin reset and the reset-2fa script. Mail and the Suggestions inbox are replaced by recorders.
 * Integration test: needs a real Postgres; throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/services/authenticator.db.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP authenticator.db.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.AUTH_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex'); // hex on purpose: both shapes work

const assert = require('assert');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');

const sent = [];
const sendEmailPath = require.resolve('../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async (opts) => { sent.push(opts); return { ok: true }; } };
const captured = [];
const suggestPath = require.resolve('./SuggestionService');
require.cache[suggestPath] = { id: suggestPath, filename: suggestPath, loaded: true, exports: {
  capture: async (p) => { captured.push(p); return { id: 1 }; }, makeFingerprint: (s, k) => `${s}:${k}`, getPrimaryAdminUserId: async () => 999999,
} };

const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const totp = require('./totp');

const run = Date.now();
const mail = (tag) => `au-test-${tag}-${run}@example.test`;
let callerId;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api/admin', (req, _res, next) => { req.user = { id: callerId, isAdmin: true }; next(); }, requireAdmin, require('../routes/admin'));
app.use('/api', requireAuth, (req, res) => res.json({ ok: true }));

let base;
let ipSeq = 0;
async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}
const PW = 'pass-word-123';
async function makeUser(tag, extra = {}) {
  const email = mail(tag);
  const { rows } = await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,$2,$3) RETURNING id`, [email, await bcrypt.hash(PW, 4), extra.isAdmin !== false]);
  return { id: rows[0].id, email };
}
const login = (u, cookie) => call('POST', '/api/auth/login', { email: u.email, password: PW }, cookie ? { Cookie: cookie } : {});
const secretOf = (uri) => {
  const b32 = new URL(uri).searchParams.get('secret');
  const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const ch of b32) bits += map.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
};
const codeNow = (secret, ahead = 0) => totp.codeAt(secret, totp.stepAt(Date.now()) + ahead);
const sessions = async (id) => (await pool.query('SELECT COUNT(*)::int n FROM auth_sessions WHERE "userId"=$1', [id])).rows[0].n;

/** Enrol an admin through the API; returns { secret, backupCodes, token, json }. */
async function enrol(u, { remember = false } = {}) {
  const r = await login(u);
  assert.strictEqual(r.json.method, 'totp_enrol', JSON.stringify(r.json));
  const s = await call('POST', '/api/auth/challenge/enrol/start', { challengeId: r.json.challengeId });
  assert.strictEqual(s.status, 200, JSON.stringify(s.json));
  const secret = secretOf(s.json.otpauthUri);
  const c = await call('POST', '/api/auth/challenge/enrol/confirm', { challengeId: r.json.challengeId, code: codeNow(secret), rememberDevice: remember });
  assert.strictEqual(c.status, 200, JSON.stringify(c.json));
  return { secret, backupCodes: c.json.backupCodes, token: c.json.token, json: c.json, start: s.json, setCookie: c.setCookie };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('an admin with no authenticator must set one up before any session exists', async () => {
  const u = await makeUser('enrol');
  const before = sent.length;
  const r = await login(u);
  assert.strictEqual(r.json.method, 'totp_enrol');
  assert.strictEqual(r.json.rememberDays, 7);
  assert.ok(!r.json.token);
  assert.strictEqual(await sessions(u.id), 0);
  const s = await call('POST', '/api/auth/challenge/enrol/start', { challengeId: r.json.challengeId });
  assert.deepStrictEqual(Object.keys(s.json).sort(), ['manualKey', 'otpauthUri'], 'only the link and the key, no image');
  assert.ok(s.json.otpauthUri.startsWith('otpauth://totp/Curam%20Vault%3A'));
  assert.ok(/^([A-Z2-7]{4} )+[A-Z2-7]{4}$/.test(s.json.manualKey));
  const again = await call('POST', '/api/auth/challenge/enrol/start', { challengeId: r.json.challengeId });
  assert.strictEqual(again.json.otpauthUri, s.json.otpauthUri, 'a reload shows the same QR');
  const row = (await pool.query('SELECT "secretEnc", "enabledAt" FROM auth_totp WHERE "userId"=$1', [u.id])).rows[0];
  assert.strictEqual(row.enabledAt, null, 'not on until a code is confirmed');
  assert.ok(!row.secretEnc.includes(new URL(s.json.otpauthUri).searchParams.get('secret')), 'secret stored encrypted');
  const secret = secretOf(s.json.otpauthUri);
  const wrong = await call('POST', '/api/auth/challenge/enrol/confirm', { challengeId: r.json.challengeId, code: codeNow(secret, 5) });
  assert.strictEqual(wrong.status, 400);
  assert.strictEqual(await sessions(u.id), 0);
  const ok = await call('POST', '/api/auth/challenge/enrol/confirm', { challengeId: r.json.challengeId, code: codeNow(secret) });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.token && ok.json.user.isAdmin);
  assert.strictEqual(ok.json.backupCodes.length, 10);
  assert.ok(ok.json.backupCodes.every((c) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c)));
  assert.strictEqual(new Set(ok.json.backupCodes).size, 10);
  const stored = (await pool.query('SELECT "codeHash" FROM auth_backup_codes WHERE "userId"=$1', [u.id])).rows.map((x) => x.codeHash);
  assert.ok(stored.length === 10 && stored.every((h) => h.length === 64 && !ok.json.backupCodes.some((c) => h.includes(c))), 'hashed');
  assert.ok((await pool.query('SELECT "enabledAt" FROM auth_totp WHERE "userId"=$1', [u.id])).rows[0].enabledAt);
  assert.strictEqual(sent.length, before, 'no email at any point');
  assert.ok(captured.some((c) => c.title === `Admin sign-in from a new device: ${u.email}`));
});

test('an enrolled admin signs in with an authenticator code; the same code cannot be used twice', async () => {
  const u = await makeUser('totp');
  const { secret } = await enrol(u);
  const r = await login(u);
  assert.strictEqual(r.json.method, 'totp');
  assert.strictEqual((await call('POST', '/api/auth/challenge/verify', { challengeId: r.json.challengeId, code: codeNow(secret) })).status, 400, 'the enrolment code is spent');
  const next = codeNow(secret, 1); // the next 30-second code, inside the window
  const v = await call('POST', '/api/auth/challenge/verify', { challengeId: r.json.challengeId, code: next });
  assert.strictEqual(v.status, 200, JSON.stringify(v.json));
  const r2 = await login(u);
  assert.strictEqual((await call('POST', '/api/auth/challenge/verify', { challengeId: r2.json.challengeId, code: next })).status, 400, 'reused code refused');
});

test('a backup code works once, the count drops, and the admin inbox hears about it', async () => {
  const u = await makeUser('backup');
  const { backupCodes } = await enrol(u);
  const r = await login(u);
  const before = captured.length;
  const typed = backupCodes[3].toLowerCase().replace('-', ' '); // typed sloppily still works
  const b = await call('POST', '/api/auth/challenge/backup', { challengeId: r.json.challengeId, backupCode: typed });
  assert.strictEqual(b.status, 200, JSON.stringify(b.json));
  assert.ok(b.json.token);
  assert.strictEqual(b.json.backupCodesLeft, 9);
  await new Promise((res) => setTimeout(res, 100));
  assert.ok(captured.slice(before).some((c) => c.title === `A backup code was used: ${u.email}` && /9 left/.test(c.body)));
  const r2 = await login(u);
  const again = await call('POST', '/api/auth/challenge/backup', { challengeId: r2.json.challengeId, backupCode: backupCodes[3] });
  assert.strictEqual(again.status, 400, 'same backup code refused');
  const other = await call('POST', '/api/auth/challenge/backup', { challengeId: r2.json.challengeId, backupCode: backupCodes[4] });
  assert.strictEqual(other.status, 200, 'another one still works');
});

test("one admin's backup codes do nothing for another admin", async () => {
  const a = await makeUser('bk-a');
  const b = await makeUser('bk-b');
  const { backupCodes } = await enrol(a);
  await enrol(b);
  const r = await login(b);
  assert.strictEqual((await call('POST', '/api/auth/challenge/backup', { challengeId: r.json.challengeId, backupCode: backupCodes[0] })).status, 400);
});

test('admins cannot use email codes or the email route; members cannot use backup codes', async () => {
  const u = await makeUser('noemail');
  await enrol(u);
  const r = await login(u);
  const before = sent.length;
  assert.strictEqual((await call('POST', '/api/auth/challenge/resend', { challengeId: r.json.challengeId })).json.code, 'challenge_dead');
  assert.strictEqual(sent.length, before);
  const m = await makeUser('member', { isAdmin: false });
  const mr = await login(m);
  assert.strictEqual(mr.json.method, 'email');
  assert.strictEqual((await call('POST', '/api/auth/challenge/backup', { challengeId: mr.json.challengeId, backupCode: 'AAAAA-AAAAA' })).json.code, 'challenge_dead');
  assert.strictEqual((await call('POST', '/api/auth/challenge/enrol/start', { challengeId: mr.json.challengeId })).json.code, 'challenge_dead');
});

test('a password alone can never replace an authenticator that is already set up', async () => {
  const u = await makeUser('noreplace');
  await enrol(u);
  const id = `forged-${run}`;
  await pool.query(`INSERT INTO auth_login_challenges (id,"userId",method,"expiresAt") VALUES ($1,$2,'totp_enrol',NOW() + INTERVAL '5 minutes')`, [id, u.id]);
  assert.strictEqual((await call('POST', '/api/auth/challenge/enrol/start', { challengeId: id })).status, 400);
});

test('5 wrong authenticator codes kill the challenge', async () => {
  const u = await makeUser('wrong5');
  const { secret } = await enrol(u);
  const r = await login(u);
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/challenge/verify', { challengeId: r.json.challengeId, code: codeNow(secret, 10) });
  assert.strictEqual((await call('POST', '/api/auth/challenge/verify', { challengeId: r.json.challengeId, code: codeNow(secret, 1) })).json.code, 'challenge_dead');
});

test('an admin may remember a device for 7 days; a remembered device skips the code only once an authenticator is set up', async () => {
  const u = await makeUser('remember');
  const { setCookie } = await enrol(u, { remember: true });
  assert.ok(setCookie.includes(`Max-Age=${7 * 86400}`), setCookie);
  const cookie = setCookie.split(';')[0];
  const before = captured.length;
  const r = await login(u, cookie);
  assert.ok(r.json.token && !r.json.challengeId, 'remembered: no code');
  assert.strictEqual(captured.length, before, 'no new-device alert on a remembered device');
  await call('POST', `/api/admin/users/${u.id}/reset-2fa`);
  // a device cookie from before a reset is gone; even a fresh one does not skip enrolment
  await require('./trustedDevices').trustDevice(pool, { headers: {}, ip: null }, { id: u.id, isAdmin: true });
  const dev = (await pool.query('SELECT 1 FROM auth_trusted_devices WHERE "userId"=$1', [u.id])).rows.length;
  assert.strictEqual(dev, 1);
  assert.strictEqual((await login(u)).json.method, 'totp_enrol');
});

test('an admin resetting another person: authenticator, backup codes, devices and sessions all go', async () => {
  const u = await makeUser('reset');
  const { token } = await enrol(u, { remember: true });
  assert.strictEqual((await call('GET', '/api/x', null, { Authorization: `Bearer ${token}` })).status, 200);
  const r = await call('POST', `/api/admin/users/${u.id}/reset-2fa`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.removed, { authenticator: 1, backupCodes: 10, devices: 1, sessions: 1, challenges: 1 });
  assert.strictEqual((await call('GET', '/api/x', null, { Authorization: `Bearer ${token}` })).status, 401, 'signed out');
  assert.strictEqual((await login(u)).json.method, 'totp_enrol', 'sets up again');
  assert.ok((await pool.query('SELECT "isAdmin" FROM users WHERE id=$1', [u.id])).rows[0].isAdmin, 'still an admin');
  assert.strictEqual((await call('POST', '/api/admin/users/999999999/reset-2fa')).status, 404);
});

test('reset-2fa.js resets one person by email and leaves the admin flag alone', async () => {
  const u = await makeUser('script');
  await enrol(u);
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'reset-2fa.js'), u.email.toUpperCase()], { env: process.env }).toString();
  assert.ok(out.includes(`Two-step login reset for ${u.email}`), out);
  assert.ok(out.includes('1 authenticator, 10 backup codes'), out);
  assert.ok(/set up an authenticator app again/.test(out), out);
  assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM auth_totp WHERE "userId"=$1', [u.id])).rows[0].n, 0);
  assert.ok((await pool.query('SELECT "isAdmin" FROM users WHERE id=$1', [u.id])).rows[0].isAdmin);
  let failed = null;
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'reset-2fa.js'), `nobody-${run}@example.test`], { env: process.env, stdio: 'pipe' }); } catch (e) { failed = e; }
  assert.ok(failed && failed.status === 1 && /No account/.test(failed.stderr.toString()));
});

test('a broken key stops admin sign-in with a plain message (nobody gets in on a password alone)', async () => {
  const u = await makeUser('brokenkey');
  const lc = require('./loginChallenge');
  const good = process.env.AUTH_ENCRYPTION_KEY;
  process.env.AUTH_ENCRYPTION_KEY = 'broken';
  lc._internal.resetKeyCache();
  try {
    const r = await login(u);
    assert.strictEqual(r.status, 503);
    assert.ok(!r.json.token);
  } finally {
    process.env.AUTH_ENCRYPTION_KEY = good;
    lc._internal.resetKeyCache();
  }
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  callerId = (await makeUser('the-caller')).id;
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
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`au-test-%-${run}@example.test`]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
