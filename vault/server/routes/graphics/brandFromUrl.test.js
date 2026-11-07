'use strict';

// node server/routes/graphics/brandFromUrl.test.js
// The route and its two helpers with the browser stubbed out (the browser part is tested in services/brandFromUrl/). No database.

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createProposalStore, createRunLimiter } = require('../../services/brandFromUrl/proposalStore');

// ---- the store: owner only, expires, bounded ----
{
  let t = 1000;
  const store = createProposalStore({ ttlMs: 100, maxPerUser: 2, maxTotal: 3, now: () => t });
  const a = store.put(1, { n: 'a' });
  assert.deepStrictEqual(store.get(1, a), { n: 'a' });
  assert.strictEqual(store.get(2, a), null, 'another person gets nothing');
  assert.strictEqual(store.get(1, 'nope'), null);
  assert.strictEqual(store.get(1, undefined), null);
  t += 101;
  assert.strictEqual(store.get(1, a), null, 'expired');
  const ids = [store.put(1, 'x'), store.put(1, 'y'), store.put(1, 'z')];
  assert.strictEqual(store.get(1, ids[0]), null, 'a person keeps at most 2: the oldest goes');
  assert.strictEqual(store.get(1, ids[2]), 'z');
  store.put(2, 'p'); store.put(3, 'q'); store.put(3, 'r');
  assert.ok(store.size() <= 3, 'whole store is bounded');
  assert.ok(/^[0-9a-f]{32}$/.test(ids[2]), 'ids are random, not counters');
}

// ---- the limiter: one at a time, N an hour ----
{
  let t = 0;
  const lim = createRunLimiter({ perHour: 2, now: () => t });
  const end1 = lim.begin(1);
  assert.throws(() => lim.begin(1), (e) => e.status === 429 && /already/.test(e.message));
  const other = lim.begin(2); // someone else is not held up
  other();
  end1(); end1(); // ending twice is harmless
  const end2 = lim.begin(1);
  end2();
  assert.throws(() => lim.begin(1), (e) => e.status === 429 && /last hour/.test(e.message));
  t += 3601 * 1000;
  lim.begin(1)();
}

// ---- the route, with extractBrand stubbed ----
const stubPath = require.resolve('../../services/brandFromUrl');
const calls = [];
let behaviour = null;
const fontBuf = Buffer.from([0, 1, 0, 0, 9, 9, 9, 9]);
function fakeBrand() {
  return {
    sourceUrl: 'https://example.com/', finalUrl: 'https://www.example.com/', title: 'Example', siteName: '',
    colours: { background: '#ffffff', text: '#111111', primary: '#9b5b46' }, palette: ['#ffffff'], dark: null, radius: { px: 8, label: 'rounded' },
    fonts: {
      heading: {
        family: 'Montserrat', weight: 600, system: false, source: 'page',
        file: { buffer: fontBuf, bytes: 8, ext: 'ttf', renderFamily: 'BrandFont12345678', internalFamily: 'Montserrat Thin', weight: 600, variable: true, instanced: true, sha256: 'abc' },
      },
      body: { family: 'Arial', weight: 400, system: true, source: null, file: null },
    },
    logos: [{ kind: 'img', score: 9, dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 10, sourceUrl: 'https://example.com/l.png', via: 'file' }],
    logo: null, warnings: [],
  };
}
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports: { extractBrand: async (url) => { calls.push(url); return behaviour(url); } } };
const router = require('./brandFromUrl');

(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); });
  app.use('/api/graphics', router);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/graphics`;
  const call = async (method, path, body, user = 1) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': String(user) }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  try {
    behaviour = async () => fakeBrand();

    // bad input never reaches the browser
    for (const bad of [{}, { url: '' }, { url: 42 }, { url: 'x'.repeat(2049) }]) {
      const r = await call('POST', '/brand-from-url', bad);
      assert.strictEqual(r.status, 400);
    }
    assert.strictEqual(calls.length, 0);

    // success: the proposal comes back, the font bytes do not
    const ok = await call('POST', '/brand-from-url', { url: ' example.com ' });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(calls, ['example.com'], 'the address is trimmed');
    assert.ok(ok.body.ok && /^[0-9a-f]{32}$/.test(ok.body.id) && ok.body.expiresInSec === 1800);
    assert.strictEqual(ok.body.colours.primary, '#9b5b46');
    assert.strictEqual(ok.body.fonts.heading.file.renderFamily, 'BrandFont12345678');
    assert.strictEqual(ok.body.fonts.heading.file.buffer, undefined, 'font bytes stay on the server');
    assert.strictEqual(ok.body.fonts.body.file, null);
    assert.ok(ok.body.logos[0].dataUrl.startsWith('data:image/png'));
    assert.strictEqual(ok.body.logoIndex, 0);
    assert.strictEqual(ok.body.logo, undefined, 'the logo picture is not sent twice');

    // the font file: owner only, right bytes, right type
    const font = await call('GET', `/brand-from-url/${ok.body.id}/font/heading`);
    assert.strictEqual(font.status, 200);
    assert.strictEqual(font.type, 'font/ttf');
    assert.ok(Buffer.compare(font.body, fontBuf) === 0);
    assert.strictEqual((await call('GET', `/brand-from-url/${ok.body.id}/font/heading`, null, 2)).status, 404, 'another person cannot get it');
    assert.strictEqual((await call('GET', `/brand-from-url/${ok.body.id}/font/body`)).status, 404, 'no file for a system font');
    assert.strictEqual((await call('GET', `/brand-from-url/${ok.body.id}/font/other`)).status, 400);
    assert.strictEqual((await call('GET', `/brand-from-url/${'0'.repeat(32)}/font/heading`)).status, 404);

    // errors from the reader keep their plain message and status; an unexpected one does not leak internals
    behaviour = async () => { throw Object.assign(new Error('Could not reach that website.'), { status: 422 }); };
    const e1 = await call('POST', '/brand-from-url', { url: 'a.com' }, 3);
    assert.deepStrictEqual([e1.status, e1.body.error], [422, 'Could not reach that website.']);
    behaviour = async () => { throw new Error('ECONNRESET at /srv/secret/path'); };
    const e2 = await call('POST', '/brand-from-url', { url: 'a.com' }, 3);
    assert.strictEqual(e2.status, 500);
    assert.ok(!/secret/.test(e2.body.error));

    // one at a time per person; the slot is freed afterwards
    let release;
    behaviour = () => new Promise((r) => { release = () => r(fakeBrand()); });
    const slow = call('POST', '/brand-from-url', { url: 'slow.com' }, 4);
    await new Promise((r) => setTimeout(r, 100));
    const second = await call('POST', '/brand-from-url', { url: 'second.com' }, 4);
    assert.strictEqual(second.status, 429);
    release();
    assert.strictEqual((await slow).status, 200);
    behaviour = async () => fakeBrand();
    assert.strictEqual((await call('POST', '/brand-from-url', { url: 'again.com' }, 4)).status, 200);

    console.log('brandFromUrl route tests: ok');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
