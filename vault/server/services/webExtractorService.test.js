'use strict';

// node server/services/webExtractorService.test.js   (npm run test:web-extractor). No network: the extractors take HTML strings.

const assert = require('assert');
const { extractArticle, extractImages, extractStyled, rewriteCssUrls, pickFromSrcset } = require('./webExtractorService');

const URL_ = 'https://example.com/news/story';
const longText = (word) => Array.from({ length: 40 }, () => `${word} sentence about the story that goes on.`).join(' ');

// ---- an article wrapped in one big <form> (ASP.NET WebForms) is not thrown away ----
{
  const html = `<html><body><form id="aspnetForm"><div><p>${longText('Alpha')}</p><p>${longText('Beta')}</p></div></form></body></html>`;
  const r = extractArticle(html, URL_);
  assert.match(r.text, /Alpha sentence/, 'text inside a page-wide form survives');
}

// ---- a small search/sign-up form is still removed ----
{
  const html = `<html><body><form><p>Search the site</p><input></form><article><p>${longText('Gamma')}</p></article></body></html>`;
  const r = extractArticle(html, URL_);
  assert.ok(!/Search the site/.test(r.text), 'small form removed');
  assert.match(r.text, /Gamma sentence/);
}

// ---- the headline in the article's own <header> is kept; the page header is not ----
{
  const html = `<html><head><title>The Story | Example News</title></head><body>
    <header><h1>Example News</h1><nav>Home</nav></header>
    <article><header><h1>The Story</h1></header><p>${longText('Delta')}</p></article></body></html>`;
  const r = extractArticle(html, URL_);
  assert.match(r.text, /# The Story/, 'article header headline kept');
  assert.ok(!/Example News/.test(r.text), 'page header removed');
  assert.strictEqual(r.title, 'The Story', 'title is the headline, not "The Story | Example News"');
}

// ---- og:title and meta author win; a long bio block is not a byline ----
{
  const html = `<html><head><title>x | Site</title><meta property="og:title" content="Clean Title"><meta name="author" content="Jo Smith"></head>
    <body><article><p>${longText('Eps')}</p></article></body></html>`;
  const r = extractArticle(html, URL_);
  assert.strictEqual(r.title, 'Clean Title');
  assert.strictEqual(r.byline, 'Jo Smith');
  const bio = extractArticle(`<html><body><div class="author">${'About the author. '.repeat(20)}</div><article><p>${longText('Zeta')}</p></article></body></html>`, URL_);
  assert.strictEqual(bio.byline, '', 'a bio paragraph is not a byline');
}

// ---- custom excludes match whole labels, never part of a word, and never delete the article ----
{
  const html = `<html><body><main><div class="wrap">
    <h2>Updates</h2><p>${longText('Keep')}</p>
    <h2>Date</h2><p>Published 1 May</p>
    </div></main></body></html>`;
  const r = extractArticle(html, URL_, ['Date']);
  assert.match(r.text, /Updates/, '"Date" does not match the heading "Updates"');
  assert.match(r.text, /Keep sentence/, 'the article body is still there');
  const asBlock = extractArticle(`<html><body><main><div>${'<p>filler line of body text.</p>'.repeat(12)}<h2>Author</h2></div></main></body></html>`, URL_, ['Author']);
  assert.ok(!/^# Author/m.test(asBlock.text), 'a matching heading inside a page-sized wrapper loses only the heading');
  assert.match(asBlock.text, /filler line/, 'the wrapper itself is kept');
}

// ---- built-in "most read" boxes still go ----
{
  const html = `<html><body><main><p>${longText('Body')}</p><section><h3>Most read</h3><ul><li>Other story</li></ul></section></main></body></html>`;
  const r = extractArticle(html, URL_);
  assert.ok(!/Other story/.test(r.text), 'most-read section removed');
  assert.match(r.text, /Body sentence/);
}

// ---- table cells and list items keep their separators ----
{
  const html = `<html><body><article><p>${longText('Tab')}</p>
    <table><tr><th>Price</th><th>Qty</th></tr><tr><td>5</td><td>7</td></tr></table>
    <ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol></article></body></html>`;
  const r = extractArticle(html, URL_);
  assert.match(r.text, /Price \| Qty/, 'header cells are separated');
  assert.match(r.text, /5 \| 7/, 'data cells are separated');
  assert.match(r.text, /• one/);
  assert.match(r.text, /• two/);
  assert.match(r.text, /1\. first/);
  assert.match(r.text, /2\. second/);
}

// ---- a listing page takes the biggest article, and a page with no <article> takes the paragraph block, not the whole page ----
{
  const cards = `<article><p>Teaser one</p></article><article><p>Teaser two</p></article>`;
  const big = `<article><p>${longText('Lead')}</p></article>`;
  assert.match(extractArticle(`<html><body>${cards}${big}</body></html>`, URL_).text, /Lead sentence/);
  const plain = `<html><body><div id="page"><div id="menu"><a>x</a></div><div id="story"><p>${longText('Story')}</p><p>${longText('More')}</p></div><div id="foot"><p>Copyright</p></div></div></body></html>`;
  const r = extractArticle(plain, URL_);
  assert.match(r.text, /Story sentence/);
  assert.ok(!/Copyright/.test(r.text), 'the outer wrapper is not chosen');
}

// ---- thin pages say why ----
{
  const r = extractArticle('<html><body><div id="root"></div></body></html>', URL_);
  assert.match(r.notice, /JavaScript/);
  assert.strictEqual(extractArticle(`<html><body><article><p>${longText('Ok')}</p></article></body></html>`, URL_).notice, '');
}

// ---- images: the largest srcset candidate, social-card images first, backgrounds, no tracking pixels ----
{
  assert.strictEqual(pickFromSrcset('a.jpg 480w, b.jpg 1080w, c.jpg 720w'), 'b.jpg');
  assert.strictEqual(pickFromSrcset('a.jpg 1x, b.jpg 2x'), 'b.jpg');
  assert.strictEqual(pickFromSrcset(''), '');
  const html = `<html><head><meta property="og:image" content="/social.png"><meta name="twitter:image" content="https://cdn.example.com/tw.png"></head><body>
    <img src="/small.jpg" srcset="/s.jpg 480w, /l.jpg 1600w" alt="hero">
    <img src="data:image/gif;base64,AAAA" data-src="/lazy.jpg">
    <img src="/pixel.gif" width="1" height="1">
    <div style="background-image:url('/bg.jpg')"></div>
    <img src="/small.jpg" srcset="/s.jpg 480w, /l.jpg 1600w"></body></html>`;
  const r = extractImages(html, URL_);
  const srcs = r.images.map((i) => i.src);
  assert.deepStrictEqual(srcs.slice(0, 2), ['https://example.com/social.png', 'https://cdn.example.com/tw.png'], 'social images lead');
  assert.ok(srcs.includes('https://example.com/l.jpg'), 'largest srcset candidate');
  assert.ok(!srcs.includes('https://example.com/s.jpg'), 'smaller candidate not listed');
  assert.ok(srcs.includes('https://example.com/lazy.jpg'), 'lazy attribute used');
  assert.ok(srcs.includes('https://example.com/bg.jpg'), 'inline background picture');
  assert.ok(!srcs.includes('https://example.com/pixel.gif'), 'tracking pixel skipped');
  assert.strictEqual(new Set(srcs).size, srcs.length, 'no duplicates');
  assert.strictEqual(r.count, srcs.length);
  assert.strictEqual(r.notice, '');
  assert.match(extractImages('<html><body></body></html>', URL_).notice, /No pictures/);
}

// ---- exact scrape: addresses inside CSS become absolute, <base> is honoured then removed, no refresh redirect, no scripts ----
{
  assert.strictEqual(rewriteCssUrls("a{background:url(/img/a.png)} b{background:url('x.png')} c{background:url(data:image/png;base64,AA)}", 'https://example.com/dir/p'),
    "a{background:url(https://example.com/img/a.png)} b{background:url('https://example.com/dir/x.png')} c{background:url(data:image/png;base64,AA)}");
  assert.strictEqual(rewriteCssUrls('@import "/css/x.css";', 'https://example.com/'), '@import "https://example.com/css/x.css";');
  const html = `<html><head><base href="https://assets.example.com/v2/"><meta http-equiv="refresh" content="0;url=/elsewhere">
    <style>.hero{background:url(img/hero.jpg)}</style><script>alert(1)</script></head>
    <body><img src="pic.png" data-src="real.png"><div style="background:url(bg.png)"></div><a href="/about">x</a></body></html>`;
  const out = extractStyled(html, URL_).html;
  assert.ok(out.includes('url(https://assets.example.com/v2/img/hero.jpg)'), 'style block rewritten against <base>');
  assert.ok(out.includes('url(https://assets.example.com/v2/bg.png)'), 'inline style rewritten');
  assert.ok(out.includes('src="https://assets.example.com/v2/real.png"'), 'lazy picture shown');
  assert.ok(out.includes('href="https://assets.example.com/about"') || out.includes('href="https://example.com/about"'), 'link absolute');
  assert.ok(!/<base/i.test(out) && !/http-equiv/i.test(out) && !/<script/i.test(out), 'base, refresh and scripts removed');
}

console.log('webExtractorService tests passed');
