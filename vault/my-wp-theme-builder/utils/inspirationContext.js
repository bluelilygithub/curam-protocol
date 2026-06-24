'use strict';

const path = require('path');
const { normalizeUrlList } = require('./urlNormalize');
const { capturePage, closeBrowser, isPlaywrightAvailable } = require('./playwrightCapture');
const { analyzeScreenshot } = require('./inspirationVision');
const { sessionDir, ensureDir } = require('./filewriter');

function extractMeta(html, attr, valuePattern) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${valuePattern}["'][^>]+content=["']([^"']+)["']`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${valuePattern}["']`, 'i');
  return html.match(re)?.[1] || html.match(alt)?.[1] || '';
}

function extractTitle(html) {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
}

function screenshotPathFor(sessionId, index) {
  return path.join(sessionDir(sessionId), 'stage1', 'inspiration', `site-${index + 1}.jpg`);
}

async function fetchInspirationSiteFallback(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WPThemeBuilder/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return { url, ok: false, method: 'fetch', error: `HTTP ${res.status}` };
    }

    const html = (await res.text()).slice(0, 120000);
    const title = extractTitle(html);
    const description = extractMeta(html, 'name', 'description')
      || extractMeta(html, 'property', 'og:description');
    const ogTitle = extractMeta(html, 'property', 'og:title');
    const themeColor = extractMeta(html, 'name', 'theme-color');

    const fontHints = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi)]
      .map((m) => decodeURIComponent(m[1].replace(/\+/g, ' ')))
      .slice(0, 4);

    return {
      url,
      ok: true,
      method: 'fetch',
      title: ogTitle || title,
      description,
      themeColor,
      fontHints,
    };
  } catch (err) {
    return { url, ok: false, method: 'fetch', error: err.message || 'Fetch failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function stripScreenshot(result) {
  if (!result || !result.screenshotBase64) return result;
  const { screenshotBase64, ...rest } = result;
  return { ...rest, hasScreenshot: true };
}

async function researchInspirationSite(url, { sessionId, index = 0, onProgress } = {}) {
  const notify = (message) => {
    if (typeof onProgress === 'function') onProgress(message);
  };

  notify(`Opening ${url} in headless browser…`);

  let result;
  if (isPlaywrightAvailable()) {
    const shotPath = sessionId ? screenshotPathFor(sessionId, index) : null;
    result = await capturePage(url, { screenshotPath: shotPath });
  } else {
    notify('Playwright unavailable — falling back to HTTP fetch');
    result = await fetchInspirationSiteFallback(url);
  }

  if (!result.ok) {
    notify(`Browser capture failed for ${url} — trying HTTP fetch`);
    const fallback = await fetchInspirationSiteFallback(url);
    return stripScreenshot({ ...fallback, browserError: result.error });
  }

  if (result.screenshotBase64) {
    notify(`Analysing visual design for ${url}…`);
    const vision = await analyzeScreenshot({
      screenshotBase64: result.screenshotBase64,
      url,
      extracted: result,
    });
    result.vision = vision;
    if (vision.ok) {
      notify(`Vision analysis complete for ${url}`);
    } else if (vision.skipped) {
      notify(`Vision skipped for ${url} (${vision.reason})`);
    } else {
      notify(`Vision analysis failed for ${url}: ${vision.error}`);
    }
  }

  return stripScreenshot(result);
}

async function researchInspirationSites(urls = [], options = {}) {
  const unique = normalizeUrlList(urls, 3);
  if (!unique.length) return [];

  if (options.sessionId) {
    ensureDir(path.join(sessionDir(options.sessionId), 'stage1', 'inspiration'));
  }

  const results = [];
  for (let i = 0; i < unique.length; i += 1) {
    const url = unique[i];
    results.push(await researchInspirationSite(url, { ...options, index: i }));
  }

  await closeBrowser();
  return results;
}

module.exports = {
  researchInspirationSites,
  isPlaywrightAvailable,
};
