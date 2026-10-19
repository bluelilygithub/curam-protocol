'use strict';

// node server/services/restyle/restyleScrape.test.js   (npm run test:restyle-scrape). "Download a page's CSS": the style files a page
// depends on, in order, with imports and made-complete addresses, and the summary of the settings they set. No network, no browser.

const assert = require('assert');
const { summariseCss } = require('./cssSettings');
const { scrapePageCss } = require('./scrapeCss');

(async () => {
  // ---- the summary ----
  const css = `
    :root { --brand: #CC785C; --gap: 8px; --unused: 1px; }
    body { font-family: 'Inter', sans-serif; font-size: 16px; color: #333; background: #FFF; line-height: 1.5; }
    h1 { font-size: 32px; font-weight: 700; color: var(--brand); }
    .a, .b { color: #333; background-color: RGBA(0, 0, 0, 0.5); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.2); padding: 8px 16px; margin: 0 0 8px; }
    .c { font-family: 'Inter', sans-serif; border-radius: 8px; gap: var(--gap); padding: 16px; font-size: 14px; border: 1px solid #fff; }
    @media (max-width: 768px) { .a { font-size: 14px; } }
    @media (min-width: 1024px) and (max-width: 1200px) { .a { color: hsl(10, 50%, 40%); } }
    @media print { .a { display: none; } }
    @font-face { font-family: "Brand Sans"; font-weight: 400; src: url(/fonts/b.woff2) format("woff2"), url(data:font/woff2;base64,AAAA); }
    @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
    @import url("more.css");
    h2 { margin: var(--gap) 0; color: var(--brand); padding: calc(var(--gap) * 2); }
  `;
  const s = summariseCss([css, 'this is { not valid css', '']);
  const count = (list, value) => (list.find((x) => x.value === value) || {}).count;
  assert.strictEqual(count(s.colors, '#333'), 2, 'a colour used twice is counted twice');
  assert.strictEqual(count(s.colors, '#fff'), 2, 'colours are lower-cased: #FFF and #fff are one');
  assert.strictEqual(count(s.colors, 'rgba(0,0,0,0.5)'), 1, 'colour functions are normalised (case and spaces)');
  assert.ok(s.colors.some((c) => c.value === 'hsl(10,50%,40%)'));
  assert.ok(!s.colors.some((c) => /^#cc785c$/i.test(c.value)), 'a variable declaration is not counted as a use of its colour');
  assert.strictEqual(s.colors[0].count >= s.colors[s.colors.length - 1].count, true, 'most used first');
  assert.strictEqual(count(s.fontFamilies, "'Inter', sans-serif"), 2);
  assert.deepStrictEqual(s.fontSizes.map((f) => f.value), ['14px', '14px', '16px', '32px'].filter((v, i, a) => a.indexOf(v) === i), 'sizes sorted smallest first');
  assert.strictEqual(count(s.fontSizes, '14px'), 2);
  assert.strictEqual(count(s.fontWeights, '700'), 1);
  assert.strictEqual(count(s.lineHeights, '1.5'), 1);
  assert.strictEqual(count(s.radii, '8px'), 2);
  assert.strictEqual(s.shadows.length, 1);
  assert.ok(s.spacing.some((x) => x.value === '8px' && x.count >= 2), 'spacing values are counted');
  assert.ok(!s.spacing.some((x) => parseFloat(x.value) === 0), 'zero is not a spacing value');
  const brand = s.variables.find((v) => v.name === '--brand');
  assert.strictEqual(brand.value, '#CC785C');
  assert.strictEqual(brand.uses, 2, 'a variable counts the places that use it');
  assert.strictEqual(s.variables.find((v) => v.name === '--unused').uses, 0);
  assert.strictEqual(s.variables[0].name, '--gap', 'most used variable first (3 uses against 2)');
  assert.strictEqual(s.variables[0].uses, 3);
  assert.deepStrictEqual(s.breakpoints.map((b) => b.value), ['max-width: 768px', 'min-width: 1024px', 'max-width: 1200px'], 'breakpoints in order, print ignored');
  assert.deepStrictEqual(s.fontFaces, [{ family: 'Brand Sans', weight: '400', style: '', sources: ['/fonts/b.woff2'] }], 'font files listed, data: fonts left out');
  assert.deepStrictEqual(s.keyframes.map((k) => k.value), ['pulse']);
  assert.deepStrictEqual(s.imports, ['more.css']);
  assert.strictEqual(s.stats.files, 3);
  assert.strictEqual(s.stats.unreadable, 1, 'a file that cannot be read is counted, not fatal');
  assert.ok(s.stats.rules >= 8 && s.stats.declarations >= 20);
  assert.deepStrictEqual(summariseCss([]).colors, []);
  assert.doesNotThrow(() => summariseCss(undefined));

  // ---- the scrape ----
  const pages = {
    'https://example.com/shop/': `<html><head><title> The Shop </title>
      <link rel="stylesheet" href="/css/main.css"><style>.inline { color: #123456; background: url(img/i.png) }</style>
      <link rel="stylesheet" href="theme.css" media="print"><link rel="stylesheet" href="https://cdn.example.net/missing.css">
      <link rel="stylesheet" href="/css/huge.css"><style>.second { color: #654321 }</style><link rel="icon" href="/x.ico"></head><body>Hi</body></html>`,
    'https://example.com/css/main.css': '@import "base.css";\n@import url(deep/one.css);\n.hero { background: url(../img/hero.jpg); color: #cc785c }',
    'https://example.com/css/base.css': 'body { margin: 0; font-family: Georgia, serif }',
    'https://example.com/css/deep/one.css': '@import "two.css";\n.one { color: red }',
    'https://example.com/css/deep/two.css': '@import "three.css";\n.two { color: blue }',
    'https://example.com/css/deep/three.css': '.three { color: green }',
    'https://example.com/shop/theme.css': '.print-only { display: none }',
    'https://example.com/css/huge.css': 'a{}'.repeat(600000),
  };
  const fetched = [];
  const fakeFetch = async (u) => {
    fetched.push(u);
    if (pages[u] === undefined) throw new Error('Server returned 404');
    return { body: pages[u], statusCode: 200 };
  };
  const out = await scrapePageCss('https://example.com/shop/', {}, { fetchHtml: fakeFetch });
  assert.strictEqual(out.title, 'The Shop');
  assert.strictEqual(out.rendered, false);
  assert.deepStrictEqual(out.files.map((f) => f.filename), [
    'base.css', 'two.css', 'one.css', 'main.css', 'Styles inside the page', 'theme.css', 'Styles inside the page (2)',
  ], 'files in page order, each imported file standing just before the file that imports it');
  const byName = Object.fromEntries(out.files.map((f) => [f.filename, f]));
  assert.strictEqual(byName['base.css'].source, 'imported');
  assert.strictEqual(byName['base.css'].importedBy, 'main.css');
  assert.strictEqual(byName['main.css'].source, 'linked');
  assert.strictEqual(byName['Styles inside the page'].source, 'embedded');
  assert.strictEqual(byName['theme.css'].media, 'print', 'the media a file is for is kept');
  assert.match(byName['main.css'].css, /url\(https:\/\/example\.com\/img\/hero\.jpg\)/, 'addresses inside a file are made complete');
  assert.match(byName['main.css'].css, /\/\* @import "https:\/\/example\.com\/css\/base\.css"|\/\* @import "base\.css"/, 'a fetched @import becomes a note, since the file is included above');
  assert.match(byName['Styles inside the page'].css, /url\(https:\/\/example\.com\/shop\/img\/i\.png\)/, 'addresses in the page\'s own styles are made complete too');
  assert.ok(!fetched.includes('https://example.com/css/deep/three.css'), 'imports are followed two levels, not further');
  assert.ok(out.files.some((f) => f.filename === 'one.css' && f.importedBy === 'main.css'), 'a second import is followed');
  assert.ok(out.files.some((f) => f.filename === 'two.css' && f.importedBy === 'one.css'), 'an import of an import is followed');
  assert.ok(!out.files.some((f) => f.filename === 'huge.css'), 'a file over the size cap is left out');
  assert.ok(out.flags.some((f) => /1 style file could not be fetched/.test(f)), 'a failed fetch is reported');
  assert.ok(out.flags.some((f) => /left out for being too large/.test(f)), 'an over-size file is reported');
  assert.ok(out.flags.some((f) => /imports more files than are followed/.test(f)), 'the import depth limit is reported');
  assert.ok(out.files.every((f) => typeof f.bytes === 'number' && f.bytes > 0));
  assert.ok(out.summary.colors.some((c) => c.value === '#cc785c'), 'the summary covers the fetched files');
  assert.ok(out.summary.colors.some((c) => c.value === '#654321'), 'and the page\'s own styles');
  assert.strictEqual(out.summary.stats.files, out.files.length);

  // a page with nothing to find says so
  const bare = await scrapePageCss('https://example.com/bare', {}, { fetchHtml: async () => ({ body: '<html><body>Hi</body></html>', statusCode: 200 }) });
  assert.strictEqual(bare.files.length, 0);
  assert.ok(bare.flags.some((f) => /No style files were found/.test(f)));
  // the browser option is used when asked, the plain fetch is not
  const viaBrowser = await scrapePageCss('https://app.example.com/', { render: true }, {
    fetchHtml: async (u) => ({ body: u.endsWith('a.css') ? '.x{color:red}' : '', statusCode: 200 }),
    render: async (u) => ({ html: '<html><head><link rel="stylesheet" href="/a.css"></head><body></body></html>', finalUrl: `${u}home/` }),
  });
  assert.strictEqual(viaBrowser.rendered, true);
  assert.strictEqual(viaBrowser.finalUrl, 'https://app.example.com/home/');
  assert.strictEqual(viaBrowser.files.length, 1);
  assert.ok(viaBrowser.flags.some((f) => /ran its scripts first/.test(f)));
  await assert.rejects(scrapePageCss('https://example.com/gone', {}, { fetchHtml: async () => ({ body: '', statusCode: 404 }) }), /Server returned 404/);
  await assert.rejects(scrapePageCss('not a url at all', {}, { fetchHtml: fakeFetch }), /Invalid URL|http/i);

  console.log('restyle scrape tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
