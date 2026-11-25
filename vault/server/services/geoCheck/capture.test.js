'use strict';

// node server/services/geoCheck/capture.test.js
// A fake browser stands in for Chromium: the context options per country, media blocked unless allowed, SSRF refusal, the exit check,
// bytes summed, blocked pages, and plain error words. Uses IP-literal addresses so no DNS lookup is needed.

const assert = require('assert');
const { captureOne, captureCountry, contextOptions, pageFacts } = require('./capture');
const { countryOf } = require('./countries');

const PROXY = { server: 'http://gw.example.net:823', username: 'SECRETUSER', password: 'SECRETPASS' };
const PAGE = 'http://93.184.216.34/shop';
const CHECK = 'http://93.184.216.35/json';

function fakeBrowser({ exitJson = { country: 'AU' }, status = 200, title = 'Shop', gotoError = null, height = 3000 } = {}) {
  const seen = { contexts: [], shots: [], closed: { context: 0, browser: 0 } };
  const browser = {
    async newContext(opts) {
      const listeners = {};
      const ctx = {
        opts, route: null,
        async route(_pattern, handler) { ctx.route = handler; },
        on(evt, fn) { listeners[evt] = fn; },
        async close() { seen.closed.context += 1; },
        async newPage() {
          let current = null;
          const finish = (n) => listeners.requestfinished && listeners.requestfinished({ sizes: async () => ({ requestHeadersSize: n, requestBodySize: 0, responseHeadersSize: n, responseBodySize: n * 10 }) });
          return {
            async goto(address) {
              if (address === CHECK) { finish(10); return { json: async () => exitJson }; }
              if (gotoError) throw new Error(gotoError);
              current = address; finish(100);
              return { status: () => status };
            },
            url: () => current,
            async waitForLoadState() {},
            async waitForTimeout() {},
            async setViewportSize(v) { seen.viewports = (seen.viewports || []).concat([v.width]); },
            async evaluate(_fn, arg) {
              if (arg !== undefined) return undefined; // the scroll
              return { lang: 'en-AU', title, text: 'Price A$49.95 AUD, cookies', headings: ['Sale'], buttons: ['Buy'], height };
            },
            async screenshot(o) { seen.shots.push(o); return Buffer.from('jpeg'); },
          };
        },
      };
      seen.contexts.push(ctx);
      return ctx;
    },
    async close() { seen.closed.browser += 1; },
  };
  return { browser, seen };
}

const deps = (browser, extra = {}) => ({ launch: async () => browser, proxyFor: () => PROXY, checkUrl: () => CHECK, ...extra });
const SCREEN = { width: 390, height: 844, mobile: true };

function fakeRoute(url, resourceType = 'document') {
  const r = { result: null, request: () => ({ url: () => url, resourceType: () => resourceType }) };
  r.abort = async () => { r.result = 'abort'; };
  r.continue = async () => { r.result = 'continue'; };
  return r;
}

