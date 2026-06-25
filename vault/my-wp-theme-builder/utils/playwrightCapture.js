'use strict';

const fs = require('fs');
const path = require('path');

const VIEWPORT = { width: 1440, height: 900 };
const NAV_TIMEOUT = 28000;

const EXTRACT_SCRIPT = `
() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      letterSpacing: cs.letterSpacing,
    };
  };

  const header = document.querySelector('header')
    || document.querySelector('[role="banner"]')
    || document.querySelector('.header, .site-header, #header');
  const nav = document.querySelector('nav')
    || header?.querySelector('nav')
    || document.querySelector('[role="navigation"]');
  const h1 = document.querySelector('h1');
  const hero = document.querySelector('main section, .hero, [class*="hero"], main > div');
  const footer = document.querySelector('footer') || document.querySelector('[role="contentinfo"]');

  const linkRoot = nav || header || document;
  const navLinks = [...linkRoot.querySelectorAll('a')]
    .map((a) => ({
      text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      href: a.getAttribute('href') || '',
    }))
    .filter((l) => l.text && l.text.length > 1)
    .slice(0, 14);

  const colors = new Set();
  [document.body, header, nav, h1, hero, footer].forEach((el) => {
    if (!el) return;
    const cs = getComputedStyle(el);
    [cs.color, cs.backgroundColor, cs.borderColor].forEach((c) => {
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colors.add(c);
    });
  });

  const description = document.querySelector('meta[name="description"]')?.content
    || document.querySelector('meta[property="og:description"]')?.content
    || '';

  return {
    title: document.title || '',
    description: (description || '').trim().slice(0, 400),
    navLinks,
    styles: {
      body: pick(document.body),
      h1: pick(h1),
      header: pick(header),
      nav: pick(nav),
    },
    colors: [...colors].slice(0, 14),
  };
}
`;

let browserPromise = null;
let playwrightModule = null;

function loadPlaywright() {
  if (playwrightModule) return playwrightModule;
  try {
    playwrightModule = require('playwright');
    return playwrightModule;
  } catch {
    return null;
  }
}

function isPlaywrightAvailable() {
  return Boolean(loadPlaywright());
}

async function getBrowser() {
  const pw = loadPlaywright();
  if (!pw) throw new Error('Playwright is not installed');

  if (!browserPromise) {
    browserPromise = pw.chromium.launch({ headless: true });
  }
  return browserPromise;
}

async function capturePage(url, options = {}) {
  const { screenshotPath } = options;

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    }

    await page.waitForTimeout(1200);

    let extracted = {};
    try {
      extracted = await page.evaluate(EXTRACT_SCRIPT) || {};
    } catch (evalErr) {
      extracted = { title: '', description: '', navLinks: [], styles: {}, colors: [] };
      extracted.evaluateError = evalErr.message;
    }

    // Full-page capture, but cap height: the vision API rejects images taller
    // than 8000px, so very long pages get their top MAX_SHOT_HEIGHT px instead.
    const MAX_SHOT_HEIGHT = 7000;
    let fullHeight = VIEWPORT.height;
    try {
      fullHeight = await page.evaluate(() => document.documentElement.scrollHeight) || VIEWPORT.height;
    } catch (_) {
      // keep viewport height on failure
    }
    const screenshotBuffer = fullHeight > MAX_SHOT_HEIGHT
      ? await page.screenshot({
          type: 'jpeg',
          quality: 70,
          clip: { x: 0, y: 0, width: VIEWPORT.width, height: MAX_SHOT_HEIGHT },
        })
      : await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true });

    if (screenshotPath) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, screenshotBuffer);
    }

    await context.close();

    return {
      ok: true,
      url,
      method: 'playwright',
      title: extracted.title,
      description: extracted.description,
      navLinks: extracted.navLinks,
      styles: extracted.styles,
      colors: extracted.colors,
      screenshotBase64: screenshotBuffer.toString('base64'),
      hasScreenshot: true,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      method: 'playwright',
      error: err.message || 'Playwright capture failed',
    };
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (_) {
    // ignore shutdown errors
  } finally {
    browserPromise = null;
  }
}

module.exports = {
  capturePage,
  closeBrowser,
  isPlaywrightAvailable,
};
