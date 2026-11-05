'use strict';

// node server/services/webExtractorPalette.test.js   (colour palette tool of the Web Extractor). No network: a fake fetcher serves pages and
// style files, and the real style reader (restyle/scrapeCss.js) runs on them.

const assert = require('assert');
const { buildPalette, parseColour, collectColours, readHtmlColours, pickPages, rgbToHsl, isNeutral } = require('./webExtractorPalette');
const { runExtraction } = require('./webExtractorService');

// ---- one colour, whatever its spelling ----
assert.deepStrictEqual(parseColour('#FFF'), { hex: '#ffffff', alpha: 1 });
assert.deepStrictEqual(parseColour('#9B5B46'), { hex: '#9b5b46', alpha: 1 });
assert.deepStrictEqual(parseColour('#9b5b4680').hex, '#9b5b46');
assert.ok(Math.abs(parseColour('#9b5b4680').alpha - 0.5) < 0.01);
assert.deepStrictEqual(parseColour('#f008'), { hex: '#ff0000', alpha: 0x88 / 255 });
assert.deepStrictEqual(parseColour('rgb(155, 91, 70)'), { hex: '#9b5b46', alpha: 1 });
assert.deepStrictEqual(parseColour('rgb(155 91 70 / 50%)'), { hex: '#9b5b46', alpha: 0.5 });
assert.deepStrictEqual(parseColour('rgba(0,0,0,.25)'), { hex: '#000000', alpha: 0.25 });
assert.deepStrictEqual(parseColour('rgb(100%, 0%, 0%)'), { hex: '#ff0000', alpha: 1 });
assert.strictEqual(parseColour('hsl(0, 100%, 50%)').hex, '#ff0000');
assert.strictEqual(parseColour('hsl(120deg 100% 25%)').hex, '#008000');
assert.strictEqual(parseColour('hsla(240, 100%, 50%, 0.4)').alpha, 0.4);
assert.strictEqual(parseColour('white').hex, '#ffffff');
for (const bad of ['', 'transparent', 'currentColor', 'var(--x)', '#12', '#12345', 'rgb(1,2)', 'notacolour', null]) assert.strictEqual(parseColour(bad), null, `${bad} is not a colour`);
assert.deepStrictEqual(rgbToHsl(255, 0, 0), [0, 100, 50]);
assert.ok(isNeutral(rgbToHsl(128, 128, 128)) && isNeutral(rgbToHsl(255, 255, 255)) && isNeutral(rgbToHsl(5, 5, 5)) && !isNeutral(rgbToHsl(155, 91, 70)));
assert.ok(isNeutral(rgbToHsl(232, 230, 220)) && isNeutral(rgbToHsl(20, 20, 19)), 'a pale cream and a warm near-black are neutrals');
assert.ok(!isNeutral(rgbToHsl(217, 119, 87)) && !isNeutral(rgbToHsl(144, 195, 246)), 'a vivid orange and a light blue are colours');

// ---- counting colours, with their role, from CSS ----
{
  const css = `
    :root { --primary: #9B5B46; --bg: #fff; }
    body { color: #222; background: var(--bg); }
    a { color: var(--primary); border-bottom: 1px solid #9b5b46; }
    .btn { background: rgb(155, 91, 70); border-color: rgba(0,0,0,0); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
    .hero { background: linear-gradient(#111, #fff); background-image: url(foo.svg#abc); }
    .x { fill: white; font-family: black, serif; content: "#fed"; }
  `;
  const { map, uses } = collectColours([css]);
  const brand = map.get('#9b5b46');
  assert.strictEqual(brand.count, 3, 'the variable once, the border once, the button once (spelled three ways, one colour)');
  assert.deepStrictEqual(brand.roles, { background: 1, text: 0, border: 1, other: 0 });
  assert.deepStrictEqual([...brand.variables], ['--primary']);
  assert.strictEqual(uses.get('--primary'), 1, 'a variable is counted where it is used');
  assert.strictEqual(map.get('#222222').roles.text, 1);
  assert.ok(!map.has('#000000') || map.get('#000000').count === 1, 'transparent black is ignored; only the shadow counts');
  assert.strictEqual(map.get('#000000').roles.other, 1, 'a shadow colour is "other"');
  assert.strictEqual(map.get('#000000').semiTransparent, true);
  assert.ok(map.has('#111111') && map.has('#ffffff'), 'gradient stops are read');
  assert.ok(!map.has('#abcdef') && !map.has('#aabbcc'), 'a url() fragment is not a colour');
  assert.ok(!map.has('#ffeedd'), 'text in content: is not a colour');
  assert.strictEqual(map.get('#ffffff').roles.other >= 1, true, 'fill: white is read, font-family: black is not');
  assert.ok(!(map.get('#000000').roles.text), 'font-family: black is not a colour');
}
assert.doesNotThrow(() => collectColours(['this is { not css', '']), 'broken CSS is skipped, never thrown');

