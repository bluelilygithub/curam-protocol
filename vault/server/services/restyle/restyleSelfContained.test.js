'use strict';

// node server/services/restyle/restyleSelfContained.test.js   (npm run test:restyle-selfcontained). The Web Extractor's Exact scrape: the page
// comes back as one self-contained page (style files in place, pictures copied in), reads the real page rather than a text-only copy, and
// says honestly when it cannot. No network.

const assert = require('assert');
const { buildSelfContainedPage } = require('./selfContainedPage');
const { runExtraction } = require('../webExtractorService');

const PAGE_URL = 'https://example.com/shop/';
const RAW = `<!DOCTYPE html><html><head><title>Shop</title>
  <link rel="preload" href="/f.woff2" as="font">
  <link rel="stylesheet" href="/css/main.css"><style>.mid { color: #123456 }</style>
  <link rel="stylesheet" href="print.css" media="print"><link rel="stylesheet" href="small.css" media="(max-width: 600px)">
  <link rel="stylesheet" href="https://cdn.example.net/gone.css">
  <script>boot()</script></head>
  <body><img src="logo.png" alt="Logo"><a href="about">About</a><div style="background:url(bg.jpg)">x</div><script>track()</script></body></html>`;

const files = {
  'https://example.com/shop/': RAW,
  'https://example.com/css/main.css': '.hero { background: url(../img/hero.jpg) } @import "base.css";',
  'https://example.com/shop/print.css': '.p { display: none }',
  'https://example.com/shop/small.css': '.s { color: red }',
};
const fakeFetcher = (log = []) => async (url, opts) => {
  log.push([url, !!(opts && opts.asset)]);
  if (files[url] === undefined) throw new Error('Server returned 404');
  return { body: files[url], statusCode: 200, finalUrl: url, profile: 'chrome' };
};
// stands in for copying pictures in: marks every <img src> and counts one failure
const fakeInline = async (fragment) => ({
  html: fragment.replace(/(<img[^>]*src=")([^"]+)"/g, '$1data:image/png;base64,INLINED"'),
  inlinedCount: (fragment.match(/<img/g) || []).length,
  failedCount: fragment.includes('hero.jpg') ? 1 : 0,
});

