'use strict';

/**
 * Render one page in a real browser, with JavaScript on, for the AI Visibility audit.
 *
 * Why a browser at all: the audit's central question is "can an answer engine read the
 * page without running JavaScript?" The no-JS side is the raw HTML fetched by
 * htmlFetch; this is the JS side. The difference is the finding.
 *
 * Safety follows server/services/brandFromUrl: every request the page makes is paused
 * and checked with checkSsrf before it leaves Chromium (including redirect legs, which
 * page.route does not see), only ports 80/443, no frames, media, downloads, popups or
 * service workers. Chromium resolves names itself after the check, so a hostile DNS
 * server that answers differently the second time is not fully covered — accepted for
 * a signed-in tool, and the same trade-off brandFromUrl documents.
 */

const { chromium } = require('playwright');
const { checkSsrf } = require('../../utils/safeFetch');

const GOTO_TIMEOUT_MS = 20000;
const SETTLE_MS = 1200;
const TOTAL_BUDGET_MS = 45000;

let browserPromise = null;
let active = 0;
let idleTimer = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--block-new-web-contents'] });
    browserPromise.then((b) => b.on('disconnected', () => { browserPromise = null; })).catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

/**
 * A desktop Chrome identity carrying the real Chromium version. A fixed older version
 * ("Chrome/124" while the browser was 149) does not match what the browser itself sends,
 * and some firewalls drop such connections: wiwc.com.au answered it with
 * net::ERR_HTTP2_PROTOCOL_ERROR (2026-11-13) and loaded normally with the matching version.
 */
function userAgentFor(browser) {
  const version = String((browser && browser.version && browser.version()) || '').trim() || '124.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (active > 0 || !browserPromise) return;
    const p = browserPromise;
    browserPromise = null;
    p.then((b) => b.close()).catch(() => {});
  }, 60000);
  if (idleTimer.unref) idleTimer.unref();
}

async function closeBrowser() {
  clearTimeout(idleTimer);
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}

/** Hold every request until its host has passed checkSsrf. Sees redirect legs too. */
async function installGuard(context, page) {
  const cdp = await context.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const mainFrameId = frameTree.frame.id;
  const verdicts = new Map();
  const allowedPorts = ['', '80', '443'];
  const check = (host) => {
    const h = host.replace(/^\[|\]$/g, '');
    if (!verdicts.has(h)) verdicts.set(h, Promise.resolve().then(() => checkSsrf(h)).then(() => true, () => false));
    return verdicts.get(h);
  };

  cdp.on('Fetch.requestPaused', async (ev) => {
    try {
      let u;
      try { u = new URL(ev.request.url); } catch { return cdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'BlockedByClient' }); }
      let ok = false;
      if (['data:', 'blob:', 'about:'].includes(u.protocol)) ok = true;
      else if (u.protocol !== 'http:' && u.protocol !== 'https:') ok = false;
      else if (['Media', 'WebSocket', 'EventSource', 'Image', 'Font'].includes(ev.resourceType)) ok = false;
      else if (ev.resourceType === 'Document' && ev.frameId !== mainFrameId) ok = false;
      else if (!allowedPorts.includes(u.port)) ok = false;
      else ok = await check(u.hostname);

      if (ok) await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
      else await cdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'BlockedByClient' });
    } catch { /* the page closed while this was waiting */ }
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  await context.addInitScript(() => { window.open = () => null; });
  context.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
}

const PAGE_SCRIPT = () => {
  const text = String(document.body?.innerText || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .map((el) => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40);
  const ld = document.querySelectorAll('script[type="application/ld+json"]').length;
  return {
    title: document.title || '',
    lang: document.documentElement?.lang || '',
    text,
    headings,
    jsonLdCount: ld,
    links: document.querySelectorAll('a[href]').length,
  };
};

async function renderWithBudget(url, timeoutMs) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: userAgentFor(browser),
    locale: 'en-AU',
    javaScriptEnabled: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const page = await context.newPage();
  try {
    await installGuard(context, page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch { /* long-polling pages never idle */ }
    await page.waitForTimeout(SETTLE_MS);

    const finalUrl = page.url();
    // The guard sees every request, but re-checking the address we ended on makes a
    // redirect chain that slipped through fail closed rather than save an internal page.
    try { await checkSsrf(new URL(finalUrl).hostname); } catch { throw new Error('The page redirected to a private or internal address'); }

    const data = await page.evaluate(PAGE_SCRIPT);
    return {
      ok: true,
      finalUrl,
      title: String(data.title || '').slice(0, 300),
      lang: String(data.lang || '').slice(0, 20),
      text: String(data.text || '').slice(0, 20000),
      headings: (data.headings || []).slice(0, 40),
      jsonLdCount: Number(data.jsonLdCount) || 0,
      links: Number(data.links) || 0,
      bytes: String(data.text || '').length,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Render `url` with JavaScript enabled. Resolves a plain object; throws on failure. */
async function renderPage(url, { timeoutMs = GOTO_TIMEOUT_MS } = {}) {
  active += 1;
  clearTimeout(idleTimer);
  try {
    const budget = Math.max(5000, Math.min(TOTAL_BUDGET_MS, timeoutMs + 15000));
    let timer;
    try {
      return await Promise.race([
        renderWithBudget(url, timeoutMs),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Rendering timed out after ${Math.round(budget / 1000)}s`)), budget);
        }),
      ]);
    } catch (err) {
      // Playwright appends a multi-line call log; the report needs the first line only.
      throw new Error(String((err && err.message) || err).split('\n')[0]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    active -= 1;
    scheduleIdleClose();
  }
}

module.exports = { renderPage, closeBrowser, userAgentFor };
