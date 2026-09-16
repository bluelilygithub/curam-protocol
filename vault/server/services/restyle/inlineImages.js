'use strict';

// The preview iframe inherits Vault's own Content-Security-Policy (srcdoc has no origin of its
// own, so there's no separate CSP to set) — that CSP's img-src only allows 'self', data:, and
// blob:, so any http(s) image URL in the uploaded page is silently blocked by the browser
// regardless of the sandbox attribute (confirmed via the browser's own console error). Fixing
// this means never asking the iframe to fetch a remote image at all: fetch each one server-side
// (reusing the same SSRF-safe fetch as Web Extractor) and inline it as a data: URI, which the
// CSP already permits.
//
// A remote image can show up in FOUR places in an uploaded page, and all four are covered here —
// an earlier version only handled the first two, which is why some images still got blocked:
//   1. <img src="...">  / <img srcset="...">
//   2. an inline style="background-image: url(...)" attribute on any element
//   3. a <style>...</style> block embedded directly in the page (head or body) — separate from
//      the user's uploaded/pasted CSS FILES, which inlineImagesInCss (below) already covers
//   4. url(...) inside an uploaded/pasted CSS file (handled by inlineImagesInCss, called from
//      the /process-css route on the merged stylesheet)
//
// This is best-effort, not required for the tool to otherwise work — an image that fails to
// fetch (404, blocked host, too large, timeout) is just left as its original URL and stays
// broken in the preview exactly as before, rather than failing the whole build.

const { JSDOM } = require('jsdom');
const { fetchBinary } = require('../webExtractorService');

const MAX_IMAGES = 40; // cap total fetches per call so a page with hundreds of images can't hang the request
const CSS_URL_RE = /url\(\s*(['"]?)(https?:\/\/[^'")]+)\1\s*\)/gi;

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

function rewriteCssText(css, urlToDataUri) {
  return (css || '').replace(CSS_URL_RE, (match, quote, url) =>
    urlToDataUri.has(url) ? `url(${quote}${urlToDataUri.get(url)}${quote})` : match
  );
}

/**
 * Rewrites every http(s) image reference found in an HTML fragment (an <img> tag's src/srcset,
 * an inline style="" attribute's url(...), or an embedded <style> block's url(...)) to a
 * data: URI. Call once for the sanitized head and once for the sanitized body.
 * @returns {Promise<{ html: string, inlinedCount: number, failedCount: number }>}
 */
async function inlineImagesInHtmlFragment(htmlFragment) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${htmlFragment || ''}</body>`);
  const doc = dom.window.document;

  const collect = new Set();
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (/^https?:\/\//i.test(src)) collect.add(src);
  });
  doc.querySelectorAll('img[srcset]').forEach((img) => {
    img.getAttribute('srcset').split(',').forEach((part) => {
      const url = part.trim().split(/\s+/)[0];
      if (/^https?:\/\//i.test(url)) collect.add(url);
    });
  });
  doc.querySelectorAll('[style]').forEach((el) => {
    for (const m of el.getAttribute('style').matchAll(CSS_URL_RE)) collect.add(m[2]);
  });
  doc.querySelectorAll('style').forEach((styleTag) => {
    for (const m of styleTag.textContent.matchAll(CSS_URL_RE)) collect.add(m[2]);
  });

  if (!collect.size) return { html: htmlFragment || '', inlinedCount: 0, failedCount: 0 };
  const { urlToDataUri, inlinedCount, failedCount } = await fetchAllAsDataUris([...collect]);

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (urlToDataUri.has(src)) img.setAttribute('src', urlToDataUri.get(src));
  });
  doc.querySelectorAll('img[srcset]').forEach((img) => {
    const rewritten = img.getAttribute('srcset').split(',').map((part) => {
      const trimmed = part.trim();
      const [url, descriptor] = trimmed.split(/\s+/);
      if (urlToDataUri.has(url)) return descriptor ? `${urlToDataUri.get(url)} ${descriptor}` : urlToDataUri.get(url);
      return trimmed;
    }).join(', ');
    img.setAttribute('srcset', rewritten);
  });
  doc.querySelectorAll('[style]').forEach((el) => {
    el.setAttribute('style', rewriteCssText(el.getAttribute('style'), urlToDataUri));
  });
  doc.querySelectorAll('style').forEach((styleTag) => {
    styleTag.textContent = rewriteCssText(styleTag.textContent, urlToDataUri);
  });

  return { html: doc.body.innerHTML, inlinedCount, failedCount };
}

/**
 * Rewrites every http(s) url(...) reference (e.g. background-image) in a CSS FILE's text
 * (uploaded/pasted, merged by cssProcessor) to a data: URI.
 * @returns {Promise<{ css: string, inlinedCount: number, failedCount: number }>}
 */
async function inlineImagesInCss(css) {
  const urls = [...new Set([...(css || '').matchAll(CSS_URL_RE)].map((m) => m[2]))];
  if (!urls.length) return { css: css || '', inlinedCount: 0, failedCount: 0 };
  const { urlToDataUri, inlinedCount, failedCount } = await fetchAllAsDataUris(urls);
  return { css: rewriteCssText(css, urlToDataUri), inlinedCount, failedCount };
}

module.exports = { inlineImagesInHtmlFragment, inlineImagesInCss };
