'use strict';

// "Brand from a website": open one public page in a real browser (the Chromium the Browser Agent already uses), read what it painted,
// and answer with a proposed brand: colour roles, heading and body fonts (the font files themselves, as plain TTF/OTF), a corner radius
// and logo candidates. Nothing is saved here and nothing is run on the person's behalf: this only reads. The route (step 2) decides what
// to keep.
//
// Safety: the address and EVERY request the page makes (every redirect leg, scripts, fonts, images) is checked with checkSsrf before it
// leaves the browser, so a page cannot be used to reach internal addresses. Only ports 80 and 443. No frames, popups, downloads, service
// workers or media.
// Chromium resolves names itself once the check has passed, so a hostile DNS server that answers differently the second time is not fully
// covered (the Node fetchers pin the address; the browser cannot). Accepted for a signed-in tool; noted in docs/brand-from-url.md.
//
// Test: node server/services/brandFromUrl/brandFromUrl.test.js (the browser part is skipped when Chromium is missing).

const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { checkSsrf, fetchPublicFile } = require('../../utils/safeFetch');
const { normaliseHttpUrl } = require('../htmlFetch');
const { collectBrand } = require('./pageScript');
const roles = require('./brandRoles');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, 'brand_font.py');
const PYTHON_BINS = [process.env.BRAND_FONT_PYTHON, process.env.FONTS_PYTHON_BIN, 'python3', 'python'].filter(Boolean);

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, scale: 1 },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, scale: 0.5 },
  dark: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark', scale: 0 },
};
const GOTO_TIMEOUT_MS = 20000;
const SETTLE_MS = 1500; // late scripts and web fonts
const TOTAL_BUDGET_MS = 60000;
const MAX_FONT_FILES = 16;
const MAX_FONT_BYTES = 3 * 1024 * 1024;
const MAX_LOGO_BYTES = 4 * 1024 * 1024;
const LOGO_PX = 512;
const MAX_PARALLEL = 2; // each run is a few hundred MB of browser

const fail = (message, status = 422) => Object.assign(new Error(message), { status });

function logWarn(obj, msg) {
  try { require('../../middleware/requestContext').getLogger().warn(obj, msg); } catch { /* logging must never break a run */ }
}

// ---------------------------------------------------------------- the browser (one shared process, closed when idle)
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

/** Close the shared browser now (tests, shutdown). */
async function closeBrowser() {
  clearTimeout(idleTimer);
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}

// ---------------------------------------------------------------- one page load
/**
 * Every request the page makes is held until its address passes checkSsrf. This uses the browser's own request-pause protocol rather
 * than Playwright's page.route, because page.route is NOT called for the later legs of a redirect (checked 2026-11-07: a public page that
 * answers 302 to http://127.0.0.2/ was followed without a single call), and a redirect is the usual way to reach an internal address.
 * Pausing here sees every leg. Also refused: pictures-in-frames (a frame in another process would escape this guard), media,
 * websockets, non-standard ports and anything that is not http(s)/data/blob.
 */
async function installGuard(context, page, deps) {
  const cdp = await context.newCDPSession(page);
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const mainFrameId = frameTree.frame.id;
  const verdicts = new Map();
  const allowedPorts = deps.ports || ['', '80', '443'];
  const check = (host) => {
    const h = host.replace(/^\[|\]$/g, '');
    if (!verdicts.has(h)) verdicts.set(h, Promise.resolve().then(() => deps.checkHost(h)).then(() => true, () => false));
    return verdicts.get(h);
  };
  async function allowed(ev) {
    let u;
    try { u = new URL(ev.request.url); } catch { return false; }
    if (['data:', 'blob:', 'about:'].includes(u.protocol)) return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (['Media', 'WebSocket', 'EventSource'].includes(ev.resourceType)) return false;
    if (ev.resourceType === 'Document' && ev.frameId !== mainFrameId) return false;
    if (!allowedPorts.includes(u.port)) return false;
    return check(u.hostname);
  }
  cdp.on('Fetch.requestPaused', async (ev) => {
    try {
      if (await allowed(ev)) await cdp.send('Fetch.continueRequest', { requestId: ev.requestId });
      else await cdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'BlockedByClient' });
    } catch { /* the page closed while this was waiting */ }
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // a popup would be a second page with no guard on it: the browser is started with --block-new-web-contents, window.open is also
  // switched off in the page, and any page that still appears is closed
  await context.addInitScript(() => { window.open = () => null; });
  context.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
}

