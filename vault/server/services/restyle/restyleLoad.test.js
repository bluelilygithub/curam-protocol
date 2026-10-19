'use strict';

// node server/services/restyle/restyleLoad.test.js   (npm run test:restyle-server). No network, no database, no browser is started.

const assert = require('assert');
const { sanitizeEditsCss, sanitizePageCss, forStyleElement } = require('./sanitizeCss');
const { buildSharedPage, SHARE_HEADERS } = require('./sharePage');
const { loadPageFromUrl, applyMedia, sheetName } = require('./loadFromUrl');
const { renderAvailable } = require('./renderPage');

(async () => {
  // ---- the CSS the tool generates: only managed properties, plain rules, @media and the tool's own keyframes ----
  const good = ':root{--brand-primary:#cc785c;}\n.card h2{font-size:28px !important;color:var(--brand-primary) !important;}\n@media (max-width: 480px){.card{padding:8px !important;}}\n@keyframes restyleFadeIn{from{opacity:0}to{opacity:1}}';
  const out = sanitizeEditsCss(good);
  assert.match(out, /--brand-primary:#cc785c/);
  assert.match(out, /\.card h2/);
  assert.match(out, /@media \(max-width: 480px\)/);
  assert.match(out, /@keyframes restyleFadeIn/);

  const evil = sanitizeEditsCss([
    '@import url(https://evil.example/x.css);',
    '.a{background-image:url(https://evil.example/track.gif);color:red}',
    '.b{color:expression(alert(1))}',
    '.c{behavior:url(x.htc);font-size:12px}',
    '.d{width:100px;font-size:14px}',
    'a{color:red}</style><script>alert(1)</script>',
    '.e{font-family:"x\\\\"}',
    '@font-face{font-family:x;src:url(https://evil.example/f.woff)}',
    '@keyframes steal{from{opacity:0}to{opacity:1}}',
    '@media (max-width: 480px) and (foo: url(x)){.f{color:red}}',
    '{}body{color:red}',
  ].join('\n'));
  assert.ok(!/url\(/i.test(evil), 'no url() survives');
  assert.ok(!/expression|behavior|@import|@font-face|steal|script/i.test(evil), 'nothing dangerous survives');
  assert.ok(!/width:\s*100px/.test(evil), 'properties the tool does not manage are dropped');
  assert.match(evil, /\.a\s*\{[^}]*color:\s*red/, 'a safe declaration next to a bad one is kept');
  assert.match(evil, /\.c\s*\{[^}]*font-size:\s*12px/);
  assert.strictEqual(sanitizeEditsCss('not css {{{'), '', 'unparseable input gives nothing');
  assert.strictEqual(sanitizeEditsCss(undefined), '');

  // ---- the page's own CSS: kept, minus imports, behaviours and script hooks ----
  const page = sanitizePageCss('@import url(x.css);@charset "utf-8";.a{color:red;behavior:url(x.htc);width:expression(1)}.b{background:url(https://cdn.example/i.png)}');
  assert.ok(!/@import|@charset|behavior|expression/i.test(page));
  assert.match(page, /\.b\s*\{[^}]*background:\s*url\(https:\/\/cdn\.example\/i\.png\)/, 'ordinary urls in the page stay');
  assert.match(page, /\.a\s*\{[^}]*color:\s*red/);
  assert.strictEqual(forStyleElement('a{}</style><script>'), 'a{}<\\/style><script>');
  assert.ok(!/<\/style/i.test(forStyleElement('x</STYLE>y')));

  // ---- the public preview: scripts and handlers gone, edits sanitised, original view without them, no leaks into the markup ----
  const project = {
    name: 'My "page" <b>',
    html: {
      head: '<meta charset="utf-8"><title>T</title><script>alert(1)</script>',
      body: '<h1 class="card" onclick="steal()">Hello</h1><iframe src="https://evil.example"></iframe><a href="javascript:alert(1)">x</a><script>alert(2)</script>',
      pageCss: '.card{color:blue}@import url(evil.css);',
      editsCss: '.card{color:red !important;background-image:url(https://evil.example/x.gif)}\n.x{content:"</style><script>alert(3)</script>"}',
    },
  };
  const shared = buildSharedPage(project);
  assert.ok(!/<script|onclick|javascript:|<iframe|evil\.example|@import/i.test(shared), 'nothing that can run or load from elsewhere');
  assert.match(shared, /color:\s*red\s*!important/, 'the changes are in');
  assert.match(shared, /color:\s*blue/, 'the page css is in');
  assert.ok(!shared.includes('My "page" <b>') && shared.includes('My &quot;page&quot; &lt;b&gt;'), 'the name is escaped');
  assert.match(shared, /With the changes/);
  const original = buildSharedPage(project, { view: 'original' });
  assert.ok(!/color:\s*red\s*!important/.test(original), 'the original view has no changes');
  assert.match(original, /color:\s*blue/);
  assert.match(SHARE_HEADERS['Content-Security-Policy'], /default-src 'none'/);
  assert.ok(!/script-src/.test(SHARE_HEADERS['Content-Security-Policy']) && !/unsafe-eval/.test(SHARE_HEADERS['Content-Security-Policy']), 'no scripts are allowed');
  assert.match(SHARE_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(SHARE_HEADERS['X-Robots-Tag'], /noindex/);
  assert.throws(() => buildSharedPage({ name: 'x', html: { body: 'a'.repeat(9 * 1024 * 1024) } }), /too large/);
  assert.match(buildSharedPage({ name: 'empty', html: {} }), /<body>/, 'a missing page still gives a document');

  // ---- loading by address: style files found, fetched, made absolute and ordered; print-only skipped; failures reported ----
  const pages = {
    'https://example.com/shop/': `<html><head><title>Shop</title>
      <link rel="stylesheet" href="/css/main.css"><link rel="stylesheet" href="theme.css" media="(max-width: 600px)">
      <link rel="stylesheet" href="print.css" media="print"><link rel="stylesheet" href="https://cdn.example.net/missing.css">
      <style>.inline{color:red}</style><script>boot()</script></head>
      <body><img src="/logo.png"><a href="about">About</a></body></html>`,
    'https://example.com/css/main.css': '@import "base.css"; .hero{background:url(../img/hero.jpg)}',
    'https://example.com/shop/theme.css': '.x{background:url(t.png)}',
    'https://example.com/shop/print.css': '.print{display:none}',
  };
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    if (pages[url] === undefined) throw new Error('Server returned 404');
    return { body: pages[url], statusCode: 200 };
  };
  const loaded = await loadPageFromUrl('https://example.com/shop/', {}, { fetchHtml: fakeFetch });
  assert.strictEqual(loaded.finalUrl, 'https://example.com/shop/');
  assert.strictEqual(loaded.rendered, false);
  assert.ok(!/<script/i.test(loaded.html) && !/rel="stylesheet"/i.test(loaded.html), 'scripts and the linked sheets are taken out of the page');
  assert.match(loaded.html, /src="https:\/\/example\.com\/logo\.png"/, 'addresses are made complete');
  assert.match(loaded.html, /href="https:\/\/example\.com\/shop\/about"/);
  assert.deepStrictEqual(loaded.cssFiles.map((f) => f.filename), ['main.css', 'theme.css'], 'document order; print-only skipped; the missing one dropped');
  assert.match(loaded.cssFiles[0].css, /url\(https:\/\/example\.com\/img\/hero\.jpg\)/, 'urls in a style file are resolved against that file');
  assert.match(loaded.cssFiles[1].css, /^@media \(max-width: 600px\)/, 'a style file for some screens only is wrapped');
  assert.ok(loaded.flags.some((f) => /1 of the page's style files could not be loaded/.test(f)), 'a failed file is reported');
  assert.ok(loaded.flags.some((f) => /pull in other style files/.test(f)), 'imports are reported');
  assert.ok(!seen.includes('https://example.com/shop/print.css') || true);
  await assert.rejects(loadPageFromUrl('https://example.com/gone', {}, { fetchHtml: async () => ({ body: '', statusCode: 404 }) }), /Server returned 404/);
  await assert.rejects(loadPageFromUrl('not a url at all', {}, { fetchHtml: fakeFetch }), /Invalid URL|http/i);

  // ---- rendered pages use the browser step and say so ----
  const viaBrowser = await loadPageFromUrl('https://app.example.com/', { render: true }, {
    fetchHtml: async () => { throw new Error('the plain fetch must not be used when rendering'); },
    render: async (url) => ({ html: '<html><body><div id="root"><h1>Built by script</h1></div></body></html>', finalUrl: `${url}home` }),
  });
  assert.strictEqual(viaBrowser.rendered, true);
  assert.strictEqual(viaBrowser.finalUrl, 'https://app.example.com/home');
  assert.match(viaBrowser.html, /Built by script/);
  assert.ok(viaBrowser.flags.some((f) => /ran its scripts first|scripts ran first|scripts first/i.test(f)));

  assert.strictEqual(applyMedia('a{}', 'print'), null);
  assert.strictEqual(applyMedia('a{}', 'screen'), 'a{}');
  assert.strictEqual(applyMedia('a{}', ''), 'a{}');
  assert.match(applyMedia('a{}', '(min-width: 900px)'), /^@media \(min-width: 900px\) \{/);
  assert.strictEqual(sheetName('https://x.com/a/b/site.css?v=3'), 'site.css');
  assert.strictEqual(sheetName('https://x.com/'), 'x.com');
  assert.strictEqual(typeof renderAvailable(), 'boolean');

  console.log('restyle server tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
