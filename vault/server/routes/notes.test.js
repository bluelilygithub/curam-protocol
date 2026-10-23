#!/usr/bin/env node
/**
 * Notes list: light rows, search, date range, paging, project/client names, ownership checks.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards (everything cascades from users).
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/notes.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP notes.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let userA; let userB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: true }; next(); });
app.use('/api/notes', require('./notes'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, more: res.headers.get('x-has-more') };
}

let clientA; let clientB; let projectA; let projectB;
const ids = {};
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const day = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();

test('the list sends a short preview, never the whole text', async () => {
  const long = 'x'.repeat(5000);
  const made = await call('POST', '/api/notes', { title: 'Long one', body: long });
  assert.strictEqual(made.status, 201);
  ids.long = made.json.id;
  const r = await call('GET', '/api/notes');
  const row = r.json.find((n) => n.id === ids.long);
  assert.ok(row, 'listed');
  assert.strictEqual(row.body, undefined, 'no body in the list');
  assert.strictEqual(row.preview.length, 240, 'preview is cut');
  assert.strictEqual((await call('GET', `/api/notes/${ids.long}`)).json.body.length, 5000, 'the open note still has everything');
});

test('seed notes with known dates, a project and a client', async () => {
  const mk = async (title, body, created, updated, extra = {}) => {
    const r = await pool.query(
      'INSERT INTO notes (user_id, title, body, created_at, updated_at, project_id, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [userA, title, body, created, updated, extra.project || null, extra.client || null]);
    ids[title] = r.rows[0].id;
  };
  await mk('Old budget', 'tax and budget', day(2026, 1, 5), day(2026, 1, 6), { project: projectA });
  await mk('March call', 'call with Acme', day(2026, 3, 10), day(2026, 3, 11), { client: clientA });
  await mk('October plan', '100% sure_thing', day(2026, 10, 1), day(2026, 10, 20));
  await mk('Edited late', 'made in feb, edited in oct', day(2026, 2, 1), day(2026, 10, 22));
});

test('newest first by last edited; names for project and client come with each row', async () => {
  const r = await call('GET', '/api/notes');
  const order = r.json.map((n) => n.title).filter((t) => ['Old budget', 'March call', 'October plan', 'Edited late'].includes(t));
  assert.deepStrictEqual(order, ['Edited late', 'October plan', 'March call', 'Old budget']);
  assert.strictEqual(r.json.find((n) => n.title === 'Old budget').project_name, 'Project A');
  assert.strictEqual(r.json.find((n) => n.title === 'March call').client_name, 'Client A');
});

test('date range: from is included, to is excluded; the field picks created or edited', async () => {
  const titles = async (qs) => (await call('GET', `/api/notes?${qs}`)).json.map((n) => n.title).filter((t) => ids[t]);
  const q = (o) => new URLSearchParams(o).toString();
  assert.deepStrictEqual(await titles(q({ from: day(2026, 10, 1), to: day(2026, 11, 1) })), ['Edited late', 'October plan']);
  assert.deepStrictEqual(await titles(q({ from: day(2026, 2, 1), to: day(2026, 3, 1), field: 'created' })), ['Edited late']);
  assert.deepStrictEqual(await titles(q({ from: day(2026, 3, 11), to: day(2026, 3, 12) })), ['March call'], 'edge of the range');
  assert.deepStrictEqual(await titles(q({ to: day(2026, 3, 11) })), ['Old budget'], 'to excludes that instant');
  assert.strictEqual((await call('GET', '/api/notes?from=not-a-date')).status, 400);
});

test('search: title, text, project and client names; % and _ are plain characters', async () => {
  const titles = async (q) => (await call('GET', `/api/notes?q=${encodeURIComponent(q)}`)).json.map((n) => n.title);
  assert.deepStrictEqual(await titles('budget'), ['Old budget']);
  assert.ok((await titles('Project A')).includes('Old budget'), 'project name');
  assert.ok((await titles('Client A')).includes('March call'), 'client name');
  assert.deepStrictEqual((await titles('100%')).filter((t) => ids[t]), ['October plan']);
  assert.deepStrictEqual((await titles('%')).filter((t) => ids[t]), ['October plan'], 'a lone % is not "match everything"');
  assert.deepStrictEqual((await titles('sure_thing')).filter((t) => ids[t]), ['October plan']);
  assert.deepStrictEqual((await titles('sureXthing')), [], '_ is not "any one character"');
});

test('filter by project, client and unfiled', async () => {
  const titles = async (qs) => (await call('GET', `/api/notes?${qs}`)).json.map((n) => n.title).filter((t) => ids[t]);
  assert.deepStrictEqual(await titles(`project_id=${projectA}`), ['Old budget']);
  assert.deepStrictEqual(await titles(`client_id=${clientA}`), ['March call']);
  assert.ok(!(await titles('unfiled=1')).includes('Old budget'));
  assert.ok((await titles('unfiled=1')).includes('October plan'));
});

test('paging: limit, offset and the X-Has-More header', async () => {
  const total = (await call('GET', '/api/notes?limit=300')).json.length;
  assert.ok(total >= 5);
  const p1 = await call('GET', '/api/notes?limit=2');
  assert.strictEqual(p1.json.length, 2);
  assert.strictEqual(p1.more, '1');
  const p2 = await call('GET', '/api/notes?limit=2&offset=2');
  assert.ok(!p1.json.some((a) => p2.json.some((b) => b.id === a.id)), 'pages do not overlap');
  const last = await call('GET', `/api/notes?limit=2&offset=${total - 1}`);
  assert.strictEqual(last.more, '0');
});

test('a note can only be filed under your own project and client', async () => {
  assert.strictEqual((await call('POST', '/api/notes', { title: 'x', project_id: projectB })).status, 400);
  assert.strictEqual((await call('POST', '/api/notes', { title: 'x', project_id: 999999999 })).status, 400);
  assert.strictEqual((await call('PUT', `/api/notes/${ids.long}`, { project_id: projectB })).status, 400);
  assert.strictEqual((await call('PUT', `/api/notes/${ids.long}`, { client_id: clientB })).status, 400);
  const ok = await call('PUT', `/api/notes/${ids.long}`, { project_id: projectA });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.project_id, projectA);
  assert.strictEqual((await call('POST', '/api/notes', { title: 5 })).status, 400, 'a title that is not text is refused, not a 500');
});

test('GET /:id carries the project and client names; /options lists only your clients', async () => {
  const one = await call('GET', `/api/notes/${ids['March call']}`);
  assert.strictEqual(one.json.client_name, 'Client A');
  const opts = await call('GET', '/api/notes/options');
  assert.deepStrictEqual(opts.json.clients.map((c) => c.name), ['Client A']);
});

test("other people's notes are invisible", async () => {
  assert.strictEqual((await call('GET', `/api/notes/${ids['March call']}`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('PUT', `/api/notes/${ids['March call']}`, { title: 'hax' }, 'B')).status, 404);
  assert.strictEqual((await call('DELETE', `/api/notes/${ids['March call']}`, undefined, 'B')).status, 404);
  assert.deepStrictEqual((await call('GET', '/api/notes', undefined, 'B')).json, []);
  assert.deepStrictEqual((await call('GET', '/api/notes/options', undefined, 'B')).json.clients.map((c) => c.name), ['Client B']);
});

async function cleanup(userIds) {
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
}

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query('INSERT INTO users (email, "passwordHash") VALUES ($1,\'x\') RETURNING id', [`notes-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  const proj = async (name, uid) => (await pool.query('INSERT INTO projects (name, "userId", model, "projectType") VALUES ($1,$2,\'m\',\'writing\') RETURNING id', [name, uid])).rows[0].id;
  projectA = await proj('Project A', userA); projectB = await proj('Project B', userB);
  clientA = (await pool.query('INSERT INTO clients ("userId", name) VALUES ($1,\'Client A\') RETURNING id', [userA])).rows[0].id;
  clientB = (await pool.query('INSERT INTO clients ("userId", name) VALUES ($1,\'Client B\') RETURNING id', [userB])).rows[0].id;
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
    await cleanup([userA, userB]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
