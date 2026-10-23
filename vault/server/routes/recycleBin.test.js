#!/usr/bin/env node
/**
 * The shared recycle bin, tested with a made-up second tool ("rb-test-thing") to prove any tool can use it with just an adapter.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards (the bin rows cascade from users).
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/recycleBin.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP recycleBin.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');
const bin = require('../services/recycleBin');

let userA; let userB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: true }; next(); });
app.use('/api/recycle-bin', require('./recycleBin'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

// The "other tool": a table of things, and the whole of what it has to write to join the bin.
let failRestore = false;
bin.register('rb-test-thing', {
  label: 'Test thing',
  async restore(db, userId, payload) {
    if (failRestore) throw new Error('boom');
    const { rows } = await db.query('INSERT INTO rb_test_things (id, "userId", name) VALUES ($1,$2,$3) RETURNING id', [payload.id, userId, payload.name]);
    return { entityId: rows[0].id };
  },
});
const things = async (uid) => (await pool.query('SELECT id, name FROM rb_test_things WHERE "userId"=$1 ORDER BY id', [uid])).rows;
const trash = (userId, id, name) => bin.moveToBin(pool, { userId, type: 'rb-test-thing', id, title: name, detail: `about ${name}`, payload: { id, name } });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a tool deletes into the bin and the item can be listed and restored', async () => {
  await pool.query('INSERT INTO rb_test_things (id, "userId", name) VALUES (1,$1,\'Alpha\')', [userA]);
  const binId = await pool.connect().then(async (db) => {
    try {
      await db.query('BEGIN');
      const id = await trash(userA, 1, 'Alpha'); // same transaction as the delete
      await db.query('COMMIT');
      return id;
    } finally { db.release(); }
  });
  await pool.query('DELETE FROM rb_test_things WHERE id=1');
  assert.deepStrictEqual(await things(userA), []);

  const list = await call('GET', '/api/recycle-bin');
  assert.strictEqual(list.json.retentionDays, 30);
  const item = list.json.items.find((i) => i.id === binId);
  assert.deepStrictEqual({ type: item.entityType, label: item.label, title: item.title, detail: item.detail, daysLeft: item.daysLeft },
    { type: 'rb-test-thing', label: 'Test thing', title: 'Alpha', detail: 'about Alpha', daysLeft: 30 });

  const back = await call('POST', `/api/recycle-bin/${binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.deepStrictEqual({ type: back.json.type, entityId: back.json.entityId, title: back.json.title }, { type: 'rb-test-thing', entityId: '1', title: 'Alpha' });
  assert.deepStrictEqual(await things(userA), [{ id: 1, name: 'Alpha' }], 'the tool got its row back');
  assert.ok(!(await call('GET', '/api/recycle-bin')).json.items.some((i) => i.id === binId), 'and it left the bin');
  assert.strictEqual((await call('POST', `/api/recycle-bin/${binId}/restore`)).status, 404, 'a second restore finds nothing');
});

test('a failed restore changes nothing: the item stays in the bin and the tool gets no half-row', async () => {
  const binId = await trash(userA, 2, 'Beta');
  failRestore = true;
  try {
    const r = await call('POST', `/api/recycle-bin/${binId}/restore`);
    assert.strictEqual(r.status, 500);
    assert.match(r.json.error, /still in the recycle bin/);
  } finally { failRestore = false; }
  assert.deepStrictEqual(await things(userA), [{ id: 1, name: 'Alpha' }], 'no Beta row appeared (Alpha is the one restored earlier)');
  assert.ok((await call('GET', '/api/recycle-bin')).json.items.some((i) => i.id === binId), 'still there to try again');
  assert.strictEqual((await call('POST', `/api/recycle-bin/${binId}/restore`)).status, 200, 'and it works the next time');
  assert.deepStrictEqual((await things(userA)).map((t) => t.name), ['Alpha', 'Beta']);
});

test('items older than 30 days are purged, and cannot be restored', async () => {
  const old = await trash(userA, 3, 'Gamma');
  await pool.query(`UPDATE recycle_bin SET "expiresAt" = NOW() - interval '1 hour' WHERE id=$1`, [old]);
  await assert.rejects(bin.restoreItem(userA, old), (e) => e.status === 410, 'too old to restore');
  assert.ok(!(await call('GET', '/api/recycle-bin')).json.items.some((i) => i.id === old), 'the list purges it');
  assert.strictEqual((await call('POST', `/api/recycle-bin/${old}/restore`)).status, 404, 'gone');
  const another = await trash(userA, 4, 'Delta');
  await pool.query(`UPDATE recycle_bin SET "expiresAt" = NOW() - interval '1 day' WHERE id=$1`, [another]);
  assert.ok((await bin.purgeExpired()) >= 1, 'the scheduled purge removes them too');
  await call('DELETE', '/api/recycle-bin?types=rb-test-thing');
});

test("a person only sees, restores and deletes their own items", async () => {
  const mine = await trash(userA, 5, 'Epsilon');
  const theirs = await trash(userB, 6, 'Zeta');
  assert.deepStrictEqual((await call('GET', '/api/recycle-bin')).json.items.map((i) => i.title), ['Epsilon']);
  assert.deepStrictEqual((await call('GET', '/api/recycle-bin', undefined, 'B')).json.items.map((i) => i.title), ['Zeta']);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${mine}/restore`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('DELETE', `/api/recycle-bin/${mine}`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('DELETE', '/api/recycle-bin', undefined, 'B')).json.removed, 1, "B's empty only empties B's");
  assert.deepStrictEqual((await call('GET', '/api/recycle-bin')).json.items.map((i) => i.title), ['Epsilon'], "A's item is untouched");
  assert.ok(theirs);
});

test('delete forever, and empty (all, or just some kinds)', async () => {
  await call('DELETE', '/api/recycle-bin');
  const a = await trash(userA, 7, 'Eta');
  await trash(userA, 8, 'Theta');
  await pool.query(`INSERT INTO recycle_bin ("userId","entityType","entityId",title,payload,"expiresAt") VALUES ($1,'note','999','A note','{}'::jsonb,NOW()+interval '5 days')`, [userA]);
  assert.strictEqual((await call('DELETE', `/api/recycle-bin/${a}`)).status, 200);
  assert.strictEqual((await call('DELETE', `/api/recycle-bin/${a}`)).status, 404);
  assert.strictEqual((await call('GET', '/api/recycle-bin?types=note')).json.items.length, 1, 'filter by kind');
  assert.strictEqual((await call('GET', '/api/recycle-bin?types=note,rb-test-thing')).json.items.length, 2, 'or several kinds');
  assert.strictEqual((await call('DELETE', '/api/recycle-bin?types=rb-test-thing')).json.removed, 1, 'empty just one kind');
  assert.strictEqual((await call('GET', '/api/recycle-bin')).json.items.length, 1, 'the other kind stays');
  assert.strictEqual((await call('DELETE', '/api/recycle-bin')).json.removed, 1);
});

test('safety: unknown kinds are refused, and an item whose tool is gone cannot be restored', async () => {
  await assert.rejects(bin.moveToBin(pool, { userId: userA, type: 'never-registered', id: 1, title: 'x', payload: {} }), /no adapter/);
  const r = await pool.query(`INSERT INTO recycle_bin ("userId","entityType","entityId",title,payload,"expiresAt") VALUES ($1,'retired-tool','1','Old',$2::jsonb,NOW()+interval '5 days') RETURNING id`, [userA, '{}']);
  const out = await call('POST', `/api/recycle-bin/${r.rows[0].id}/restore`);
  assert.strictEqual(out.status, 422);
  assert.ok((await call('GET', '/api/recycle-bin')).json.items.some((i) => i.entityType === 'retired-tool' && i.label === 'retired-tool'), 'still listed, with its kind as the label');
  await call('DELETE', '/api/recycle-bin');
  assert.throws(() => bin.register('x', {}), /restore function/);
});

async function cleanup(ids) {
  await pool.query('DROP TABLE IF EXISTS rb_test_things');
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
}

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query('INSERT INTO users (email, "passwordHash") VALUES ($1,\'x\') RETURNING id', [`rb-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  await pool.query('CREATE TABLE rb_test_things (id INTEGER PRIMARY KEY, "userId" INTEGER NOT NULL, name TEXT NOT NULL)');
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
