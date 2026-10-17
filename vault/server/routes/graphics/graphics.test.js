'use strict';

// Regression tests for the Graphics routes that run on sharp. Each test builds a tiny image with the
// property that used to break (a phone-rotated photo, a see-through PNG, a big overlay on a small
// image, a GPS tag) and calls the real route over HTTP. No database is needed: db.js is stubbed.
//
//   node server/routes/graphics/graphics.test.js      (npm run test:graphics)

const assert = require('assert');
const path = require('path');
const http = require('http');

// shared.js loads the database module; the routes under test never touch it.
const dbPath = require.resolve('../../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [{ value: global.__restrictions || '[]' }] }) } } };

const express = require('express');
const sharp = require('sharp');
const router = require('../graphics');
const { exifHasGps } = require('./analyse');

const dataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;
const toBuf = (url) => Buffer.from(String(url).split(',')[1], 'base64');

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/api/graphics', router);
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/graphics`;
  const post = async (route, body) => {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { server, post };
}

(async () => {
  const { server, post } = await startServer();
  try {
    // A 200x100 JPEG tagged "rotate 90 degrees": a phone portrait photo, which viewers show as 100x200.
    const phone = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#c00' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const phoneUrl = dataUrl(phone, 'image/jpeg');

    // ---- Convert / Compress keep a phone photo upright ----
    let r = await post('/convert', { imageDataUrl: phoneUrl, format: 'png' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.width, r.body.height], [100, 200], 'convert bakes in the rotation');
    r = await post('/compress', { imageDataUrl: phoneUrl, quality: 60 });
    assert.strictEqual(r.status, 200);
    if (!r.body.noGain) assert.deepStrictEqual([r.body.width, r.body.height], [100, 200], 'compress bakes in the rotation');

    // ---- Convert: see-through PNG to JPG is white, not black ----
    const clear = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    r = await post('/convert', { imageDataUrl: dataUrl(clear, 'image/png'), format: 'jpg' });
    assert.strictEqual(r.status, 200);
    let px = await sharp(toBuf(r.body.imageDataUrl)).raw().toBuffer();
    assert.ok(px[0] > 240 && px[1] > 240 && px[2] > 240, 'transparent areas become white');
    r = await post('/convert', { imageDataUrl: dataUrl(clear, 'image/png'), format: 'jpg', background: '#ff0000' });
    px = await sharp(toBuf(r.body.imageDataUrl)).raw().toBuffer();
    assert.ok(px[0] > 200 && px[1] < 60 && px[2] < 60, 'a chosen background colour is used');

    // ---- Auto-enhance keeps the full size ----
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#555' } }).jpeg().toBuffer();
    r = await post('/auto-enhance', { imageDataUrl: dataUrl(big, 'image/jpeg') });
    assert.strictEqual(r.status, 200);
    const enhanced = await sharp(toBuf(r.body.imageDataUrl)).metadata();
    assert.deepStrictEqual([enhanced.width, enhanced.height], [2000, 1000], 'auto-enhance does not shrink the image');
    assert.deepStrictEqual([r.body.width, r.body.height], [2000, 1000]);

    // ---- Overlays bigger than the image are shrunk to fit instead of failing ----
    const small = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
    const smallUrl = dataUrl(small, 'image/png');
    r = await post('/watermark', { imageDataUrl: smallUrl, type: 'text', text: 'A very long watermark that cannot fit', fontSize: 40, position: 'bottom-right' });
    assert.strictEqual(r.status, 200, `watermark: ${r.body.error}`);
    assert.deepStrictEqual([r.body.width, r.body.height], [120, 80]);
    r = await post('/watermark', { imageDataUrl: smallUrl, type: 'text', text: 'Tiled and too long to fit', fontSize: 40, tile: true });
    assert.strictEqual(r.status, 200, `tiled watermark: ${r.body.error}`);
    r = await post('/text', { imageDataUrl: smallUrl, text: 'Headline', fontSize: 400 });
    assert.strictEqual(r.status, 200, `text overlay: ${r.body.error}`);
    const tallLogo = dataUrl(await sharp({ create: { width: 30, height: 300, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer(), 'image/png');
    r = await post('/composite', { imageDataUrl: smallUrl, overlays: [{ type: 'image', imageDataUrl: tallLogo, scale: 25 }, { type: 'text', text: 'Hello there, this is a long line', fontSize: 200 }] });
    assert.strictEqual(r.status, 200, `composite: ${r.body.error}`);
    r = await post('/batch-text', { images: [{ name: 'a.png', imageDataUrl: smallUrl }, null], text: 'A long label for a small picture', fontSize: 80 });
    assert.strictEqual(r.status, 200, 'a null item does not fail the whole batch');
    assert.ok(r.body.results[0].imageDataUrl && r.body.results[1].error);

    // ---- Overlay sizes on a rotated photo use the upright size ----
    r = await post('/watermark', { imageDataUrl: phoneUrl, type: 'text', text: 'Tall photo, wide mark', fontSize: 60 });
    assert.strictEqual(r.status, 200, `rotated watermark: ${r.body.error}`);
    assert.deepStrictEqual([r.body.width, r.body.height], [100, 200]);

    // ---- Crop by shape on a rotated photo ----
    r = await post('/resize', { imageDataUrl: phoneUrl, op: 'crop', aspect: '1:1', strategy: 'centre' });
    assert.strictEqual(r.status, 200, `crop: ${r.body.error}`);
    assert.deepStrictEqual([r.body.width, r.body.height], [100, 100], 'a 1:1 crop of a 100x200 upright photo is 100x100');

    // ---- Remove Meta sees a real GPS tag ----
    const geo = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#888' } }).jpeg()
      .withMetadata({ exif: { IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '27/1 28/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '153/1 1/1 0/1' } } }).toBuffer();
    const geoUrl = dataUrl(geo, 'image/jpeg');
    r = await post('/metadata', { imageDataUrl: geoUrl });
    assert.strictEqual(r.body.flags.gps, true, 'metadata reports GPS');
    assert.ok(r.body.exif.some((f) => f.label === 'GPS'));
    r = await post('/strip-metadata', { imageDataUrl: geoUrl });
    assert.ok(r.body.removed.includes('GPS location'), 'strip reports the GPS location it removed');
    assert.strictEqual((await sharp(toBuf(r.body.imageDataUrl)).metadata()).exif, undefined, 'the cleaned file has no EXIF');
    assert.strictEqual(exifHasGps((await sharp(phone).metadata()).exif), false, 'no GPS tag, no GPS claim');
    assert.strictEqual(exifHasGps(undefined), false);

    // ---- Content restrictions are enforced by the server, with whole-word matching ----
    global.__restrictions = JSON.stringify(['gore', 'graphic violence', 'nudity']);
    const img = dataUrl(small, 'image/png');
    r = await post('/generate', { prompt: 'a gory battle scene', skipRefine: true });
    assert.strictEqual(r.status, 422, 'a restricted prompt is refused');
    assert.strictEqual(r.body.code, 'CONTENT_RESTRICTED');
    assert.ok(r.body.matches.some((m) => m.restriction === 'gore'), 'the match is named');
    assert.strictEqual((await post('/generate', { prompt: 'Nude figure study', skipRefine: true })).status, 422, 'a short restriction also catches its related words');
    assert.strictEqual((await post('/generate', { prompt: 'a graphic scene full of violence', skipRefine: true })).status, 422, 'all the words of a multi-word restriction');
    assert.notStrictEqual((await post('/generate', { prompt: 'Singapore skyline at dusk', skipRefine: true })).status, 422, 'gore does not match Singapore');
    assert.notStrictEqual((await post('/generate', { prompt: 'a graphic design poster', skipRefine: true })).status, 422, 'one word of a multi-word restriction is not enough');
    assert.strictEqual((await post('/augment', { prompt: 'make it gory', imageDataUrl: img })).status, 422, 'augment is guarded');
    assert.strictEqual((await post('/inpaint', { prompt: 'add gore here', imageDataUrl: img, maskDataUrl: img })).status, 422, 'inpaint is guarded');
    r = await post('/preflight', { prompt: 'Singapore' });
    assert.strictEqual(r.body.restricted, false);
    r = await post('/preflight', { prompt: 'so much gore' });
    assert.strictEqual(r.body.restricted, true);
    global.__restrictions = '[]';

    // ---- Import by URL refuses internal addresses ----
    for (const url of ['http://127.0.0.1/x.png', 'http://localhost/x.png', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x.png', 'http://[::ffff:10.0.0.1]/x.png', 'http://2130706433/x.png', 'http://example.com:8080/x.png', 'ftp://example.com/x.png', 'http://user:pw@example.com/x.png']) {
      r = await post('/fetch-url', { url });
      assert.strictEqual(r.status, 400, `${url} is refused (got ${r.status})`);
    }

    console.log('graphics route tests passed');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
