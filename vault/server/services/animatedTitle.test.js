'use strict';

// node server/services/animatedTitle.test.js
// Parts 1-3 need nothing. Part 4 renders a real video (needs Chromium from Playwright and ffmpeg; skipped with a note when ffmpeg is missing).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const svc = require('./animatedTitle');
const { frameTimes, RenderCancelled } = require('./htmlVideoRender');


(async () => {
  // ---- 1. what the person asked for is checked, in plain words ----
  assert.match(svc.normalizeSpec({ headline: '   ' }).error, /headline/i);
  assert.match(svc.normalizeSpec(null).error, /headline/i);
  const s = svc.normalizeSpec({ headline: '  Spring\n Collection  ', subline: 'x'.repeat(500), layout: 'nope', shape: '4:3', quality: 'huge', seconds: 99, fontSource: 'arial', background: 'red', text: '#FFFFFF' });
  assert.strictEqual(s.headline, 'Spring Collection');
  assert.strictEqual(s.subline.length, 120);
  assert.strictEqual(s.layout, 'rise');
  assert.strictEqual(s.shape, '16:9');
  assert.strictEqual(s.quality, 'hd');
  assert.strictEqual(s.seconds, svc.MAX_SEC, 'length is capped');
  assert.strictEqual(s.fontSource, 'standard', 'an unknown font choice is the standard font');
  assert.strictEqual(s.background, svc.DEFAULTS.background, 'a bad colour falls back');
  assert.strictEqual(s.text, '#ffffff');
  assert.strictEqual(svc.normalizeSpec({ headline: 'a', seconds: 0 }).seconds, svc.MIN_SEC);
  assert.strictEqual(svc.normalizeSpec({ headline: 'a', seconds: 'x' }).seconds, 5);
  assert.strictEqual(svc.normalizeSpec({ headline: 'a', useBrandColours: 'yes' }).useBrandColours, false, 'only a real true counts');
  assert.deepStrictEqual(svc.sizeFor('16:9', 'hd'), { width: 1280, height: 720 });
  assert.deepStrictEqual(svc.sizeFor('9:16', 'full'), { width: 1080, height: 1920 });
  assert.deepStrictEqual(svc.sizeFor('1:1', 'hd'), { width: 720, height: 720 });
  assert.strictEqual(frameTimes(2).length, 60);
  assert.strictEqual(frameTimes(0.01).length, 1);

  // ---- 2. the page is built from escaped text and contains no address ----
  const spec = svc.normalizeSpec({ headline: '<img src=x onerror=alert(1)> & "q"', subline: '</script><script>bad()</script>', layout: 'centre' });
  const html = svc.buildHtml(spec, svc.sizeFor(spec.shape, spec.quality), { background: '#112233', text: '#ffffff', accent: '#f4c9a8' });
  assert.ok(!/<img src=x/.test(html) && html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;'), 'the headline is escaped');
  assert.ok(!/<\/script><script>bad/.test(html), 'the supporting line cannot close the script');
  assert.ok(!/https?:\/\//i.test(html), 'no web address in the page');
  assert.ok(!html.includes('id="l"'), 'no logo unless asked');
  const withAssets = svc.buildHtml(spec, svc.sizeFor('16:9', 'hd'), { background: '#112233', text: '#fff000', accent: '#f4c9a8' }, { fontDataUrl: 'data:font/ttf;base64,AAAA', fontFormat: 'truetype', fontFamily: 'BrandTitleab12cd34', logoDataUrl: 'data:image/png;base64,AAAA' });
  assert.ok(withAssets.includes("@font-face{font-family:'BrandTitleab12cd34'") && withAssets.includes('id="l"'));
  assert.ok(!svc.buildHtml(svc.normalizeSpec({ headline: 'Only a headline' }), svc.sizeFor('16:9', 'hd'), { background: '#000000', text: '#ffffff', accent: '#ffffff' }).includes('id="s"'), 'no supporting line, no rule');

  // ---- 3. the Brand Kit is read on the server, for this person only; a missing part is a plain 409 ----
  const kit = { roles: { primary: '#9B5B46', onPrimary: '#FFFFFF', accent: '#E8C07D', background: '#faf7f2' }, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
  const bytes = Buffer.from([0, 1, 0, 0, 1, 2, 3]);
  const db = {
    async query(sql, params) {
      const uid = params[0];
      if (/FROM settings/.test(sql)) return { rows: uid === 1 ? [{ value: JSON.stringify(kit) }] : [] };
      if (/SELECT role, family, weight, "renderFamily", ext, bytes, sha256, data FROM graphics_brand_fonts/.test(sql)) {
        return { rows: uid === 1 && params[1] === 'heading' ? [{ role: 'heading', family: 'F', weight: 400, renderFamily: 'F', ext: 'ttf', bytes: 7, sha256: 'abcdef0123456789', data: bytes }] : [] };
      }
      if (/FROM graphics_brand_fonts/.test(sql)) return { rows: uid === 1 ? [{ role: 'heading' }] : [] };
      return { rows: [] };
    },
  };
  const offer = await svc.brandOffer(db, 1);
  assert.deepStrictEqual(offer, { hasColours: true, colours: { background: '#9B5B46', text: '#FFFFFF', accent: '#E8C07D' }, hasLogo: true, fonts: { heading: true, body: false } });
  assert.deepStrictEqual(await svc.brandOffer(db, 2), { hasColours: false, colours: null, hasLogo: false, fonts: { heading: false, body: false } });
  const b = await svc.loadBrand(db, 1, svc.normalizeSpec({ headline: 'a', useBrandColours: true, useLogo: true, fontSource: 'brand-heading' }));
  assert.strictEqual(b.colours.background, '#9b5b46');
  assert.ok(b.logoDataUrl.startsWith('data:image/png'));
  assert.strictEqual(b.font.fontFamily, 'BrandTitleabcdef01');
  assert.strictEqual(b.font.fontDataUrl, `data:font/ttf;base64,${bytes.toString('base64')}`);
  const plain = await svc.loadBrand(db, 2, svc.normalizeSpec({ headline: 'a' }));
  assert.deepStrictEqual(plain, { colours: null, logoDataUrl: null, font: null }, 'nothing is read when nothing is asked for');
  for (const [ask, re] of [[{ useBrandColours: true }, /no colours/i], [{ useLogo: true }, /no logo/i], [{ fontSource: 'brand-heading' }, /No brand heading font/]]) {
    await assert.rejects(() => svc.loadBrand(db, 2, svc.normalizeSpec({ headline: 'a', ...ask })), (e) => e.status === 409 && re.test(e.message), 'another person gets no Brand Kit');
  }
  await assert.rejects(() => svc.loadBrand(db, 1, svc.normalizeSpec({ headline: 'a', fontSource: 'brand-body' })), (e) => e.status === 409 && /No brand body font/.test(e.message));

  // ---- 4. a real render ----
  const ffmpeg = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
  const ok = await new Promise((r) => execFile(ffmpeg, ['-version'], (e) => r(!e)));
  if (!ok) {
    console.log('animatedTitle tests: parts 1-3 ok; part 4 (real render) skipped, ffmpeg not found');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animtitle-'));
  try {
    const out = path.join(dir, 'a.mp4');
    const t0 = Date.now();
    const r = await svc.makeAnimatedTitle({ spec: svc.normalizeSpec({ headline: 'Spring Collection', subline: 'Margot Cairnes Interiors', seconds: 2 }), brand: { colours: null, logoDataUrl: null, font: null }, outPath: out });
    assert.strictEqual(r.frames, 60);
    const probe = await new Promise((res, rej) => execFile(ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames,codec_name', '-of', 'default=nw=1', out], (e, o) => (e ? rej(e) : res(o))));
    assert.match(probe, /width=1280/); assert.match(probe, /height=720/); assert.match(probe, /codec_name=h264/); assert.match(probe, /nb_frames=60/);
    assert.ok(fs.statSync(out).size > 5000, 'the file has content');
    // the picture really changes over time (not 60 identical frames)
    const frameAt = (t) => new Promise((res, rej) => execFile(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-vf', 'scale=160:90', '-'], { encoding: 'buffer', maxBuffer: 1 << 22 }, (e, o) => (e ? rej(e) : res(o))));
    const early = await frameAt(0.05); const late = await frameAt(1.6);
    assert.ok(Buffer.compare(early, late) !== 0, 'the title animates');
    console.log(`  rendered 2 s at 720p in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // cancel in the middle: stops quickly, says cancelled, leaves no file claim
    const ac = new AbortController();
    const out2 = path.join(dir, 'b.mp4');
    setTimeout(() => ac.abort(), 1500);
    const t1 = Date.now();
    await assert.rejects(() => svc.makeAnimatedTitle({ spec: svc.normalizeSpec({ headline: 'Cancel me', seconds: 8 }), brand: { colours: null, logoDataUrl: null, font: null }, outPath: out2, signal: ac.signal }), (e) => e instanceof RenderCancelled && e.cancelled === true);
    assert.ok(Date.now() - t1 < 6000, 'a cancelled render stops quickly');
    // already cancelled before it starts
    const ac2 = new AbortController(); ac2.abort();
    await assert.rejects(() => svc.makeAnimatedTitle({ spec: svc.normalizeSpec({ headline: 'x' }), brand: { colours: null, logoDataUrl: null, font: null }, outPath: path.join(dir, 'c.mp4'), signal: ac2.signal }), (e) => e.cancelled === true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('animatedTitle tests: all ok');
})().catch((e) => { console.error(e); process.exit(1); });
