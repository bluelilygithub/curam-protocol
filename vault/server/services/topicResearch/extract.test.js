#!/usr/bin/env node
/**
 * Topic Research (milestone 3): reading article pages. The fetcher, robots checker and clock are stand-ins, so it needs no network and no
 * real waiting; one test runs the real Web Extractor code on a small page to prove the pieces fit together.
 *
 * Run: node server/services/topicResearch/extract.test.js
 */
'use strict';

const assert = require('assert');
const { createExtractor, decodeBody, believableDate, MAX_TEXT_CHARS, THIN_CHARS } = require('./extract');

const NOW = Date.UTC(2026, 9, 25, 0, 0, 0);
const LONG = 'Cyclone Alfie crossed the coast near Cairns overnight, cutting power to thousands of homes across Far North Queensland. '.repeat(4);
const page = (body) => `<html><head><title>t</title></head><body><nav>Menu Home About</nav><article><p>${body}</p></article><footer>Footer links</footer></body></html>`;
const httpError = (status) => Object.assign(new Error(`Could not fetch the file (HTTP ${status})`), { status: 400 });

/** A fake world: pages by address, a clock that moves only when something sleeps or a fetch "takes time". */
function world({ pages = {}, robotsFor = {}, fetchMs = 0 } = {}) {
  const w = { clock: NOW, sleeps: [], fetched: [], robotsChecked: [] };
  w.now = () => w.clock;
  w.sleep = async (ms) => { w.sleeps.push(ms); w.clock += ms; };
  w.fetchFile = async (url) => {
    w.fetched.push(url);
    w.clock += fetchMs;
    const p = pages[url];
    if (p instanceof Error) throw p;
    if (p === undefined) throw httpError(404);
    return { buffer: Buffer.from(p.body ?? p, 'utf8'), contentType: p.type ?? 'text/html; charset=utf-8', finalUrl: p.finalUrl || url };
  };
  w.robots = { check: async (url) => { w.robotsChecked.push(url); return robotsFor[url] || { allowed: true, reason: 'allowed', crawlDelayMs: null }; } };
  w.extractor = (extra = {}) => createExtractor({
    fetchFile: w.fetchFile, robots: w.robots, now: w.now, sleep: w.sleep,
    extractArticle: (html) => ({ text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }),
    extractMetadata: () => ({ published: null }),
    ...extra,
  });
  return w;
}
const cand = (id, url, publishedAt = null) => ({ id, url, publishedAt });

