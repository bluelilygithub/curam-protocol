'use strict';

// node server/services/webExtractorService.test.js   (npm run test:web-extractor). No network: the extractors take HTML strings.

const assert = require('assert');
const {
  extractArticle, extractImages, extractStyled, extractLinks, extractTables, extractMetadata, rewriteCssUrls, pickFromSrcset,
} = require('./webExtractorService');

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

// ---- CSS selector: only what is inside the matching boxes, no built-in clean-up, nested matches read once, bad selector refused ----
{
  const html = `<html><body><nav>Menu</nav><div class="product-card"><h3>Chair</h3><p>Oak, 4 legs.</p><div class="product-card"><p>inner</p></div></div>
    <div class="product-card"><h3>Table</h3><p>Pine.</p></div><div class="related"><h2>Related products</h2><p>Lamp</p></div><p>Outside text</p></body></html>`;
  const r = extractArticle(html, URL_, [], { selector: '.product-card' });
  assert.strictEqual(r.matchCount, 2, 'the nested card is not counted twice');
  assert.match(r.text, /# Chair/);
  assert.match(r.text, /Pine\./);
  assert.ok(!/Menu|Outside text|Lamp/.test(r.text), 'only the selected boxes');
  assert.strictEqual((r.text.match(/inner/g) || []).length, 1, 'inner card text appears once');
  assert.strictEqual(r.notice, '');
  assert.ok(r.wordCount > 0 && r.readingMinutes >= 1, 'word count and reading time');
  // the built-in "related" clean-up does not delete a box the person asked for
  assert.match(extractArticle(html, URL_, [], { selector: '.related' }).text, /Lamp/);
  assert.match(extractArticle(html, URL_, [], { selector: '.nothing-here' }).notice, /Nothing on the page matches/);
  assert.throws(() => extractArticle(html, URL_, [], { selector: 'div[' }), /Invalid CSS selector/);
  // no selector: unchanged behaviour
  assert.match(extractArticle(html, URL_, [], { selector: '  ' }).text, /Outside text|Chair/);
  assert.strictEqual(extractArticle('<html><body><article><p>one two three four</p></article></body></html>', URL_).wordCount, 4);
}

// ---- links: internal / external / email / phone, deduped, www ignored, fragments and javascript skipped, text fallbacks ----
{
  const html = `<html><body>
    <a href="/about">About us</a><a href="https://www.example.com/about">dup</a>
    <a href="https://other.org/x" rel="nofollow noopener">Other</a>
    <a href="mailto:hi@example.com">Email</a><a href="tel:+61400000000">Call</a>
    <a href="#top">Top</a><a href="javascript:void(0)">js</a><a href="ftp://x/y">ftp</a>
    <a href="/logo"><img alt="Home logo" src="/l.png"></a><a href="/aria" aria-label="Aria words"></a></body></html>`;
  const r = extractLinks(html, 'https://example.com/page');
  const by = (href) => r.links.find((l) => l.href === href);
  assert.strictEqual(by('https://example.com/about').type, 'internal');
  assert.strictEqual(by('https://www.example.com/about').type, 'internal', 'www is the same site');
  assert.strictEqual(by('https://other.org/x').type, 'external');
  assert.strictEqual(by('https://other.org/x').nofollow, true);
  assert.strictEqual(by('mailto:hi@example.com').type, 'email');
  assert.strictEqual(by('tel:+61400000000').type, 'phone');
  assert.strictEqual(by('https://example.com/logo').text, 'Home logo');
  assert.strictEqual(by('https://example.com/aria').text, 'Aria words');
  assert.ok(!r.links.some((l) => /javascript|ftp|#top/.test(l.href)), 'fragments, javascript: and other schemes skipped');
  assert.deepStrictEqual([r.internalCount, r.externalCount, r.otherCount, r.count], [4, 1, 2, 7]);
  const dup = extractLinks('<html><body><a href="/a">First</a><a href="/a">Second</a><a href="/b"></a></body></html>', 'https://example.com/');
  assert.strictEqual(dup.count, 2);
  assert.deepStrictEqual([dup.links[0].text, dup.links[0].occurrences], ['First', 2]);
  assert.match(extractLinks('<html><body></body></html>', 'https://example.com/').notice, /No links/);
}

// ---- tables: header row split off, nested and layout tables skipped, caption kept ----
{
  const html = `<html><body>
    <table><caption>Prices</caption><tr><th>Item</th><th>Cost</th></tr><tr><td>Pen</td><td>2</td></tr><tr><td></td><td></td></tr><tr><td>Book</td><td>9</td></tr></table>
    <table><tr><td>Just layout</td></tr></table>
    <table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td><table><tr><td>x</td><td>y</td></tr></table></td></tr></table></body></html>`;
  const r = extractTables(html, URL_);
  assert.strictEqual(r.count, 2, 'layout table skipped, nested table not listed separately');
  assert.deepStrictEqual(r.tables[0].headers, ['Item', 'Cost']);
  assert.deepStrictEqual(r.tables[0].rows, [['Pen', '2'], ['Book', '9']], 'blank rows dropped');
  assert.strictEqual(r.tables[0].caption, 'Prices');
  assert.strictEqual(r.tables[0].colCount, 2);
  assert.strictEqual(r.tables[1].headers, null, 'no header row when the first row has data cells');
  assert.strictEqual(r.tables[1].rows[0][0], 'a');
  assert.match(extractTables('<html><body><p>none</p></body></html>', URL_).notice, /No tables/);
}

// ---- metadata: tags, social cards, JSON-LD, dates, headings, and bad JSON-LD does not break it ----
{
  const html = `<html lang="en-AU"><head><title>The Story | Site</title>
    <meta name="description" content="A short summary."><meta name="robots" content="noindex"><meta name="keywords" content="a, b">
    <meta property="og:title" content="OG Title"><meta property="og:site_name" content="Example News"><meta property="og:image" content="/i.png">
    <meta name="twitter:card" content="summary_large_image"><meta property="article:published_time" content="2026-05-01T10:00:00Z">
    <link rel="canonical" href="/story"><link rel="icon" href="/fav.ico">
    <script type="application/ld+json">{"@type":"NewsArticle","headline":"H","dateModified":"2026-05-02","author":{"@type":"Person","name":"Jo Writer"}}</script>
    <script type="application/ld+json">{ not json </script></head>
    <body><h1>The Story</h1><h2>Part one</h2><h2>Part two</h2><h3>Detail</h3></body></html>`;
  const r = extractMetadata(html, 'https://example.com/news/story');
  assert.strictEqual(r.title, 'OG Title');
  assert.strictEqual(r.titleTag, 'The Story | Site');
  assert.strictEqual(r.description, 'A short summary.');
  assert.strictEqual(r.canonical, 'https://example.com/story');
  assert.strictEqual(r.language, 'en-AU');
  assert.strictEqual(r.robots, 'noindex');
  assert.strictEqual(r.siteName, 'Example News');
  assert.strictEqual(r.og.image, '/i.png');
  assert.strictEqual(r.twitter.card, 'summary_large_image');
  assert.strictEqual(r.published, '2026-05-01T10:00:00Z');
  assert.strictEqual(r.modified, '2026-05-02');
  assert.strictEqual(r.author, 'Jo Writer', 'author from JSON-LD when the page has no author tag');
  assert.strictEqual(r.jsonLd.length, 1);
  assert.strictEqual(r.jsonLdSkipped, 1, 'broken JSON-LD is counted, not fatal');
  assert.deepStrictEqual(r.headings.map((h) => h.level), [1, 2, 2, 3]);
  assert.strictEqual(r.h1Count, 1);
  assert.deepStrictEqual(r.icons, ['https://example.com/fav.ico']);
}

console.log('webExtractorService tests passed');
