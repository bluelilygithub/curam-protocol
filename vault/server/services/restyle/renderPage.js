'use strict';

// Loads a page in a real (headless) browser so a page that builds itself with JavaScript, such as most shops, apps and many marketing
// sites, comes back with its content in it. Only used when the person ticks "builds itself with JavaScript" in the CSS tool, or "Load with
// a real browser" / Sign in in the Web Extractor, because it is slower and heavier than a plain fetch. The page's scripts run here, in the browser, never in Vault's own process; what comes back is the
// finished HTML, which the CSS tool then cleans of scripts like any other page.
//
// Safety, in order of importance:
//  - every request the page makes (the page itself, redirects, scripts, images, anything) is checked with checkSsrf() first, so a page
//    cannot be used to reach a private address or Vault's own network. Known limit: the browser looks the name up again itself, so a
//    hostile DNS record that changes between the two lookups is not covered (the same limit the Browser Agent has).
//  - one render at a time (a small queue behind it), a hard time limit, a size limit, no downloads, no service workers, media and fonts
//    not fetched, a new browser per render that is always closed.
// Test: node server/services/restyle/restyleLoad.test.js (no browser is started there).

const fs = require('fs');
const { checkSsrf } = require('../htmlFetch');
const { BLOCKED_TITLE, titleOfHtml } = require('./pageFetch');

const RENDER_TIMEOUT_MS = 30000;
const SETTLE_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 5 * 1024 * 1024;
const MAX_QUEUED = 2;
const BLOCKED_TYPES = new Set(['media', 'font']);
// Who the browser says it is, in order: a site's firewall may turn away one and let another through.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (compatible; VaultCSSTool/1.0)',
  'curl/8.5.0',
];
// The browser could not reach the page at all: some firewalls cut the connection for an identity they turn away instead of answering
// (finestone.com.au drops "Chrome" with ERR_HTTP2_PROTOCOL_ERROR and lets "Firefox" in), so this is a refusal to retry, not the end.
const CONNECTION_REFUSED = /net::ERR_(HTTP2_PROTOCOL_ERROR|CONNECTION_(CLOSED|RESET|REFUSED|ABORTED)|EMPTY_RESPONSE|SSL_PROTOCOL_ERROR|QUIC_PROTOCOL_ERROR)/;

let availableCache = null;
let running = 0;
let waiting = 0;

function loadPlaywright() {
  try { return require('playwright'); } catch { return null; }
}

/** True when the headless browser is installed on this server (it is in the Docker image, often not on a laptop). Cached. */
function renderAvailable() {
  if (availableCache !== null) return availableCache;
  try {
    const pw = loadPlaywright();
    availableCache = !!(pw && pw.chromium && fs.existsSync(pw.chromium.executablePath()));
  } catch {
    availableCache = false;
  }
  return availableCache;
}

/** Waits for the one render slot; refuses when too many are already waiting. */
async function takeSlot() {
  if (running === 0) { running = 1; return; }
  if (waiting >= MAX_QUEUED) throw new Error('The page loader is busy right now. Try again in a minute.');
  waiting += 1;
  try {
    while (running > 0) await new Promise((r) => setTimeout(r, 400));
  } finally { waiting -= 1; }
  running = 1;
}

// ── Signing in (Web Extractor only) ─────────────────────────────────────────────────────────────────────────────────────
// The person's own username and password, used for this one render and never stored or logged. Two kinds of sign-in are covered:
//  - the browser's own password box (HTTP Basic/Digest): answered through httpCredentials, and only for the page's own site;
//  - a sign-in form on the page: the first visible password box is filled, with the name box in the same form, and the form sent.
// A name-first, password-on-the-next-screen form (two steps) is only tried on a sign-in page address the person gave, because on an
// ordinary page the only visible email box is usually a newsletter sign-up.
// One identity only when signing in: trying the same password four times over could lock the account.
const SIGN_IN_WAIT_MS = 15000;
const STRICT_USER_FIELD = 'input[type="email"], input[autocomplete="username" i], input[autocomplete="email" i], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i], input[id*="login" i]';
const ANY_USER_FIELD = `${STRICT_USER_FIELD}, input[type="text"], input:not([type])`;
const SUBMIT = 'button[type="submit"], input[type="submit"], button:not([type])';
const SIGN_IN_FAILED = 'Sign-in did not work: the page still asks for a password. Check the username and password. Sites that send a code, ask for a CAPTCHA or use "Sign in with Google" cannot be signed in to this way.';

