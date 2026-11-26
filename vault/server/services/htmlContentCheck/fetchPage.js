'use strict';

// Gets one round's page and makes its snapshot. Order (brief decision 6):
//   fetchMode 'plain'   plain fetch only
//   fetchMode 'browser' the real browser only (Load in a real browser)
//   fetchMode 'auto'    plain fetch; the real browser when the plain copy has almost no text, or the site turns the plain fetch away
//                       (HTTP 403/406/429/503: firewalls often let a browser in). Never on a refused address (SSRF guard).
// Or a saved copy the person uploaded (fetchedVia 'upload'). Outside addresses go only through safeFetch.fetchPublicFile and
// restyle/renderPage.js (every request SSRF-checked). `deps` exists for tests; production uses the defaults.

const { fetchPublicFile } = require('../../utils/safeFetch');
const lib = require('./lib');
const { buildSnapshot } = require('./extract');
const C = require('./config');

const pub = (message) => Object.assign(new Error(message), { isPublic: true, status: 422 });
const looksLikeHtml = (buf) => /<(!doctype html|html|head|body|main|article|div|p)[\s>]/i.test(buf.subarray(0, 4096).toString('latin1'));
const TURNED_AWAY = /\(HTTP (403|406|429|503)\)/;
const THIN = 'This page has almost no text that could be read. It may build itself with JavaScript and refuse a real browser too, or need a login. Open it in your browser, save it with File > Save Page As (Webpage, HTML only) and upload the saved copy instead.';

async function plainFetch(url, safeFetchDeps) { // safeFetchDeps: tests only (a fake resolver for local test sites)
  try {
    const { buffer, contentType, finalUrl } = await fetchPublicFile(url, {
      maxBytes: C.MAX_FETCH_BYTES, timeoutMs: C.FETCH_TIMEOUT_MS, totalTimeoutMs: C.FETCH_TOTAL_MS, maxRedirects: 5,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', userAgent: C.USER_AGENT,
      ...(safeFetchDeps ? { deps: safeFetchDeps } : {}),
    });
    if (!/html|xml/i.test(contentType) && !looksLikeHtml(buffer)) throw pub(`That address is not a web page (${(contentType || 'unknown type').split(';')[0]}).`);
    return { html: lib.decodeHtml(new Uint8Array(buffer)), finalUrl };
  } catch (err) {
    if (err.isPublic) throw err;
    // safeFetch's own messages (status 400) are written to be shown; they say "file", which here is a page
    const e = pub(err.status === 400 ? err.message.replace(/the file/g, 'the page') : 'Could not fetch that page.');
    e.turnedAway = err.status === 400 && TURNED_AWAY.test(err.message);
    throw e;
  }
}

async function browserFetch(url) {
  const { renderPage } = require('../restyle/renderPage');
  try {
    const { html, finalUrl } = await renderPage(url);
    return { html, finalUrl };
  } catch (err) {
    throw pub(`The real browser could not load the page: ${err.message}`);
  }
}

function browserAvailable() {
  try { return require('../restyle/renderPage').renderAvailable(); } catch { return false; }
}

const DEFAULT_DEPS = { plainFetch, browserFetch, browserAvailable };

// Far less text than the starting point: under this share of its words (and the starting point had at least LESS_TEXT_MIN words).
// A plain copy like that is usually a site rebuilt to draw itself with JavaScript, not the client deleting most of the page.
const LESS_TEXT_RATIO = 0.4;
const LESS_TEXT_MIN = 100;
const farLess = (snapshot, expectWords) => expectWords >= LESS_TEXT_MIN && snapshot.meta.words < expectWords * LESS_TEXT_RATIO;

/** { expected, got } when `snapshot` has far less text than the starting point's `expectWords`, else null. */
const lessTextOf = (snapshot, expectWords) => (farLess(snapshot, expectWords) ? { expected: expectWords, got: snapshot.meta.words } : null);

/**
 * Fetches `url` the way `fetchMode` says. Returns { snapshot, html, finalUrl, fetchedVia, retried? }; throws a public error (with
 * `fetchedVia`). `expectWords` (the starting point's word count): in auto mode a plain copy with far less text is read again in the real
 * browser and the fuller copy kept (`retried: true`). The caller flags a round that still has far less text (lessTextOf).
 */
async function loadPage(url, fetchMode, deps = DEFAULT_DEPS, { expectWords = 0 } = {}) {
  const viaBrowser = async () => {
    if (!deps.browserAvailable()) throw Object.assign(pub('Loading pages in a real browser is not set up on this server.'), { fetchedVia: 'browser' });
    const page = await deps.browserFetch(url).catch((err) => { throw Object.assign(err, { fetchedVia: 'browser' }); });
    const { snapshot, thin } = buildSnapshot(page.html, { finalUrl: page.finalUrl, fetchedVia: 'browser' });
    if (thin) throw Object.assign(pub(THIN), { fetchedVia: 'browser' });
    return { snapshot, html: page.html, finalUrl: page.finalUrl, fetchedVia: 'browser' };
  };
  if (fetchMode === 'browser') return viaBrowser();

  let page;
  try {
    page = await deps.plainFetch(url);
  } catch (err) {
    if (fetchMode === 'auto' && err.turnedAway && deps.browserAvailable()) return viaBrowser();
    throw Object.assign(err, { fetchedVia: 'plain' });
  }
  const { snapshot, thin } = buildSnapshot(page.html, { finalUrl: page.finalUrl, fetchedVia: 'plain' });
  const plainResult = { snapshot, html: page.html, finalUrl: page.finalUrl, fetchedVia: 'plain' };
  if (!thin && fetchMode === 'auto' && farLess(snapshot, expectWords) && deps.browserAvailable()) {
    const viaB = await viaBrowser().catch(() => null); // the browser failing is not a failed round: the plain copy is kept, flagged
    return viaB && viaB.snapshot.meta.words > snapshot.meta.words ? { ...viaB, retried: true } : { ...plainResult, retried: true };
  }
  if (!thin) return plainResult;
  if (fetchMode === 'auto' && deps.browserAvailable()) return viaBrowser();
  throw Object.assign(pub(fetchMode === 'auto' ? `${THIN} (A real browser is not available on this server.)` : THIN), { fetchedVia: 'plain' });
}

/** A saved copy the person uploaded: bytes of an .html file. The page's own address (saved-from comment, canonical) is used if it has one. */
function readUpload(buffer) {
  if (!looksLikeHtml(buffer)) throw Object.assign(pub('That file is not a web page. Save the page from your browser with File > Save Page As (Webpage, HTML only).'), { fetchedVia: 'upload' });
  const html = lib.decodeHtml(new Uint8Array(buffer));
  const { snapshot, thin } = buildSnapshot(html, { finalUrl: null, fetchedVia: 'upload' });
  if (thin) throw Object.assign(pub('That saved page has almost no text that could be read. Save it again after it has finished loading in your browser.'), { fetchedVia: 'upload' });
  return { snapshot, html, finalUrl: snapshot.meta.pageUrl, fetchedVia: 'upload' };
}

module.exports = { loadPage, readUpload, plainFetch, lessTextOf, DEFAULT_DEPS, LESS_TEXT_RATIO, LESS_TEXT_MIN };
