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
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
// The database: tests may set global.__poolHandler(sql, params) to answer specific queries; otherwise one row holding the restrictions list.
stub('../../db', { pool: { query: async (sql, params) => (global.__poolHandler ? global.__poolHandler(sql, params) : { rows: [{ value: global.__restrictions || '[]' }] }) } });
// The language model and usage log, so the icon routes can be checked without a provider or a database.
const modelCalls = [];
const usageLogs = [];
stub('../../services/modelResolver', { getModelsForUser: async () => ({ light: 'light-model', standard: 'standard-model' }), getVaultModelsConfigForUser: async () => ({ models: [] }) });
stub('../../services/callModel', { callModel: async (model) => { if (global.__callModelThrow) throw new Error('provider down'); modelCalls.push(model); return { text: global.__callModelText !== undefined ? global.__callModelText : JSON.stringify({ lucide: ['a'], fontawesome: ['b'] }), inputTokens: 11, outputTokens: 22, model }; } });
stub('../../utils/logUsage', { logUsage: (u) => usageLogs.push(u) });
process.env.GRAPHICS_MAX_MEGAPIXELS = '30';
process.env.GRAPHICS_DAILY_COST_CAP_USD = '5';

const express = require('express');
const sharp = require('sharp');
const router = require('../graphics');
const { exifHasGps } = require('./analyse');
const { makePaidGuard } = require('../../middleware/graphicsLimits');
const { runPixelTask } = require('../../services/graphicsWorker');
const { EventEmitter } = require('events');

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
  return { server, post, baseUrl: base };
}