async function firstVisible(locator) {
  const n = Math.min(await locator.count().catch(() => 0), 20);
  for (let i = 0; i < n; i += 1) {
    const el = locator.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

async function submitForm(page, scope, field) {
  const button = await firstVisible(scope.locator(SUBMIT));
  if (button) await button.click({ timeout: 5000 }).catch(() => field.press('Enter'));
  else await field.press('Enter');
  await page.waitForLoadState('domcontentloaded', { timeout: SIGN_IN_WAIT_MS }).catch(() => {});
}

/** Fills and sends the sign-in form on the open page. Returns true when a form was found and sent. */
async function signIn(page, { username, password }, { twoStep }) {
  try {
    let pwd = await firstVisible(page.locator('input[type="password"]'));
    if (!pwd && twoStep && username) {
      const user = await firstVisible(page.locator(STRICT_USER_FIELD));
      if (!user) return false;
      await user.fill(username);
      const form = user.locator('xpath=ancestor::form[1]');
      await submitForm(page, (await form.count()) ? form : page, user);
      await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: SIGN_IN_WAIT_MS }).catch(() => {});
      pwd = await firstVisible(page.locator('input[type="password"]'));
      if (!pwd) throw new Error(SIGN_IN_FAILED);
      username = ''; // eslint-disable-line no-param-reassign -- already given on the first screen
    }
    if (!pwd) return false;
    const form = pwd.locator('xpath=ancestor::form[1]');
    const scope = (await form.count()) ? form : page;
    if (username) {
      const user = await firstVisible(scope.locator(ANY_USER_FIELD));
      if (user) await user.fill(username);
    }
    await pwd.fill(password);
    await submitForm(page, scope, pwd);
    await page.locator('input[type="password"]').first().waitFor({ state: 'hidden', timeout: SIGN_IN_WAIT_MS }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    return true;
  } catch (err) {
    // Playwright's own messages can describe the call that failed; only our plain words leave this function.
    throw new Error(String(err && err.message).startsWith('Sign-in') ? err.message : 'Sign-in failed: the sign-in form could not be filled in.');
  }
}

// ── Shared with Geo-check (server/services/geoCheck/capture.js): the safety rules for any browser context Vault opens ──

/** Checks every request the context makes with checkSsrf() (verdict per host remembered for this context) and drops blocked kinds. */
async function guardContext(context, blockedTypes = BLOCKED_TYPES) {
  const verdicts = new Map();
  const hostAllowed = async (hostname) => {
    if (!verdicts.has(hostname)) verdicts.set(hostname, checkSsrf(hostname).then(() => true, () => false));
    return verdicts.get(hostname);
  };
  await context.route('**/*', async (route) => {
    const req = route.request();
    let parsed;
    try { parsed = new URL(req.url()); } catch { return route.abort(); }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return route.continue();
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return route.abort();
    if (blockedTypes.has(req.resourceType())) return route.abort();
    return (await hostAllowed(parsed.hostname)) ? route.continue() : route.abort();
  });
}

/** page.goto that turns "the site cut the connection" into { dropped: true } instead of an error. */
async function openPage(page, address) {
  try {
    return { response: await page.goto(address, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS }) };
  } catch (err) {
    if (CONNECTION_REFUSED.test(String(err && err.message))) return { dropped: true };
    throw err;
  }
}

/** A redirect leg is not seen by context.route, so the address the page ended on is checked again. */
async function assertPublicFinalUrl(finalUrl) {
  try { await checkSsrf(new URL(finalUrl).hostname); } catch { throw new Error('The page redirected to a private or internal address'); }
}

