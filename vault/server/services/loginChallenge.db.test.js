#!/usr/bin/env node
/**
 * Two-step login, Milestone 1 (docs/two-step-login.md): emailed codes for members and accountants.
 * Mail and the Suggestions inbox are replaced by recorders, so nothing is sent and no inbox item is made.
 * Integration test: needs a real Postgres. Uses throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/services/loginChallenge.db.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP loginChallenge.db.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.AUTH_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const assert = require('assert');
const http = require('http');
const express = require('express');

const sent = [];
let mailMode = 'ok'; // 'ok' | 'throw' | 'skipped'
const sendEmailPath = require.resolve('../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async (opts) => {
  if (mailMode === 'throw') throw new Error('MailChannels error 500');
  if (mailMode === 'skipped') return { ok: false, skipped: true, reason: 'Email disabled' };
  sent.push(opts); return { ok: true };
} };
const captured = [];
const suggestPath = require.resolve('./SuggestionService');
require.cache[suggestPath] = { id: suggestPath, filename: suggestPath, loaded: true, exports: {
  capture: async (p) => { captured.push(p); return { id: 1 }; },
  makeFingerprint: (s, k) => `${s}:${k}`,
  getPrimaryAdminUserId: async () => 999999,
} };

const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const run = Date.now();
const mail = (tag) => `lc-test-${tag}-${run}@example.test`;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api', requireAuth, (req, res) => res.json({ ok: true, userId: req.user.id }));

let base;
let ipSeq = 0;
async function call(method, url, body, headers = {}) {
  // a new address per call, so the per-IP limiters never trip during the test
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const lastCode = () => sent[sent.length - 1].subject.slice(0, 6);
const wrong = (code) => String((Number(code) + 1) % 1000000).padStart(6, '0');

async function makeUser(tag, extra = {}) {
  const email = mail(tag);
  const { rows } = await pool.query(
    `INSERT INTO users (email,"passwordHash","isAdmin","disabledAt") VALUES ($1,$2,$3,$4) RETURNING id`,
    [email, await bcrypt.hash('pass-word-123', 4), !!extra.isAdmin, extra.disabledAt || null]
  );
  return { id: rows[0].id, email };
}
const login = (u) => call('POST', '/api/auth/login', { email: u.email, password: 'pass-word-123' });
const verify = (challengeId, code) => call('POST', '/api/auth/challenge/verify', { challengeId, code });
const resend = (challengeId) => call('POST', '/api/auth/challenge/resend', { challengeId });
const sessions = async (userId) => (await pool.query('SELECT COUNT(*)::int n FROM auth_sessions WHERE "userId"=$1', [userId])).rows[0].n;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a member gets a challenge, not a session; the right code makes exactly one session', async () => {
  const u = await makeUser('happy');
  const r = await login(u);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.challengeId && !r.json.token, 'no token before the code');
  assert.strictEqual(r.json.method, 'email');
  assert.strictEqual(r.json.emailHint, `l***@example.test`);
  assert.strictEqual(sent[sent.length - 1].to, u.email);
  assert.strictEqual(await sessions(u.id), 0);
  const row = (await pool.query('SELECT "codeHash" FROM auth_login_challenges WHERE id=$1', [r.json.challengeId])).rows[0];
  assert.ok(row.codeHash.length === 64 && !row.codeHash.includes(lastCode()), 'code stored only as a hash');
  const v = await verify(r.json.challengeId, lastCode());
  assert.strictEqual(v.status, 200, JSON.stringify(v.json));
  assert.ok(v.json.token && v.json.user.email === u.email);
  assert.strictEqual(await sessions(u.id), 1);
  assert.strictEqual((await call('GET', '/api/anything', null, { Authorization: `Bearer ${v.json.token}` })).status, 200);
});

test('a challenge id is not a session token', async () => {
  const u = await makeUser('notsession');
  const r = await login(u);
  assert.strictEqual((await call('GET', '/api/anything', null, { Authorization: `Bearer ${r.json.challengeId}` })).status, 401);
});

test('a used challenge cannot be used again', async () => {
  const u = await makeUser('reuse');
  const r = await login(u);
  const code = lastCode();
  assert.strictEqual((await verify(r.json.challengeId, code)).status, 200);
  const again = await verify(r.json.challengeId, code);
  assert.strictEqual(again.status, 400);
  assert.strictEqual(again.json.code, 'challenge_dead');
  assert.strictEqual(await sessions(u.id), 1);
});

test('an expired challenge is refused even with the right code', async () => {
  const u = await makeUser('expired');
  const r = await login(u);
  await pool.query(`UPDATE auth_login_challenges SET "expiresAt"=NOW() - INTERVAL '1 second' WHERE id=$1`, [r.json.challengeId]);
  const v = await verify(r.json.challengeId, lastCode());
  assert.strictEqual(v.json.code, 'challenge_dead');
  assert.strictEqual(await sessions(u.id), 0);
});

test('5 wrong codes kill the challenge, the right code then fails, and the admin inbox hears about it', async () => {
  const u = await makeUser('fivewrong');
  const r = await login(u);
  const code = lastCode();
  const before = captured.length;
  for (let i = 1; i <= 4; i++) {
    const v = await verify(r.json.challengeId, wrong(code));
    assert.strictEqual(v.status, 400);
    assert.strictEqual(v.json.attemptsLeft, 5 - i);
    assert.ok(!/exist|account/i.test(v.json.error), 'generic error');
  }
  assert.strictEqual((await verify(r.json.challengeId, wrong(code))).json.code, 'challenge_dead');
  assert.strictEqual((await verify(r.json.challengeId, code)).json.code, 'challenge_dead');
  assert.strictEqual(await sessions(u.id), 0);
  await new Promise((res) => setTimeout(res, 100));
  assert.ok(captured.slice(before).some((c) => c.source === 'twoStepLogin' && c.title.includes(u.email)));
});

test('10 wrong codes in an hour lock the account across new challenges', async () => {
  const u = await makeUser('acctlock');
  for (let round = 0; round < 2; round++) {
    const r = await login(u);
    for (let i = 0; i < 5; i++) await verify(r.json.challengeId, wrong(lastCode()));
  }
  // sends are capped at 6 an hour; clear them so the third login can send
  await pool.query(`UPDATE auth_login_challenges SET "lastSentAt"=NULL WHERE "userId"=$1`, [u.id]);
  const r = await login(u);
  const v = await verify(r.json.challengeId, lastCode());
  assert.strictEqual(v.status, 400, 'right code refused while the account is locked');
  assert.strictEqual(await sessions(u.id), 0);
});

test('resend: not within a minute; then a new code replaces the old one', async () => {
  const u = await makeUser('resend');
  const r = await login(u);
  const first = lastCode();
  assert.strictEqual((await resend(r.json.challengeId)).status, 429);
  await pool.query(`UPDATE auth_login_challenges SET "lastSentAt"=NOW() - INTERVAL '61 seconds' WHERE id=$1`, [r.json.challengeId]);
  const s = await resend(r.json.challengeId);
  assert.strictEqual(s.status, 200, JSON.stringify(s.json));
  const second = lastCode();
  if (second !== first) assert.strictEqual((await verify(r.json.challengeId, first)).status, 400, 'old code stops working');
  assert.strictEqual((await verify(r.json.challengeId, second)).status, 200);
  const row = (await pool.query('SELECT "resendCount" FROM auth_login_challenges WHERE id=$1', [r.json.challengeId])).rows[0];
  assert.strictEqual(row.resendCount, 1);
});

test('resend: at most 6 code emails an hour per account, across challenges', async () => {
  const u = await makeUser('hourcap');
  const r = await login(u);
  for (let i = 0; i < 5; i++) {
    await pool.query(`UPDATE auth_login_challenges SET "lastSentAt"=NOW() - INTERVAL '61 seconds' WHERE id=$1`, [r.json.challengeId]);
    assert.strictEqual((await resend(r.json.challengeId)).status, 200, `resend ${i + 1}`);
  }
  await pool.query(`UPDATE auth_login_challenges SET "lastSentAt"=NOW() - INTERVAL '61 seconds' WHERE id=$1`, [r.json.challengeId]);
  assert.strictEqual((await resend(r.json.challengeId)).status, 429);
  assert.strictEqual((await login(u)).status, 429, 'a new login cannot get round the cap');
});

test('a failed send says so plainly, raises an inbox item, and Send code works straight away', async () => {
  const u = await makeUser('sendfail');
  const before = captured.length;
  mailMode = 'throw';
  const r = await login(u);
  mailMode = 'ok';
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.sendFailed, true);
  assert.ok(/couldn't send your code/i.test(r.json.error) && /admin/i.test(r.json.error));
  assert.ok(captured.slice(before).some((c) => c.category === 'alert' && /could not be sent/.test(c.title)));
  const s = await resend(r.json.challengeId);
  assert.strictEqual(s.status, 200, 'no one-minute wait after a failed send');
  assert.strictEqual((await verify(r.json.challengeId, lastCode())).status, 200);
  const row = (await pool.query('SELECT "resendCount" FROM auth_login_challenges WHERE id=$1', [r.json.challengeId])).rows[0];
  assert.strictEqual(row.resendCount, 0, 'the first real send is not a resend');
});

test('email switched off (DISABLE_EMAIL) counts as a failed send; a failed resend says so too', async () => {
  const u = await makeUser('skipped');
  mailMode = 'skipped';
  const r = await login(u);
  assert.strictEqual(r.json.sendFailed, true);
  const s = await resend(r.json.challengeId);
  mailMode = 'ok';
  assert.strictEqual(s.status, 502);
  assert.strictEqual(s.json.code, 'code_send_failed');
});

test('admins still sign in with a password until Milestone 3; they are never sent an email code', async () => {
  const u = await makeUser('admin', { isAdmin: true });
  const before = sent.length;
  const r = await login(u);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.token && !r.json.challengeId);
  assert.strictEqual(sent.length, before);
});

test('a disabled account and a wrong password get no code', async () => {
  const u = await makeUser('disabled', { disabledAt: new Date() });
  const before = sent.length;
  assert.strictEqual((await login(u)).status, 403);
  const v = await makeUser('wrongpw');
  assert.strictEqual((await call('POST', '/api/auth/login', { email: v.email, password: 'nope-nope-1' })).status, 401);
  assert.strictEqual(sent.length, before);
});

test('rubbish ids and codes are refused without errors', async () => {
  for (const body of [{}, { challengeId: 'x', code: '123456' }, { challengeId: ['a'], code: { a: 1 } }]) {
    const v = await call('POST', '/api/auth/challenge/verify', body);
    assert.strictEqual(v.status, 400, JSON.stringify(body));
  }
  assert.strictEqual((await resend('nope')).status, 400);
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
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`lc-test-%-${run}@example.test`]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
