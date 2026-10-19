'use strict';

// node server/services/restyle/restyleFetch.test.js   (npm run test:restyle-fetch). How the CSS tool fetches a live page: it never settles for
// a text-only copy, it tries other identities when a site's firewall refuses one (a real site answered 403 to "Chrome on Windows" and 200 to
// others), it remembers the identity that worked for the style files, and it says so honestly when everything is refused. No network.

const assert = require('assert');
const { createPageFetcher, isRealPage, PROFILES, BLOCKED_TITLE } = require('./pageFetch');

const PAGE = `<!DOCTYPE html><html><head><title>Walk-In Wine Cabinets</title></head><body>${'<p>real content of a real page</p>'.repeat(20)}</body></html>`;
const ua = (headers) => headers['User-Agent'];

// a fake network: which identities a site accepts, and what it says to the others
function fakeSite({ accepts, refuseWith = 403, page = PAGE, css = '.a{color:red}' }) {
  const calls = [];
  const fetchOnce = async (url, redirects, timeout, extra, cookies, headers) => {
    const who = PROFILES.find((p) => p.headers === headers).id;
    calls.push({ url, who, accept: extra && extra.Accept });
    if (!accepts.includes(who)) return { body: 'blocked', statusCode: refuseWith, finalUrl: url };
    return { body: /\.css/.test(url) ? css : page, statusCode: 200, finalUrl: url.replace('://www.', '://') };
  };
  return { fetchOnce, calls };
}

