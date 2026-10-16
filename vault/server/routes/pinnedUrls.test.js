#!/usr/bin/env node
/**
 * Pinned URLs belong to the project's owner. Another user cannot list, add, refresh or delete pins in a
 * project they do not own, and nothing is fetched on their behalf. Network access is replaced by a fake
 * here, so this test never touches the internet.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/pinnedUrls.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP pinnedUrls.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { EventEmitter } = require('events');
const express = require('express');

// A fake internet: every host resolves to a public address and every page is the same small page.
let fetches = 0;
dns.lookup = (_host, cb) => cb(null, '93.184.216.34');
https.get = (_url, _opts, cb) => {
  fetches++;
  const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
  process.nextTick(() => {
    const res = new EventEmitter(); res.statusCode = 200; res.headers = {};
    cb(res);
    res.emit('data', Buffer.from(`<html><head><title>FAKE-TITLE-${fetches}</title></head><body>fake page body ${fetches}</body></html>`));
    res.emit('end');
  });
  return req;
};
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/pinned-urls', require('./pinnedUrls'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
let projA; let projB; let pinA;
const MISSING = { error: 'Not found' };
const pins = async (proj) => (await pool.query('SELECT id, title, content FROM pinned_urls WHERE "projectId"=$1 ORDER BY id', [proj])).rows;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("the owner can pin, list, refresh and delete in their own project", async () => {
  const add = await call('POST', '/api/pinned-urls', undefined, { projectId: projA, url: 'https://pages.example.test/one' });
  assert.strictEqual(add.status, 201, JSON.stringify(add.json));
  assert.ok(/FAKE-TITLE/.test(add.json.title));
  const list = await call('GET', `/api/pinned-urls/${projA}`);
  assert.ok(list.json.some((p) => p.id === add.json.id));
  const before = fetches;
  const refreshed = await call('PATCH', `/api/pinned-urls/${add.json.id}/refresh`);
  assert.strictEqual(refreshed.status, 200);
  assert.strictEqual(fetches, before + 1);
  assert.deepStrictEqual((await call('DELETE', `/api/pinned-urls/${add.json.id}`)).json, { ok: true });
  assert.ok(!(await pins(projA)).some((p) => p.id === add.json.id));
});

test("another user cannot list pins in someone else's project: the same empty list as a missing project", async () => {
  const other = await call('GET', `/api/pinned-urls/${projA}`, 'B');
  const missing = await call('GET', '/api/pinned-urls/999999999', 'B');
  assert.deepStrictEqual(other.json, []);
  assert.deepStrictEqual(other.json, missing.json);
  assert.ok((await call('GET', `/api/pinned-urls/${projA}`)).json.length >= 1, 'the owner still sees theirs');
});

test("another user cannot pin into someone else's project: 404, nothing stored, and nothing fetched", async () => {
  const before = (await pins(projA)).length; const f0 = fetches;
  const r = await call('POST', '/api/pinned-urls', 'B', { projectId: projA, url: 'https://attacker.example.test/instructions' });
  assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, MISSING);
  assert.strictEqual((await pins(projA)).length, before, 'no pin was planted');
  assert.strictEqual(fetches, f0, 'no page was fetched for them');
  const missing = await call('POST', '/api/pinned-urls', 'B', { projectId: 999999999, url: 'https://x.example.test/' });
  assert.deepStrictEqual(missing.json, r.json); assert.strictEqual(missing.status, 404);
  assert.strictEqual((await call('POST', '/api/pinned-urls', 'B', { url: 'https://x.example.test/' })).status, 400, 'input check unchanged');
});

test("another user cannot refresh or delete someone else's pin: same 404 as a missing pin, pin untouched, nothing fetched", async () => {
  const f0 = fetches; const snapshot = JSON.stringify(await pins(projA));
  const refresh = await call('PATCH', `/api/pinned-urls/${pinA}/refresh`, 'B');
  const del = await call('DELETE', `/api/pinned-urls/${pinA}`, 'B');
  const missing = await call('DELETE', '/api/pinned-urls/999999999', 'B');
  for (const r of [refresh, del, missing]) { assert.strictEqual(r.status, 404); assert.deepStrictEqual(r.json, MISSING); }
  assert.strictEqual(fetches, f0, 'nothing was fetched');
  assert.strictEqual(JSON.stringify(await pins(projA)), snapshot, "A's pin is exactly as it was");
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`pu-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const proj = async (u, n) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [n, u])).rows[0].id;
  projA = await proj(A, 'A'); projB = await proj(B, 'B');
  pinA = (await pool.query(`INSERT INTO pinned_urls ("projectId",url,title,content) VALUES ($1,'https://a-private.example.test/x','A-SECRET-PIN','A pinned content') RETURNING id`, [projA])).rows[0].id;
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
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // projects and their pins cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
