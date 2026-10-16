#!/usr/bin/env node
/**
 * Found by the cross-user route test:
 *  - PUT /api/folders/:id, /api/personas/:id, /api/prompts/:id updated only the caller's own row but then
 *    read the row back by id alone, so any member got another member's folder / persona / prompt back.
 *  - POST /api/finance/invoices and PUT /api/finance/invoices/:id accepted any client id; the invoice
 *    views join the client's name and billing details, so any member could read another member's client.
 * Now: a stranger gets 404 and nothing is stored or returned; the owner's own use is unchanged.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/putOwnership.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP putOwnership.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'put-own-test-'));
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let A; let B; let clientA; let clientB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/folders', require('./folders'));
app.use('/api/personas', require('./personas'));
app.use('/api/prompts', require('./prompts'));
app.use('/api/finance', require('./finance'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
}
const run = Date.now();
const SECRET = `secret-${run}`;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('folders: a stranger cannot rename or read another member\'s folder; the owner can', async () => {
  const f = (await pool.query('INSERT INTO folders (name,"userId") VALUES ($1,$2) RETURNING id', [SECRET, A])).rows[0].id;
  const r = await call('PUT', `/api/folders/${f}`, 'B', { name: 'hijacked' });
  assert.strictEqual(r.status, 404); assert.ok(!r.text.includes(SECRET), 'the folder must not be returned');
  assert.strictEqual((await pool.query('SELECT name FROM folders WHERE id=$1', [f])).rows[0].name, SECRET, 'not renamed');
  const own = await call('PUT', `/api/folders/${f}`, 'A', { name: 'renamed' });
  assert.strictEqual(own.status, 200); assert.strictEqual(own.json.name, 'renamed');
  assert.strictEqual((await call('PUT', '/api/folders/999999999', 'A', { name: 'x' })).status, 404);
});

test('personas: same', async () => {
  const p = (await pool.query(`INSERT INTO personas (name,description,"systemPrompt","userId") VALUES ('n','d',$1,$2) RETURNING id`, [SECRET, A])).rows[0].id;
  const r = await call('PUT', `/api/personas/${p}`, 'B', { name: 'x', systemPrompt: 'hijacked' });
  assert.strictEqual(r.status, 404); assert.ok(!r.text.includes(SECRET));
  assert.strictEqual((await pool.query('SELECT "systemPrompt" s FROM personas WHERE id=$1', [p])).rows[0].s, SECRET, 'not changed');
  const own = await call('PUT', `/api/personas/${p}`, 'A', { name: 'n2', systemPrompt: 'new' });
  assert.strictEqual(own.status, 200); assert.strictEqual(own.json.systemPrompt, 'new');
});

test('prompts: same, and a stranger\'s update never borrows the owner\'s text', async () => {
  const p = (await pool.query(`INSERT INTO prompts (title,content,"userId") VALUES ('t',$1,$2) RETURNING id`, [SECRET, A])).rows[0].id;
  const r = await call('PUT', `/api/prompts/${p}`, 'B', { title: 'hijacked' });
  assert.strictEqual(r.status, 404); assert.ok(!r.text.includes(SECRET));
  assert.strictEqual((await pool.query('SELECT content c, title t FROM prompts WHERE id=$1', [p])).rows[0].c, SECRET);
  const own = await call('PUT', `/api/prompts/${p}`, 'A', { title: 'mine now' });
  assert.strictEqual(own.status, 200); assert.strictEqual(own.json.title, 'mine now'); assert.strictEqual(own.json.content, SECRET, 'unsent fields keep the owner\'s values');
});

const inv = (clientRef) => ({ clientRef, issueDate: '2026-03-10', dueDate: '2026-04-10', items: [{ description: 'Work', quantity: 1, unitPrice: 100 }] });
const invoiceCount = async (u) => Number((await pool.query('SELECT count(*) c FROM fin_invoices WHERE "userId"=$1', [u])).rows[0].c);

test('invoices: another member\'s client cannot be attached; own client, and no client, still work', async () => {
  const before = await invoiceCount(B);
  const bad = await call('POST', '/api/finance/invoices', 'B', inv(clientA));
  assert.strictEqual(bad.status, 404, bad.text); assert.deepStrictEqual(bad.json, { error: 'Client not found' });
  assert.strictEqual(await invoiceCount(B), before, 'nothing was created');
  const missing = await call('POST', '/api/finance/invoices', 'B', inv(999999999));
  assert.strictEqual(missing.status, 404, 'same answer as for someone else\'s client');
  assert.strictEqual((await call('POST', '/api/finance/invoices', 'B', inv(String(clientA)))).status, 404, 'a string id is checked the same');
  assert.strictEqual((await call('POST', '/api/finance/invoices', 'B', inv('1 OR 1=1'))).status, 404, 'a non-numeric id is refused');
  const ok = await call('POST', '/api/finance/invoices', 'B', inv(clientB));
  assert.ok(ok.status === 200 || ok.status === 201, ok.text);
  const none = await call('POST', '/api/finance/invoices', 'B', inv(undefined));
  assert.ok(none.status === 200 || none.status === 201, none.text);
  const emptyClient = await call('POST', '/api/finance/invoices', 'B', inv(''));
  assert.ok(emptyClient.status === 200 || emptyClient.status === 201, emptyClient.text);
});

test('invoices: an existing invoice cannot be re-pointed at another member\'s client', async () => {
  const mine = await call('POST', '/api/finance/invoices', 'B', inv(clientB));
  const id = mine.json.id;
  const bad = await call('PUT', `/api/finance/invoices/${id}`, 'B', inv(clientA));
  assert.strictEqual(bad.status, 404, bad.text);
  assert.strictEqual(String((await pool.query('SELECT "clientRef" c FROM fin_invoices WHERE id=$1', [id])).rows[0].c), String(clientB), 'unchanged');
  const ok = await call('PUT', `/api/finance/invoices/${id}`, 'B', inv(clientB));
  assert.strictEqual(ok.status, 200, ok.text);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`po-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  clientA = (await pool.query(`INSERT INTO clients (name,"userId") VALUES ($1,$2) RETURNING id`, [`Client-${SECRET}`, A])).rows[0].id;
  clientB = (await pool.query(`INSERT INTO clients (name,"userId") VALUES ('B client',$1) RETURNING id`, [B])).rows[0].id;
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
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A, B]]);
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