/** Opens the page once as one identity. Returns what came back, including the status of the page itself. */
async function renderOnce(browser, userAgent, url, login = null) {
  let origin = null;
  try { origin = new URL(url).origin; } catch { /* checked by the caller */ }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, locale: 'en-AU', userAgent,
    acceptDownloads: false, serviceWorkers: 'block', javaScriptEnabled: true,
    ...(login ? { httpCredentials: { username: login.username || '', password: login.password, origin } } : {}),
  });
  try {
    await guardContext(context);
    const page = await context.newPage();
    const open = (address) => openPage(page, address);
    let opened = await open(login && login.loginUrl ? login.loginUrl : url);
    if (opened.dropped) return { status: 0, html: '', finalUrl: url, dropped: true };
    let signedIn = false;
    let landing = null; // where the site put us straight after signing in
    if (login) {
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      signedIn = await signIn(page, login, { twoStep: !!login.loginUrl });
      if (signedIn) landing = { url: page.url(), asksPassword: !!(await firstVisible(page.locator('input[type="password"]'))) };
      // After signing in, open the page asked for (sites often land you on an account page instead).
      if (signedIn || login.loginUrl) {
        opened = await open(url);
        if (opened.dropped) return { status: 0, html: '', finalUrl: url, dropped: true };
      }
    }
    let { response } = opened;
    let status = response ? response.status() : 0;
    if (status >= 400) return { status, html: '', finalUrl: page.url(), signedIn };
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    let readLanding = false;
    if (signedIn && await firstVisible(page.locator('input[type="password"]'))) {
      // The sign-in worked (the form went away) but the address asked for is the sign-in form itself: read where the site put us.
      if (!landing || landing.asksPassword) throw new Error(SIGN_IN_FAILED);
      opened = await open(landing.url);
      if (opened.dropped) return { status: 0, html: '', finalUrl: url, dropped: true };
      ({ response } = opened);
      status = response ? response.status() : 0;
      if (status >= 400) return { status, html: '', finalUrl: page.url(), signedIn };
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      if (await firstVisible(page.locator('input[type="password"]'))) throw new Error(SIGN_IN_FAILED);
      readLanding = true;
    }
    // Wake up pictures that load as you scroll, then come back to the top.
    await page.evaluate(() => { window.scrollTo(0, document.body ? document.body.scrollHeight : 0); }).catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.scrollTo(0, 0); }).catch(() => {});
    // Styles added by script through the style API (common with CSS-in-JS) have no text in their <style> element: copy the rules in.
    await page.evaluate(() => {
      Array.from(document.styleSheets).forEach((sheet) => {
        const node = sheet.ownerNode;
        if (!node || node.tagName !== 'STYLE' || node.textContent.trim()) return;
        try { node.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'); } catch { /* cross-origin sheet: has a link, handled separately */ }
      });
    }).catch(() => {});
    const finalUrl = page.url();
    await assertPublicFinalUrl(finalUrl);
    return { status, html: await page.content(), finalUrl, signedIn, readLanding };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * @param {string} url  an http(s) address already normalised by the caller
 * @param {{login?: {username?: string, password: string, loginUrl?: string}}} [opts]  sign in first (Web Extractor); never stored or logged
 * @returns {Promise<{html:string, finalUrl:string, signedIn:boolean, readLanding:boolean}>}  signedIn: a sign-in form was found and sent;
 *   readLanding: the address given was the sign-in form itself, so the page the site showed after signing in was read instead
 */
async function renderPage(url, { login = null } = {}) {
  if (!renderAvailable()) throw new Error('Loading pages that build themselves with JavaScript is not set up on this server.');
  await takeSlot();
  let browser = null;
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    let lastStatus = 0;
    let dropped = 0;
    for (const userAgent of (login ? USER_AGENTS.slice(0, 1) : USER_AGENTS)) {
      const out = await renderOnce(browser, userAgent, url, login);
      if (out.dropped) { dropped += 1; continue; }
      lastStatus = out.status || lastStatus;
      // refused, or sent to a "robot challenge" page: the next identity may be let in
      if (out.status >= 400 || BLOCKED_TITLE.test(titleOfHtml(out.html))) { lastStatus = lastStatus || 403; continue; }
      if (out.html.length > MAX_HTML_CHARS) throw new Error('That page is too large to load.');
      return { html: out.html, finalUrl: out.finalUrl, signedIn: !!out.signedIn, readLanding: !!out.readLanding };
    }
    if (!lastStatus && dropped) throw new Error('Connection dropped: the website cut the browser off every time');
    throw new Error(`Server returned ${lastStatus || 403}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    running = 0;
  }
}

module.exports = {
  renderPage, renderAvailable, loadPlaywright, CONNECTION_REFUSED, USER_AGENTS,
  guardContext, openPage, assertPublicFinalUrl, SETTLE_TIMEOUT_MS,
};
