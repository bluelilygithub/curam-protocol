'use strict';

// node server/routes/graphics/brandText.test.js
// Text Overlay and Composite text layers drawn in the person's brand font (docs/brand-from-url.md, step 6). The database is stubbed with
// one stored font (any TrueType file found on this machine stands in for a brand font); skipped when there is none.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const FONT_FILES = [
  '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', '/usr/share/fonts/liberation/LiberationSerif-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 'C:\\Windows\\Fonts\\times.ttf', 'C:\\Windows\\Fonts\\georgia.ttf',
  '/Library/Fonts/Georgia.ttf', '/System/Library/Fonts/Supplemental/Georgia.ttf',
];
const fontPath = FONT_FILES.find((p) => fs.existsSync(p));
if (!fontPath) { console.log('brandText tests skipped: no serif TrueType file found on this machine'); process.exit(0); }
const fontBytes = fs.readFileSync(fontPath);
const fontSha = crypto.createHash('sha256').update(fontBytes).digest('hex');

// the database: user 1 has a heading font stored, nobody has a body font
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../../db', {
  pool: {
    query: async (sql, params) => {
      if (/FROM graphics_brand_fonts/.test(sql)) {
        const [uid, role] = params;
        if (uid === 1 && role === 'heading') return { rows: [{ role, family: 'Test Serif', weight: 400, renderFamily: 'BrandFonttest0001', ext: 'ttf', bytes: fontBytes.length, sha256: fontSha, data: fontBytes }] };
        return { rows: [] };
      }
      return { rows: [{ value: '[]' }] };
    },
  },
});
stub('../../services/modelResolver', { getModelsForUser: async () => ({ light: 'l', standard: 's' }), getVaultModelsConfigForUser: async () => ({ models: [] }) });
stub('../../services/callModel', { callModel: async () => ({ text: '{}', inputTokens: 1, outputTokens: 1, model: 'm' }) });
stub('../../utils/logUsage', { logUsage: () => {} });

const express = require('express');
const sharp = require('sharp');
const compose = require('./compose');
const BT = require('../../services/graphicsBrandText');

const dataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
const pixels = async (url) => (await sharp(Buffer.from(String(url).split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true }));

