'use strict';

const http = require('http');
const https = require('https');
const { JSDOM } = require('jsdom');
const { fetchHtml, normaliseHttpUrl, checkSsrf } = require('./htmlFetch');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Binary-safe fetch for images — htmlFetch's fetchHtml decodes everything as utf8 text. */
function fetchBinary(url, redirectsLeft = 5, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('Only http/https URLs are allowed'));
    }
    checkSsrf(parsed.hostname).then(() => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
        timeout: timeoutMs,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchBinary(next, redirectsLeft - 1, timeoutMs));
        }
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`Server returned ${res.statusCode}`));
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_IMAGE_BYTES) {
            req.destroy();
            return reject(new Error('Image too large'));
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'application/octet-stream',
        }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    }).catch(reject);
  });
}

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

// Heading/label text that flags a block as supplementary (not article body),
// even though it sits inside <article>/<main> and survives JUNK_SELECTORS.
const JUNK_HEADING_PATTERNS = [
  /^most read/i, /^most popular/i, /^trending( now)?$/i, /^popular (now|stories|articles)/i,
  /^recent(ly)? (stories|articles|posts|news)/i, /^in this section/i, /^more (from|in|on|stories|articles)/i,
  /^you may (also )?like/i, /^you might (also )?like/i, /^also read/i, /^also on/i,
  /^related (articles|stories|content|posts)?$/i, /^recommended( for you)?$/i,
  /^editor'?s pick(s)?/i, /^sponsored/i, /^advertisement/i, /^promoted/i,
  /^what to read next/i, /^read (next|more)/i, /^up next/i, /^more like this/i,
  /^latest (news|stories|articles)/i, /^top stories/i, /^next article/i, /^previous article/i,
];

const HEADING_LIKE_SELECTOR = 'h1, h2, h3, h4, h5, h6, [class*="heading" i], [class*="title" i]';
// A block-level container worth removing wholesale when its heading matches.
const REMOVABLE_ANCESTOR_SELECTOR = 'section, aside, div, ul, nav';

function textMatchesAny(text, patterns) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return patterns.some((p) => (p instanceof RegExp ? p.test(t) : t.toLowerCase().includes(String(p).toLowerCase())));
}

/**
 * Remove sections whose heading/label text matches a junk phrase (built-in
 * "most read" / "related stories" style boilerplate, plus any user-supplied
 * terms). Walks up from the matching heading to the nearest reasonably-scoped
 * block ancestor and drops that whole subtree.
 */
function removeSupplementarySections(document, domWindow, customTerms = []) {
  const patterns = [...JUNK_HEADING_PATTERNS, ...customTerms.filter(Boolean)];
  if (!patterns.length) return;

  document.querySelectorAll(HEADING_LIKE_SELECTOR).forEach((el) => {
    if (!el.isConnected) return; // already removed as part of an earlier match
    const label = el.tagName.toLowerCase().startsWith('h') ? el.textContent : (el.textContent || '').slice(0, 80);
    if (!textMatchesAny(label, patterns)) return;

    let target = el.closest(REMOVABLE_ANCESTOR_SELECTOR) || el;
    // Don't nuke the whole document/body if the selector matched too broadly.
    if (target === document.body || target === document.documentElement) target = el;
    target.remove();
  });
}

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

const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'li', 'blockquote', 'pre',
  'tr', 'table', 'ul', 'ol', 'br', 'hr',
]);

/**
 * Walk an element tree to plain text, inserting blank lines around block
 * elements and marking headings with a markdown-style `#` prefix + a blank
 * line on each side, so heading breaks survive the flatten to text/PDF.
 */
function blockToText(root, domWindow) {
  const lines = [];
  let current = '';

  const flushCurrent = () => {
    const t = current.replace(/[ \t]+/g, ' ').trim();
    if (t) lines.push(t);
    current = '';
  };

  const walk = (node) => {
    if (node.nodeType === domWindow.Node.TEXT_NODE) {
      current += node.textContent;
      return;
    }
    if (node.nodeType !== domWindow.Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    const level = HEADING_LEVEL[tag];

    if (level) {
      flushCurrent();
      const headingText = node.textContent.replace(/\s+/g, ' ').trim();
      if (headingText) lines.push(`${'#'.repeat(level)} ${headingText}`);
      return;
    }

    if (tag === 'br') {
      current += '\n';
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flushCurrent();
    for (const child of node.childNodes) walk(child);
    if (isBlock) flushCurrent();
  };

  walk(root);
  flushCurrent();
  return lines.join('\n\n');
}

/**
 * Mode 1 — article text only: strip chrome (nav/header/footer/ads/sidebars/images),
 * return the readable body text (with heading line breaks) plus a lightly-cleaned HTML fragment.
 */
function extractArticle(html, url, customExcludes = []) {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;

  const title = (document.querySelector('title')?.textContent || '').trim();
  const byline = document.querySelector('[rel="author"], .author, [class*="byline" i]')?.textContent?.trim() || '';

  JUNK_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  });
  // Images are excluded from this mode by request.
  document.querySelectorAll('img, picture, figure, video, source').forEach((el) => el.remove());
  // "Most read" / "related stories" / user-named sections — supplementary, not article body.
  removeSupplementarySections(document, dom.window, customExcludes);

  const main = findMainCandidate(document);
  const html_ = main ? main.innerHTML : '';
  const text = blockToText(main || document.body, dom.window);

  return { title, byline, text, html: html_ };
}

/** Mode 2 — every image on the page, deduped, with alt text and absolute URLs. */
function extractImages(html, url) {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;

  const seen = new Set();
  const images = [];

  const firstSrcsetUrl = (val) => (val || '').split(',')[0]?.trim().split(/\s+/)[0];

  document.querySelectorAll('img').forEach((img) => {
    // Lazy-load attrs hold the real image; plain src is often a tiny placeholder
    // (base64 blur-up or 1x1 gif) — prefer the lazy attrs when present.
    const raw = img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.getAttribute('data-original')
      || firstSrcsetUrl(img.getAttribute('data-srcset'))
      || firstSrcsetUrl(img.getAttribute('srcset'))
      || img.getAttribute('src');
    if (!raw || raw.startsWith('data:')) return;
    const abs = absoluteUrl(raw, url);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    images.push({
      src: abs,
      alt: img.getAttribute('alt') || '',
      width: img.getAttribute('width') || null,
      height: img.getAttribute('height') || null,
    });
  });

  // <picture><source srcset></picture> images not duplicated by a sibling <img> above.
  document.querySelectorAll('picture source[srcset]').forEach((source) => {
    const raw = firstSrcsetUrl(source.getAttribute('srcset'));
    if (!raw || raw.startsWith('data:')) return;
    const abs = absoluteUrl(raw, url);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    images.push({ src: abs, alt: '', width: null, height: null });
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

async function runExtraction(rawUrl, mode, customExcludes = []) {
  const url = normaliseHttpUrl(rawUrl);
  const { body, statusCode } = await fetchHtml(url);
  if (statusCode >= 400) throw new Error(`Server returned ${statusCode}`);

  if (mode === 'images') return { url, mode, ...extractImages(body, url) };
  if (mode === 'styled') return { url, mode, ...extractStyled(body, url) };
  return { url, mode: 'article', ...extractArticle(body, url, customExcludes) };
}

module.exports = { runExtraction, extractArticle, extractImages, extractStyled, fetchBinary };