(async () => {
  // context options per country
  const de = contextOptions(countryOf('DE'), SCREEN, PROXY);
  assert.strictEqual(de.locale, 'de-DE');
  assert.strictEqual(de.timezoneId, 'Europe/Berlin');
  assert.deepStrictEqual(de.permissions, ['geolocation']);
  assert.strictEqual(de.extraHTTPHeaders['Accept-Language'], 'de-DE,de;q=0.9');
  assert.strictEqual(de.isMobile, true);
  assert.ok(/Mobile/.test(de.userAgent));
  assert.strictEqual(de.proxy, PROXY);
  assert.strictEqual(contextOptions(countryOf('JP'), { width: 1280, height: 900 }, PROXY).isMobile, false);
  assert.strictEqual(contextOptions(countryOf('JP'), [SCREEN, { width: 1280, height: 900 }], PROXY).isMobile, false, 'a phone only when every screen is');
  assert.strictEqual(contextOptions(countryOf('JP'), [SCREEN, SCREEN], PROXY).viewport.width, 390);

  // a good capture
  let { browser, seen } = fakeBrowser();
  let out = await captureOne({ url: PAGE, country: 'au', screen: SCREEN }, deps(browser));
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(out.verified, true);
  assert.strictEqual(out.label, 'Verified');
  assert.strictEqual(out.httpStatus, 200);
  assert.strictEqual(out.finalUrl, PAGE);
  assert.strictEqual(out.bytes, 120 + 1200, 'exit check and page bytes are both counted');
  assert.deepStrictEqual(out.facts.currencies.sort(), ['A$', 'AUD'].sort());
  assert.deepStrictEqual(out.facts.prices, ['A$49.95']);
  assert.strictEqual(out.facts.consentBanner, true);
  assert.strictEqual(out.cut, false);
  assert.strictEqual(seen.shots[0].type, 'jpeg');
  assert.strictEqual(seen.shots[0].clip.height, 3000);
  assert.deepStrictEqual(seen.closed, { context: 1, browser: 1 });
  assert.strictEqual(seen.contexts[0].opts.locale, 'en-AU');

  // the guard: media blocked by default, private addresses refused, public pages through
  const route = seen.contexts[0].route;
  let r = fakeRoute('http://93.184.216.34/clip.mp4', 'media'); await route(r); assert.strictEqual(r.result, 'abort');
  r = fakeRoute('http://127.0.0.1/admin'); await route(r); assert.strictEqual(r.result, 'abort', 'SSRF refusal');
  r = fakeRoute('http://10.0.0.5/'); await route(r); assert.strictEqual(r.result, 'abort', 'SSRF refusal');
  r = fakeRoute('http://93.184.216.34/font.woff2', 'font'); await route(r); assert.strictEqual(r.result, 'continue', 'fonts load');
  ({ browser, seen } = fakeBrowser());
  await captureOne({ url: PAGE, country: 'AU', screen: SCREEN, allowMedia: true }, deps(browser));
  r = fakeRoute('http://93.184.216.34/clip.mp4', 'media'); await seen.contexts[0].route(r); assert.strictEqual(r.result, 'continue', 'media allowed when asked');

  // exited from the wrong country, and no answer: rendered anyway, labelled
  ({ browser } = fakeBrowser({ exitJson: { country: 'US' } }));
  out = await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser));
  assert.strictEqual(out.status, 'ok');
  assert.strictEqual(out.label, 'Unverified: exited from US');
  ({ browser } = fakeBrowser({ exitJson: { nothing: true } }));
  out = await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser));
  assert.strictEqual(out.label, 'Unverified: exit not confirmed');

  // a robot check or refusal is "blocked", with its picture
  ({ browser } = fakeBrowser({ title: 'Just a moment...' }));
  out = await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser));
  assert.strictEqual(out.status, 'blocked');
  assert.ok(out.image);
  ({ browser } = fakeBrowser({ status: 403 }));
  assert.strictEqual((await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser))).status, 'blocked');

  // a tall page is cut at 8,000 px
  ({ browser, seen } = fakeBrowser({ height: 20000 }));
  out = await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser));
  assert.strictEqual(out.cut, true);
  assert.strictEqual(seen.shots[0].clip.height, 8000);

  // failures come back in plain words, never Playwright's message (which repeats the address and could carry details)
  ({ browser, seen } = fakeBrowser({ gotoError: `page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at ${PAGE}?token=abc` }));
  out = await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser));
  assert.strictEqual(out.status, 'failed');
  assert.ok(/^The proxy refused/.test(out.error));
  assert.ok(!JSON.stringify(out).includes('SECRET') && !out.error.includes('token'));
  assert.deepStrictEqual(seen.closed, { context: 1, browser: 1 }, 'closed after a failure too');
  // a wrong proxy password: Chromium only times out on the exit check, and the page is not tried
  ({ browser } = fakeBrowser());
  const origNewContext = browser.newContext;
  let pageTried = false;
  browser.newContext = async (o) => { const c = await origNewContext(o); const np = c.newPage; c.newPage = async () => { const p = await np(); const g = p.goto; p.goto = async (a) => { if (a === CHECK) throw new Error('page.goto: Timeout 15000ms exceeded.'); pageTried = true; return g(a); }; return p; }; return c; };
  out = await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser));
  assert.ok(/^The proxy did not answer/.test(out.error), out.error);
  assert.strictEqual(pageTried, false);
  ({ browser } = fakeBrowser({ gotoError: 'page.goto: Timeout 30000ms exceeded.' }));
  assert.strictEqual((await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser))).error, 'The page took too long to load through the proxy.');
  ({ browser } = fakeBrowser({ gotoError: 'net::ERR_CONNECTION_RESET' }));
  assert.ok(/Connection dropped/.test((await captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser))).error));

  // set-up problems throw before a browser is opened
  await assert.rejects(captureOne({ url: PAGE, country: 'XX', screen: SCREEN }, deps(browser)), /not in the list/);
  await assert.rejects(captureOne({ url: PAGE, country: 'AU', screen: SCREEN }, deps(browser, { proxyFor: () => null })), /not set up/);

  // page facts keep no page text
  const facts = pageFacts({ text: 'Total €12,50 or 9 kr. Ships from USD 5', headings: [' A ', 'A', ''], buttons: [] });
  assert.deepStrictEqual(facts.headings, ['A']);
  assert.ok(facts.prices.includes('€12,50') && facts.prices.includes('9 kr') && facts.prices.includes('USD 5'), JSON.stringify(facts.prices));
  assert.ok(!('text' in facts));

  // one load per country, resized per screen, in a shared browser that is left open; Stop ends between screens
  ({ browser, seen } = fakeBrowser());
  const LAPTOP = { width: 1366, height: 768 };
  out = await captureCountry({ url: PAGE, country: 'NZ', screens: [SCREEN, LAPTOP] }, deps(browser, { browser }));
  assert.strictEqual(out.shots.length, 2);
  assert.deepStrictEqual(seen.viewports, [1366]);
  assert.strictEqual(seen.shots[1].clip.width, 1366);
  assert.strictEqual(seen.contexts.length, 1, 'one context (one load) for both screens');
  assert.deepStrictEqual(seen.closed, { context: 1, browser: 0 }, 'a shared browser stays open');
  const ac = new AbortController(); ac.abort();
  ({ browser } = fakeBrowser());
  assert.strictEqual((await captureCountry({ url: PAGE, country: 'NZ', screens: [SCREEN, LAPTOP] }, deps(browser, { signal: ac.signal }))).shots.length, 0);

  console.log('geoCheck capture tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
