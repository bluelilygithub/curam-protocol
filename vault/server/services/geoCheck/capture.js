'use strict';

// One Geo-check capture: open a page in a real browser as a visitor in one country sees it (through a residential proxy in that country,
// with its language, time zone and location), check where the proxy really exited, and take a JPEG of the page with the facts the diff
// needs. The safety rules are renderPage.js's own (guardContext: every request checked with checkSsrf; the final address checked again).
// Differences from renderPage, on purpose: fonts load (a picture without the site's fonts looks wrong), video and sound are blocked unless
// allowed, and there is no identity retry (each retry is paid proxy traffic; a refusal is shown as "blocked", which is what a visitor
// gets). See docs/geo-check.md. Test: node server/services/geoCheck/capture.test.js (no browser is started there).

const { countryOf } = require('./countries');
const proxy = require('./proxy');
const { readExitCountry, exitVerdict } = require('./exitCheck');
const { guardContext, openPage, assertPublicFinalUrl, loadPlaywright, USER_AGENTS, SETTLE_TIMEOUT_MS } = require('../restyle/renderPage');
const { BLOCKED_TITLE } = require('../restyle/pageFetch');

const MAX_SHOT_HEIGHT = 8000;
const EXIT_CHECK_TIMEOUT_MS = 15000;
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
// Chromium's words for "the proxy itself failed" (wrong password, no traffic left, gateway down), told apart from the site failing.
const PROXY_FAILED = /net::ERR_(PROXY_\w+|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES)/;

/** The browser context settings for one country and one screen. */
function contextOptions(country, screen, proxyOption) {
  const mobile = !!screen.mobile;
  return {
    viewport: { width: screen.width, height: screen.height },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? MOBILE_UA : USER_AGENTS[0],
    locale: country.locale, timezoneId: country.timezoneId,
    geolocation: { latitude: country.latitude, longitude: country.longitude }, permissions: ['geolocation'],
    extraHTTPHeaders: { 'Accept-Language': `${country.locale},${country.locale.split('-')[0]};q=0.9` },
    acceptDownloads: false, serviceWorkers: 'block', javaScriptEnabled: true,
    proxy: proxyOption,
  };
}