(async () => {
  // ---- the service: measuring and outlines ----
  const row = { data: fontBytes, sha256: fontSha };
  const font = BT.parseFontBuffer(row.data, row.sha256);
  assert.ok(BT.measure(font, 'Brand Headline', 48) > BT.measure(font, 'Brand', 48), 'longer text is wider');
  assert.ok(BT.measure(font, 'W', 96) > BT.measure(font, 'W', 48) * 1.9, 'width scales with size');
  assert.ok(BT.lineHeightFor(font, 40) >= 50, 'never tighter than the standard 1.25');
  const d = BT.linePathData(font, 'Hello', { x: 100, top: 0, size: 40, lineHeight: 50, anchor: 'middle' });
  assert.ok(/^M/.test(d) && d.length > 100, 'outlines of the letters');
  const left = BT.linePathData(font, 'Hello', { x: 100, top: 0, size: 40, lineHeight: 50, anchor: 'start' });
  const right = BT.linePathData(font, 'Hello', { x: 100, top: 0, size: 40, lineHeight: 50, anchor: 'end' });
  const firstX = (p) => Number(/^M([\d.-]+)/.exec(p)[1]);
  assert.ok(firstX(left) > firstX(d) && firstX(d) > firstX(right), 'start, middle and end anchors put the text right, centre and left of the point');
  assert.strictEqual(BT.brandRoleOf('brand-heading'), 'heading');
  assert.strictEqual(BT.brandRoleOf('brand-body'), 'body');
  assert.strictEqual(BT.brandRoleOf('arial'), null);
  assert.strictEqual(BT.brandRoleOf(undefined), null);
  assert.strictEqual(await BT.loadBrandFont({ query: async () => ({ rows: [] }) }, 1, undefined), null, 'no brand font asked for: nothing loaded');
  await assert.rejects(() => BT.loadBrandFont({ query: async () => ({ rows: [] }) }, 1, 'brand-body'), (e) => e.status === 409 && /No brand body font/.test(e.message));
  await assert.rejects(() => BT.loadBrandFont({ query: async () => ({ rows: [{ data: Buffer.from('not a font at all'), sha256: 'x', family: 'F', weight: 400 }] }) }, 1, 'brand-heading'), (e) => e.status === 409 && /could not be read/.test(e.message));

  // ---- the routes ----
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); });
  app.use('/api/graphics', compose);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/graphics`;
  const post = async (route, body, user = 1) => {
    const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': String(user) }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const photo = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#203040' } }).png().toBuffer();
    const imageDataUrl = dataUrl(photo, 'image/png');
    const req = { imageDataUrl, text: 'Brand Headline goes here', fontSize: 60, color: '#d4af37', position: 'center' };

    const std = await post('/text', req);
    const brand = await post('/text', { ...req, fontSource: 'brand-heading' });
    assert.strictEqual(std.status, 200);
    assert.strictEqual(brand.status, 200, JSON.stringify(brand.body));
    assert.strictEqual(brand.body.width, 800);
    assert.strictEqual(brand.body.height, 500);
    const a = await pixels(std.body.imageDataUrl);
    const b = await pixels(brand.body.imageDataUrl);
    assert.notStrictEqual(sha(a.data), sha(b.data), 'the brand font draws differently from Arial');
    const base0 = await sharp(photo).raw().toBuffer();
    assert.notStrictEqual(sha(b.data), sha(base0), 'and it really drew something');
    // a gold-ish pixel exists in the output: the text colour was used for the outlines
    let gold = 0;
    for (let i = 0; i < b.data.length; i += b.info.channels) if (b.data[i] > 180 && b.data[i + 1] > 140 && b.data[i + 2] < 100) gold++;
    assert.ok(gold > 300, `the brand text is in the chosen colour (${gold} pixels)`);

    // the same request twice gives the same picture (no hidden state)
    const again = await post('/text', { ...req, fontSource: 'brand-heading' });
    assert.strictEqual(sha((await pixels(again.body.imageDataUrl)).data), sha(b.data));

    // 'standard' or an unknown value is the old behaviour, exactly
    for (const fs2 of ['standard', 'arial', '', null]) {
      const r = await post('/text', { ...req, fontSource: fs2 });
      assert.strictEqual(sha((await pixels(r.body.imageDataUrl)).data), sha(a.data), `fontSource ${JSON.stringify(fs2)} is the standard font`);
    }

    // background pill, outline, alignments and wrapping all work with the brand font
    const rich = await post('/text', { ...req, fontSource: 'brand-heading', backgroundColor: '#000000', strokeColor: '#ffffff', strokeWidth: 3, align: 'left', maxWidth: 30, position: 'top-left' });
    assert.strictEqual(rich.status, 200, JSON.stringify(rich.body));
    const narrow = await pixels(rich.body.imageDataUrl);
    const wide = await pixels((await post('/text', { ...req, fontSource: 'brand-heading', backgroundColor: '#000000', align: 'left', maxWidth: 100, position: 'top-left' })).body.imageDataUrl);
    // the black box is the overlay's background: its size shows how the text wrapped
    const box = (p) => {
      let x0 = 1e9; let y0 = 1e9; let x1 = -1; let y1 = -1;
      for (let y = 0; y < p.info.height; y += 1) {
        for (let x = 0; x < p.info.width; x += 1) {
          const i = (y * p.info.width + x) * p.info.channels;
          if (p.data[i] < 8 && p.data[i + 1] < 8 && p.data[i + 2] < 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        }
      }
      return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const nb = box(narrow);
    const wb = box(wide);
    assert.ok(nb.h > wb.h * 1.5, `a narrow box wraps onto more lines, so it is taller (${nb.h} against ${wb.h})`);
    assert.ok(nb.w < wb.w, `and narrower (${nb.w} against ${wb.w})`);
    assert.ok(nb.w <= 800 * 0.3 + Math.ceil(60 * 0.4) * 2 + 2, 'the narrow box stays within the chosen width plus padding');

    // asking for a brand font that is not saved is refused in plain words, never drawn in another font
    const noBody = await post('/text', { ...req, fontSource: 'brand-body' });
    assert.strictEqual(noBody.status, 409);
    assert.match(noBody.body.error, /No brand body font is saved/);
    const other = await post('/text', { ...req, fontSource: 'brand-heading' }, 2);
    assert.strictEqual(other.status, 409, "another person's font is not used");

    // Composite: a brand-font text layer between other layers, with opacity
    const comp = await post('/composite', { imageDataUrl, overlays: [
      { type: 'text', text: 'Layer one', fontSize: 50, color: '#ffffff', position: 'top', fontSource: 'brand-heading', opacity: 0.5 },
      { type: 'text', text: 'Layer two', fontSize: 50, color: '#ffffff', position: 'bottom' },
    ] });
    assert.strictEqual(comp.status, 200, JSON.stringify(comp.body));
    assert.strictEqual(comp.body.overlays, 2);
    const noFontComposite = await post('/composite', { imageDataUrl, overlays: [{ type: 'text', text: 'x', fontSource: 'brand-body' }] });
    assert.strictEqual(noFontComposite.status, 409);
    const otherComposite = await post('/composite', { imageDataUrl, overlays: [{ type: 'text', text: 'x', fontSource: 'brand-heading' }] }, 2);
    assert.strictEqual(otherComposite.status, 409);

    // ---- Watermark (text mode) and Batch Text ----
    const wmReq = { imageDataUrl, type: 'text', text: 'Brand Watermark', color: '#ffffff', fontSize: 48, opacity: 0.9, position: 'center' };
    const wmStd = await post('/watermark', wmReq);
    const wmBrand = await post('/watermark', { ...wmReq, fontSource: 'brand-heading' });
    assert.strictEqual(wmStd.status, 200);
    assert.strictEqual(wmBrand.status, 200, JSON.stringify(wmBrand.body));
    const w1 = await pixels(wmStd.body.imageDataUrl);
    const w2 = await pixels(wmBrand.body.imageDataUrl);
    assert.notStrictEqual(sha(w1.data), sha(w2.data), 'the watermark is drawn in the brand font');
    assert.notStrictEqual(sha(w2.data), sha(base0), 'and it really drew something');
    for (const fs2 of ['standard', 'arial', '', null]) {
      const r = await post('/watermark', { ...wmReq, fontSource: fs2 });
      assert.strictEqual(sha((await pixels(r.body.imageDataUrl)).data), sha(w1.data), `watermark fontSource ${JSON.stringify(fs2)} is the standard font`);
    }
    const wmTiled = await post('/watermark', { ...wmReq, fontSource: 'brand-heading', tile: true });
    assert.strictEqual(wmTiled.status, 200, 'a tiled brand-font watermark works');
    assert.strictEqual((await post('/watermark', { ...wmReq, fontSource: 'brand-body' })).status, 409);
    assert.strictEqual((await post('/watermark', { ...wmReq, fontSource: 'brand-heading' }, 2)).status, 409, "another person's font is not used");
    // image watermarks have no font: the setting is ignored, not an error
    const logo = await sharp({ create: { width: 60, height: 30, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const imgWm = await post('/watermark', { imageDataUrl, type: 'image', watermarkDataUrl: dataUrl(logo, 'image/png'), fontSource: 'brand-heading' });
    assert.strictEqual(imgWm.status, 200);

    const photo2 = dataUrl(await sharp({ create: { width: 600, height: 400, channels: 3, background: '#405060' } }).png().toBuffer(), 'image/png');
    const btReq = { images: [{ imageDataUrl, name: 'one.png' }, { imageDataUrl: photo2, name: 'two.png' }], text: '{filename} {index}/{n}', color: '#ffffff', fontSize: 40, background: '#000000', position: 'south' };
    const btStd = await post('/batch-text', btReq);
    const btBrand = await post('/batch-text', { ...btReq, fontSource: 'brand-heading' });
    assert.strictEqual(btStd.status, 200);
    assert.strictEqual(btBrand.status, 200, JSON.stringify(btBrand.body));
    assert.strictEqual(btBrand.body.count, 2);
    assert.ok(btBrand.body.results.every((r) => r.imageDataUrl && !r.error), 'every picture of the batch came back');
    assert.strictEqual(btBrand.body.results[0].label, 'one 1/2', 'the template still works');
    const bt1 = await pixels(btStd.body.results[0].imageDataUrl);
    const bt2 = await pixels(btBrand.body.results[0].imageDataUrl);
    assert.notStrictEqual(sha(bt1.data), sha(bt2.data), 'the batch captions are drawn in the brand font');
    for (const fs2 of ['standard', 'arial', '', null]) {
      const r = await post('/batch-text', { ...btReq, fontSource: fs2 });
      assert.strictEqual(sha((await pixels(r.body.results[0].imageDataUrl)).data), sha(bt1.data), `batch text fontSource ${JSON.stringify(fs2)} is the standard font`);
    }
    const btNo = await post('/batch-text', { ...btReq, fontSource: 'brand-body' });
    assert.strictEqual(btNo.status, 409, 'a missing brand font refuses the whole batch in plain words');
    assert.match(btNo.body.error, /No brand body font is saved/);
    assert.strictEqual((await post('/batch-text', { ...btReq, fontSource: 'brand-heading' }, 2)).status, 409);

    console.log('brandText tests: ok');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
