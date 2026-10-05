#!/usr/bin/env node
/** Plant-images router: input checks, admin-only curator routes, no network from requests. Run: node server/routes/plantImages.test.js */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const assert = require('assert');
const http = require('http');
const express = require('express');
const { createRouter } = require('./plantImagesRouter');

const calls = [];
const service = {
  images: async (id) => { calls.push(['images', id]); return id === 'nope' ? { status: 'unknown_plant', images: [] } : { status: 'ready', images: [] }; },
  credits: async (ids) => { calls.push(['credits', ids]); return []; },
  allImages: async (id) => { calls.push(['all', id]); return []; },
  setHidden: async (id, h) => { calls.push(['hide', id, h]); return id !== '999'; },
  setRole: async (id, r) => { calls.push(['role', id, r]); if (r === 'bad') throw new Error('unknown role'); return true; },
  setDefault: async (p, r, i) => { calls.push(['default', p, r, i]); if (r === 'habitat') throw new Error('role must be flower, foliage or plant'); return true; },
  startRefresh: (id) => calls.push(['refresh', id]),
  summary: async () => { calls.push(['summary']); return [{ plantId: 'a', visible: 2, hidden: 0, defaults: 1, status: 'ok', fetchedAt: 1 }]; },
  refreshMissing: async () => { calls.push(['missing']); return 7; },
};
const admin = (req, res, next) => (req.headers['x-admin'] === '1' ? next() : res.status(403).json({ error: 'Admin only' }));
const app = express();
app.use(express.json());
app.use('/api/plant-images', createRouter(service, admin));

let passed = 0, failed = 0;
const tests = [];
const test = (n, f) => tests.push([n, f]);
const call = (port, method, path, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ port, method, path, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null, headers: res.headers }));
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

test('GET /:plantId returns the cached answer, never cached by the browser', async (p) => {
  const r = await call(p, 'GET', '/api/plant-images/grevillea-robusta');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.status, 'ready');
  assert.strictEqual(r.headers['cache-control'], 'no-store');
});
test('unknown or malformed plant ids are 404 and malformed ones never reach the service', async (p) => {
  calls.length = 0;
  assert.strictEqual((await call(p, 'GET', '/api/plant-images/nope')).status, 404);
  for (const bad of ['Grevillea%20robusta', '..%2Fetc', 'a%27b', 'x'.repeat(81)]) assert.strictEqual((await call(p, 'GET', `/api/plant-images/${bad}`)).status, 404, bad);
  assert.deepStrictEqual(calls, [['images', 'nope']]);
});
test('credits needs 1 to 300 valid ids', async (p) => {
  assert.strictEqual((await call(p, 'GET', '/api/plant-images/credits')).status, 400);
  assert.strictEqual((await call(p, 'GET', '/api/plant-images/credits?ids=a,B!')).status, 400);
  assert.strictEqual((await call(p, 'GET', `/api/plant-images/credits?ids=${Array.from({ length: 301 }, (_, i) => `p${i}`).join(',')}`)).status, 400);
  assert.strictEqual((await call(p, 'GET', '/api/plant-images/credits?ids=a,b')).status, 200);
});
test('curator routes are admin only', async (p) => {
  calls.length = 0;
  for (const [m, path, body] of [['GET', '/api/plant-images/grevillea-robusta/all'], ['POST', '/api/plant-images/images/5/hide', { hidden: true }], ['POST', '/api/plant-images/images/5/role', { role: 'flower' }], ['POST', '/api/plant-images/grevillea-robusta/default', { role: 'flower', imageId: 5 }], ['POST', '/api/plant-images/grevillea-robusta/refresh', {}]]) {
    assert.strictEqual((await call(p, m, path, body)).status, 403, `${m} ${path}`);
  }
  assert.deepStrictEqual(calls, [], 'the service is never reached');
});
test('summary and refresh-missing are admin only, and are not mistaken for plant ids', async (p) => {
  calls.length = 0;
  assert.strictEqual((await call(p, 'GET', '/api/plant-images/summary')).status, 403);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/refresh-missing', {})).status, 403);
  assert.deepStrictEqual(calls, []);
  const h = { 'x-admin': '1' };
  const s = await call(p, 'GET', '/api/plant-images/summary', null, h);
  assert.strictEqual(s.status, 200);
  assert.strictEqual(s.body.plants[0].plantId, 'a');
  assert.ok(!calls.some((c) => c[0] === 'images'), 'summary did not reach the /:plantId route');
  const m = await call(p, 'POST', '/api/plant-images/refresh-missing', {}, h);
  assert.strictEqual(m.status, 202);
  assert.strictEqual(m.body.queued, 7);
});

test('curator actions validate input and report not-found / bad role', async (p) => {
  const h = { 'x-admin': '1' };
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/images/5/hide', { hidden: 'yes' }, h)).status, 400);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/images/abc/hide', { hidden: true }, h)).status, 400);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/images/5/hide', { hidden: true }, h)).status, 200);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/images/999/hide', { hidden: true }, h)).status, 404);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/images/5/role', { role: 'bad' }, h)).status, 400);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/grevillea-robusta/default', { role: 'habitat', imageId: 5 }, h)).status, 400);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/grevillea-robusta/default', { role: 'flower', imageId: 'x' }, h)).status, 400);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/grevillea-robusta/default', { role: 'flower', imageId: null }, h)).status, 200);
  assert.strictEqual((await call(p, 'POST', '/api/plant-images/grevillea-robusta/refresh', {}, h)).status, 202);
  assert.strictEqual((await call(p, 'GET', '/api/plant-images/grevillea-robusta/all', null, h)).status, 200);
});

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  for (const [name, fn] of tests) {
    try { await fn(port); passed += 1; console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
})();