(async () => {
  const { server, post, baseUrl } = await startServer();
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


    // ---- Pixel-heavy tools run in a worker thread, and still give the right answers ----
    const solid = async (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
    const red = await solid(40, 40, '#cc0000');
    r = await post('/recolor', { imageDataUrl: dataUrl(red, 'image/png'), sourceColor: '#cc0000', targetColor: '#0000cc', tolerance: 10 });
    assert.strictEqual(r.status, 200, `recolor: ${r.body.error}`);
    assert.strictEqual(r.body.matchedPct, 100);
    px = await sharp(toBuf(r.body.imageDataUrl)).raw().toBuffer();
    assert.ok(px[2] > 150 && px[0] < 80, 'red became blue');
    const blue = await solid(40, 40, '#0000cc');
    r = await post('/diff', { imageA: dataUrl(red, 'image/png'), imageB: dataUrl(blue, 'image/png'), threshold: 25 });
    assert.strictEqual(r.status, 200, `diff: ${r.body.error}`);
    assert.strictEqual(r.body.diffPct, 100);
    r = await post('/diff', { imageA: dataUrl(red, 'image/png'), imageB: dataUrl(red, 'image/png'), threshold: 25 });
    assert.strictEqual(r.body.diffPixels, 0, 'identical pictures do not differ');
    const maskHalf = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#000' } })
      .composite([{ input: await sharp({ create: { width: 20, height: 40, channels: 3, background: '#fff' } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
    r = await post('/extract', { imageDataUrl: dataUrl(red, 'image/png'), maskDataUrl: dataUrl(maskHalf, 'image/png') });
    assert.strictEqual(r.status, 200, `extract: ${r.body.error}`);
    px = await sharp(toBuf(r.body.imageDataUrl)).ensureAlpha().raw().toBuffer();
    assert.ok(px[3] > 250, 'masked-in pixels stay opaque');
    assert.ok(px[(39 * 4) + 3] < 5, 'masked-out pixels become transparent');
    r = await post('/print-ready', { imageDataUrl: dataUrl(red, 'image/png'), format: 'tiff-cmyk', dpi: 300 });
    assert.strictEqual(r.status, 200, `cmyk: ${r.body.error}`);
    assert.strictEqual(r.body.colorSpace, 'CMYK');
    const cmyk = await runPixelTask('cmyk', { rgb: Buffer.from([255, 0, 0, 0, 0, 0]), pixelCount: 2 });
    assert.deepStrictEqual([...cmyk.out], [0, 255, 255, 0, 0, 0, 0, 255], 'pure red and black convert to CMYK');
    r = await post('/vectorize', { imageDataUrl: dataUrl(red, 'image/png'), colors: 4 });
    assert.strictEqual(r.status, 200, `vectorize: ${r.body.error}`);
    assert.ok(r.body.svg.includes('<svg'));

    // ---- A big recolor does not freeze the server (the old in-process loop stalled it for seconds) ----
    const bigPic = await solid(5000, 5000, '#cc0000'); // 25 megapixels
    let worstGap = 0;
    let last = Date.now();
    const ticker = setInterval(() => { const now = Date.now(); worstGap = Math.max(worstGap, now - last); last = now; }, 20);
    const started = Date.now();
    r = await post('/recolor', { imageDataUrl: dataUrl(bigPic, 'image/png'), sourceColor: '#cc0000', targetColor: '#0000cc', tolerance: 10 });
    clearInterval(ticker);
    assert.strictEqual(r.status, 200, `big recolor: ${r.body.error}`);
    assert.ok(worstGap < 500, `the server stayed responsive during a ${Date.now() - started}ms recolor (worst stall ${worstGap}ms)`);

    // ---- Oversized images are refused up front ----
    const huge = await solid(6000, 6000, '#fff'); // 36 megapixels, over the 30 set for this test
    r = await post('/convert', { imageDataUrl: dataUrl(huge, 'image/png'), format: 'jpg' });
    assert.strictEqual(r.status, 413, 'too many megapixels');
    assert.match(r.body.error, /too large/);
    r = await post('/batch', { op: 'convert', items: [{ imageDataUrl: dataUrl(huge, 'image/png'), format: 'jpg' }] });
    assert.strictEqual(r.status, 413, 'images nested inside a batch are checked too');

    // ---- Paid tools: daily spend cap ----
    global.__poolHandler = (sql) => (/usage_logs/.test(sql) ? { rows: [{ spent: '5.25' }] } : { rows: [{ value: '[]' }] });
    r = await post('/generate', { prompt: 'a sunny hill', skipRefine: true });
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.body.code, 'GRAPHICS_DAILY_CAP');
    assert.strictEqual((await post('/inpaint', { prompt: 'x', imageDataUrl: smallUrl, maskDataUrl: smallUrl })).status, 429, 'inpaint is capped');
    assert.strictEqual((await post('/upscale', { imageDataUrl: smallUrl })).status, 429, 'upscale is capped');
    assert.notStrictEqual((await post('/convert', { imageDataUrl: smallUrl, format: 'png' })).status, 429, 'free tools are not capped');
    global.__poolHandler = (sql) => (/usage_logs/.test(sql) ? { rows: [{ spent: '0.10' }] } : { rows: [{ value: '[]' }] });
    assert.notStrictEqual((await post('/generate', { prompt: 'a sunny hill', skipRefine: true })).status, 429, 'under the cap goes through');

    // ---- Paid tools: only a couple of jobs at once ----
    const guard = makePaidGuard({ pool: { query: async () => ({ rows: [{ spent: '0' }] }) } });
    const fakeRes = () => { const e = new EventEmitter(); e.status = (c) => { e.code = c; return e; }; e.json = (b) => { e.body = b; return e; }; return e; };
    const started3 = [];
    for (let i = 0; i < 3; i += 1) {
      const res = fakeRes();
      let passed = false;
      // eslint-disable-next-line no-await-in-loop
      await guard({ method: 'POST', user: { id: 77 } }, res, () => { passed = true; });
      started3.push({ res, passed });
    }
    assert.deepStrictEqual(started3.map((x) => x.passed), [true, true, false], 'a third simultaneous paid job is refused');
    assert.strictEqual(started3[2].res.code, 429);
    started3[0].res.emit('finish');
    let again = false;
    await guard({ method: 'POST', user: { id: 77 } }, fakeRes(), () => { again = true; });
    assert.ok(again, 'a finished job frees its place');
    let other = false;
    await guard({ method: 'POST', user: { id: 78 } }, fakeRes(), () => { other = true; });
    assert.ok(other, "one person's jobs do not count against another");

    // ---- Upscale refuses outputs that are too big, before spending anything ----
    global.__poolHandler = null;
    const mid = await solid(5000, 5000, '#fff');
    r = await post('/upscale', { imageDataUrl: dataUrl(mid, 'image/png'), scale: 4 });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /megapixels/);

    // ---- Animate frame cap ----
    r = await post('/animate', { frames: Array(41).fill(smallUrl) });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, /Too many frames/);

    // ---- Icon tools use the workspace's model and record their cost ----
    r = await post('/icon-references', { subject: 'banking' });
    assert.strictEqual(r.status, 200, `icon-references: ${r.body.error}`);
    assert.deepStrictEqual(r.body.lucide, ['a']);
    assert.strictEqual(modelCalls[modelCalls.length - 1], 'light-model', 'the model id comes from Settings, not from code');
    assert.deepStrictEqual({ f: usageLogs[0].feature, i: usageLogs[0].inputTokens, o: usageLogs[0].outputTokens, u: usageLogs[0].userId }, { f: 'graphics_icons', i: 11, o: 22, u: 1 });

    // ---- Gallery limits, previews and id handling ----
    global.__poolHandler = (sql, params) => {
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: global.__galleryCount }] };
      if (/INSERT INTO graphics_gallery/.test(sql)) return { rows: [{ id: 5, prompt: params[1], thumbDataUrl: params[3], metadata: params[8] }] };
      if (/SELECT "imageDataUrl"/.test(sql)) return { rows: [{ imageDataUrl: dataUrl(red, 'image/png') }] };
      if (/FROM graphics_gallery/.test(sql)) return { rows: [{ id: 1, prompt: 'p', thumbDataUrl: null }, { id: 2, prompt: 'q', thumbDataUrl: 'data:image/jpeg;base64,AAAA' }] };
      return { rows: [] };
    };
    global.__galleryCount = '200';
    r = await post('/gallery', { prompt: 'p', imageDataUrl: dataUrl(red, 'image/png') });
    assert.strictEqual(r.status, 409, 'gallery full');
    global.__galleryCount = '3';
    r = await post('/gallery', { prompt: 'p', imageDataUrl: `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}` });
    assert.strictEqual(r.status, 413, 'one saved image is limited to 8MB');
    r = await post('/gallery', { prompt: 'p', imageDataUrl: dataUrl(red, 'image/png'), metadata: ['not', 'an', 'object'] });
    assert.strictEqual(r.status, 201);
    assert.ok(/^data:image\/jpeg;base64,/.test(r.body.thumbDataUrl), 'a preview is made when saving');
    assert.strictEqual(r.body.metadata, null, 'array metadata is dropped');
    const listed = await (await fetch(`${baseUrl}/gallery`)).json();
    assert.ok(listed.every((row) => !('imageDataUrl' in row)), 'the list carries previews, not full images');
    assert.ok(listed[0].thumbDataUrl.startsWith('data:image/jpeg'), 'a missing preview is made on the fly');
    assert.strictEqual((await fetch(`${baseUrl}/gallery/abc`)).status, 404, 'a bad id is a 404, not a 500');
    assert.strictEqual((await fetch(`${baseUrl}/gallery/abc`, { method: 'DELETE' })).status, 404);
    global.__poolHandler = null;


    // ---- Pipeline keeps the picture's quality across many steps ----
    let seedN = 12345;
    const rand = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
    const W0 = 240;
    const noise = Buffer.alloc(W0 * W0 * 3);
    for (let i = 0; i < W0 * W0; i += 1) {
      const x = i % W0; const y = Math.floor(i / W0);
      noise[i * 3] = (x + Math.sin(y / 5) * 30 + rand() * 40) & 255;
      noise[i * 3 + 1] = (y + rand() * 40) & 255;
      noise[i * 3 + 2] = ((x ^ y) + rand() * 30) & 255;
    }
    const photo = await sharp(noise, { raw: { width: W0, height: W0, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const photoPx = await sharp(photo).raw().toBuffer();
    r = await post('/pipeline', { imageDataUrl: dataUrl(photo, 'image/jpeg'), steps: Array(8).fill({ op: 'brightness', value: 1 }) });
    assert.strictEqual(r.status, 200, `pipeline: ${r.body.error}`);
    assert.strictEqual(r.body.format, 'jpeg', 'the result stays a JPEG');
    const pipePx = await sharp(toBuf(r.body.imageDataUrl)).raw().toBuffer();
    let diffSum = 0;
    for (let i = 0; i < photoPx.length; i += 1) diffSum += Math.abs(photoPx[i] - pipePx[i]);
    const meanErr = diffSum / photoPx.length;
    // Re-saving as a JPEG after every step measured about 9.7 here; one lossless chain and a single final save is about 4.6.
    assert.ok(meanErr < 7, `eight pipeline steps cost little quality (mean error ${meanErr.toFixed(2)})`);

    // ---- Compress only squeezes a PNG to 256 colours when asked for strong compression ----
    const gradient = Buffer.alloc(300 * 300 * 3);
    for (let i = 0; i < 300 * 300; i += 1) { gradient[i * 3] = (i % 300) * 255 / 300; gradient[i * 3 + 1] = Math.floor(i / 300) * 255 / 300; gradient[i * 3 + 2] = ((i % 300) + Math.floor(i / 300)) % 256; }
    const gradPng = await sharp(gradient, { raw: { width: 300, height: 300, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    r = await post('/compress', { imageDataUrl: dataUrl(gradPng, 'image/png'), quality: 95 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await sharp(toBuf(r.body.imageDataUrl)).metadata()).paletteBitDepth, undefined, 'a high-quality PNG compress is lossless');
    r = await post('/compress', { imageDataUrl: dataUrl(gradPng, 'image/png'), quality: 50 });
    assert.ok((await sharp(toBuf(r.body.imageDataUrl)).metadata()).paletteBitDepth, 'a strong PNG compress uses a palette');

    // ---- Auto-enhance gives back the picture's own format ----
    r = await post('/auto-enhance', { imageDataUrl: dataUrl(photo, 'image/jpeg') });
    assert.strictEqual(r.body.format, 'jpeg');
    assert.ok(r.body.imageDataUrl.startsWith('data:image/jpeg;'), 'a JPEG stays a JPEG');

    // ---- Favicon pack includes a real favicon.ico ----
    const JSZip = require('jszip');
    r = await post('/favicon', { imageDataUrl: dataUrl(red, 'image/png') });
    assert.strictEqual(r.status, 200, `favicon: ${r.body.error}`);
    const zip = await JSZip.loadAsync(toBuf(r.body.zipDataUrl));
    const names = Object.keys(zip.files);
    assert.ok(names.includes('favicon.ico'), `favicon.ico is in the zip (${names.join(', ')})`);
    const icoBytes = await zip.file('favicon.ico').async('nodebuffer');
    assert.deepStrictEqual([icoBytes.readUInt16LE(0), icoBytes.readUInt16LE(2), icoBytes.readUInt16LE(4)], [0, 1, 3], 'an ICO holding three sizes');
    assert.ok((await zip.file('head-snippet.html').async('string')).includes('/favicon.ico'), 'the snippet links it');

    // ---- Things that are not images get a clean 400, not a decoder error ----
    const notImage = 'data:application/pdf;base64,JVBERi0xLjQK';
    for (const route of ['/smart-crop', '/perspective', '/colorgrade', '/auto-enhance', '/blur-detect']) {
      r = await post(route, { imageDataUrl: notImage });
      assert.strictEqual(r.status, 400, `${route} refuses a PDF`);
    }
    assert.strictEqual((await post('/diff', { imageA: notImage, imageB: notImage })).status, 400);

    // ---- Ask Graphics bounds what it sends to the model ----
    r = await post('/plan-request', { transcript: 'x'.repeat(2500), catalog: [{ id: 'adjust' }] });
    assert.strictEqual(r.status, 400);
    r = await post('/plan-request', { transcript: 'brighter', catalog: Array.from({ length: 61 }, (_, i) => ({ id: `m${i}` })) });
    assert.strictEqual(r.status, 400);


    // ---- Animated pictures: editing tools refuse rather than quietly keep one frame; Convert and Compress keep the animation ----
    const frameA = dataUrl(await solid(40, 30, '#cc0000'), 'image/png');
    const frameB = dataUrl(await solid(40, 30, '#0000cc'), 'image/png');
    r = await post('/animate', { frames: [frameA, frameB], delay: 100 });
    assert.strictEqual(r.status, 200, `animate: ${r.body.error}`);
    const gif = r.body.imageDataUrl;
    assert.strictEqual((await sharp(toBuf(gif), { animated: true }).metadata()).pages, 2, 'the test GIF really has two frames');
    const animatedRoutes = [
      ['/resize', { width: 20 }], ['/extend', { top: 5 }], ['/effect', { effect: 'grayscale' }], ['/adjust', { brightness: 1.2 }], ['/colorgrade', { preset: 'warm' }],
      ['/watermark', { type: 'text', text: 'hi' }], ['/text', { text: 'hi' }], ['/strip-metadata', {}], ['/smart-crop', { width: 10, height: 10 }], ['/perspective', { hSkew: 5 }],
      ['/recolor', { sourceColor: '#cc0000', targetColor: '#00cc00' }], ['/pipeline', { steps: [{ op: 'grayscale' }] }], ['/composite', { overlays: [{ type: 'text', text: 'hi' }] }],
    ];
    for (const [route, extra] of animatedRoutes) {
      r = await post(route, { imageDataUrl: gif, ...extra });
      assert.strictEqual(r.status, 422, `${route} refuses an animated GIF (got ${r.status}: ${r.body.error})`);
      assert.match(r.body.error, /animated/);
    }
    r = await post('/batch', { op: 'resize', items: [{ imageDataUrl: gif, width: 20 }, { imageDataUrl: frameA, width: 20 }] });
    assert.match(r.body.results[0].error, /animated/, 'in a batch, the animated item is reported');
    assert.ok(r.body.results[1].imageDataUrl, 'and the others still run');
    r = await post('/convert', { imageDataUrl: gif, format: 'webp' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await sharp(toBuf(r.body.imageDataUrl), { animated: true }).metadata()).pages, 2, 'Convert keeps the animation');
    r = await post('/compress', { imageDataUrl: gif, quality: 60 });
    assert.strictEqual(r.status, 200);

    // ---- Composite {x, y}: between 0 and 1 is a fraction, 1 and up is pixels ----
    const dot = dataUrl(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).png().toBuffer(), 'image/png');
    const whiteBase = dataUrl(await solid(100, 100, '#ffffff'), 'image/png');
    const pixelAt = async (url, x, y) => { const { data, info } = await sharp(toBuf(url)).raw().toBuffer({ resolveWithObject: true }); const o = (y * info.width + x) * info.channels; return [data[o], data[o + 1], data[o + 2]]; };
    r = await post('/composite', { imageDataUrl: whiteBase, overlays: [{ type: 'image', imageDataUrl: dot, scale: 4, position: { x: 1, y: 1 } }] });
    assert.strictEqual(r.status, 200, `composite px: ${r.body.error}`);
    assert.deepStrictEqual(await pixelAt(r.body.imageDataUrl, 2, 2), [255, 0, 0], 'x = 1 means one pixel in');
    r = await post('/composite', { imageDataUrl: whiteBase, overlays: [{ type: 'image', imageDataUrl: dot, scale: 4, position: { x: 0.5, y: 0.5 } }] });
    assert.deepStrictEqual(await pixelAt(r.body.imageDataUrl, 51, 51), [255, 0, 0], 'x = 0.5 means halfway across');

    // ---- Favicon manifest has no blank names; a site name is used when given ----
    r = await post('/favicon', { imageDataUrl: dataUrl(red, 'image/png') });
    let manifest = JSON.parse(await (await JSZip.loadAsync(toBuf(r.body.zipDataUrl))).file('site.webmanifest').async('string'));
    assert.ok(!('name' in manifest) && !('short_name' in manifest), 'no empty name fields');
    r = await post('/favicon', { imageDataUrl: dataUrl(red, 'image/png'), name: 'Curam Vault' });
    manifest = JSON.parse(await (await JSZip.loadAsync(toBuf(r.body.zipDataUrl))).file('site.webmanifest').async('string'));
    assert.strictEqual(manifest.name, 'Curam Vault');

    // ---- Ask Graphics reports the right kind of failure ----
    r = await post('/plan-request', { transcript: '', catalog: [{ id: 'adjust' }] });
    assert.strictEqual(r.status, 400, 'an empty request is the person');
    r = await post('/plan-request', { transcript: 'make it brighter', catalog: [] });
    assert.strictEqual(r.status, 400, 'no catalogue is a bad request');
    r = await post('/plan-request', { transcript: 'make it brighter', catalog: [{ id: 'adjust', label: 'Adjust', description: 'x', paramSchema: {} }] });
    assert.strictEqual(r.status, 422, 'an answer that is not a plan is "could not understand", not a server error');
    global.__callModelThrow = true;
    r = await post('/plan-request', { transcript: 'make it brighter', catalog: [{ id: 'adjust', label: 'Adjust', description: 'x', paramSchema: {} }] });
    assert.strictEqual(r.status, 502, 'a provider failure is a 502');
    assert.ok(!/provider down/.test(r.body.error), "the provider's raw message is not shown");
    global.__callModelThrow = false;


    // ---- Prompt refining uses the workspace's own model on the hosted site, and never blocks a generation ----
    const { runtimeConfig } = require('./shared');
    runtimeConfig.isLocal = false; // behave like production
    const callsBefore = modelCalls.length;
    const logsBefore = usageLogs.length;
    global.__callModelText = '  "Prompt: A misty green hill at dawn, soft golden light, wide shot"  ';
    r = await post('/refine', { prompt: 'a hill' });
    assert.strictEqual(r.status, 200, `refine: ${r.body.error}`);
    assert.strictEqual(r.body.refinedPrompt, 'A misty green hill at dawn, soft golden light, wide shot', 'quotes and a label are stripped');
    assert.strictEqual(r.body.model, 'light-model', 'the model comes from Settings');
    assert.strictEqual(modelCalls.length, callsBefore + 1);
    assert.strictEqual(usageLogs[logsBefore].feature, 'graphics_refine', 'the cost is recorded, so it shows on the dashboard and counts toward the cap');
    global.__callModelText = "I'm sorry, I can't help with that.";
    r = await post('/refine', { prompt: 'a hill' });
    assert.strictEqual(r.body.refinedPrompt, 'a hill', 'a refusal or chatter is never used as the prompt');
    global.__callModelText = 'x'.repeat(2000);
    assert.strictEqual((await post('/refine', { prompt: 'a hill' })).body.refinedPrompt, 'a hill', 'an over-long answer is not used');
    global.__callModelThrow = true;
    r = await post('/refine', { prompt: 'a hill' });
    assert.strictEqual(r.status, 200, 'a failing model does not fail the request');
    assert.strictEqual(r.body.refinedPrompt, 'a hill', 'the original prompt is used');
    global.__callModelThrow = false;
    // Generate refines unless told not to, and checks the refined text against the content restrictions
    global.__callModelText = 'A calm lake at sunrise';
    const before = modelCalls.length;
    await post('/generate', { prompt: 'a lake' });
    assert.strictEqual(modelCalls.length, before + 1, 'Generate refines the prompt');
    await post('/generate', { prompt: 'a lake', skipRefine: true });
    assert.strictEqual(modelCalls.length, before + 1, 'skipRefine makes no model call');
    global.__restrictions = JSON.stringify(['gore']);
    global.__callModelText = 'a gory battle scene';
    r = await post('/generate', { prompt: 'a battle' });
    assert.strictEqual(r.status, 422, 'a refined prompt that brings a restricted idea back is refused');
    global.__restrictions = '[]';
    // the standalone Refine button is covered by the daily spend cap like the other paid tools
    global.__poolHandler = (sql) => (/usage_logs/.test(sql) ? { rows: [{ spent: '9' }] } : { rows: [{ value: '[]' }] });
    assert.strictEqual((await post('/refine', { prompt: 'a hill' })).status, 429, 'Refine respects the daily cap');
    global.__poolHandler = null;
    global.__callModelText = undefined;
    runtimeConfig.isLocal = true;

    console.log('graphics route tests passed');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
