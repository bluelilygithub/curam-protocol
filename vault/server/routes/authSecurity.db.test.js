#!/usr/bin/env node
/**
 * Two-step login, Milestone 4 (docs/two-step-login.md): Settings → Security routes. Each test proves the session making the
 * request survives, and that nobody can touch another person's devices. Integration test: needs a real Postgres; throwaway users.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/authSecurity.db.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP authSecurity.db.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.AUTH_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const devices = require('../services/trustedDevices');
const authenticator = require('../services/authenticator');
const totp = require('../services/totp');
const { encrypt } = require('../utils/aesGcm');
const authKey = () => require('../services/loginChallenge')._internal.authKey();

const run = Date.now();
const mail = (tag) => `sec-test-${tag}-${run}@example.test`;
const app = express();
app.use(express.json());
app.use('/api/auth', require('./auth'));
app.use('/api', requireAuth, (req, res) => res.json({ ok: true }));

let base;
async function call(method, url, token, body, headers = {}) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
async function makeUser(tag, extra = {}) {
  const { rows } = await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin","accountantOfUserId") VALUES ($1,'x',$2,$3) RETURNING id`,
    [mail(tag), !!extra.isAdmin, extra.accountantOf || null]);
  return { id: rows[0].id, isAdmin: !!extra.isAdmin };
}
async function session(u) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO auth_sessions (token,"userId","expiresAt") VALUES ($1,$2,NOW() + INTERVAL '1 hour')`, [token, u.id]);
  return token;
}
const device = async (u, label = 'Chrome on Windows') => {
  const cookie = await devices.trustDevice(pool, { headers: { 'user-agent': label.includes('Firefox') ? 'Firefox/120 Linux' : 'Windows Chrome/130' }, ip: null }, u);
  return cookie.split(';')[0];
};
const alive = async (token) => (await call('GET', '/api/x', token)).status === 200;
const deviceCount = async (id) => (await pool.query('SELECT COUNT(*)::int n FROM auth_trusted_devices WHERE "userId"=$1', [id])).rows[0].n;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('every Security route needs a session', async () => {
  for (const [m, url] of [['GET', '/api/auth/security'], ['POST', '/api/auth/devices/forget-all'], ['DELETE', '/api/auth/devices/1'],
    ['POST', '/api/auth/backup-codes/regenerate'], ['POST', '/api/auth/sessions/sign-out-others']]) {
    assert.strictEqual((await call(m, url, null, m === 'POST' ? {} : null)).status, 401, `${m} ${url}`);
  }
});

test('GET /security lists your own live devices, marks this browser, and counts other sessions', async () => {
  const u = await makeUser('list');
  const other = await makeUser('list-other');
  const here = await device(u);
  await device(u, 'Firefox on Linux');
  await device(other);
  await pool.query(`INSERT INTO auth_trusted_devices ("userId","tokenHash","expiresAt") VALUES ($1,$2,NOW() - INTERVAL '1 minute')`, [u.id, `expired-${run}`]);
  const token = await session(u);
  await session(u);
  const r = await call('GET', '/api/auth/security', token, null, { Cookie: here });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.devices.length, 2, 'own live devices only');
  assert.deepStrictEqual(r.json.devices.map((d) => d.current).sort(), [false, true]);
  assert.ok(r.json.devices.every((d) => !('tokenHash' in d)), 'no hashes sent');
  assert.strictEqual(r.json.otherSessions, 1);
  assert.strictEqual(r.json.isAdmin, false);
  assert.strictEqual(r.json.authenticatorSince, null);
});

test("forgetting one device works only on your own, and keeps this session", async () => {
  const u = await makeUser('forget1');
  const other = await makeUser('forget1-other');
  await device(u);
  await device(other);
  const mine = (await pool.query('SELECT id FROM auth_trusted_devices WHERE "userId"=$1', [u.id])).rows[0].id;
  const theirs = (await pool.query('SELECT id FROM auth_trusted_devices WHERE "userId"=$1', [other.id])).rows[0].id;
  const token = await session(u);
  assert.strictEqual((await call('DELETE', `/api/auth/devices/${theirs}`, token)).status, 404);
  assert.strictEqual(await deviceCount(other.id), 1, "another person's device is untouched");
  assert.strictEqual((await call('DELETE', `/api/auth/devices/${mine}`, token)).status, 200);
  assert.strictEqual(await deviceCount(u.id), 0);
  assert.ok(await alive(token));
});

test('forget all devices removes only your devices and signs nobody out', async () => {
  const u = await makeUser('forgetall');
  const other = await makeUser('forgetall-other');
  await device(u); await device(u); await device(other);
  const token = await session(u);
  const second = await session(u);
  const r = await call('POST', '/api/auth/devices/forget-all', token, {});
  assert.deepStrictEqual(r.json, { ok: true, removed: 2 });
  assert.strictEqual(await deviceCount(u.id), 0);
  assert.strictEqual(await deviceCount(other.id), 1);
  assert.ok(await alive(token), 'this session stays');
  assert.ok(await alive(second), 'sessions are not touched');
});

test('sign out other sessions keeps this one and leaves other people alone', async () => {
  const u = await makeUser('signout');
  const other = await makeUser('signout-other');
  const token = await session(u);
  const a = await session(u);
  const b = await session(u);
  const theirs = await session(other);
  const r = await call('POST', '/api/auth/sessions/sign-out-others', token, {});
  assert.deepStrictEqual(r.json, { ok: true, removed: 2 });
  assert.ok(await alive(token), 'this session stays');
  assert.ok(!(await alive(a)) && !(await alive(b)));
  assert.ok(await alive(theirs));
  assert.strictEqual((await call('POST', '/api/auth/sessions/sign-out-others', token, {})).json.removed, 0, 'run again: nothing to do, still signed in');
  assert.ok(await alive(token));
});

test('regenerating backup codes needs a current authenticator code; old codes stop working, new ones work once', async () => {
  const a = await makeUser('regen', { isAdmin: true });
  const secret = totp.newSecret();
  await pool.query(`INSERT INTO auth_totp ("userId","secretEnc","enabledAt") VALUES ($1,$2,NOW())`, [a.id, encrypt(authKey(), secret)]);
  const old = await authenticator.newBackupCodes(pool, a.id);
  const token = await session(a);
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', token, { code: '000000' })).status, 400);
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', token, {})).status, 400);
  const code = totp.codeAt(secret, totp.stepAt(Date.now()));
  const r = await call('POST', '/api/auth/backup-codes/regenerate', token, { code });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.backupCodes.length, 10);
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', token, { code })).status, 400, 'the same code cannot be used twice');
  assert.ok(!(await authenticator.useBackupCode(pool, a.id, old[0])), 'an old code is dead');
  assert.ok(await authenticator.useBackupCode(pool, a.id, r.json.backupCodes[0]));
  const s = await call('GET', '/api/auth/security', token);
  assert.strictEqual(s.json.backupCodesLeft, 9);
  assert.ok(s.json.authenticatorSince && s.json.isAdmin);
  assert.ok(await alive(token));
});

test('regenerate: 5 wrong codes an hour per account, then even a right code is refused; sign-in is not affected', async () => {
  const a = await makeUser('regen-limit', { isAdmin: true });
  const secret = totp.newSecret();
  await pool.query(`INSERT INTO auth_totp ("userId","secretEnc","enabledAt") VALUES ($1,$2,NOW())`, [a.id, encrypt(authKey(), secret)]);
  const before = await authenticator.newBackupCodes(pool, a.id);
  const token = await session(a);
  const other = await makeUser('regen-limit-other', { isAdmin: true });
  const otherToken = await session(other);
  for (let i = 1; i <= 4; i++) {
    const r = await call('POST', '/api/auth/backup-codes/regenerate', token, { code: '000000' });
    assert.strictEqual(r.status, 400, `wrong code ${i}`);
    assert.strictEqual(r.json.attemptsLeft, 5 - i);
  }
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', token, { code: '000000' })).status, 429, 'the 5th wrong code closes it');
  const right = totp.codeAt(secret, totp.stepAt(Date.now()));
  const r = await call('POST', '/api/auth/backup-codes/regenerate', token, { code: right });
  assert.strictEqual(r.status, 429, 'a right code is refused too, for the rest of the hour');
  assert.ok(await authenticator.useBackupCode(pool, a.id, before[0]), 'the old codes were not replaced');
  // the limit is per account: another admin is unaffected (a wrong code is a plain 400)
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', otherToken, { code: '000000' })).status, 400);
  // the wrong regenerate codes do not count towards the sign-in limit (10 wrong an hour)
  const signInFails = (await pool.query(`SELECT COALESCE(SUM(attempts),0)::int n FROM auth_login_challenges WHERE "userId"=$1`, [a.id])).rows[0].n;
  assert.strictEqual(signInFails, 0);
  // an hour later it opens again
  await pool.query(`UPDATE auth_login_challenges SET "createdAt"=NOW() - INTERVAL '61 minutes' WHERE "userId"=$1 AND method='regen'`, [a.id]);
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', token, { code: right })).status, 200);
  assert.ok(await alive(token));
});

test('a member (no authenticator) cannot make backup codes', async () => {
  const u = await makeUser('regen-member');
  const token = await session(u);
  assert.strictEqual((await call('POST', '/api/auth/backup-codes/regenerate', token, { code: '123456' })).status, 400);
  assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM auth_backup_codes WHERE "userId"=$1', [u.id])).rows[0].n, 0);
});

test('a read-only accountant login is refused (and cannot reach the owner\'s devices)', async () => {
  const owner = await makeUser('owner');
  await device(owner);
  const acc = await makeUser('accountant', { accountantOf: owner.id });
  const token = await session(acc);
  assert.strictEqual((await call('GET', '/api/auth/security', token)).status, 403);
  assert.strictEqual((await call('POST', '/api/auth/devices/forget-all', token, {})).status, 403);
  assert.strictEqual(await deviceCount(owner.id), 1);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
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
    await pool.query(`DELETE FROM users WHERE email LIKE $1 AND "accountantOfUserId" IS NOT NULL`, [`sec-test-%-${run}@example.test`]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`sec-test-%-${run}@example.test`]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