(async () => {
  // ---- the identities ----
  assert.deepStrictEqual(PROFILES.map((p) => p.id), ['chrome', 'firefox', 'plain', 'minimal']);
  assert.ok(PROFILES.every((p) => ua(p.headers)), 'each has a user agent');
  assert.match(ua(PROFILES.find((p) => p.id === 'plain').headers), /VaultCSSTool/, 'one of them says honestly who it is');

  // ---- what counts as the real page ----
  assert.strictEqual(isRealPage({ statusCode: 200, body: PAGE }), true);
  assert.strictEqual(isRealPage({ statusCode: 403, body: PAGE }), false);
  assert.strictEqual(isRealPage({ statusCode: 202, body: PAGE }), false, '202 is a "come back later", not a page');
  assert.strictEqual(isRealPage({ statusCode: 200, body: '<html><body>hi</body></html>' }), false, 'a stub is not a page');
  assert.strictEqual(isRealPage({ statusCode: 200, body: 'just some text '.repeat(40) }), false, 'text with no markup is not a page');
  for (const title of ['403 - Forbidden', 'Access Denied', 'Just a moment...', 'Attention Required! | Cloudflare', 'Robot Challenge Screen', 'Are you a robot?', 'Verify you are human']) {
    assert.strictEqual(isRealPage({ statusCode: 200, body: PAGE.replace('Walk-In Wine Cabinets', title) }), false, `"${title}" served with a 200 is a refusal`);
    assert.ok(BLOCKED_TITLE.test(title));
  }
  assert.strictEqual(isRealPage({ statusCode: 200, body: PAGE.replace('Walk-In Wine Cabinets', 'Forbidden fruit: a cookbook') }), true, 'a page about forbidden fruit is a page');
  assert.strictEqual(BLOCKED_TITLE.test('403 Forbidden Windows blinds'), true);

  // ---- a site that accepts everything: one request ----
  let site = fakeSite({ accepts: ['chrome', 'firefox', 'plain', 'minimal'] });
  let fetchPage = createPageFetcher({ fetchOnce: site.fetchOnce });
  let got = await fetchPage('https://example.com/');
  assert.strictEqual(got.profile, 'chrome');
  assert.strictEqual(site.calls.length, 1);

  // ---- a site that turns Chrome away: the next identity gets the real page, and the style files are asked for that way first ----
  site = fakeSite({ accepts: ['firefox', 'plain', 'minimal'] });
  fetchPage = createPageFetcher({ fetchOnce: site.fetchOnce });
  got = await fetchPage('https://www.example.com/');
  assert.strictEqual(got.profile, 'firefox');
  assert.deepStrictEqual(site.calls.map((c) => c.who), ['chrome', 'firefox']);
  assert.strictEqual(got.finalUrl, 'https://example.com/', 'the address the page ended up at (after redirects) is returned, so relative addresses resolve against it');
  assert.strictEqual(got.body, PAGE);
  const sheet = await fetchPage('https://example.com/css/theme.css', { asset: true });
  assert.strictEqual(sheet.profile, 'firefox');
  assert.deepStrictEqual(site.calls.slice(2).map((c) => c.who), ['firefox'], 'the identity that worked is used first for the style files');
  assert.strictEqual(site.calls[2].accept, 'text/css,*/*;q=0.1', 'a style file is asked for as a style file');
  assert.strictEqual(sheet.body, '.a{color:red}');

  // ---- a firewall that serves its refusal as a normal-looking 200 page is also tried again ----
  let phase = 0;
  const challenge = PAGE.replace('Walk-In Wine Cabinets', 'Robot Challenge Screen');
  fetchPage = createPageFetcher({ fetchOnce: async (url, r, t, e, c, headers) => { phase += 1; return { body: headers === PROFILES[0].headers ? challenge : PAGE, statusCode: 200, finalUrl: url }; } });
  got = await fetchPage('https://example.com/');
  assert.strictEqual(got.profile, 'firefox');
  assert.strictEqual(phase, 2);

  // ---- everything refused: an honest error, never a text-only copy ----
  site = fakeSite({ accepts: [], refuseWith: 403 });
  fetchPage = createPageFetcher({ fetchOnce: site.fetchOnce });
  await assert.rejects(fetchPage('https://example.com/'), /^Error: Server returned 403$/);
  assert.strictEqual(site.calls.length, PROFILES.length, 'every identity was tried');
  site = fakeSite({ accepts: [], refuseWith: 429 });
  await assert.rejects(createPageFetcher({ fetchOnce: site.fetchOnce })('https://example.com/'), /Server returned 429/);

  // ---- things another identity cannot fix are not retried ----
  let n = 0;
  await assert.rejects(createPageFetcher({ fetchOnce: async () => { n += 1; return { body: 'gone', statusCode: 404, finalUrl: 'x' }; } })('https://example.com/missing'), /Server returned 404/);
  assert.strictEqual(n, 1, 'a 404 is the real answer');
  n = 0;
  await assert.rejects(createPageFetcher({ fetchOnce: async () => { n += 1; throw new Error('Address resolves to a private IP'); } })('https://intranet.local/'), /private/);
  assert.strictEqual(n, 1, 'a private address is refused once');
  n = 0;
  await assert.rejects(createPageFetcher({ fetchOnce: async () => { n += 1; throw new Error('Request timed out'); } })('https://slow.example.com/'), /timed out/);
  assert.strictEqual(n, PROFILES.length, 'a timeout is retried with the other identities');

  // ---- style files: any 2xx with content counts ----
  fetchPage = createPageFetcher({ fetchOnce: async (u) => ({ body: '', statusCode: 200, finalUrl: u }) });
  await assert.rejects(fetchPage('https://example.com/empty.css', { asset: true }), /Server returned 200/, 'an empty style file is not a style file');

  // ---- a connection that fails outright: the www / http alternates are tried, in that order, and the original error is kept if none works ----
  const { alternateUrls } = require('./pageFetch');
  assert.deepStrictEqual(alternateUrls('https://example.com/a?b=1'), ['https://www.example.com/a?b=1', 'http://example.com/a?b=1']);
  assert.deepStrictEqual(alternateUrls('http://www.example.com/'), ['http://example.com/', 'https://www.example.com/']);
  assert.deepStrictEqual(alternateUrls('not a url'), []);
  const tried = [];
  const onlyWww = createPageFetcher({ fetchOnce: async (url) => { tried.push(url); if (url.startsWith('https://www.')) return { body: PAGE, statusCode: 200, finalUrl: url }; throw new Error('Client network socket disconnected before secure TLS connection was established'); } });
  got = await onlyWww('https://example.com/');
  assert.strictEqual(got.finalUrl, 'https://www.example.com/', 'a site that only answers on its www name is found');
  assert.ok(tried.indexOf('https://www.example.com/') > tried.indexOf('https://example.com/'), 'the address as typed comes first');
  tried.length = 0;
  const dead = createPageFetcher({ fetchOnce: async (url) => { tried.push(url); throw new Error(url.startsWith('https://example.com') ? 'getaddrinfo ENOTFOUND example.com' : 'ECONNRESET'); } });
  await assert.rejects(dead('https://example.com/'), /ENOTFOUND example\.com/, 'when nothing works the error for the address typed is the one shown');
  assert.ok(tried.some((u) => u.startsWith('http://example.com')) && tried.some((u) => u.startsWith('https://www.example.com')), 'both alternates were tried');
  tried.length = 0;
  await assert.rejects(createPageFetcher({ fetchOnce: async (url) => { tried.push(url); return { body: 'no', statusCode: 403, finalUrl: url }; } })('https://example.com/'), /Server returned 403/);
  assert.ok(tried.every((u) => u === 'https://example.com/'), 'a refusal (the site answered) does not go looking for other addresses');

  console.log('restyle fetch tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