// ---- colours held in CSS variables count for what the variable is USED for, also through a variable that points at another ----
{
  const { summarise } = require('./webExtractorPalette');
  const css = `
    :root { --cream: #faf9f5; --ink: #141413; --orange: #d97757; --surface: var(--cream); --fg: var(--ink); }
    body { background: var(--surface); color: var(--fg); }
    .card { background: var(--surface); border: 1px solid var(--ink); }
    .btn { background: var(--orange); color: var(--cream); }
    a { color: var(--orange); }
    .utility { background: #808080; }
  `;
  const acc = collectColours([css]);
  const out = summarise(acc, '');
  const by = (hex) => out.colors.find((c) => c.hex === hex);
  assert.strictEqual(by('#faf9f5').roles.background, 2, 'the cream is the background of body and card, through --surface');
  assert.strictEqual(by('#faf9f5').roles.text, 1, 'and the text of the button');
  assert.strictEqual(by('#141413').roles.text, 1, 'the ink is the body text, through --fg');
  assert.strictEqual(by('#141413').roles.border, 1);
  assert.strictEqual(by('#d97757').roles.background, 1);
  assert.strictEqual(out.suggested.background, '#faf9f5', 'a rarely used literal grey does not beat the variable-held page background');
  assert.strictEqual(out.suggested.text, '#141413');
  assert.strictEqual(out.suggested.primary, '#d97757', 'the vivid orange is the primary');
  assert.strictEqual(out.suggested.accent, null, 'no second vivid hue, so no accent');
  assert.ok(by('#faf9f5').variables.includes('--cream'));
}
// a vivid colour beats a pale one for primary, and a link colour is not the text colour when a neutral one exists
{
  const { summarise } = require('./webExtractorPalette');
  const out = summarise(collectColours(['a{color:#0a58ca} .a{background:#e8e6dc} .b{background:#e8e6dc} .c{background:#e8e6dc} p{color:#333} .t{background:#2e8b57}']), '');
  assert.strictEqual(out.suggested.primary, '#0a58ca', 'vivid blue, not the more used pale cream');
  assert.strictEqual(out.suggested.accent, '#2e8b57', 'a clearly different hue');
  assert.strictEqual(out.suggested.text, '#333333', 'plain dark text, not the link blue');
}

// ---- HTML: style attributes and the theme colour ----
{
  const r = readHtmlColours('<html><head><meta name="theme-color" content="#336699"></head><body><p style="color: #ff0000">x</p><p style="margin:0">y</p></body></html>', 'https://example.com/');
  assert.strictEqual(r.themeColor, '#336699');
  assert.strictEqual(r.styles.length, 2);
  const { map } = collectColours(r.styles);
  assert.strictEqual(map.get('#ff0000').roles.text, 1);
}

// ---- which other pages to read ----
{
  const link = (href, type = 'internal') => ({ href, type, text: '' });
  const links = [
    link('https://example.com/'), link('https://example.com/about'), link('https://example.com/about/team'), link('https://example.com/shop/a'),
    link('https://example.com/shop/b'), link('https://example.com/files/brochure.pdf'), link('https://other.com/x', 'external'), link('mailto:a@b.c', 'email'),
    link('https://example.com/blog/one'), link('https://example.com/story'),
  ];
  const picked = pickPages(links, 'https://example.com/', 4);
  assert.deepStrictEqual(picked, ['https://example.com/about', 'https://example.com/shop/a', 'https://example.com/blog/one', 'https://example.com/story'], 'spread across sections, the page itself, files and other sites skipped');
  assert.deepStrictEqual(pickPages(links, 'https://example.com/', 0), []);
  assert.deepStrictEqual(pickPages([], 'https://example.com/', 3), []);
  assert.strictEqual(pickPages(links, 'https://example.com/about/', 99).includes('https://example.com/about'), false, 'the page being read is not read twice');
}

