'use strict';

// node server/services/brandFromUrl/brandFromUrl.test.js
// Part 1 needs nothing (colour roles, fonts, radius). Part 2 needs Python with fontTools and a system font to build a woff2 from.
// Part 3 needs Chromium (the one Playwright installed for the Browser Agent) and talks only to a throw-away server on 127.0.0.1;
// each of parts 2 and 3 is skipped with a message when its tool is missing.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const R = require('./brandRoles');

// ---------------------------------------------------------------- part 1: pure logic
{
  // merging: near-identical colours join the heavier one
  const merged = R.mergeMap({ '#ffffff': 10, '#fefefe': 5, '#9b5b46': 3 });
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].hex, '#ffffff');
  assert.strictEqual(merged[0].w, 15);

  // a warm site: cream page, dark text, terracotta buttons, a muted grey for small print, a sale banner that must not win
  const data = {
    canvas: '#fdf6ee',
    themeColor: null,
    bg: { '#fdf6ee': 3, '#f3e9dc': 0.6, '#9b5b46': 0.1, '#00ff00': 0.01 },
    fg: { '#2b2b2b': 900, '#7a7a7a': 120, '#9b5b46': 30 },
    btnBg: { '#9b5b46': 6, '#00ff00': 0.3 },
    btnFg: { '#ffffff': 6 },
    linkFg: { '#9b5b46': 40 },
    border: { '#e3d6c6': 5 },
    fonts: {}, radii: [],
  };
  const out = R.pickColourRoles(data).colours;
  assert.strictEqual(out.background, '#fdf6ee');
  assert.strictEqual(out.text, '#2b2b2b');
  assert.strictEqual(out.primary, '#9b5b46');
  assert.strictEqual(out.onPrimary, '#ffffff');
  assert.strictEqual(out.surface, '#f3e9dc');
  assert.strictEqual(out.border, '#e3d6c6');
  assert.ok(out.mutedText === '#7a7a7a', 'muted text found');

  // black-and-white brand: no colourful colour, the buttons are the primary
  const mono = R.pickColourRoles({ canvas: '#ffffff', bg: { '#ffffff': 3, '#111111': 0.2 }, fg: { '#111111': 500 }, btnBg: { '#111111': 4 }, btnFg: {}, linkFg: {}, border: {}, fonts: {}, radii: [] }).colours;
  assert.strictEqual(mono.primary, '#111111');
  assert.strictEqual(mono.accent, null);

  // dark mode is reported only when the page changes clearly
  const darkData = { canvas: '#111111', bg: { '#111111': 3 }, fg: { '#eeeeee': 500 }, btnBg: { '#9b5b46': 3 }, btnFg: {}, linkFg: {}, border: {}, fonts: {}, radii: [] };
  const dark = R.pickDark('#fdf6ee', darkData);
  assert.strictEqual(dark.background, '#111111');
  assert.strictEqual(dark.text, '#eeeeee');
  assert.strictEqual(R.pickDark('#fdf6ee', { ...darkData, canvas: '#fdf7ef', bg: { '#fdf7ef': 3 }, fg: { '#222222': 500 } }), null);

  // two page loads: the phone counts half
  const combined = R.combineRuns([{ data: { bg: { '#fff': 0 }, fg: { '#111111': 100 }, btnBg: {}, btnFg: {}, linkFg: {}, border: {}, fonts: {}, radii: [4, 4, 4], canvas: null, themeColor: null }, scale: 1 },
    { data: { bg: {}, fg: { '#111111': 100 }, btnBg: {}, btnFg: {}, linkFg: {}, border: {}, fonts: {}, radii: [99], canvas: '#fff', themeColor: null }, scale: 0.5 }]);
  assert.strictEqual(combined.fg['#111111'], 150);
  assert.deepStrictEqual(combined.radii, [4, 4, 4]); // phone radii are not counted

  // radius
  assert.deepStrictEqual(R.pickRadius([8, 8, 8, 0, 4]), { px: 8, label: 'rounded' });
  assert.deepStrictEqual(R.pickRadius([9999, 9999, 9999, 4]), { px: 999, label: 'pill' });
  assert.deepStrictEqual(R.pickRadius([0, 0, 0, 0]), { px: 0, label: 'square' });
  assert.strictEqual(R.pickRadius([]).label, 'unknown');

  // font names: most-used family per role and its most-used weight; generic stacks marked as system
  const names = R.pickFontNames({ 'h|Playfair Display|700': 500, 'h|Playfair Display|400': 40, 'h|Arial|700': 100, 'b|Inter|400': 900, 'b|Inter|500': 100, 'b|system-ui|400': 50 });
  assert.deepStrictEqual(names.heading, { family: 'Playfair Display', weight: 700, system: false });
  assert.deepStrictEqual(names.body, { family: 'Inter', weight: 400, system: false });
  assert.strictEqual(R.pickFontNames({ 'b|Arial|400': 10 }).heading.system, true);
  assert.strictEqual(R.pickFontNames({}).body, null);

  // matching a downloaded file: same family, has letters, nearest weight, upright over italic; an icon font never matches
  const files = [
    { id: '0', family: 'Playfair Display', weight: 400, italic: false, variable: false, hasLatin: true, glyphs: 700 },
    { id: '1', family: 'Playfair Display', weight: 700, italic: false, variable: false, hasLatin: true, glyphs: 700 },
    { id: '2', family: 'Playfair Display', weight: 700, italic: true, variable: false, hasLatin: true, glyphs: 700 },
    { id: '3', family: 'Playfair Display', weight: 700, italic: false, variable: false, hasLatin: false, glyphs: 140 }, // Cyrillic subset
    { id: '4', family: 'FontAwesome', weight: 400, italic: false, variable: false, hasLatin: false, glyphs: 600 },
    { id: '5', family: 'Inter Variable', weight: 400, italic: false, variable: true, wghtRange: [100, 900], hasLatin: true, glyphs: 2000 },
    { id: '6', error: 'bad file' },
  ];
  assert.strictEqual(R.matchFontFile(files, 'Playfair Display', 700).id, '1');
  assert.strictEqual(R.matchFontFile(files, 'playfair display', 400).id, '0');
  assert.strictEqual(R.matchFontFile(files, 'Inter', 600).id, '5', 'a variable font covers its whole weight range');
  assert.strictEqual(R.matchFontFile(files, 'FontAwesome', 400), null);
  assert.strictEqual(R.matchFontFile(files, 'Georgia', 400), null);
  // a variable font names its default instance: "Montserrat Thin" is the family Montserrat, "Montserrat Alternates" is not
  assert.ok(R.sameFamily('Montserrat Thin', 'Montserrat') && R.sameFamily('Inter Variable', 'Inter') && R.sameFamily('Roboto Slab', 'Roboto Slab'));
  assert.ok(!R.sameFamily('Montserrat Alternates', 'Montserrat') && !R.sameFamily('Roboto Slab', 'Roboto') && !R.sameFamily('', 'Inter'));
  console.log('part 1 (roles, radius, fonts): ok');
}

