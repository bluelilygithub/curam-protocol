'use strict';

// The preview iframe inherits Vault's own Content-Security-Policy (srcdoc has no origin of its
// own, so there's no separate CSP to set) — that CSP's img-src only allows 'self', data:, and
// blob:, so any http(s) image URL in the uploaded page is silently blocked by the browser
// regardless of the sandbox attribute (confirmed via the browser's own console error). Fixing
// this means never asking the iframe to fetch a remote image at all: fetch each one server-side
// (reusing the same SSRF-safe fetch as Web Extractor) and inline it as a data: URI, which the
// CSP already permits.
//
// A remote image can show up in FOUR places in an uploaded page, and all four are covered here:
//   1. <img src="...">  / <img srcset="...">
//   2. an inline style="background-image: url(...)" attribute on any element
//   3. a <style>...</style> block embedded directly in the page (head or body) — separate from
//      the user's uploaded/pasted CSS FILES, which inlineImagesInCss (below) already covers
//   4. url(...) inside an uploaded/pasted CSS file (handled by inlineImagesInCss, called from
//      the /process-css route on the merged stylesheet)
//
// A page fetched via /scrape-url almost always uses RELATIVE image paths (src="/img/logo.png"),
// since they're only ever meant to resolve against that page's own origin — a plain uploaded/
// pasted page has no such origin to resolve against, so those stay untouched (same as before).
// Callers that know the source page's URL (scrape-url) pass it as `baseUrl` so relative
// references can be resolved to absolute before fetching; upload-html/process-css omit it,
// preserving the original http(s)-only behavior.
//
// This is best-effort, not required for the tool to otherwise work — an image that fails to
// fetch (404, blocked host, too large, timeout) is just left as its original URL and stays
// broken in the preview exactly as before, rather than failing the whole build.

const { JSDOM } = require('jsdom');
const { fetchBinary } = require('../webExtractorService');

const MAX_IMAGES = 40; // cap total fetches per call so a page with hundreds of images can't hang the request
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/** Resolves a raw src/href/url(...) value to an absolute http(s) URL, or null if it can't be
 * (data:/blob: are left alone entirely; a relative path with no baseUrl can't be resolved). */
function resolveUrl(raw, baseUrl) {
  const value = (raw || '').trim();
  if (!value || /^(data|blob):/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!baseUrl) return null;
  try { return new URL(value, baseUrl).toString(); } catch { return null; }
}

async function toDataUri(url) {
  const { buffer, contentType } = await fetchBinary(url);
  const type = contentType.split(';')[0].trim() || 'application/octet-stream';
  return `data:${type};base64,${buffer.toString('base64')}`;
}

async function fetchAllAsDataUris(urls) {
  const urlToDataUri = new Map();
  let inlinedCount = 0;
  let failedCount = 0;
  await Promise.all(urls.slice(0, MAX_IMAGES).map(async (url) => {
    try {
      urlToDataUri.set(url, await toDataUri(url));
      inlinedCount++;
    } catch {
      failedCount++;
    }
  }));
  return { urlToDataUri, inlinedCount, failedCount };
}

function rewriteCssText(css, urlToDataUri, baseUrl) {
  return (css || '').replace(CSS_URL_RE, (match, quote, raw) => {
    const absolute = resolveUrl(raw, baseUrl);
    return absolute && urlToDataUri.has(absolute) ? `url(${quote}${urlToDataUri.get(absolute)}${quote})` : match;
  });
}

/**
 * Rewrites every image reference found in an HTML fragment (an <img> tag's src/srcset, an inline
 * style="" attribute's url(...), or an embedded <style> block's url(...)) to a data: URI. Call
 * once for the sanitized head and once for the sanitized body.
 * @param {string} htmlFragment
 * @param {string} [baseUrl] - the source page's URL, so relative references can be resolved
 *   (pass when known, e.g. from /scrape-url); omit for a plain upload/paste with no known origin.
 * @returns {Promise<{ html: string, inlinedCount: number, failedCount: number }>}
 */