(async () => {
  const sheet = 'https://example.com/css/site.css';
  const calls = [];
  const pagesHtml = {
    'https://example.com/': `<html><head><title>Home</title><meta name="theme-color" content="#9b5b46"><link rel="stylesheet" href="/css/site.css"><style>.home{color:#111}</style></head>
      <body><a href="/about">About</a><a href="/shop/a">Shop</a><a href="/missing">Gone</a></body></html>`,
    'https://example.com/about': '<html><head><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/about.css"></head><body><p style="color:#00aa00">x</p></body></html>',
    'https://example.com/shop/a': '<html><head><link rel="stylesheet" href="/css/site.css"></head><body>x</body></html>',
  };
  const files = {
    [sheet]: ':root{--brand:#9B5B46} a{color:var(--brand)} .nav{background:#f4efe6} body{color:#222;background:#fff}',
    'https://example.com/css/about.css': '.about{background:#2a6f97;color:#fff}',
  };
  const fetcher = async (u, o) => {
    calls.push(u);
    if (o && o.asset) {
      if (files[u] == null) return { body: '', statusCode: 404, finalUrl: u };
      return { body: files[u], statusCode: 200, finalUrl: u };
    }
    if (pagesHtml[u] == null) return { body: '', statusCode: 404, finalUrl: u };
    return { body: pagesHtml[u], statusCode: 200, finalUrl: u };
  };

  // one page: its style file, its inline style, its theme colour
  const one = await buildPalette('https://example.com/', pagesHtml['https://example.com/'], { pages: 1 }, { fetcher });
  assert.strictEqual(one.pagesRead, 1);
  assert.strictEqual(one.themeColor, '#9b5b46');
  const brand = one.colors.find((c) => c.hex === '#9b5b46');
  assert.ok(brand && brand.kind === 'brand' && brand.variables.includes('--brand'), 'the brand colour is found, with its variable name');
  assert.strictEqual(one.suggested.primary, '#9b5b46');
  assert.strictEqual(one.suggested.background, '#f4efe6', 'the first background met is suggested (ties go to the colour found first)');
  assert.strictEqual(one.suggested.text, '#111111', 'a text colour is suggested');
  assert.ok(one.colors.every((c, i, a) => i === 0 || a[i - 1].count >= c.count), 'most used first');
  assert.ok(one.colors.every((c) => Math.abs(c.share) <= 100));
  assert.strictEqual(calls.filter((u) => u === 'https://example.com/').length, 0, 'the first page is not fetched again');
  assert.strictEqual(one.colors.some((c) => c.hex === '#2a6f97'), false, 'a colour only on another page is not counted when one page is read');

  // six pages (the page and its three links, one of them missing): each page fetched once, the shared style file counted once, the colour only on another page found
  calls.length = 0;
  const three = await buildPalette('https://example.com/', pagesHtml['https://example.com/'], { pages: 6 }, { fetcher });
  assert.strictEqual(three.pagesRead, 3, 'the page and two of its links that exist');
  assert.ok(three.colors.some((c) => c.hex === '#2a6f97'), 'a colour only on the About page is found');
  assert.ok(three.colors.some((c) => c.hex === '#00aa00'), 'a style="" colour on another page is found');
  assert.strictEqual(calls.filter((u) => u === sheet).length, 1, 'the shared style file is fetched once for all the pages');
  assert.ok(three.colors.find((c) => c.hex === '#9b5b46').count === one.colors.find((c) => c.hex === '#9b5b46').count, 'the shared style file is counted once, however many pages use it');
  assert.strictEqual(calls.filter((u) => u === 'https://example.com/about').length, 1, 'each extra page is fetched once');
  assert.deepStrictEqual(three.pages.filter((p) => !p.ok).map((p) => p.url), ['https://example.com/missing'], 'the missing page is listed');
  assert.match(three.notice, /1 of the other pages could not be read/, 'a missing page is reported, not hidden');

  // a page with nothing in it says why
  const empty = await buildPalette('https://example.com/x', '<html><body>hi</body></html>', {}, { fetcher: async () => ({ body: '', statusCode: 200, finalUrl: 'x' }) });
  assert.strictEqual(empty.colors.length, 0);
  assert.match(empty.notice, /JavaScript/);

  // through the same entry point as every other tool
  const viaRun = await runExtraction('https://example.com/', 'palette', [], { pages: 1 }, { fetcher });
  assert.strictEqual(viaRun.mode, 'palette');
  assert.ok(viaRun.colors.length > 3);

  // an unsupported number of pages falls back to one
  const odd = await buildPalette('https://example.com/', pagesHtml['https://example.com/'], { pages: 50 }, { fetcher });
  assert.strictEqual(odd.pages.length, 1);

  console.log('webExtractorPalette tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
