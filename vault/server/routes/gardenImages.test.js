#!/usr/bin/env node
/**
 * Garden Planner tracing pictures: upload / download / ownership / limits, the rule that a garden never embeds its picture, orphan
 * clean-up, and the boot migration of pictures embedded by the first server build. In-memory stand-in for the pool (queries matched
 * by shape), so it needs no database.
 *
 * Run: node server/routes/gardenImages.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createRouter, validateData } = require('./gardenProjectsRouter');
const { migrateEmbeddedPictures, parseDataUrl, imageRef, reconcileImages, MAX_IMAGES_PER_USER, PURGE_AFTER_DAYS } = require('../services/gardenImages');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);

function fakePool() {
  const images = [];
  const gardens = [];
  let seq = 0;
  const pool = {
    images, gardens, now: Date.UTC(2026, 9, 7),
    async query(sql, params) {
      const s = sql.replace(/\s+/g, ' ');
      if (/SELECT COUNT\(\*\) AS n FROM garden_images/.test(s)) return { rows: [{ n: String(images.filter((i) => i.userId === params[0] && !i.deletedAt).length) }] };
      if (/INSERT INTO garden_images/.test(s)) {
        const r = { id: ++seq, userId: params[0], mime: params[1], bytes: params[2], data: params[3], createdAt: pool.now, deletedAt: null };
        images.push(r);
        return { rows: [{ id: r.id }] };
      }
      if (/SELECT mime, data FROM garden_images/.test(s)) {
        const r = images.find((i) => String(i.id) === String(params[0]) && i.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      // soft-delete housekeeping, with the semantics of the SQL in services/gardenImages.js
      const referenced = (userId) => new Set(gardens.filter((g) => g.userId === userId && g.data.underlay && g.data.underlay.imageId).map((g) => g.data.underlay.imageId));
      if (/UPDATE garden_images SET "deletedAt" = NOW\(\)/.test(s)) {
        const refs = referenced(params[0]);
        for (const i of images) if (i.userId === params[0] && !i.deletedAt && i.createdAt < pool.now - HOUR && !refs.has(imageRef(i.id))) i.deletedAt = pool.now;
        return { rowCount: 0 };
      }
      if (/UPDATE garden_images SET "deletedAt" = NULL/.test(s)) {
        const refs = referenced(params[0]);
        for (const i of images) if (i.userId === params[0] && i.deletedAt && refs.has(imageRef(i.id))) i.deletedAt = null;
        return { rowCount: 0 };
      }
      if (/DELETE FROM garden_images/.test(s)) {
        const refs = referenced(params[0]);
        for (let k = images.length - 1; k >= 0; k--) {
          const i = images[k];
          if (i.userId === params[0] && i.deletedAt && i.deletedAt < pool.now - PURGE_AFTER_DAYS * DAY && !refs.has(imageRef(i.id))) images.splice(k, 1);
        }
        return { rowCount: 0 };
      }
      if (/FROM garden_projects WHERE data->'underlay'->>'dataUrl' IS NOT NULL/.test(s)) {
        return { rows: gardens.filter((g) => g.data.underlay && g.data.underlay.dataUrl) };
      }
      if (/UPDATE garden_projects SET data = \$1::jsonb WHERE id = \$2/.test(s)) {
        const g = gardens.find((x) => x.id === params[1]);
        g.data = JSON.parse(params[0]);
        return { rowCount: 1 };
      }
      throw new Error(`unexpected query: ${s}`);
    },
  };
  return pool;
}

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function withServer(fn) {
  const pool = fakePool();
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-test-user') || 1) }; next(); });
  app.use('/api/garden-projects', createRouter(pool));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/garden-projects`;
  const post = async (bytes, type, user = 1) => {
    const res = await fetch(`${base}/images`, { method: 'POST', headers: { 'Content-Type': type, 'x-test-user': String(user) }, body: bytes });
    return { status: res.status, body: await res.json() };
  };
  const get = async (ref, user = 1) => {
    const res = await fetch(`${base}/images/${ref}`, { headers: { 'x-test-user': String(user) } });
    return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), bytes: Buffer.from(await res.arrayBuffer()) };
  };
  try { await fn({ post, get, pool }); } finally { await new Promise((r) => server.close(r)); }
}

test('upload then download returns the same bytes, typed, private-cached, with a srv- reference', () => withServer(async ({ post, get }) => {
  const up = await post(JPEG, 'image/jpeg');
  assert.strictEqual(up.status, 200);
  assert.match(up.body.image.id, /^srv-\d+$/);
  assert.strictEqual(up.body.image.bytes, JPEG.length);
  const down = await get(up.body.image.id);
  assert.strictEqual(down.status, 200);
  assert.strictEqual(down.type, 'image/jpeg');
  assert.match(down.cache, /private/);
  assert.ok(down.bytes.equals(JPEG));
  const png = await post(PNG, 'image/png');
  assert.strictEqual(png.status, 200);
}));

test('only the owner can read a picture (404 for anyone else)', () => withServer(async ({ post, get }) => {
  const up = await post(JPEG, 'image/jpeg', 1);
  assert.strictEqual((await get(up.body.image.id, 2)).status, 404);
  assert.strictEqual((await get(up.body.image.id, 1)).status, 200);
}));

test('the bytes must really be the claimed image type; other types and empty bodies are refused', () => withServer(async ({ post }) => {
  assert.strictEqual((await post(PNG, 'image/jpeg')).status, 400);
  assert.strictEqual((await post(Buffer.from('<svg onload=alert(1)>'), 'image/png')).status, 400);
  assert.strictEqual((await post(Buffer.from('hello'), 'text/plain')).status, 400);
  assert.strictEqual((await post(Buffer.alloc(0), 'image/jpeg')).status, 400);
}));

test('bad references are 404, never an error', () => withServer(async ({ get }) => {
  for (const ref of ['abc', '12', 'srv-', 'srv-1;DROP', 'srv-99999999999', 'srv-999']) assert.strictEqual((await get(encodeURIComponent(ref))).status, 404, ref);
}));

test('a user cannot hold more than the picture limit', () => withServer(async ({ post, pool }) => {
  for (let i = 0; i < MAX_IMAGES_PER_USER; i++) pool.images.push({ id: 1000 + i, userId: 1, mime: 'image/jpeg', bytes: 1, data: JPEG });
  const r = await post(JPEG, 'image/jpeg');
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /limit of 50/);
  assert.strictEqual((await post(JPEG, 'image/jpeg', 2)).status, 200);
}));

test('soft-deleted pictures do not count toward the 50-picture limit', () => withServer(async ({ post, pool }) => {
  // 45 live + 20 marked deleted = 65 rows, but only 45 count
  for (let i = 0; i < 45; i++) pool.images.push({ id: 2000 + i, userId: 1, mime: 'image/jpeg', bytes: 1, data: JPEG, createdAt: 0, deletedAt: null });
  for (let i = 0; i < 20; i++) pool.images.push({ id: 3000 + i, userId: 1, mime: 'image/jpeg', bytes: 1, data: JPEG, createdAt: 0, deletedAt: 1 });
  for (let i = 0; i < 5; i++) assert.strictEqual((await post(JPEG, 'image/jpeg')).status, 200, `upload ${i + 1} reaches 50 live`);
  const over = await post(JPEG, 'image/jpeg');
  assert.strictEqual(over.status, 400, 'the 51st live picture is refused');
  assert.match(over.body.error, /limit of 50/);
  // marking one live picture deleted frees a slot straight away
  pool.images.find((i) => i.userId === 1 && !i.deletedAt).deletedAt = 1;
  assert.strictEqual((await post(JPEG, 'image/jpeg')).status, 200);
  assert.strictEqual(pool.images.filter((i) => i.userId === 1 && !i.deletedAt).length, 50);
}));

test('a garden design may not embed its picture, and the design limit is small', () => {
  const g = { schemaVersion: 1, id: 'g', location: { label: 'x' }, zones: [], beds: [], paths: [], lawns: [], structures: [], plants: [] };
  assert.strictEqual(validateData(g), null);
  assert.strictEqual(validateData({ ...g, underlay: { imageId: 'srv-3', widthPx: 1, heightPx: 1 } }), null);
  assert.match(validateData({ ...g, underlay: { dataUrl: 'data:image/png;base64,AAAA' } }), /embeds its tracing picture/);
  assert.match(validateData({ ...g, pad: 'x'.repeat(2 * 1024 * 1024 + 10) }), /too large/);
});

const gardenWith = (ref) => ({ userId: 1, data: { id: 'g', underlay: ref ? { imageId: ref } : undefined } });

test('remove picture -> save -> undo: the picture is only marked, still downloads, and is restored when a garden references it again', () => withServer(async ({ post, get, pool }) => {
  const ref = (await post(JPEG, 'image/jpeg')).body.image.id;
  const img = pool.images[0];
  pool.now += 2 * HOUR; // past the upload grace period
  const garden = gardenWith(ref);
  pool.gardens.push(garden);
  // the user removes the tracing picture and the garden is saved
  delete garden.data.underlay;
  await reconcileImages(pool, 1);
  assert.ok(img.deletedAt, 'marked deleted, not removed');
  assert.strictEqual(pool.images.length, 1);
  assert.strictEqual((await get(ref)).status, 200, 'a marked picture still downloads, so Undo shows it');
  // Undo puts the reference back and the garden is saved again
  garden.data.underlay = { imageId: ref };
  await reconcileImages(pool, 1);
  assert.strictEqual(img.deletedAt, null, 'restored');
  assert.strictEqual((await get(ref)).status, 200);
}));

test('duplicate a garden, delete the original: the copy still has its picture (shared, never removed while referenced)', () => withServer(async ({ post, get, pool }) => {
  const ref = (await post(JPEG, 'image/jpeg')).body.image.id;
  pool.now += 2 * HOUR;
  const original = gardenWith(ref);
  const copy = { userId: 1, data: { ...structuredClone(original.data), id: 'copy' } }; // a duplicate carries the same reference
  pool.gardens.push(original, copy);
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images[0].deletedAt, null);
  pool.gardens.splice(pool.gardens.indexOf(original), 1); // delete the original
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images[0].deletedAt, null, 'still referenced by the copy');
  assert.strictEqual((await get(ref)).status, 200);
  pool.now += 60 * DAY;
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images.length, 1, 'never purged while a garden uses it');
  // only when the copy goes too does it become removable
  pool.gardens.length = 0;
  await reconcileImages(pool, 1);
  assert.ok(pool.images[0].deletedAt);
}));

test('purge happens only 30 days after marking, and never for a restored picture', () => withServer(async ({ post, get, pool }) => {
  const ref = (await post(JPEG, 'image/jpeg')).body.image.id;
  pool.now += 2 * HOUR;
  await reconcileImages(pool, 1); // no garden references it: marked
  const marked = pool.images[0].deletedAt;
  assert.ok(marked);
  pool.now = marked + 29 * DAY;
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images.length, 1, 'day 29: kept');
  pool.gardens.push(gardenWith(ref)); // referenced again before day 30
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images[0].deletedAt, null);
  pool.gardens.length = 0;
  await reconcileImages(pool, 1); // marked again: the 30 days start over
  const again = pool.images[0].deletedAt;
  pool.now = again + 31 * DAY;
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images.length, 0, 'day 31 after the last marking: purged');
  assert.strictEqual((await get(ref)).status, 404);
}));

test('a picture uploaded in the last hour is never marked (its garden may not have saved yet); other users are untouched', () => withServer(async ({ post, pool }) => {
  await post(JPEG, 'image/jpeg', 1);
  await post(JPEG, 'image/jpeg', 2);
  await reconcileImages(pool, 1);
  assert.strictEqual(pool.images[0].deletedAt, null, 'fresh');
  pool.now += 2 * HOUR;
  await reconcileImages(pool, 1);
  assert.ok(pool.images.find((i) => i.userId === 1).deletedAt);
  assert.strictEqual(pool.images.find((i) => i.userId === 2).deletedAt, null, 'another user\'s picture is not touched');
}));

test('housekeeping never throws', async () => {
  const bad = { query: async () => { throw new Error('db down'); } };
  await reconcileImages(bad, 1, { warn: () => undefined });
});

test('migration moves an embedded picture into garden_images, keeps the rest, is idempotent, leaves unreadable ones', async () => {
  const pool = fakePool();
  const url = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  pool.gardens.push(
    { id: 10, userId: 1, data: { id: 'a', name: 'A', underlay: { dataUrl: url, widthPx: 100, heightPx: 50, opacity: 0.6 } } },
    { id: 11, userId: 2, data: { id: 'b', name: 'B', underlay: { dataUrl: 'data:text/html;base64,PGI+', widthPx: 1, heightPx: 1 } } },
    { id: 12, userId: 2, data: { id: 'c', name: 'C' } },
  );
  const warnings = [];
  const n = await migrateEmbeddedPictures(pool, { warn: (...a) => warnings.push(a), info: () => undefined });
  assert.strictEqual(n, 1);
  const a = pool.gardens[0].data;
  assert.strictEqual(a.underlay.dataUrl, undefined);
  assert.strictEqual(a.underlay.imageId, imageRef(pool.images[0].id));
  assert.strictEqual(a.underlay.widthPx, 100);
  assert.strictEqual(a.name, 'A');
  assert.ok(pool.images[0].data.equals(JPEG));
  assert.strictEqual(pool.images[0].userId, 1);
  assert.ok(pool.gardens[1].data.underlay.dataUrl, 'unreadable picture left in place');
  assert.strictEqual(warnings.length, 1);
  // second run: the readable one is done; the unreadable one is reported again, nothing is duplicated
  assert.strictEqual(await migrateEmbeddedPictures(pool, { warn: () => undefined, info: () => undefined }), 0);
  assert.strictEqual(pool.images.length, 1);
});

test('parseDataUrl accepts real images only', () => {
  assert.ok(parseDataUrl(`data:image/png;base64,${PNG.toString('base64')}`));
  assert.strictEqual(parseDataUrl(`data:image/png;base64,${JPEG.toString('base64')}`), null);
  assert.strictEqual(parseDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.strictEqual(parseDataUrl(5), null);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
