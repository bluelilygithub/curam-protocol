'use strict';
// node server/services/htmlContentCheck/fetchPage.test.js
// When the real browser is used and when it is not; a redirected address is stored as finalUrl (a real redirect through safeFetch to a
// test site on this machine, allowed by a fake resolver as in docCompareFetch.test.js); saved copies; no live site is contacted.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadPage, readUpload, plainFetch } = require('./fetchPage');
const { isPublicIp } = require('../../utils/safeFetch');

const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'artist-before.html'), 'utf8');
const SHELL = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
const pub = (message, extra) => Object.assign(new Error(message), { isPublic: true, ...extra });

function stubs({ plain, browser, browserOk = true }) {
  const calls = { plain: 0, browser: 0 };
  return {
    calls,
    deps: {
      plainFetch: async () => { calls.plain++; if (plain instanceof Error) throw plain; return plain; },
      browserFetch: async () => { calls.browser++; if (browser instanceof Error) throw browser; return browser; },
      browserAvailable: () => browserOk,
    },
  };
}

(async () => {
  const url = 'https://gallery.example/artists/dorothy-stoner';

  // auto: a readable plain copy is enough
  let s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: { html: PAGE, finalUrl: url } });
  let r = await loadPage(url, 'auto', s.deps);
  assert.equal(r.fetchedVia, 'plain'); assert.deepEqual(s.calls, { plain: 1, browser: 0 });
  assert.equal(r.snapshot.meta.fetchedVia, 'plain');

  // auto: a near-empty plain copy falls back to the real browser
  s = stubs({ plain: { html: SHELL, finalUrl: url }, browser: { html: PAGE, finalUrl: `${url}/` } });
  r = await loadPage(url, 'auto', s.deps);
  assert.equal(r.fetchedVia, 'browser'); assert.deepEqual(s.calls, { plain: 1, browser: 1 });
  assert.equal(r.finalUrl, `${url}/`); assert.equal(r.snapshot.meta.fetchedVia, 'browser');

  // auto: near-empty in the browser too, or no browser on this server: a clear failure
  s = stubs({ plain: { html: SHELL, finalUrl: url }, browser: { html: SHELL, finalUrl: url } });
  await assert.rejects(loadPage(url, 'auto', s.deps), (e) => e.isPublic && /almost no text/.test(e.message) && e.fetchedVia === 'browser');
  s = stubs({ plain: { html: SHELL, finalUrl: url }, browserOk: false });
  await assert.rejects(loadPage(url, 'auto', s.deps), (e) => /not available on this server/.test(e.message) && e.fetchedVia === 'plain');
  assert.equal(s.calls.browser, 0);

  // plain: never the browser
  s = stubs({ plain: { html: SHELL, finalUrl: url }, browser: { html: PAGE, finalUrl: url } });
  await assert.rejects(loadPage(url, 'plain', s.deps), /almost no text/);
  assert.equal(s.calls.browser, 0);

  // browser: only the browser
  s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: { html: PAGE, finalUrl: url } });
  r = await loadPage(url, 'browser', s.deps);
  assert.equal(r.fetchedVia, 'browser'); assert.deepEqual(s.calls, { plain: 0, browser: 1 });

  // auto: a site that turns the plain fetch away gets a browser; a refused address (SSRF guard) never does
  s = stubs({ plain: pub('Could not fetch the page (HTTP 403)', { turnedAway: true }), browser: { html: PAGE, finalUrl: url } });
  assert.equal((await loadPage(url, 'auto', s.deps)).fetchedVia, 'browser');
  s = stubs({ plain: pub('That address is not allowed', { turnedAway: false }), browser: { html: PAGE, finalUrl: url } });
  await assert.rejects(loadPage(url, 'auto', s.deps), (e) => /not allowed/.test(e.message) && e.fetchedVia === 'plain');
  assert.equal(s.calls.browser, 0, 'no browser for a refused address');

  // far less text than the starting point (a site rebuilt to draw itself with JavaScript): auto reads it again in the real browser
  const { lessTextOf } = require('./fetchPage');
  const FULL = `<html><body>${Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} about the artist and her long career in painting.</p>`).join('')}</body></html>`; // 400 words
  s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: { html: FULL, finalUrl: url } }); // PAGE has about 80 words
  r = await loadPage(url, 'auto', s.deps, { expectWords: 400 });
  assert.deepEqual(s.calls, { plain: 1, browser: 1 }); assert.equal(r.fetchedVia, 'browser'); assert.equal(r.retried, true);
  assert.equal(lessTextOf(r.snapshot, 400), null, 'the browser copy has the text: no flag');
  s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: { html: PAGE, finalUrl: url } });
  r = await loadPage(url, 'auto', s.deps, { expectWords: 400 });
  assert.equal(r.fetchedVia, 'plain', 'the browser was no better: the plain copy is kept'); assert.equal(r.retried, true);
  assert.deepEqual(lessTextOf(r.snapshot, 400), { expected: 400, got: r.snapshot.meta.words }, 'and flagged');
  s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: pub('Server returned 403') });
  r = await loadPage(url, 'auto', s.deps, { expectWords: 400 });
  assert.equal(r.fetchedVia, 'plain', 'a browser failure keeps the plain copy, not a failed round');
  s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: { html: FULL, finalUrl: url } });
  await loadPage(url, 'plain', s.deps, { expectWords: 400 });
  assert.equal(s.calls.browser, 0, 'plain mode never uses the browser');
  s = stubs({ plain: { html: PAGE, finalUrl: url }, browser: { html: FULL, finalUrl: url } });
  await loadPage(url, 'auto', s.deps, { expectWords: 150 });
  assert.equal(s.calls.browser, 0, 'about half the text is not "far less"');
  assert.equal(lessTextOf(r.snapshot, 60), null, 'a small starting point is never flagged');

  // a page over the size cap fails in any mode
  const huge = `<html><body>${Array.from({ length: 60 }, () => `<p>${'abcdefgh '.repeat(1000)}</p>`).join('')}</body></html>`;
  s = stubs({ plain: { html: huge, finalUrl: url } });
  await assert.rejects(loadPage(url, 'auto', s.deps), (e) => e.code === 'TOO_BIG');

  // saved copy: its own address comes from the browser's saved-from comment or the canonical link
  r = readUpload(Buffer.from(`<!-- saved from url=(0040)https://gallery.example/artists/saved -->\n${PAGE.replace(/<link rel="canonical"[^>]*>/, '')}`));
  assert.equal(r.fetchedVia, 'upload'); assert.equal(r.finalUrl, 'https://gallery.example/artists/saved');
  assert.throws(() => readUpload(Buffer.from('%PDF-1.7 not a page')), /not a web page/);
  assert.throws(() => readUpload(Buffer.from(SHELL)), /almost no text/);

  // ---- a real redirect through safeFetch: the final address is what is stored ----
  const server = http.createServer((req, res) => {
    if (req.url === '/old') { res.writeHead(301, { Location: '/artists/dorothy-stoner' }); return res.end(); }
    if (req.url === '/artists/dorothy-stoner') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    if (req.url === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.7'); }
    if (req.url === '/forbidden') { res.writeHead(403); return res.end('no'); }
    res.writeHead(404); res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = String(server.address().port);
  let viaSite = false;
  const deps = {
    resolve: async (h) => { viaSite = h === 'site.test'; if (viaSite) return ['127.0.0.1']; if (h === 'internal.test') return ['10.0.0.7']; throw new Error('ENOTFOUND'); },
    isAllowedIp: (ip) => { const v = viaSite; viaSite = false; return ip === '127.0.0.1' && v ? true : isPublicIp(ip); },
    ports: ['80', '443', port],
  };
  try {
    const page = await plainFetch(`http://site.test:${port}/old`, deps);
    assert.equal(page.finalUrl, `http://site.test:${port}/artists/dorothy-stoner`, 'the redirected address');
    const viaRedirect = await loadPage(`http://site.test:${port}/old`, 'plain', { plainFetch: (u) => plainFetch(u, deps), browserFetch: null, browserAvailable: () => false });
    assert.equal(viaRedirect.finalUrl, `http://site.test:${port}/artists/dorothy-stoner`);
    assert.equal(viaRedirect.snapshot.meta.finalUrl, viaRedirect.finalUrl);
    await assert.rejects(plainFetch(`http://site.test:${port}/pdf`, deps), /not a web page/);
    await assert.rejects(plainFetch(`http://site.test:${port}/forbidden`, deps), (e) => e.turnedAway === true && /the page \(HTTP 403\)/.test(e.message));
    await assert.rejects(plainFetch('http://internal.test/', deps), (e) => /not allowed/.test(e.message) && !e.turnedAway);
  } finally { server.close(); }

  console.log(`fetchPage.test.js: passed (Node ${process.version})`);
})().catch((err) => { console.error(err); process.exit(1); });
