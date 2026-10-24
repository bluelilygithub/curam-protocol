#!/usr/bin/env node
/**
 * Route Tracer tracks use the shared recycle bin: a deleted track (one or several) is kept 30 days with its line and its directions, comes back
 * whole with its own id, is private to its owner, and the bin copy and the delete succeed or fail together.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/routeTracksBin.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP routeTracksBin.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/route-tracks', require('./routeTracks'));
app.use('/api/recycle-bin', require('./recycleBin'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const cue = (n) => ({ text: `Turn left onto Park Road ${n}`, distanceM: 120, durationS: 90, type: 0, pos: [153.03, -27.47] });
const make = async (name, withCues, as) => (await call('POST', '/api/route-tracks', {
  name, drawMode: 'route', geometry: { type: 'MultiLineString', coordinates: [[[153.03, -27.47], [153.031, -27.471], [153.032, -27.472]]] }, ...(withCues ? { cues: [cue(1), cue(2)] } : {}),
}, as)).json.track;
const inBin = async (user) => (await pool.query(`SELECT * FROM recycle_bin WHERE "userId" = $1 AND "entityType" = 'route-track' ORDER BY id`, [user])).rows;
const exists = async (id) => (await pool.query('SELECT 1 FROM route_tracks WHERE id = $1', [id])).rows.length > 0;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a deleted track goes to the bin, then comes back whole: same id, line, directions, notes, colour', async () => {
  const t = await make('Sunday loop', true);
  await call('PATCH', `/api/route-tracks/${t.id}`, { notes: 'Park, then the river', color: '#2E7D32' });
  const del = await call('DELETE', `/api/route-tracks/${t.id}`);
  assert.strictEqual(del.status, 200);
  assert.ok(del.json.binId);
  assert.strictEqual(await exists(t.id), false, 'the track is gone from the tracks table');
  const rows = await inBin(A);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].title, 'Sunday loop');
  const listed = await call('GET', '/api/recycle-bin?types=route-track');
  assert.strictEqual(listed.json.items.length, 1);
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  const again = (await call('GET', `/api/route-tracks/${t.id}`)).json.track;
  assert.strictEqual(again.name, 'Sunday loop');
  assert.strictEqual(again.notes, 'Park, then the river');
  assert.strictEqual(again.color, '#2E7D32');
  assert.deepStrictEqual(again.geometry, t.geometry);
  assert.strictEqual(again.cues.length, 2, 'the directions come back as a list, not a Postgres array');
  assert.strictEqual(again.distanceM, t.distanceM);
  assert.strictEqual((await inBin(A)).length, 0, 'once restored it leaves the bin');
  await call('DELETE', `/api/route-tracks/${t.id}`);
});

test('deleting several at once puts each in the bin, and only the caller\'s own', async () => {
  const mine = [await make('One', false), await make('Two', true)];
  const theirs = await make('Not yours', false, 'B');
  const before = (await inBin(A)).length;
  const r = await call('POST', '/api/route-tracks/delete', { ids: [...mine.map((m) => m.id), theirs.id] });
  assert.strictEqual(r.json.deleted, 2);
  assert.strictEqual(r.json.binIds.length, 2);
  assert.strictEqual((await inBin(A)).length, before + 2);
  assert.strictEqual(await exists(theirs.id), true, 'another person\'s track is untouched');
  assert.strictEqual((await inBin(B)).length, 0);
  for (const id of r.json.binIds) assert.strictEqual((await call('POST', `/api/recycle-bin/${id}/restore`)).status, 200);
  assert.strictEqual((await call('GET', '/api/route-tracks?limit=100')).json.tracks.length, 2);
  await call('POST', '/api/route-tracks/delete', { ids: mine.map((m) => m.id) });
  await call('DELETE', `/api/route-tracks/${theirs.id}`, undefined, 'B');
});

test('the bin is private: another person cannot see or restore a deleted track', async () => {
  const t = await make('Private', false);
  const del = await call('DELETE', `/api/route-tracks/${t.id}`);
  assert.ok(!(await call('GET', '/api/recycle-bin?types=route-track', undefined, 'B')).json.items.some((i) => i.title === 'Private'), 'not in the other bin');
  assert.notStrictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`, undefined, 'B')).status, 200);
  assert.strictEqual(await exists(t.id), false);
  await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  await call('DELETE', `/api/route-tracks/${t.id}`);
});

test('delete forever and the 30-day purge remove the copy for good', async () => {
  const t = await make('Gone for good', false);
  const del = await call('DELETE', `/api/route-tracks/${t.id}`);
  assert.strictEqual((await call('DELETE', `/api/recycle-bin/${del.json.binId}`)).status, 200);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`)).status, 404);
  const t2 = await make('Old', false);
  await call('DELETE', `/api/route-tracks/${t2.id}`);
  await pool.query(`UPDATE recycle_bin SET "expiresAt" = NOW() - INTERVAL '1 day' WHERE "userId" = $1 AND "entityType" = 'route-track'`, [A]);
  assert.strictEqual((await call('GET', '/api/recycle-bin?types=route-track')).json.items.length, 0, 'past 30 days it is removed');
});

test('a failed bin copy leaves the track where it was', async () => {
  const t = await make('Stays put', false);
  const original = require('../services/recycleBin').moveToBin;
  const bin = require('../services/recycleBin');
  bin.moveToBin = async () => { throw new Error('bin is full'); };
  try {
    const del = await call('DELETE', `/api/route-tracks/${t.id}`);
    assert.strictEqual(del.status, 500);
    assert.ok(!JSON.stringify(del.json).includes('bin is full'), 'no internals in the answer');
  } finally { bin.moveToBin = original; }
  assert.strictEqual(await exists(t.id), true, 'nothing was deleted');
  assert.strictEqual((await inBin(A)).length, 0);
  await call('DELETE', `/api/route-tracks/${t.id}`);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const run = Date.now();
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`rt-${tag}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const x of tests) {
      try { await x.fn(); console.log(`  ok   ${x.name}`); } catch (e) { failed += 1; console.log(`  FAIL ${x.name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
    }
  } finally {
    server.close();
    await pool.query('DELETE FROM route_tracks WHERE "userId" = ANY($1::int[])', [[A, B]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A, B]]); // the bin rows cascade from users
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