async function inlineImagesInHtmlFragment(htmlFragment, baseUrl) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${htmlFragment || ''}</body>`);
  const doc = dom.window.document;

  const collect = new Set();
  doc.querySelectorAll('img[src]').forEach((img) => {
    const absolute = resolveUrl(img.getAttribute('src'), baseUrl);
    if (absolute) collect.add(absolute);
  });
  doc.querySelectorAll('img[srcset]').forEach((img) => {
    img.getAttribute('srcset').split(',').forEach((part) => {
      const absolute = resolveUrl(part.trim().split(/\s+/)[0], baseUrl);
      if (absolute) collect.add(absolute);
    });
  });
  doc.querySelectorAll('[style]').forEach((el) => {
    for (const m of el.getAttribute('style').matchAll(CSS_URL_RE)) {
      const absolute = resolveUrl(m[2], baseUrl);
      if (absolute) collect.add(absolute);
    }
  });
  doc.querySelectorAll('style').forEach((styleTag) => {
    for (const m of styleTag.textContent.matchAll(CSS_URL_RE)) {
      const absolute = resolveUrl(m[2], baseUrl);
      if (absolute) collect.add(absolute);
    }
  });

  if (!collect.size) return { html: htmlFragment || '', inlinedCount: 0, failedCount: 0 };
  const { urlToDataUri, inlinedCount, failedCount } = await fetchAllAsDataUris([...collect]);

  doc.querySelectorAll('img[src]').forEach((img) => {
    const absolute = resolveUrl(img.getAttribute('src'), baseUrl);
    if (absolute && urlToDataUri.has(absolute)) img.setAttribute('src', urlToDataUri.get(absolute));
  });
  doc.querySelectorAll('img[srcset]').forEach((img) => {
    const rewritten = img.getAttribute('srcset').split(',').map((part) => {
      const trimmed = part.trim();
      const [url, descriptor] = trimmed.split(/\s+/);
      const absolute = resolveUrl(url, baseUrl);
      if (absolute && urlToDataUri.has(absolute)) return descriptor ? `${urlToDataUri.get(absolute)} ${descriptor}` : urlToDataUri.get(absolute);
      return trimmed;
    }).join(', ');
    img.setAttribute('srcset', rewritten);
  });
  doc.querySelectorAll('[style]').forEach((el) => {
    el.setAttribute('style', rewriteCssText(el.getAttribute('style'), urlToDataUri, baseUrl));
  });
  doc.querySelectorAll('style').forEach((styleTag) => {
    styleTag.textContent = rewriteCssText(styleTag.textContent, urlToDataUri, baseUrl);
  });

  return { html: doc.body.innerHTML, inlinedCount, failedCount };
}

/**
 * Rewrites every url(...) reference (e.g. background-image) in a CSS FILE's text (uploaded/
 * pasted, or fetched via /scrape-url, merged by cssProcessor) to a data: URI.
 * @param {string} css
 * @param {string} [baseUrl] - the stylesheet's own URL, so relative references (very common in
 *   real CSS files, e.g. url(../img/bg.png)) resolve correctly; omit for uploaded/pasted CSS
 *   with no known origin.
 * @returns {Promise<{ css: string, inlinedCount: number, failedCount: number }>}
 */
async function inlineImagesInCss(css, baseUrl) {
  const urls = [...new Set(
    [...(css || '').matchAll(CSS_URL_RE)]
      .map((m) => resolveUrl(m[2], baseUrl))
      .filter(Boolean)
  )];
  if (!urls.length) return { css: css || '', inlinedCount: 0, failedCount: 0 };
  const { urlToDataUri, inlinedCount, failedCount } = await fetchAllAsDataUris(urls);
  return { css: rewriteCssText(css, urlToDataUri, baseUrl), inlinedCount, failedCount };
}

module.exports = { inlineImagesInHtmlFragment, inlineImagesInCss };
