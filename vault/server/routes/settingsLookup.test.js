#!/usr/bin/env node
/**
 * Shared keys read from settings (the Gemini key, the search key and provider for web
 * search): the caller's own setting wins, otherwise an administrator's, and a value written by some
 * other member is never used for anyone else. Outside services are replaced by fakes, so nothing leaves
 * the machine.
 * Integration test: needs a real Postgres. Uses throwaway users; any existing rows for these setting
 * names are set aside for the run and put back afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/settingsLookup.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP settingsLookup.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = ''; process.env.SEARCH_API_KEY = ''; process.env.SEARCH_PROVIDER = '';

const assert = require('assert');
const http = require('http');
const https = require('https');
const express = require('express');

// Fake Serper: records which key each web search was made with.
const serperKeys = [];
https.request = (opts, cb) => {
  serperKeys.push(opts.headers && opts.headers['X-API-KEY']);
  const handlers = {};
  const req = { on: (e, f) => { handlers[e] = f; return req; }, write() {}, destroy() {}, end() {
    process.nextTick(() => { const res = { on: (e, f) => { if (e === 'data') f(Buffer.from('{"organic":[]}')); if (e === 'end') f(); return res; } }; cb(res); });
  } };
  return req;
};
const { pool } = require('../db');
const { getSettingForUser } = require('../utils/settingsLookup');

let ADMIN; let M1; let M2;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: { admin: ADMIN, m1: M1, m2: M2 }[req.headers['x-user'] || 'm2'], isAdmin: req.headers['x-user'] === 'admin' }; next(); });
app.use('/api/web-search', require('./webSearch'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-user': as }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const NAMES = ['GEMINI_API_KEY', 'SEARCH_API_KEY', 'SEARCH_PROVIDER'];
const KEY = (n) => `${'a'.repeat(0)}${n}`;
const set = (u, key, value) => pool.query(`INSERT INTO settings ("userId",key,value) VALUES ($1,$2,$3) ON CONFLICT ("userId",key) DO UPDATE SET value=EXCLUDED.value`, [u, key, value]);
const clear = (u, key) => pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [u, key]);
const searchKey = async (as) => { const before = serperKeys.length; const r = await call('GET', '/api/web-search?q=hello', as); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.strictEqual(serperKeys.length, before + 1); return serperKeys[serperKeys.length - 1]; };
const hex = (c) => c.repeat(40); // a 40-character hex key is recognised as a Serper key
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('helper: own value first, then an administrator\'s, never another member\'s; empty values are ignored', async () => {
  await set(ADMIN, 'GEMINI_API_KEY', 'ADMIN-KEY'); await set(M1, 'GEMINI_API_KEY', 'M1-KEY');
  assert.strictEqual(await getSettingForUser(M1, 'GEMINI_API_KEY'), 'M1-KEY', 'own wins');
  assert.strictEqual(await getSettingForUser(M2, 'GEMINI_API_KEY'), 'ADMIN-KEY', "a member with none gets the administrator's, not M1's");
  assert.strictEqual(await getSettingForUser(ADMIN, 'GEMINI_API_KEY'), 'ADMIN-KEY');
  await set(M2, 'GEMINI_API_KEY', '');
  assert.strictEqual(await getSettingForUser(M2, 'GEMINI_API_KEY'), 'ADMIN-KEY', 'an empty own value does not count');
  await clear(M2, 'GEMINI_API_KEY');
  await clear(ADMIN, 'GEMINI_API_KEY');
  assert.strictEqual(await getSettingForUser(M2, 'GEMINI_API_KEY'), null, "with no administrator value, M1's is still not handed to M2");
  assert.strictEqual(await getSettingForUser(M1, 'GEMINI_API_KEY'), 'M1-KEY');
  await clear(M1, 'GEMINI_API_KEY');
});

test("web search: the search key and provider come from the caller's own setting, else the administrator's, never another member's", async () => {
  await set(ADMIN, 'SEARCH_API_KEY', hex('a')); await set(ADMIN, 'SEARCH_PROVIDER', 'serper');
  await set(M1, 'SEARCH_API_KEY', hex('b')); await set(M1, 'SEARCH_PROVIDER', 'serper');
  assert.strictEqual(await searchKey('m1'), hex('b'), 'M1 uses their own');
  assert.strictEqual(await searchKey('m2'), hex('a'), "M2 uses the administrator's, not M1's");
  assert.strictEqual(await searchKey('admin'), hex('a'));
  await clear(ADMIN, 'SEARCH_API_KEY');
  const none = await call('GET', '/api/web-search?q=hello', 'm2');
  assert.strictEqual(none.status, 501, "without an administrator key M2 is told it is not configured, not run on M1's key");
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  // put back anything a crashed earlier run set aside, then set aside real rows for these names for this run
  await pool.query(`UPDATE settings SET key = replace(key, '_held_by_test', '') WHERE key LIKE '%\\_held\\_by\\_test'`);
  const held = (await pool.query(`UPDATE settings SET key = key || '_held_by_test' WHERE key = ANY($1::text[]) RETURNING "userId", key`, [NAMES])).rows;
  const mk = async (t, admin) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',$2) RETURNING id`, [`sl-${t}-${run}@example.test`, admin])).rows[0].id;
  ADMIN = await mk('admin', true); M1 = await mk('m1', false); M2 = await mk('m2', false);
  // the lookup also sees other administrators, so make the test's administrator the only one holding these names
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
    await pool.query(`UPDATE settings SET key = replace(key, '_held_by_test', '') WHERE key LIKE '%\\_held\\_by\\_test'`);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