(async () => {
  // ---- the page, made self-contained ----
  const log = [];
  const built = await buildSelfContainedPage(RAW, PAGE_URL, { fetcher: fakeFetcher(log), inlineFragment: fakeInline });
  const html = built.html;
  assert.ok(!/<script/i.test(html), 'scripts are gone');
  assert.ok(!/rel="preload"/.test(html), 'preload hints are gone');
  assert.match(html, /<style data-from="https:\/\/example\.com\/css\/main\.css">[^<]*\.hero \{ background: url\(https:\/\/example\.com\/img\/hero\.jpg\) \}/, 'a linked style file becomes a <style>, with its addresses made complete');
  assert.ok(html.indexOf('data-from="https://example.com/css/main.css"') < html.indexOf('.mid { color: #123456 }'), 'in the page\'s own order: the linked file, then the style written in the page');
  assert.match(html, /<style data-from="https:\/\/example\.com\/shop\/small\.css">@media \(max-width: 600px\) \{/, 'a file for some screens only is wrapped');
  assert.ok(!html.includes('print.css') && !html.includes('.p { display: none }'), 'a print-only file is left out');
  assert.match(html, /<link rel="stylesheet" href="https:\/\/cdn\.example\.net\/gone\.css">/, 'a file that could not be fetched stays a link, so a browser may still load it');
  assert.match(html, /<a href="https:\/\/example\.com\/shop\/about">/, 'links are made complete');
  assert.match(html, /<img src="data:image\/png;base64,INLINED"/, 'pictures go through the picture step');
  assert.strictEqual(built.cssInlined, 2);
  assert.strictEqual(built.cssFailed, 1);
  assert.strictEqual(built.imagesInlined, 1, 'counted across head and body');
  assert.strictEqual(built.imagesFailed, 1);
  assert.ok(log.every(([, asset]) => asset), 'style files are asked for as style files');
  assert.ok(html.startsWith('<!DOCTYPE html>'));

  // ---- Exact scrape: self-contained page, the page as fetched, and honest notes ----
  const seen = { fallback: 0 };
  const deps = { fetcher: fakeFetcher(), inlineFragment: fakeInline, fetchHtml: async () => { seen.fallback += 1; return { body: '<html></html>', statusCode: 200, via: 'serper' }; } };
  const styled = await runExtraction('example.com/shop/', 'styled', [], {}, deps);
  assert.strictEqual(styled.mode, 'styled');
  assert.strictEqual(styled.url, 'https://example.com/shop/');
  assert.ok(styled.sourceHtml.includes('<script>boot()</script>') && styled.sourceHtml.includes('href="/css/main.css"'), 'the page as fetched is returned for the source view');
  assert.ok(!styled.html.includes('boot()'), 'while the copy has no scripts');
  assert.deepStrictEqual(styled.stats, { cssInlined: 2, cssFailed: 1, imagesInlined: 1, imagesFailed: 1 });
  assert.match(styled.notice, /1 style file could not be loaded; 1 picture could not be copied in .* so the copy may look different from the live page\./);
  assert.strictEqual(seen.fallback, 0);

  // a clean page has no notice
  const clean = await runExtraction('https://example.com/ok', 'styled', [], {}, { fetcher: async () => ({ body: '<html><head><title>t</title></head><body><p>hi</p></body></html>', statusCode: 200, finalUrl: 'https://example.com/ok' }), inlineFragment: async (f) => ({ html: f, inlinedCount: 0, failedCount: 0 }) });
  assert.strictEqual(clean.notice, '');

  // ---- a refused page: Exact scrape and the other tools that need the real markup say so, and never use a text-only copy ----
  const refusing = { fetcher: async () => { throw new Error('Server returned 403'); }, fetchHtml: async () => { seen.fallback += 1; return { body: '<html><body>digest</body></html>', statusCode: 200, via: 'serper' }; } };
  for (const mode of ['styled', 'images', 'links', 'tables', 'metadata']) {
    await assert.rejects(runExtraction('https://example.com/', mode, [], {}, refusing), /Server returned 403/, `${mode} does not settle for a text-only copy`);
  }
  assert.strictEqual(seen.fallback, 0, 'the text-only fallback was never used');
  // Article content can make do with words, and says that is what it did
  const article = await runExtraction('https://example.com/', 'article', [], {}, {
    ...refusing,
    fetchHtml: async () => ({ body: `<html><head><title>A</title></head><body><article><p>${'Some words of an article. '.repeat(20)}</p></article></body></html>`, statusCode: 200, via: 'serper' }),
  });
  assert.strictEqual(article.mode, 'article');
  assert.match(article.text, /Some words of an article/);
  assert.match(article.notice, /reading service/, 'and it says the text came from a reading service');
  const direct = await runExtraction('https://example.com/', 'article', [], {}, { fetcher: async () => ({ body: `<html><head><title>A</title></head><body><article><p>${'Words of a real page. '.repeat(20)}</p></article></body></html>`, statusCode: 200, finalUrl: 'https://example.com/' }) });
  assert.strictEqual(direct.notice, '', 'a page that was read properly has no such note');
  await assert.rejects(runExtraction('https://example.com/', 'article', [], {}, { fetcher: async () => { throw new Error('Server returned 403'); }, fetchHtml: async () => ({ body: '', statusCode: 403 }) }), /Server returned 403/, 'if even the reading service fails, the error is the honest one');

  // ---- relative addresses use where the page ended up after redirects ----
  const moved = await runExtraction('https://www.example.com/', 'links', [], {}, { fetcher: async () => ({ body: '<html><body><a href="contact">Contact</a><a href="/about">About</a></body></html>', statusCode: 200, finalUrl: 'https://other-site.example.org/shop/' }) });
  assert.strictEqual(moved.url, 'https://other-site.example.org/shop/');
  assert.strictEqual(moved.requestedUrl, 'https://www.example.com/');
  assert.deepStrictEqual(moved.links.map((l) => l.href), ['https://other-site.example.org/shop/contact', 'https://other-site.example.org/about']);

  console.log('restyle self-contained tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