/** Load the page under one profile and read it. Returns { data, fontFiles, page, context } (the caller closes the context). */
async function loadAndRead(browser, url, profileName, deps, { captureFonts }) {
  const p = PROFILES[profileName];
  const context = await browser.newContext({
    viewport: p.viewport, isMobile: p.isMobile, hasTouch: p.hasTouch, deviceScaleFactor: p.deviceScaleFactor || 1,
    colorScheme: p.colorScheme || 'light', userAgent: CHROME_UA, locale: 'en-AU', serviceWorkers: 'block', acceptDownloads: false,
    javaScriptEnabled: true,
  });
  deps.contexts.add(context);
  const page = await context.newPage();
  await installGuard(context, page, deps);
  const fontBodies = [];
  if (captureFonts) {
    page.on('response', (resp) => {
      try {
        if (resp.request().resourceType() !== 'font' || fontBodies.length >= MAX_FONT_FILES) return;
        fontBodies.push(resp.body().then((buf) => (buf.length > 0 && buf.length <= MAX_FONT_BYTES ? { url: resp.url(), buf } : null)).catch(() => null));
      } catch { /* a response that vanished */ }
    });
  }
  let loadedOk = true;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
  } catch (e) {
    if (/ERR_BLOCKED_BY_CLIENT/.test(e.message)) throw fail('That address (or where it redirects to) is private or not allowed.');
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_CERT|ERR_SSL/.test(e.message)) throw fail('Could not reach that website.');
    loadedOk = false; // a timeout: use whatever has painted so far
  }
  if (!loadedOk && page.url() === 'about:blank') throw fail('The website took too long to load.');
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => (document.fonts && document.fonts.ready) || null).catch(() => {});
  const data = await page.evaluate(collectBrand, { maxEls: 5000 });
  const fontFiles = (await Promise.all(fontBodies)).filter(Boolean);
  return { data, fontFiles, page, context, finalUrl: page.url() };
}

