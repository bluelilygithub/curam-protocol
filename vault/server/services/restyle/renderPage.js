'use strict';

// Loads a page in a real (headless) browser so a page that builds itself with JavaScript, such as most shops, apps and many marketing
// sites, comes back with its content in it. Only used when the person ticks "builds itself with JavaScript" in the CSS tool, because it is
// slower and heavier than a plain fetch. The page's scripts run here, in the browser, never in Vault's own process; what comes back is the
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

const RENDER_TIMEOUT_MS = 30000;
const SETTLE_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 5 * 1024 * 1024;
const MAX_QUEUED = 2;
const BLOCKED_TYPES = new Set(['media', 'font']);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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

/**
 * @param {string} url  an http(s) address already normalised by the caller
 * @returns {Promise<{html:string, finalUrl:string}>}
 */
async function renderPage(url) {
  if (!renderAvailable()) throw new Error('Loading pages that build themselves with JavaScript is not set up on this server.');
  await takeSlot();
  let browser = null;
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 }, locale: 'en-AU', userAgent: USER_AGENT,
      acceptDownloads: false, serviceWorkers: 'block', javaScriptEnabled: true,
    });

    // Every request is checked; the verdict for a host is remembered for this render only.
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
      if (BLOCKED_TYPES.has(req.resourceType())) return route.abort();
      return (await hostAllowed(parsed.hostname)) ? route.continue() : route.abort();
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
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

    const html = await page.content();
    if (html.length > MAX_HTML_CHARS) throw new Error('That page is too large to load.');
    return { html, finalUrl: page.url() };
  } finally {
    if (browser) await browser.close().catch(() => {});
    running = 0;
  }
}

module.exports = { renderPage, renderAvailable };
