#!/usr/bin/env node
/**
 * The local cloned-voice profile is per person. Each user's reference recording and transcript are kept
 * in their own folder and only ever read for them; one person's profile is never used to speak for
 * another. An administrator can still read the old shared profile until they save their own.
 * No audio tool is run: reference files are written directly and speech generation is never reached.
 * Integration test: needs a real Postgres (only for the throwaway users). Uses a throwaway voice folder.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/localAudio.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP localAudio.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
// The voice features exist only in local mode; point them at a throwaway folder.
process.env.APP_ENV = 'local';
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.LOCAL_VOICE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-own-test-'));

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');
const { userVoicePaths, VOICE_DIR } = require('../services/localVoiceProfile');

let ADMIN; let M1; let M2;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { const who = req.headers['x-user'] || 'm1'; req.user = { id: { admin: ADMIN, m1: M1, m2: M2 }[who], isAdmin: who === 'admin' }; next(); });
app.use('/api/local-audio', require('./localAudio'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-user': as }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const putRef = (userId) => { const p = userVoicePaths(userId); fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.refAudio, 'fake wav'); };

const run = Date.now();
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a profile saved by one person is theirs alone: another person sees nothing and cannot speak with it', async () => {
  putRef(M1);
  const saved = await call('POST', '/api/local-audio/tts/profile', 'm1', { refText: 'M1 SECRET TRANSCRIPT' });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  assert.strictEqual(saved.json.configured, true);
  assert.ok(saved.json.voiceDir.endsWith(path.join('users', String(M1))), 'stored in M1\'s own folder');
  const mine = await call('GET', '/api/local-audio/tts/status', 'm1');
  assert.strictEqual(mine.json.refText, 'M1 SECRET TRANSCRIPT');
  const theirs = await call('GET', '/api/local-audio/tts/status', 'm2');
  assert.strictEqual(theirs.json.configured, false);
  assert.strictEqual(theirs.json.refText, '', "M2 does not see M1's transcript");
  assert.ok(!JSON.stringify(theirs.json).includes('M1 SECRET'));
  assert.strictEqual((await call('GET', '/api/local-audio/tts/profile', 'm2')).json.refTextSet, false);
  const speak = await call('POST', '/api/local-audio/tts/speak', 'm2', { text: 'hello' });
  assert.strictEqual(speak.status, 503, "M2 cannot generate speech from M1's recording");
});

test('each person keeps their own: saving a second profile does not touch the first', async () => {
  putRef(M2);
  assert.strictEqual((await call('POST', '/api/local-audio/tts/profile', 'm2', { refText: 'M2 TRANSCRIPT' })).status, 200);
  assert.strictEqual((await call('GET', '/api/local-audio/tts/status', 'm1')).json.refText, 'M1 SECRET TRANSCRIPT', "M1's is unchanged");
  assert.strictEqual((await call('GET', '/api/local-audio/tts/status', 'm2')).json.refText, 'M2 TRANSCRIPT');
  const a = userVoicePaths(M1); const b = userVoicePaths(M2);
  assert.notStrictEqual(a.profile, b.profile);
  assert.strictEqual(JSON.parse(fs.readFileSync(a.profile, 'utf8')).refText, 'M1 SECRET TRANSCRIPT');
});

test('a profile needs the person\'s own recording: someone else\'s recording does not satisfy it', async () => {
  const none = await call('POST', '/api/local-audio/tts/profile', 'admin', { refText: 'ADMIN TEXT WITHOUT A RECORDING' });
  assert.strictEqual(none.status, 400);
  assert.ok(/Reference audio is required/.test(none.json.error));
  assert.ok(!fs.existsSync(userVoicePaths(ADMIN).profile), 'nothing was saved');
});

test('the old shared profile is readable by an administrator only, until they save their own', async () => {
  fs.writeFileSync(path.join(VOICE_DIR, 'reference.wav'), 'old shared wav');
  fs.writeFileSync(path.join(VOICE_DIR, 'profile.json'), JSON.stringify({ refText: 'OLD SHARED TRANSCRIPT' }));
  const admin = await call('GET', '/api/local-audio/tts/status', 'admin');
  assert.strictEqual(admin.json.configured, true);
  assert.strictEqual(admin.json.refText, 'OLD SHARED TRANSCRIPT');
  const member = await call('GET', '/api/local-audio/tts/status', 'm2');
  assert.strictEqual(member.json.refText, 'M2 TRANSCRIPT', 'a member never sees the old shared one');
  const fresh = (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`va-fresh-${run}@example.test`])).rows[0].id;
  try {
    putRef(fresh); // not used: the member has no profile of their own, and the shared one is not theirs
    const f = await fetch(`${base}/api/local-audio/tts/status`, { headers: { 'x-user': 'm2' } });
    assert.strictEqual((await f.json()).refText, 'M2 TRANSCRIPT');
  } finally { await pool.query('DELETE FROM users WHERE id=$1', [fresh]); }
  // once the administrator saves their own, theirs wins
  putRef(ADMIN);
  await call('POST', '/api/local-audio/tts/profile', 'admin', { refText: 'ADMIN OWN TRANSCRIPT' });
  assert.strictEqual((await call('GET', '/api/local-audio/tts/status', 'admin')).json.refText, 'ADMIN OWN TRANSCRIPT');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(VOICE_DIR, 'profile.json'), 'utf8')).refText, 'OLD SHARED TRANSCRIPT', 'the old file is left alone');
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t, admin) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',$2) RETURNING id`, [`va-${t}-${run}@example.test`, admin])).rows[0].id;
  ADMIN = await mk('admin', true); M1 = await mk('m1', false); M2 = await mk('m2', false);
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
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[ADMIN, M1, M2]]);
    try { fs.rmSync(process.env.LOCAL_VOICE_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