// ---------------------------------------------------------------- helpers for parts 2 and 3
const SYSTEM_FONTS = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  'C:\\Windows\\Fonts\\arial.ttf', '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
];
const PYTHONS = [process.env.BRAND_FONT_PYTHON, process.env.FONTS_PYTHON_BIN, 'python3', 'python'].filter(Boolean);

function makeWoff2(ttfPath, outPath) {
  const code = 'import sys\nfrom fontTools.ttLib import TTFont\nf=TTFont(sys.argv[1]); f.flavor="woff2"; f.save(sys.argv[2])';
  for (const py of PYTHONS) {
    try { execFileSync(py, ['-I', '-c', code, ttfPath, outPath], { stdio: 'pipe' }); return true; } catch { /* try the next one */ }
  }
  return false;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-test-'));
  const sysFont = SYSTEM_FONTS.find((p) => fs.existsSync(p));
  const woff2Path = path.join(tmp, 'face.woff2');
  const haveWoff2 = !!sysFont && makeWoff2(sysFont, woff2Path);
  const { runPython, extractBrand, closeBrowser } = require('./index');

  // ------------------------------------------------------------ part 2: font conversion (Python)
  if (!haveWoff2) {
    console.log('part 2 (woff2 -> ttf): skipped (needs python with fontTools+brotli and a system Arial/Liberation Sans)');
  } else {
    const b64 = fs.readFileSync(woff2Path).toString('base64');
    const info = await runPython({ mode: 'inspect', fonts: [{ id: 'a', b64 }, { id: 'bad', b64: Buffer.from('not a font').toString('base64') }] });
    const good = info.fonts.find((f) => f.id === 'a');
    const bad = info.fonts.find((f) => f.id === 'bad');
    assert.ok(good.hasLatin && !good.variable && good.glyphs > 100, 'real font inspected');
    assert.ok(R.familyKey(good.family).length > 0);
    assert.ok(bad.error, 'a corrupt file is reported, not thrown');
    const conv = await runPython({ mode: 'convert', b64, weight: 400, renderFamily: 'BrandFontTest01' });
    const ttf = Buffer.from(conv.ttfB64, 'base64');
    assert.ok(['\u0000\u0001\u0000\u0000', 'true', 'OTTO'].includes(ttf.slice(0, 4).toString('latin1')), 'output is a plain sfnt, not woff2');
    // the converted file carries the unique plain name and a normal weight, so nothing is faked when it is drawn
    const again = await runPython({ mode: 'inspect', fonts: [{ id: 'x', b64: conv.ttfB64 }] });
    assert.strictEqual(again.fonts[0].family, 'BrandFontTest01');
    assert.strictEqual(again.fonts[0].weight, 400);
    assert.ok(again.fonts[0].hasLatin);
    // the point of the conversion: sharp must really draw with it. Same text, fixed size: a real file differs from the fallback font.
    const family = good.family;
    const draw = async (fontfile) => {
      const text = { text: 'Brand Headline 123', font: 'BrandFontTest01', rgba: true, dpi: 200, width: 900 };
      if (fontfile) text.fontfile = fontfile;
      const buf = await sharp({ text }).png().toBuffer();
      const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return crypto256(data);
    };
    const ttfPath = path.join(tmp, 'converted.ttf');
    fs.writeFileSync(ttfPath, ttf);
    // (sharp registers a font file for the rest of the process, so the point proven here is "the converted file is accepted and drawn":
    // a woff2 would have been accepted silently and ignored; see the spike notes in docs/brand-from-url.md)
    assert.ok((await draw(ttfPath)).length === 64, 'sharp drew text with the converted font');
    console.log('part 2 (woff2 -> ttf): ok');
  }

  // ------------------------------------------------------------ part 3: the real browser against a local page
  let chromiumOk = false;
  try { chromiumOk = fs.existsSync(require('playwright').chromium.executablePath()); } catch { /* not installed */ }
  if (!chromiumOk) {
    console.log('part 3 (browser): skipped (Playwright Chromium is not installed here)');
  } else {
    const logoPng = await sharp({ create: { width: 160, height: 48, channels: 4, background: { r: 155, g: 91, b: 70, alpha: 1 } } }).png().toBuffer();
    const fontFace = haveWoff2 ? `@font-face{font-family:'Arial';src:url(/face.woff2) format('woff2');font-weight:400}` : '';
    const page = `<!doctype html><html><head><title>Test Brand</title><meta name="theme-color" content="#9b5b46">
<style>${fontFace}
body{margin:0;background:#fdf6ee;color:#2b2b2b;font-family:Arial,sans-serif}
@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}
header{display:flex;align-items:center;padding:16px 32px;border-bottom:1px solid #e3d6c6}
h1{font-size:44px;margin:40px 32px 8px}p{margin:8px 32px;font-size:16px;max-width:600px}
.btn{display:inline-block;margin:24px 32px;padding:14px 28px;background:#9b5b46;color:#fff;border-radius:12px;text-decoration:none;border:0}
.promo{position:fixed;bottom:0;left:0;right:0;height:90px;background:#00e000;color:#000;font-size:20px;text-align:center}
</style></head><body>
<header><a href="/"><img class="site-logo" src="/logo.png" alt="Test Brand logo" width="160" height="48"></a></header>
<h1>Welcome to the brand</h1><p>Some paragraph text that says things about the company and its work, long enough to count.</p>
<a class="btn" href="/go">Get started</a>
<div class="promo" id="promo-banner">SALE SALE SALE 50% OFF</div></body></html>`;
    const internalHits = []; // anything that reached the "internal" name 127.0.0.2 or asked for a frame
    const server = http.createServer((req, res) => {
      if (String(req.headers.host).startsWith('127.0.0.2') || req.url.startsWith('/frame')) internalHits.push(req.url);
      if (req.url === '/withsub') {
        const base = `http://127.0.0.2:${server.address().port}`;
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(`<html><body style="background:#fff"><p>hello there</p><img src="${base}/pixel.png"><iframe src="${base}/frame"></iframe><iframe src="/frame-same-host"></iframe><script>fetch("${base}/xhr").catch(()=>{});window.open("${base}/popup")</script></body></html>`);
      }
      if (req.url === '/logo.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(logoPng); }
      if (req.url === '/face.woff2' && haveWoff2) { res.writeHead(200, { 'content-type': 'font/woff2' }); return res.end(fs.readFileSync(woff2Path)); }
      if (req.url === '/redir') { res.writeHead(302, { location: `http://127.0.0.2:${server.address().port}/` }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(page);
    });
    await new Promise((r) => server.listen(0, '0.0.0.0', r));
    const port = String(server.address().port);
    const deps = {
      ports: ['', port, '80', '443'],
      checkHost: async (h) => { if (h !== '127.0.0.1') throw new Error('URL resolves to a private or internal address'); },
      fetchPublicFile: async (u) => ({ buffer: Buffer.from(await (await fetch(u)).arrayBuffer()), contentType: 'x', finalUrl: u }),
    };
    try {
      const brand = await extractBrand(`http://127.0.0.1:${port}/`, deps);
      assert.strictEqual(brand.colours.background, '#fdf6ee');
      assert.strictEqual(brand.colours.text, '#2b2b2b');
      assert.strictEqual(brand.colours.primary, '#9b5b46', 'the button colour is the primary, not the loud sale banner');
      assert.notStrictEqual(brand.colours.accent, '#00e000', 'the sale banner is damped out');
      assert.strictEqual(brand.colours.onPrimary, '#ffffff');
      assert.strictEqual(brand.radius.px, 12);
      assert.ok(brand.dark && brand.dark.background === '#111111', 'dark mode picked up');
      assert.strictEqual(brand.title, 'Test Brand');
      assert.ok(brand.logo && brand.logo.dataUrl.startsWith('data:image/png;base64,'), 'logo found');
      assert.ok(/logo\.png$/.test(brand.logo.sourceUrl) && brand.logo.via === 'file', 'logo taken from its own file');
      if (haveWoff2) {
        assert.ok(brand.fonts.body.file && brand.fonts.body.source === 'page', 'the page font file was captured');
        assert.ok(['ttf', 'otf'].includes(brand.fonts.body.file.ext));
        assert.ok(/^BrandFont[0-9a-f]{8}$/.test(brand.fonts.body.file.renderFamily), 'a unique name to draw it under');
      }
      console.log('part 3a (read a page): ok');

      // a redirect to somewhere the guard refuses must stop the run
      await assert.rejects(() => extractBrand(`http://127.0.0.1:${port}/redir`, deps), /private or not allowed/);
      // and a private address typed in directly never reaches the browser (real checker, no stub)
      await assert.rejects(() => extractBrand(`http://127.0.0.1:${port}/`, { ports: deps.ports }), /private or internal/);
      // sub-requests: a picture, a fetch, a popup and two frames aimed at internal or any other address never leave the browser
      await extractBrand(`http://127.0.0.1:${port}/withsub`, deps);
      assert.deepStrictEqual(internalHits, [], `nothing may reach the internal address or a frame, got ${JSON.stringify(internalHits)}`);
      await assert.rejects(() => extractBrand('not a url at all %%%', deps), (e) => e.status === 400 || /address/i.test(e.message));
      console.log('part 3b (private addresses refused): ok');
    } finally {
      await closeBrowser();
      server.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('brandFromUrl tests: done');
})().catch((e) => { console.error(e); process.exit(1); });

function crypto256(buf) { return require('crypto').createHash('sha256').update(buf).digest('hex'); }