async function main() {
  // ------------------------------------------------------------ the happy path
  {
    const w = world({ pages: { 'https://a.com/1': page(LONG) } });
    const [r] = await w.extractor().readPages([cand(1, 'https://a.com/1')]);
    assert.strictEqual(r.status, 'ok');
    assert.ok(r.text.includes('Cyclone Alfie') && r.text.length > THIN_CHARS);
    assert.strictEqual(r.wordCount, r.text.split(/\s+/).length);
    assert.strictEqual(r.id, 1);
    assert.deepStrictEqual(await w.extractor().readPages([]), [], 'nothing to read');
  }

  // ------------------------------------------------------------ pages it must not, or cannot, read
  {
    const w = world({
      pages: {
        'https://thin.com/1': page('Subscribe to read this story.'),
        'https://pdf.com/1': { body: '%PDF-1.4', type: 'application/pdf' },
        'https://paywall.com/1': httpError(403),
        'https://throttled.com/1': httpError(429),
        'https://login.com/1': httpError(401),
        'https://gone.com/1': httpError(404),
        'https://boom.com/1': new Error('Could not fetch the file'),
        'https://bad.com/1': page(LONG),
        'https://closed.com/1': page(LONG),
        'https://unreadable.com/1': page(LONG),
      },
      robotsFor: {
        'https://closed.com/1': { allowed: false, reason: 'disallowed', crawlDelayMs: null },
        'https://unreadable.com/1': { allowed: false, reason: 'unavailable', crawlDelayMs: null },
      },
    });
    const ex = w.extractor({ extractArticle: (html) => { if (html.includes('Cyclone') && w.fetched[w.fetched.length - 1] === 'https://bad.com/1') throw new Error('parser fell over'); return { text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }; } });
    const urls = ['thin', 'pdf', 'paywall', 'throttled', 'login', 'gone', 'boom', 'bad', 'closed', 'unreadable'];
    const out = await ex.readPages(urls.map((u, i) => cand(i, `https://${u}.com/1`)), { budgetMs: 1e9 });
    const status = Object.fromEntries(urls.map((u, i) => [u, out[i].status]));
    assert.deepStrictEqual(status, {
      thin: 'thin', pdf: 'not-html', paywall: 'blocked', throttled: 'blocked', login: 'blocked', gone: 'error', boom: 'error', bad: 'error', closed: 'robots', unreadable: 'blocked',
    });
    assert.ok(!w.fetched.includes('https://closed.com/1') && !w.fetched.includes('https://unreadable.com/1'), 'a site that says no is never asked for the page');
    assert.ok(out.every((r) => r.text === undefined), 'no page that failed gives any text');
    assert.strictEqual(out[0].text, undefined, 'a nearly empty page is not kept as an article');
    // a robots checker that itself blows up must not take the search down
    const shaky = createExtractor({ fetchFile: w.fetchFile, robots: { check: async () => { throw new Error('robots exploded'); } }, now: w.now, sleep: w.sleep });
    assert.deepStrictEqual((await shaky.readPages([cand(1, 'https://a.com/1')])).map((r) => r.status), ['error']);
  }

  // ------------------------------------------------------------ politeness: spacing per site, a site's own Crawl-delay
  {
    const pages = Object.fromEntries(['a1', 'a2', 'a3', 'b1', 'c1'].map((k) => [`https://${k[0]}.com/${k}`, page(LONG)]));
    const w = world({ pages });
    const out = await w.extractor().readPages(['a1', 'a2', 'a3', 'b1', 'c1'].map((k, i) => cand(i, `https://${k[0]}.com/${k}`)), { budgetMs: 1e9 });
    assert.ok(out.every((r) => r.status === 'ok'));
    assert.deepStrictEqual(w.sleeps, [2000, 2000], 'three pages of one site wait two seconds between them; other sites do not wait');

    const slowSite = world({ pages: { 'https://s.com/1': page(LONG), 'https://s.com/2': page(LONG) }, robotsFor: {
      'https://s.com/1': { allowed: true, reason: 'allowed', crawlDelayMs: 5000 }, 'https://s.com/2': { allowed: true, reason: 'allowed', crawlDelayMs: 5000 },
    } });
    await slowSite.extractor().readPages([cand(1, 'https://s.com/1'), cand(2, 'https://s.com/2')], { budgetMs: 1e9 });
    assert.deepStrictEqual(slowSite.sleeps, [5000], "a site's own Crawl-delay is respected when it is longer than ours");

    // never more than four at once
    let live = 0; let peak = 0;
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`https://h${i}.com/p`, page(LONG)]));
    const wide = createExtractor({
      robots: { check: async () => ({ allowed: true, reason: 'allowed', crawlDelayMs: null }) },
      fetchFile: async (url) => { live += 1; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live -= 1; return { buffer: Buffer.from(many[url]), contentType: 'text/html', finalUrl: url }; },
      extractArticle: () => ({ text: LONG }), extractMetadata: () => ({}),
    });
    await wide.readPages(Object.keys(many).map((u, i) => cand(i, u)), { budgetMs: 1e9 });
    assert.strictEqual(peak, 4, 'four sites at a time');
  }

  // ------------------------------------------------------------ the time budget
  {
    const urls = [1, 2, 3, 4, 5].map((i) => `https://t${i}.com/p`);
    const w = world({ pages: Object.fromEntries(urls.map((u) => [u, page(LONG)])), fetchMs: 10000 });
    const out = await w.extractor({ concurrency: 1 }).readPages(urls.map((u, i) => cand(i, u)), { budgetMs: 25000 });
    assert.deepStrictEqual(out.map((r) => r.status), ['ok', 'ok', 'ok', 'skipped', 'skipped'], 'no new page is started once the budget is spent');
    assert.strictEqual(w.fetched.length, 3);
  }

  // ------------------------------------------------------------ dates, size, order
  {
    const dated = (iso) => ({ published: iso });
    const w = world({ pages: { 'https://a.com/1': page(LONG), 'https://a.com/2': page(LONG), 'https://b.com/1': page(LONG), 'https://c.com/1': page(LONG), 'https://d.com/1': page(LONG) } });
    let metaCalls = 0;
    const ex = w.extractor({ extractMetadata: (html, url) => { metaCalls += 1; return dated({ 'https://a.com/1': '2026-10-20T04:00:00Z', 'https://a.com/2': '2031-01-01', 'https://b.com/1': 'garbage', 'https://c.com/1': '1970-01-01' }[url]) ; } });
    const out = await ex.readPages([cand('x', 'https://a.com/1'), cand('y', 'https://a.com/2'), cand('z', 'https://b.com/1'), cand('w', 'https://c.com/1'), cand('known', 'https://d.com/1', new Date(NOW - 1e6))], { budgetMs: 1e9 });
    assert.deepStrictEqual(out.map((r) => r.id), ['x', 'y', 'z', 'w', 'known'], 'results come back in the order asked');
    assert.deepStrictEqual(out[0].published, new Date('2026-10-20T04:00:00Z'), 'a missing date is filled from the page');
    assert.deepStrictEqual([out[1].published, out[2].published, out[3].published], [null, null, null], 'a date in the future, rubbish, or before 2000 is not believed');
    assert.strictEqual(metaCalls, 4, 'an article that already has a date does not have its metadata read');
    assert.strictEqual(out[4].published, null);

    const huge = 'word '.repeat(40000);
    const big = world({ pages: { 'https://big.com/1': page(huge) } });
    const [r] = await big.extractor().readPages([cand(1, 'https://big.com/1')]);
    assert.strictEqual(r.text.length, MAX_TEXT_CHARS, 'long pages are cut to the limit');
    assert.strictEqual(r.wordCount, r.text.split(/\s+/).filter(Boolean).length);

    assert.strictEqual(believableDate('2026-10-24T00:00:00Z', NOW).toISOString(), '2026-10-24T00:00:00.000Z');
    assert.strictEqual(believableDate('2026-10-26T06:00:00Z', NOW), null, 'more than a day ahead');
    assert.ok(believableDate('2026-10-26T00:00:00Z', NOW), 'exactly a day ahead is still allowed');
    assert.ok(believableDate('2026-10-25T10:00:00Z', NOW), 'a few hours ahead is a time-zone slip, not a lie');
    assert.strictEqual(believableDate('', NOW), null);
    assert.strictEqual(believableDate(null, NOW), null);
  }

  // ------------------------------------------------------------ charsets
  {
    const latin1 = Buffer.from('caf\xe9 cr\xe8me', 'latin1');
    assert.strictEqual(decodeBody(latin1, 'text/html; charset=iso-8859-1'), 'café crème', 'the charset the server declared');
    assert.strictEqual(decodeBody(Buffer.concat([Buffer.from('<meta charset="iso-8859-1">'), latin1]), 'text/html'), '<meta charset="iso-8859-1">café crème', "the page's own declaration");
    assert.strictEqual(decodeBody(Buffer.from('café', 'utf8'), 'text/html'), 'café', 'UTF-8 by default');
    assert.strictEqual(decodeBody(Buffer.from('café', 'utf8'), 'text/html; charset=no-such-charset'), 'café', 'an unknown charset falls back to UTF-8');
    assert.strictEqual(decodeBody(Buffer.from('plain'), ''), 'plain');
  }

  // ------------------------------------------------------------ the real Web Extractor on a small page
  {
    const html = '<html><head><title>Alfie lashes coast | The Example</title><meta property="article:published_time" content="2026-10-24T03:00:00Z"></head>'
      + `<body><nav>Menu Home Sport Weather Contact</nav><article><h1>Alfie lashes coast</h1><p>${LONG}</p></article><aside>Most read: ten unrelated things</aside><footer>Copyright Footer Links</footer></body></html>`;
    const w = world({ pages: { 'https://real.com/1': html } });
    const real = createExtractor({ fetchFile: w.fetchFile, robots: w.robots, now: w.now, sleep: w.sleep });
    const [r] = await real.readPages([cand(1, 'https://real.com/1')]);
    assert.strictEqual(r.status, 'ok');
    assert.ok(r.text.includes('Cyclone Alfie crossed the coast'), 'the article text is there');
    assert.ok(!r.text.includes('Menu Home Sport') && !r.text.includes('Copyright Footer Links'), 'the menu and footer are not');
    assert.deepStrictEqual(r.published, new Date('2026-10-24T03:00:00Z'), "the page's own publish date is found");
  }

  console.log('topicResearch extract: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
