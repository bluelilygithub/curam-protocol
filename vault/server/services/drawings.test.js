'use strict';

// node server/services/drawings.test.js
// Part 1 is pure. Parts 2 and 3 need a scratch Postgres and skip without one:
//   DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/services/drawings.test.js
// They work inside a throw-away schema (dropped at the end) with the REAL table definitions read out of server/db.js, so the test cannot
// drift from them.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const D = require('./drawings');

const scene = (n = 3, extra = {}) => ({ type: 'excalidraw', version: 2, source: 'test', elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, type: 'rectangle', x: i, y: i, isDeleted: false })), appState: {}, files: {}, ...extra });
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

// ---------------------------------------------------------------- part 1: pure
{
  assert.strictEqual(D.cleanTitle('  My\n  plan  '), 'My plan');
  assert.strictEqual(D.cleanTitle(''), D.DEFAULT_TITLE);
  assert.strictEqual(D.cleanTitle(null), D.DEFAULT_TITLE);
  assert.strictEqual(D.cleanTitle('x'.repeat(500)).length, D.MAX_TITLE);
  assert.strictEqual(D.cleanTitle('\u0000\u0007'), D.DEFAULT_TITLE, 'control characters are not a title');

  const ok = D.checkScene(scene(3, {}));
  assert.strictEqual(ok.elementCount, 3);
  assert.strictEqual(D.checkScene(JSON.stringify(scene(2))).elementCount, 2, 'the text form is accepted too');
  const withDeleted = scene(3); withDeleted.elements[1].isDeleted = true;
  assert.strictEqual(D.checkScene(withDeleted).elementCount, 2, 'deleted pieces are not counted');
  assert.strictEqual(D.checkScene(D.EMPTY_SCENE).elementCount, 0, 'a new empty drawing is valid');
  for (const bad of [null, undefined, 5, '', 'not json', '{}', JSON.stringify({ type: 'other', elements: [] }), JSON.stringify({ type: 'excalidraw' }), JSON.stringify({ type: 'excalidraw', elements: 'x' })]) {
    assert.throws(() => D.checkScene(bad), (e) => e instanceof D.DrawingError && e.status === 400, `refused: ${String(bad).slice(0, 30)}`);
  }
  const big = scene(1, { files: { a: { dataURL: 'x'.repeat(D.MAX_SCENE_BYTES) } } });
  assert.throws(() => D.checkScene(big), (e) => e.status === 413 && e.code === 'TOO_BIG' && /too big to save/.test(e.message), 'a drawing over the limit is refused in plain words');
  assert.throws(() => D.checkScene(scene(D.MAX_ELEMENTS + 1)), (e) => e.status === 413 && e.code === 'TOO_MANY');

  assert.strictEqual(D.checkThumbnail(null), null);
  assert.strictEqual(D.checkThumbnail(''), null);
  assert.strictEqual(D.checkThumbnail(jpeg), jpeg);
  for (const bad of ['http://x/y.png', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,<script>', `data:image/png;base64,${'A'.repeat(D.MAX_THUMB_BYTES)}`]) {
    assert.throws(() => D.checkThumbnail(bad), (e) => e instanceof D.DrawingError, `refused: ${bad.slice(0, 30)}`);
  }
  console.log('part 1 (pure): ok');
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('parts 2 and 3 (database): skipped, DATABASE_URL not set');
  process.exit(0);
}

(async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = `dr_test_${crypto.randomBytes(4).toString('hex')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await client.query('CREATE TABLE users (id INTEGER PRIMARY KEY)');
    const dbjs = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
    for (const name of ['drawings', 'recycle_bin']) {
      const start = dbjs.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
      assert.ok(start > 0, `${name} is defined in db.js`);
      await client.query(dbjs.slice(start, dbjs.indexOf('`', start)));
    }
    const alter = dbjs.indexOf('ALTER TABLE drawings ADD COLUMN IF NOT EXISTS look');
    assert.ok(alter > 0, 'the look column is added in db.js');
    await client.query(dbjs.slice(alter, dbjs.indexOf('`', alter)));
    await client.query('INSERT INTO users (id) VALUES (1), (2)');
    const pool = { query: (...a) => client.query(...a), connect: async () => ({ query: (...a) => client.query(...a), release() {} }) };
    const rowsOf = async (uid) => (await client.query('SELECT id, title, "elementCount" FROM drawings WHERE "userId" = $1 ORDER BY id', [uid])).rows;

    // ---- part 2: the service ----
    const a = await D.create(pool, 1, { title: '  Floor plan ', scene: scene(4), thumbnail: jpeg });
    assert.strictEqual(a.title, 'Floor plan');
    assert.strictEqual(a.elementCount, 4);
    assert.strictEqual(a.thumbnail, jpeg);
    assert.strictEqual(a.scene, undefined, 'the list columns carry no scene');
    const blank = await D.create(pool, 1, {});
    assert.strictEqual(blank.title, D.DEFAULT_TITLE);
    assert.strictEqual(blank.elementCount, 0);
    await assert.rejects(() => D.create(pool, 1, { scene: 'nope' }), /not a drawing file/);
    await assert.rejects(() => D.create(pool, 1, { scene: scene(1), thumbnail: 'http://evil/x.png' }), /preview picture/);
    assert.strictEqual((await rowsOf(1)).length, 2, 'a refused create left nothing behind');

    const list = await D.list(pool, 1);
    assert.deepStrictEqual(list.map((r) => r.title), [D.DEFAULT_TITLE, 'Floor plan'], 'newest change first');
    assert.ok(list.every((r) => r.scene === undefined));
    assert.deepStrictEqual(await D.list(pool, 2), [], 'another person sees none');

    const full = await D.get(pool, 1, a.id);
    assert.strictEqual(JSON.parse(full.scene).elements.length, 4, 'the scene comes back as saved');
    await assert.rejects(() => D.get(pool, 2, a.id), (e) => e.status === 404, "another person's drawing is not found");
    await assert.rejects(() => D.get(pool, 1, 999999), (e) => e.status === 404);

    // saving: partial changes, and the "changed elsewhere" guard
    const u1 = await D.update(pool, 1, a.id, { title: 'Floor plan v2', baseUpdatedAt: a.updatedAt });
    assert.strictEqual(u1.title, 'Floor plan v2');
    assert.strictEqual(u1.elementCount, 4, 'a title-only save leaves the scene alone');
    assert.ok(new Date(u1.updatedAt) >= new Date(a.updatedAt));
    const u2 = await D.update(pool, 1, a.id, { scene: scene(7), thumbnail: null, baseUpdatedAt: u1.updatedAt });
    assert.strictEqual(u2.elementCount, 7);
    assert.strictEqual(u2.thumbnail, null, 'a thumbnail can be cleared');
    await assert.rejects(() => D.update(pool, 1, a.id, { title: 'stale', baseUpdatedAt: a.updatedAt }), (e) => e.status === 409 && e.code === 'CHANGED' && /another tab/.test(e.message), 'a save from a stale copy is refused');
    assert.strictEqual((await D.get(pool, 1, a.id)).title, 'Floor plan v2', 'and changed nothing');
    const u3 = await D.update(pool, 1, a.id, { title: 'No guard' });
    assert.strictEqual(u3.title, 'No guard', 'without baseUpdatedAt the save goes through');
    await assert.rejects(() => D.update(pool, 1, a.id, {}), /Nothing to save/);
    await assert.rejects(() => D.update(pool, 1, a.id, { title: 'x', baseUpdatedAt: 'not a date' }), /save time/);
    await assert.rejects(() => D.update(pool, 2, a.id, { title: 'mine now' }), (e) => e.status === 404, "another person cannot change it (and is told it is not found)");
    await assert.rejects(() => D.update(pool, 1, a.id, { scene: scene(1, { files: { a: { dataURL: 'x'.repeat(D.MAX_SCENE_BYTES) } } }) }), (e) => e.status === 413);
    assert.strictEqual((await D.get(pool, 1, a.id)).elementCount, 7, 'a refused save kept the old scene');

    // the look: sketch unless said otherwise; only the two known looks; copied with the drawing
    assert.strictEqual(a.look, 'sketch', 'a new drawing is a sketch');
    const cleanOne = await D.create(pool, 1, { title: 'Tidy', look: 'clean' });
    assert.strictEqual(cleanOne.look, 'clean');
    await assert.rejects(() => D.create(pool, 1, { look: 'fancy' }), /sketch or clean/);
    const lk = await D.update(pool, 1, a.id, { look: 'clean' });
    assert.strictEqual(lk.look, 'clean');
    assert.strictEqual(lk.elementCount, 7, 'changing only the look leaves the scene alone');
    await assert.rejects(() => D.update(pool, 1, a.id, { look: 'neon' }), /sketch or clean/);
    assert.strictEqual((await D.get(pool, 1, a.id)).look, 'clean', 'a refused look changed nothing');
    assert.strictEqual((await D.list(pool, 1)).find((r) => r.id === a.id).look, 'clean', 'the list carries the look');
    await D.update(pool, 1, a.id, { look: 'sketch' });
    await client.query('DELETE FROM drawings WHERE id = $1', [cleanOne.id]);

    // copy
    const copy = await D.duplicate(pool, 1, a.id);
    assert.strictEqual(copy.title, 'No guard (copy)');
    assert.strictEqual(copy.elementCount, 7);
    assert.strictEqual(copy.look, 'sketch', 'the copy keeps the look');
    assert.notStrictEqual(copy.id, a.id);
    await assert.rejects(() => D.duplicate(pool, 2, a.id), (e) => e.status === 404, "another person cannot copy it");
    assert.strictEqual((await rowsOf(2)).length, 0);

    // the cap
    await client.query('INSERT INTO drawings ("userId", title, scene) SELECT 2, \'filler\', $1 FROM generate_series(1, $2)', [D.EMPTY_SCENE, D.MAX_DRAWINGS_PER_USER]);
    await assert.rejects(() => D.create(pool, 2, {}), (e) => e.status === 409 && e.code === 'FULL');
    const fillerId = (await rowsOf(2))[0].id;
    await assert.rejects(() => D.duplicate(pool, 2, fillerId), (e) => e.code === 'FULL');
    await client.query('DELETE FROM drawings WHERE "userId" = 2');
    console.log('part 2 (service): ok');

    // ---- part 3: the routes, over HTTP, and the recycle bin ----
    const dbPath = require.resolve('../db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
    const express = require('express');
    const router = require('../routes/drawings');
    const bin = require('./recycleBin');
    bin.loadAdapters();
    const app = express();
    app.use(express.json({ limit: '30mb' }));
    app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); });
    app.use('/api/drawings', router);
    const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/drawings`;
    const call = async (method, p, body, user = 1) => {
      const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-user': String(user) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };
    try {
      await client.query('DELETE FROM drawings');
      const made = await call('POST', '', { title: 'Route drawing', scene: scene(5), thumbnail: jpeg });
      assert.strictEqual(made.status, 201);
      const id = made.body.drawing.id;
      assert.strictEqual((await call('POST', '', { scene: { type: 'nope' } })).status, 400);
      assert.strictEqual((await call('POST', '', { scene: scene(1, { files: { a: { dataURL: 'x'.repeat(D.MAX_SCENE_BYTES) } } }) })).status, 413);

      const l = await call('GET', '');
      assert.strictEqual(l.status, 200);
      assert.deepStrictEqual(l.body.drawings.map((d) => d.title), ['Route drawing']);
      assert.strictEqual(l.body.max, D.MAX_DRAWINGS_PER_USER);
      assert.deepStrictEqual((await call('GET', '', null, 2)).body.drawings, [], "another person's list is empty");

      const g = await call('GET', `/${id}`);
      assert.strictEqual(g.status, 200);
      assert.strictEqual(JSON.parse(g.body.drawing.scene).elements.length, 5);
      assert.strictEqual((await call('GET', `/${id}`, null, 2)).status, 404);
      assert.strictEqual((await call('GET', '/abc')).status, 404, 'a bad id is simply not found');
      assert.strictEqual((await call('GET', '/0')).status, 404);

      const p = await call('PUT', `/${id}`, { title: 'Renamed', baseUpdatedAt: g.body.drawing.updatedAt });
      assert.strictEqual(p.status, 200);
      assert.strictEqual(p.body.drawing.title, 'Renamed');
      assert.strictEqual((await call('PUT', `/${id}`, { title: 'stale', baseUpdatedAt: g.body.drawing.createdAt })).status, 409);
      assert.strictEqual((await call('PUT', `/${id}`, { title: 'hijack' }, 2)).status, 404);
      assert.strictEqual((await call('PUT', `/${id}`, {})).status, 400);
      assert.strictEqual((await call('PUT', `/${id}`, { look: 'clean' })).body.drawing.look, 'clean');
      assert.strictEqual((await call('PUT', `/${id}`, { look: 'bad' })).status, 400);
      assert.strictEqual((await call('PUT', `/${id}`, { look: 'sketch' })).body.drawing.look, 'sketch');
      assert.strictEqual((await call('POST', `/${id}/duplicate`, null, 2)).status, 404);
      const dup = await call('POST', `/${id}/duplicate`);
      assert.strictEqual(dup.status, 201);
      assert.strictEqual(dup.body.drawing.title, 'Renamed (copy)');

      // delete goes to the recycle bin, in the same transaction, and can be put back
      assert.strictEqual((await call('DELETE', `/${id}`, null, 2)).status, 404, "another person cannot delete it");
      assert.strictEqual((await rowsOf(1)).length, 2);
      const del = await call('DELETE', `/${id}`);
      assert.strictEqual(del.status, 200);
      assert.ok(del.body.binId);
      assert.strictEqual((await call('GET', `/${id}`)).status, 404, 'it is gone from the list');
      const binned = await bin.list(1, { types: ['drawing'] });
      assert.strictEqual(binned.length, 1, 'and is in the recycle bin');
      assert.strictEqual(binned[0].title, 'Renamed');
      assert.strictEqual((await bin.list(2, { types: ['drawing'] })).length, 0, "another person cannot see it in the bin");
      const back = await bin.restoreItem(1, del.body.binId);
      assert.ok(back);
      const again = await call('GET', `/${id}`);
      assert.strictEqual(again.status, 200, 'it came back with the same id');
      assert.strictEqual(JSON.parse(again.body.drawing.scene).elements.length, 5, 'and with its scene');
      assert.strictEqual(again.body.drawing.title, 'Renamed');

      // a drawing too big for the bin is not deleted at all
      await client.query('UPDATE drawings SET scene = $1 WHERE id = $2', [JSON.stringify(scene(1, { files: { a: { dataURL: 'x'.repeat(8 * 1024 * 1024) } } })), id]);
      const tooBig = await call('DELETE', `/${id}`);
      assert.strictEqual(tooBig.status, 413);
      assert.strictEqual((await call('GET', `/${id}`)).status, 200, 'still there');
      console.log('part 3 (routes and recycle bin): ok');
    } finally {
      server.close();
    }
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
  console.log('drawings tests: all ok');
})().catch((e) => { console.error(e); process.exit(1); });
