#!/usr/bin/env node
/** Map tile proxy: key stays server side, input is validated, rate limited, nothing stored. Run: node server/routes/mapTiles.test.js */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const assert = require('assert');
const http = require('http');
const express = require('express');
const { createRouter } = require('./mapTilesRouter');
const { scrubEvent } = require('../lib/sentry');

const KEY = 'secret-maptiler-key';
let upstream = [];
let mode = 'ok';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const fetchFn = async (url) => {
  upstream.push(String(url));
  if (String(url).includes('tiles.json')) return { ok: true, status: 200, json: async () => ({ attribution: '<a href="https://www.maptiler.com/copyright/">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>', maxzoom: 20 }) };
  if (mode === 'throw') throw new Error('down');
  if (mode === '404') return { ok: false, status: 404 };
  if (mode === '403') return { ok: false, status: 403 };
  return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => JPEG };
};

let t = 0;
const build = (env, perMinute) => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 7 }; next(); });
  app.use('/api/map-tiles', createRouter({ env, fetchFn, now: () => t, perMinute }));
  return app;
};
const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ port, path }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => { const buf = Buffer.concat(c); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* binary */ } resolve({ status: res.statusCode, headers: res.headers, buf, json }); }); }).on('error', reject);
});

let passed = 0, failed = 0;
const tests = [];
const test = (n, f) => tests.push([n, f]);

test('no key: status says disabled and tiles are 503 with no upstream call', async () => {
  const s = build({}, 100).listen(0);
  try {
    const p = s.address().port;
    upstream = [];
    assert.strictEqual((await get(p, '/api/map-tiles/status')).json.enabled, false);
    assert.strictEqual((await get(p, '/api/map-tiles/17/1/1')).status, 503);
    assert.strictEqual(upstream.length, 0);
  } finally { s.close(); }
});

test('with a key: status gives the provider attribution as plain text and the max zoom', async () => {
  const s = build({ MAPTILER_API_KEY: KEY }, 100).listen(0);
  try {
    const j = (await get(s.address().port, '/api/map-tiles/status')).json;
    assert.strictEqual(j.enabled, true);
    assert.match(j.attribution, /© MapTiler/);
    assert.match(j.attribution, /OpenStreetMap contributors/);
    assert.ok(!/</.test(j.attribution), 'no HTML');
    assert.strictEqual(j.maxZoom, 20);
    assert.ok(!JSON.stringify(j).includes(KEY));
  } finally { s.close(); }
});

test('a tile is passed through as an image, the key is only on the upstream request, and the browser may keep it a day', async () => {
  const s = build({ MAPTILER_API_KEY: KEY }, 100).listen(0);
  try {
    upstream = [];
    const r = await get(s.address().port, '/api/map-tiles/17/120000/80000');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['content-type'], 'image/jpeg');
    assert.deepStrictEqual(r.buf, JPEG);
    assert.strictEqual(r.headers['cache-control'], 'private, max-age=86400');
    assert.strictEqual(upstream.length, 1);
    assert.ok(upstream[0].includes('/satellite-v2/17/120000/80000.jpg?key=' + KEY));
    assert.ok(!JSON.stringify(r.headers).includes(KEY));
    assert.ok(!r.buf.toString('latin1').includes(KEY));
  } finally { s.close(); }
});

test('only valid tile addresses reach the provider', async () => {
  const s = build({ MAPTILER_API_KEY: KEY }, 100).listen(0);
  try {
    upstream = [];
    for (const bad of ['/21/0/0', '/17/131072/0', '/17/0/131072', '/17/-1/0', '/17/a/0', '/17/1/1.png', '/1/2/0', '/17/1/1/extra', '/../../etc/passwd/1/1', '/17/1e3/1', '/17/1/%2e%2e']) {
      const r = await get(s.address().port, `/api/map-tiles${bad}`);
      assert.ok(r.status === 400 || r.status === 404, `${bad} -> ${r.status}`);
    }
    assert.strictEqual(upstream.filter((u) => !u.includes('tiles.json')).length, 0, 'nothing invalid is forwarded');
    assert.strictEqual((await get(s.address().port, '/api/map-tiles/0/0/0')).status, 200);
    assert.strictEqual((await get(s.address().port, '/api/map-tiles/17/1/1.jpg')).status, 200);
  } finally { s.close(); }
});

test('provider problems become plain errors that never contain the key', async () => {
  const s = build({ MAPTILER_API_KEY: KEY }, 100).listen(0);
  try {
    const p = s.address().port;
    mode = '404'; assert.strictEqual((await get(p, '/api/map-tiles/17/1/1')).status, 404);
    mode = '403'; const r403 = await get(p, '/api/map-tiles/17/1/2');
    assert.strictEqual(r403.status, 502);
    assert.ok(!r403.buf.toString().includes(KEY));
    mode = 'throw'; const rt = await get(p, '/api/map-tiles/17/1/3');
    assert.strictEqual(rt.status, 502);
    assert.ok(!rt.buf.toString().includes(KEY));
  } finally { mode = 'ok'; s.close(); }
});

test('rate limit per user per minute, then it frees up', async () => {
  const s = build({ MAPTILER_API_KEY: KEY }, 3).listen(0);
  try {
    const p = s.address().port;
    t = 1000;
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await get(p, `/api/map-tiles/17/1/${i}`)).status, 200);
    const r = await get(p, '/api/map-tiles/17/1/9');
    assert.strictEqual(r.status, 429);
    assert.ok(r.headers['retry-after']);
    t = 62000;
    assert.strictEqual((await get(p, '/api/map-tiles/17/1/9')).status, 200);
  } finally { s.close(); }
});

test('Sentry scrubbing drops the key from the outbound MapTiler URL (events, transactions, breadcrumbs)', () => {
  const url = `https://api.maptiler.com/tiles/satellite-v2/17/1/1.jpg?key=${KEY}`;
  const ev = scrubEvent({ request: { url, query_string: `key=${KEY}` }, breadcrumbs: [{ data: { url } }], spans: [{ data: { 'http.url': url } }] }, {});
  assert.ok(!JSON.stringify(ev).includes(KEY), JSON.stringify(ev));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
})();
