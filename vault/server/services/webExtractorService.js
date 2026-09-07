'use strict';

const { JSDOM } = require('jsdom');
const { fetchHtml, normaliseHttpUrl } = require('./htmlFetch');

const JUNK_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
  'header', 'footer', 'nav', 'aside',
  'form', 'button',
  '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]', '[role="complementary"]',
  '[class*="cookie"]', '[id*="cookie"]',
  '[class*="advert" i]', '[id*="advert" i]', '[class*="ads-" i]', '[class*="-ads" i]',
  '[class*="sidebar" i]', '[id*="sidebar" i]',
  '[class*="popup" i]', '[class*="modal" i]',
  '[class*="newsletter" i]',
  '[class*="social-share" i]', '[class*="share-buttons" i]',
  '[class*="related" i]', '[class*="recommend" i]',
  '[class*="comment" i]', '[id*="comment" i]',
];

function absoluteUrl(src, base) {
  if (!src) return null;
  try { return new URL(src, base).toString(); } catch { return null; }
}

/** Pick the element most likely to hold the article body. */
function findMainCandidate(doc) {
  const direct = doc.querySelector('article, main, [role="main"]');
  if (direct) return direct;

  let best = null;
  let bestScore = 0;
  doc.querySelectorAll('div, section').forEach((el) => {
    const text = el.textContent || '';
    const pCount = el.querySelectorAll('p').length;
    const score = text.trim().length * (pCount > 2 ? 1.4 : 1);
    if (pCount >= 2 && score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  return best || doc.body;
}

/**
 * Mode 1 — article text only: strip chrome (nav/header/footer/ads/sidebars/images),
 * return the readable body text plus a lightly-cleaned HTML fragment.
 */
function extractArticle(html, url) {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;

  const title = (document.querySelector('title')?.textContent || '').trim();
  const byline = document.querySelector('[rel="author"], .author, [class*="byline" i]')?.textContent?.trim() || '';

  JUNK_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  });
  // Images are excluded from this mode by request.
  document.querySelectorAll('img, picture, figure, video, source').forEach((el) => el.remove());

  const main = findMainCandidate(document);
  const html_ = main ? main.innerHTML : '';
  const text = (main ? main.textContent : document.body.textContent || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();

  return { title, byline, text, html: html_ };
}

/** Mode 2 — every image on the page, deduped, with alt text and absolute URLs. */
function extractImages(html, url) {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;

  const seen = new Set();
  const images = [];

  document.querySelectorAll('img').forEach((img) => {
    const raw = img.getAttribute('src')
      || img.getAttribute('data-src')
      || (img.getAttribute('srcset') || '').split(',')[0]?.trim().split(' ')[0];
    const abs = absoluteUrl(raw, url);
    if (!abs || seen.has(abs)) return;
    if (abs.startsWith('data:')) return;
    seen.add(abs);
    images.push({
      src: abs,
      alt: img.getAttribute('alt') || '',
      width: img.getAttribute('width') || null,
      height: img.getAttribute('height') || null,
    });
  });

  const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const ogAbs = absoluteUrl(og, url);
  if (ogAbs && !seen.has(ogAbs)) {
    seen.add(ogAbs);
    images.unshift({ src: ogAbs, alt: 'og:image', width: null, height: null });
  }

  return { images, count: images.length };
}

/**
 * Mode 3 — verbatim scrape: original HTML with every relative link/asset URL
 * rewritten absolute so it renders the same when sandboxed (all original
 * inline styles and <style> blocks are left untouched).
 */
function extractStyled(html, url) {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;

  document.querySelectorAll('[src]').forEach((el) => {
    const abs = absoluteUrl(el.getAttribute('src'), url);
    if (abs) el.setAttribute('src', abs);
  });
  document.querySelectorAll('[href]').forEach((el) => {
    const abs = absoluteUrl(el.getAttribute('href'), url);
    if (abs) el.setAttribute('href', abs);
  });
  document.querySelectorAll('[srcset]').forEach((el) => {
    const rewritten = el.getAttribute('srcset')
      .split(',')
      .map((part) => {
        const [u, size] = part.trim().split(/\s+/);
        const abs = absoluteUrl(u, url);
        return [abs || u, size].filter(Boolean).join(' ');
      })
      .join(', ');
    el.setAttribute('srcset', rewritten);
  });

  // Scripts stripped — this is a static visual snapshot, not a live re-execution of the page.
  document.querySelectorAll('script').forEach((el) => el.remove());

  return { html: dom.serialize() };
}

async function runExtraction(rawUrl, mode) {
  const url = normaliseHttpUrl(rawUrl);
  const { body, statusCode } = await fetchHtml(url);
  if (statusCode >= 400) throw new Error(`Server returned ${statusCode}`);

  if (mode === 'images') return { url, mode, ...extractImages(body, url) };
  if (mode === 'styled') return { url, mode, ...extractStyled(body, url) };
  return { url, mode: 'article', ...extractArticle(body, url) };
}

module.exports = { runExtraction, extractArticle, extractImages, extractStyled };