// ---------------------------------------------------------------- logos
async function toPngDataUrl(buffer) {
  const img = sharp(buffer, { density: 192, limitInputPixels: 64e6 });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('not a picture');
  const png = await img.resize({ width: LOGO_PX, height: LOGO_PX, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const out = await sharp(png).metadata();
  return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: out.width, height: out.height };
}

/** One candidate -> a PNG data URL. The original file when it can be fetched (keeps transparency), else a screenshot of the element. */
async function logoPicture(page, c, deps) {
  if (c.src && /^https?:/i.test(c.src) && c.kind !== 'svg') {
    try {
      const f = await deps.fetchPublicFile(c.src, { maxBytes: MAX_LOGO_BYTES, timeoutMs: 8000, accept: 'image/*' });
      return { ...(await toPngDataUrl(f.buffer)), via: 'file' };
    } catch { /* fall through to a screenshot */ }
  }
  if (page && c.marker != null) {
    const shot = await page.locator(`[data-brand-logo="${c.marker}"]`).first().screenshot({ omitBackground: true, timeout: 4000 });
    return { ...(await toPngDataUrl(shot)), via: 'screenshot' };
  }
  throw new Error('no picture');
}

async function buildLogos(page, data, deps, warnings) {
  const out = [];
  const jobs = (data.logos || []).slice(0, 4).map(async (c) => {
    try {
      const pic = await logoPicture(page, c, deps);
      return { kind: c.kind, score: c.score, sourceUrl: c.src || null, alt: c.alt || '', ...pic };
    } catch { return null; }
  });
  // head icons are weaker guesses than something that sits in the page header, so they rank below it
  const heads = (data.headIcons || []).filter((h) => h.kind === 'apple-touch-icon' || h.kind === 'og-image').slice(0, 2).map(async (h) => {
    try {
      const f = await deps.fetchPublicFile(h.url, { maxBytes: MAX_LOGO_BYTES, timeoutMs: 8000, accept: 'image/*' });
      return { kind: h.kind, score: h.kind === 'apple-touch-icon' ? 1.5 : 0.5, sourceUrl: h.url, alt: '', ...(await toPngDataUrl(f.buffer)), via: 'file' };
    } catch { return null; }
  });
  for (const r of await Promise.all([...jobs, ...heads])) if (r) out.push(r);
  out.sort((a, b) => b.score - a.score);
  if (!out.length) warnings.push('No logo was found on the page. Upload one by hand.');
  return out;
}

// ---------------------------------------------------------------- fonts
async function runPython(job) {
  let lastErr = null;
  for (const bin of PYTHON_BINS) {
    try {
      const child = execFileAsync(bin, [SCRIPT], { timeout: 60000, maxBuffer: 24 * 1024 * 1024, windowsHide: true });
      child.child.stdin.end(JSON.stringify(job));
      const { stdout } = await child;
      const out = JSON.parse(stdout.trim().split('\n').pop());
      if (out.ok) return out;
      lastErr = new Error(out.error || 'font conversion failed');
      break;
    } catch (e) {
      let reason = e.message;
      try { const j = JSON.parse(String(e.stdout || '').trim().split('\n').pop()); if (j.error) reason = j.error; } catch { /* keep message */ }
      lastErr = new Error(reason);
      if (!/ENOENT|not found|not recognized|Python was not found/i.test(reason)) break;
    }
  }
  throw lastErr || new Error('Python is not available');
}

/** Google Fonts fall-back for a family the page did not load as a file (a site that uses a font installed on its own server). */
async function googleFontFile(family, weight, deps) {
  if (!/^[A-Za-z0-9 ]{2,60}$/.test(family)) return null;
  const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${w}&display=swap`;
  const css = await deps.fetchPublicFile(cssUrl, { maxBytes: 200 * 1024, timeoutMs: 8000, accept: 'text/css' }).catch(() => null);
  return css ? { css: css.buffer.toString('utf8'), w } : null;
}

async function googleLatinFile(family, weight, deps) {
  const got = await googleFontFile(family, weight, deps);
  if (!got) return null;
  // Google answers by the browser asking. A current Chrome gets one woff2 per script (latin, latin-ext, cyrillic ...) and only the Latin
  // one can draw an ordinary headline; our fetcher is not a browser, so it usually gets one whole TTF. Take either.
  const blocks = got.css.split('@font-face').slice(1);
  const block = blocks.find((b) => /unicode-range:[^;]*U\+0000-00FF/.test(b)) || (blocks.length === 1 ? blocks[0] : null);
  const url = block && (/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(block) || [])[1];
  if (!url) return null;
  const f = await deps.fetchPublicFile(url, { maxBytes: MAX_FONT_BYTES, timeoutMs: 10000 }).catch(() => null);
  return f ? { buf: f.buffer, w: got.w } : null;
}

async function resolveFonts(names, captured, deps, warnings) {
  const result = { heading: null, body: null };
  let inspected = [];
  if (captured.length) {
    try {
      const r = await runPython({ mode: 'inspect', fonts: captured.map((c, i) => ({ id: String(i), b64: c.buf.toString('base64') })) });
      inspected = r.fonts.map((f) => ({ ...f, url: captured[Number(f.id)].url }));
    } catch (e) {
      warnings.push('Font files on the page could not be read.');
      logWarn({ err: e.message }, 'brandFromUrl: font inspect failed');
    }
  }
  const cache = new Map(); // same file + weight asked twice (heading and body in one family)
  for (const role of ['heading', 'body']) {
    const n = names[role];
    if (!n) continue;
    const out = { family: n.family, weight: n.weight, system: n.system, source: null, file: null };
    result[role] = out;
    try {
      let b64 = null;
      let source = null;
      const match = roles.matchFontFile(inspected, n.family, n.weight);
      if (match) { b64 = captured[Number(match.id)].buf.toString('base64'); source = 'page'; }
      else if (!n.system) {
        const g = await googleLatinFile(n.family, n.weight, deps);
        if (g) { b64 = g.buf.toString('base64'); source = 'google-fonts'; }
      }
      if (!b64) { if (!n.system) warnings.push(`The ${role} font "${n.family}" could not be downloaded; only its name is kept.`); continue; }
      const key = crypto.createHash('sha1').update(`${b64}|${n.weight}`).digest('hex'); // one file at one weight = one converted font
      let conv = cache.get(key);
      if (!conv) { conv = await runPython({ mode: 'convert', b64, weight: n.weight, renderFamily: `BrandFont${key.slice(0, 8)}` }); cache.set(key, conv); }
      if (!roles.sameFamily(conv.family, n.family) || !conv.hasLatin) {
        warnings.push(`The ${role} font file did not match "${n.family}"; only its name is kept.`);
        continue;
      }
      const buffer = Buffer.from(conv.ttfB64, 'base64');
      out.source = source;
      out.file = {
        buffer, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), internalFamily: conv.family,
        renderFamily: conv.renderFamily, // the name to give sharp as `font` with this file as `fontfile`, at normal weight
        weight: conv.weight, variable: conv.variable, instanced: conv.instanced,
        ext: buffer.slice(0, 4).toString('latin1') === 'OTTO' ? 'otf' : 'ttf',
      };
    } catch (e) {
      warnings.push(`The ${role} font "${n.family}" could not be prepared; only its name is kept.`);
      logWarn({ err: e.message, family: n.family }, 'brandFromUrl: font convert failed');
    }
  }
  return result;
}

// ---------------------------------------------------------------- the whole run
/**
 * Read one public website and propose a brand. Rejects with an Error that has a plain-words `message` and a `status`.
 * `deps` exist for tests: { checkHost, fetchPublicFile, ports }.
 */
async function extractBrand(rawUrl, depsIn = {}) {
  const deps = { checkHost: checkSsrf, fetchPublicFile, ...depsIn, contexts: new Set() };
  let url;
  try { url = normaliseHttpUrl(rawUrl); } catch { throw fail('Enter a web address like example.com', 400); }
  try { await deps.checkHost(new URL(url).hostname.replace(/^\[|\]$/g, '')); } catch (e) { throw fail(/DNS lookup failed/.test(e.message) ? 'That website address could not be found. Check the spelling.' : /private or internal/.test(e.message) ? 'That address is private or internal, so it cannot be read.' : (e.message || 'That address is not allowed.')); }
  if (active >= MAX_PARALLEL) throw fail('Brand reading is busy. Try again in a minute.', 503);

  active += 1;
  clearTimeout(idleTimer);
  const warnings = [];
  const timer = { id: null };
  try {
    const work = (async () => {
      const browser = await getBrowser();
      const desktop = await loadAndRead(browser, url, 'desktop', deps, { captureFonts: true });
      const logos = await buildLogos(desktop.page, desktop.data, deps, warnings);
      const side = await Promise.allSettled([
        loadAndRead(browser, url, 'mobile', deps, { captureFonts: false }),
        loadAndRead(browser, url, 'dark', deps, { captureFonts: false }),
      ]);
      const [mobile, dark] = side.map((s, i) => {
        if (s.status === 'fulfilled') return s.value;
        warnings.push(`The ${i === 0 ? 'phone' : 'dark mode'} view could not be read.`);
        return null;
      });
      const combined = roles.combineRuns([
        { data: desktop.data, scale: PROFILES.desktop.scale },
        { data: mobile && mobile.data, scale: PROFILES.mobile.scale },
      ]);
      const picked = roles.pickColourRoles(combined);
      const names = roles.pickFontNames(combined.fonts);
      const fonts = await resolveFonts(names, desktop.fontFiles, deps, warnings);
      if (desktop.data.fg && Object.keys(desktop.data.fg).length === 0) warnings.push('The page showed almost no text. It may block automated visitors or need a login.');
      return {
        sourceUrl: url,
        finalUrl: desktop.finalUrl,
        title: desktop.data.title || '',
        siteName: desktop.data.siteName || '',
        ...picked,
        dark: roles.pickDark(combined.canvas, dark && dark.data),
        radius: roles.pickRadius(combined.radii),
        fonts,
        logos,
        logo: logos[0] || null,
        warnings,
      };
    })();
    const limit = new Promise((_, reject) => { timer.id = setTimeout(() => reject(fail('Reading the website took too long.')), TOTAL_BUDGET_MS); });
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer.id);
    await Promise.all([...deps.contexts].map((c) => c.close().catch(() => {})));
    active -= 1;
    scheduleIdleClose();
  }
}

module.exports = { extractBrand, closeBrowser, runPython, PROFILES };