const CURRENCY_CODES = ['AUD', 'NZD', 'USD', 'GBP', 'EUR', 'JPY', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'SGD', 'HKD', 'KRW', 'INR', 'IDR', 'MYR', 'PHP', 'THB', 'AED', 'ZAR', 'BRL', 'MXN', 'CNY'];
const CODE_RE = new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b`, 'g');
const SYMBOL_RE = /(A\$|AU\$|NZ\$|US\$|C\$|CA\$|S\$|HK\$|R\$|£|€|¥|₩|₹|₱|฿)/g;
const PRICE_RE = /(?:(?:A\$|AU\$|NZ\$|US\$|C\$|CA\$|S\$|HK\$|R\$|\$|£|€|¥|₩|₹|₱|฿)\s?\d(?:[\d,.]*\d)?|\d(?:[\d,.]*\d)?\s?(?:€|kr|zł|CHF)|\b(?:AUD|NZD|USD|GBP|EUR|JPY|CAD)\s?\d(?:[\d,.]*\d)?)/g;

const uniq = (list, max) => [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].slice(0, max);

/** The page facts kept for the diff, from what the browser read. The page's full text is not kept. */
function pageFacts(raw = {}) {
  const text = String(raw.text || '');
  return {
    htmlLang: String(raw.lang || '').slice(0, 20) || null,
    title: String(raw.title || '').slice(0, 300),
    currencies: uniq([...(text.match(CODE_RE) || []), ...(text.match(SYMBOL_RE) || [])], 20),
    prices: uniq(text.match(PRICE_RE) || [], 40),
    headings: uniq(raw.headings || [], 60).map((s) => s.slice(0, 200)),
    buttons: uniq(raw.buttons || [], 80).map((s) => s.slice(0, 100)),
    consentBanner: /\b(cookies?|consent|gdpr)\b/i.test(text.slice(0, 20000)),
  };
}

/** Counts the bytes of every request the context finishes (proxy traffic is paid by the byte). */
function countBytes(context) {
  const pending = [];
  context.on('requestfinished', (req) => {
    pending.push(Promise.resolve().then(() => req.sizes()).then(
      (s) => (s.requestHeadersSize || 0) + (s.requestBodySize || 0) + (s.responseHeadersSize || 0) + (s.responseBodySize || 0),
      () => 0,
    ));
  });
  return async () => (await Promise.all(pending)).reduce((a, b) => a + b, 0);
}

const PROXY_REFUSED = 'The proxy refused the connection. Check the GEO_PROXY_ settings on Railway and that the account has traffic left.';
const PROXY_SILENT = 'The proxy did not answer. Check the GEO_PROXY_ settings on Railway (a wrong username or password looks like this) and that the account has traffic left.';

/** Asks the check address through the same context; returns the two-letter country, or null when the answer is unreadable. */
async function exitCountryOf(page, address) {
  try {
    const res = await page.goto(address, { waitUntil: 'domcontentloaded', timeout: EXIT_CHECK_TIMEOUT_MS });
    return res ? readExitCountry(await res.json()) : null;
  } catch (err) {
    const message = String(err && err.message);
    if (PROXY_FAILED.test(message)) throw new Error(PROXY_REFUSED);
    // Chromium answers a refused proxy password by asking again forever, so it shows up only as a time-out (tried 2026-11-25):
    // stop here rather than wait for the page as well.
    if (/Timeout/i.test(message)) throw new Error(PROXY_SILENT);
    return null;
  }
}

// Steps down the page so pictures that load as you scroll, and scroll animations, appear; then back to the top.
async function scrollThrough(page) {
  await page.evaluate(async (max) => {
    const step = Math.max(200, window.innerHeight);
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  }, MAX_SHOT_HEIGHT).catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * @param {{url:string, country:string, screen:{width:number,height:number,mobile?:boolean}, allowMedia?:boolean}} opts
 *   url already normalised and checked with checkSsrf by the caller
 * @returns {Promise<{country, status:'ok'|'blocked'|'failed', exitCountry, verified, label, httpStatus, finalUrl, facts, bytes, image:Buffer|null, cut:boolean, error:string|null}>}
 */
async function captureOne({ url, country: code, screen, allowMedia = false }, deps = {}) {
  const country = countryOf(code);
  if (!country) throw new Error('That country is not in the list.');
  const proxyOption = (deps.proxyFor || proxy.proxyFor)(country.code);
  if (!proxyOption) throw new Error('Geo-check is not set up: the proxy details are missing.');
  const launch = deps.launch || (() => loadPlaywright().chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] }));

  const browser = await launch();
  const out = {
    country: country.code, status: 'failed', exitCountry: null, verified: false, label: 'Unverified: exit not confirmed',
    httpStatus: null, finalUrl: null, facts: null, bytes: 0, image: null, cut: false, error: null,
  };
  let context = null;
  try {
    context = await browser.newContext(contextOptions(country, screen, proxyOption));
    await guardContext(context, new Set(allowMedia ? [] : ['media']));
    const totalBytes = countBytes(context);
    const page = await context.newPage();
    try {
      Object.assign(out, exitVerdict(country.code, await exitCountryOf(page, (deps.checkUrl || proxy.checkUrl)())));
      const opened = await openPage(page, url);
      if (opened.dropped) {
        out.error = 'Connection dropped: the website cut the browser off.';
      } else {
        out.httpStatus = opened.response ? opened.response.status() : null;
        await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
        out.finalUrl = page.url();
        await assertPublicFinalUrl(out.finalUrl);
        await scrollThrough(page);
        const raw = await page.evaluate(() => ({
          lang: document.documentElement.lang || '',
          title: document.title || '',
          text: document.body ? document.body.innerText.slice(0, 200000) : '',
          headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((e) => e.innerText),
          buttons: Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).map((e) => e.innerText || e.value || ''),
          height: document.documentElement.scrollHeight,
        }));
        out.facts = pageFacts(raw);
        out.cut = raw.height > MAX_SHOT_HEIGHT;
        out.image = await page.screenshot({
          type: 'jpeg', quality: 70, fullPage: true, timeout: 30000,
          clip: { x: 0, y: 0, width: screen.width, height: Math.max(1, Math.min(raw.height || screen.height, MAX_SHOT_HEIGHT)) },
        });
        out.status = (out.httpStatus >= 400 || BLOCKED_TITLE.test(out.facts.title)) ? 'blocked' : 'ok';
      }
    } catch (err) {
      const message = String(err && err.message);
      // Playwright's own messages repeat the address and call log: only plain words leave this function.
      if (PROXY_FAILED.test(message)) out.error = PROXY_REFUSED;
      else if (message.startsWith('The proxy') || message.startsWith('The page redirected')) out.error = message;
      else if (/Timeout/i.test(message)) out.error = 'The page took too long to load through the proxy.';
      else out.error = 'The page could not be loaded through the proxy.';
    }
    out.bytes = await totalBytes();
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return out;
}

module.exports = { captureOne, contextOptions, pageFacts, countBytes, MAX_SHOT_HEIGHT, PROXY_FAILED };
