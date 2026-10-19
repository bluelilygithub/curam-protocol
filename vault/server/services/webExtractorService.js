'use strict';

const http = require('http');
const https = require('https');
const { JSDOM, VirtualConsole } = require('jsdom');
const { fetchHtml, normaliseHttpUrl, checkSsrf } = require('./htmlFetch');
const { pinnedLookup } = require('../utils/safeFetch');

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
    checkSsrf(parsed.hostname).then((address) => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        lookup: pinnedLookup(address),
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

const MAIN_SELECTOR = 'article, main, [role="main"]';

// jsdom prints every piece of CSS it cannot parse to the server console; a scraped page is full of them and none matter here.
const parseDom = (html, url) => new JSDOM(html, { url, virtualConsole: new VirtualConsole() });

const JUNK_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
  'header', 'footer', 'nav', 'aside',
  'button',
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

// A <form> is page chrome (search box, sign-up) unless it is the wrapper around the article, which is how ASP.NET WebForms
// sites are built. It is only dropped when it holds little running text.
const FORM_KEEP_PARAGRAPH_CHARS = 400;

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
// A container this big is the article itself (or its wrapper), not a "related stories" box: remove only the heading.
const MAX_REMOVABLE_CHARS = 2500;
const MAX_REMOVABLE_PARAGRAPHS = 8;

function textMatchesAny(text, patterns) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return patterns.some((p) => p.test(t));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A term the person typed ("Author") matches a heading that IS that term or starts with it as a whole word
 * ("Author", "Author: Jo") - never one that merely contains the letters ("Candidate", "Updates" for "Date").
 */
function customTermPattern(term) {
  return new RegExp(`^${escapeRegExp(String(term).trim())}(?![\\p{L}\\p{N}])`, 'iu');
}

function holdsMain(el, mainEls) {
  return mainEls.some((m) => el === m || el.contains(m));
}

function removeJunk(document) {
  const mainEls = Array.from(document.querySelectorAll(MAIN_SELECTOR));
  JUNK_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.isConnected || holdsMain(el, mainEls)) return;
      // The headline often lives in the article's own <header>; only the page header is chrome.
      if (el.tagName === 'HEADER' && el.closest(MAIN_SELECTOR)) return;
      el.remove();
    });
  });
  document.querySelectorAll('form').forEach((form) => {
    if (!form.isConnected || holdsMain(form, mainEls)) return;
    const paragraphChars = Array.from(form.querySelectorAll('p')).reduce((n, p) => n + (p.textContent || '').length, 0);
    if (paragraphChars < FORM_KEEP_PARAGRAPH_CHARS) form.remove();
  });
}

/**
 * Remove sections whose heading/label text matches a junk phrase (built-in
 * "most read" / "related stories" style boilerplate, plus any user-supplied
 * terms). Walks up from the matching heading to the nearest reasonably-scoped
 * block ancestor and drops that whole subtree.
 */
function removeSupplementarySections(document, customTerms = [], includeBuiltIn = true) {
  const patterns = [...(includeBuiltIn ? JUNK_HEADING_PATTERNS : []), ...customTerms.filter(Boolean).map(customTermPattern)];
  if (!patterns.length) return;

  document.querySelectorAll(HEADING_LIKE_SELECTOR).forEach((el) => {
    if (!el.isConnected) return; // already removed as part of an earlier match
    const label = el.tagName.toLowerCase().startsWith('h') ? el.textContent : (el.textContent || '').slice(0, 80);
    if (!textMatchesAny(label, patterns)) return;

    let target = el.closest(REMOVABLE_ANCESTOR_SELECTOR) || el;
    const mainEls = Array.from(document.querySelectorAll(MAIN_SELECTOR));
    const tooBig = (target.textContent || '').length > MAX_REMOVABLE_CHARS || target.querySelectorAll('p').length > MAX_REMOVABLE_PARAGRAPHS;
    // Only a box that the heading LEADS is "its" section; a wrapper with other headings or text before it is shared with the article.
    const leads = target === el || target.querySelector(HEADING_LIKE_SELECTOR) === el;
    // Don't nuke the document, the article or a page-sized wrapper if the selector matched too broadly.
    if (target === document.body || target === document.documentElement || tooBig || !leads || holdsMain(target, mainEls)) target = el;
    target.remove();
  });
}

function absoluteUrl(src, base) {
  if (!src) return null;
  try { return new URL(src, base).toString(); } catch { return null; }
}

/** Where relative URLs resolve from: the page's <base href> if it has one, else the page address. */
const baseOf = (document, url) => document.baseURI || url;

/** Pick the element most likely to hold the article body. */
function findMainCandidate(doc) {
  // The biggest article/main wins (a listing page has many small <article> cards and one big <main>).
  let best = null;
  let bestLen = 0;
  doc.querySelectorAll(MAIN_SELECTOR).forEach((el) => {
    const len = (el.textContent || '').trim().length;
    if (len > bestLen) { best = el; bestLen = len; }
  });
  if (best && bestLen >= 200) return best;

  // No usable article/main: take the block with the most text in its OWN paragraphs. (Total text would always pick the
  // outermost wrapper, i.e. the whole page.)
  let bestOwn = null;
  let bestScore = 0;
  doc.querySelectorAll('div, section').forEach((el) => {
    const paragraphs = Array.from(el.children).filter((c) => c.tagName === 'P');
    if (paragraphs.length < 2) return;
    const score = paragraphs.reduce((n, p) => n + (p.textContent || '').trim().length, 0);
    if (score > bestScore) { bestScore = score; bestOwn = el; }
  });
  return bestOwn || best || doc.body;
}

const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'blockquote', 'pre',
  'tr', 'table', 'ul', 'ol', 'br', 'hr', 'figcaption', 'dl', 'dt', 'dd',
]);
const CELL_TAGS = new Set(['td', 'th']);
const EMPTY_LIST_ITEM = /^(•|\d+\.)$/;

/**
 * Walk an element tree to plain text, inserting blank lines around block
 * elements and marking headings with a markdown-style `#` prefix + a blank
 * line on each side, so heading breaks survive the flatten to text/PDF.
 * List items start with a bullet or number; table cells are separated by " | ".
 */
function blockToText(root, domWindow) {
  const lines = [];
  let current = '';

  const flushCurrent = () => {
    const t = current.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*$/, '').trim();
    if (t && !EMPTY_LIST_ITEM.test(t)) lines.push(t);
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

    if (tag === 'li') {
      flushCurrent();
      const parent = node.parentElement;
      const ordered = parent && parent.tagName.toLowerCase() === 'ol';
      const n = ordered ? Array.from(parent.children).filter((c) => c.tagName === 'LI').indexOf(node) + 1 : 0;
      current = ordered ? `${n}. ` : '• ';
      for (const child of node.childNodes) walk(child);
      flushCurrent();
      return;
    }

    if (CELL_TAGS.has(tag)) {
      for (const child of node.childNodes) walk(child);
      current += ' | ';
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

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const metaContent = (document, selector) => clean(document.querySelector(selector)?.getAttribute('content'));
const MAX_BYLINE_CHARS = 120;

/** Page title without the " | Site Name" tail: the social-card title, else the first headline, else <title>. */
function pageTitle(document) {
  return metaContent(document, 'meta[property="og:title"]')
    || clean(document.querySelector('article h1, main h1, [role="main"] h1')?.textContent) // the page header's h1 is often the site name
    || clean(document.querySelector('h1')?.textContent)
    || clean(document.querySelector('title')?.textContent);
}

/** Author name: the meta tag, else the first author-ish element short enough to be a name (not a whole bio block). */
function pageByline(document) {
  const fromMeta = metaContent(document, 'meta[name="author"]');
  if (fromMeta) return fromMeta;
  for (const el of document.querySelectorAll('[rel="author"], [itemprop="author"], [class*="byline" i], .author')) {
    const t = clean(el.textContent);
    if (t && t.length <= MAX_BYLINE_CHARS) return t;
  }
  return '';
}

// Too little text to be an article usually means the page builds itself with JavaScript, which this tool does not run.
const THIN_TEXT_CHARS = 200;
const JS_PAGE_NOTICE = 'Very little came back. The page probably loads its content with JavaScript, which this tool cannot run, or it blocked the request.';

/**
 * Mode 1 - article text only: strip chrome (nav/header/footer/ads/sidebars/images),
 * return the readable body text (with heading line breaks) plus a lightly-cleaned HTML fragment.
 */
function extractArticle(html, url, customExcludes = [], { selector = '' } = {}) {
  const dom = parseDom(html, url);
  const { document } = dom.window;

  const title = pageTitle(document);
  const byline = pageByline(document);
  const cssSelector = String(selector || '').trim();

  if (cssSelector) return extractSelected(dom, { title, byline, cssSelector, customExcludes });

  removeJunk(document);
  // Images are excluded from this mode by request.
  document.querySelectorAll('img, picture, figure, video, source').forEach((el) => el.remove());
  // "Most read" / "related stories" / user-named sections - supplementary, not article body.
  removeSupplementarySections(document, customExcludes);

  const main = findMainCandidate(document);
  const html_ = main ? main.innerHTML : '';
  const text = blockToText(main || document.body, dom.window);

  return { title, byline, text, html: html_, ...readingStats(text), notice: text.length < THIN_TEXT_CHARS ? JS_PAGE_NOTICE : '' };
}

const WORDS_PER_MINUTE = 230;
const MAX_SELECTED = 200;

/** Words in the extracted text (the # of a heading is not a word) and a reading time at an average speed. */
function readingStats(text) {
  const wordCount = String(text || '').replace(/^#{1,6}\s+/gm, '').split(/\s+/).filter(Boolean).length;
  return { wordCount, readingMinutes: wordCount ? Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)) : 0 };
}

/**
 * Article content with a CSS selector: only what is inside the matching elements, in page order. The person chose the boxes, so the
 * built-in clean-up (which could remove the very box they asked for) is skipped; their own excluded section names still apply.
 */
function extractSelected(dom, { title, byline, cssSelector, customExcludes }) {
  const { document } = dom.window;
  document.querySelectorAll('script, style, noscript, iframe, svg, canvas, img, picture, figure, video, source').forEach((el) => el.remove());
  removeSupplementarySections(document, customExcludes, false);

  let found;
  try { found = Array.from(document.querySelectorAll(cssSelector)); } catch { throw new Error('Invalid CSS selector'); }
  // A match inside another match would be read twice.
  const matches = found.filter((el) => !found.some((other) => other !== el && other.contains(el))).slice(0, MAX_SELECTED);

  const text = matches.map((el) => blockToText(el, dom.window)).filter(Boolean).join('\n\n');
  const notice = matches.length ? '' : 'Nothing on the page matches that selector. Check it, or leave the box empty to read the whole article.';
  return {
    title, byline, text, html: matches.map((el) => el.outerHTML).join('\n'), matchCount: matches.length, ...readingStats(text), notice,
  };
}

const MAX_LINKS = 2000;
const MAX_TABLES = 50;
const MAX_TABLE_ROWS = 1000;
const MAX_HEADINGS = 300;
const MAX_JSON_LD_BLOCKS = 20;
const MAX_JSON_LD_CHARS = 20000;

const hostKey = (hostname) => String(hostname || '').replace(/^www\./i, '').toLowerCase();

/** Mode - every link on the page with its words, split into this site (internal), other sites (external), and email/phone. */
function extractLinks(html, url) {
  const dom = parseDom(html, url);
  const { document } = dom.window;
  const base = baseOf(document, url);
  let pageHost = '';
  try { pageHost = hostKey(new URL(url).hostname); } catch { /* the address was already validated */ }

  const byHref = new Map();
  let truncated = false;
  document.querySelectorAll('a[href]').forEach((a) => {
    const raw = (a.getAttribute('href') || '').trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return;
    const abs = absoluteUrl(raw, base);
    let parsed;
    try { parsed = new URL(abs); } catch { return; }
    let type;
    if (parsed.protocol === 'mailto:') type = 'email';
    else if (parsed.protocol === 'tel:') type = 'phone';
    else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') type = hostKey(parsed.hostname) === pageHost ? 'internal' : 'external';
    else return;
    const text = clean(a.textContent) || clean(a.getAttribute('aria-label')) || clean(a.getAttribute('title')) || clean(a.querySelector('img')?.getAttribute('alt'));
    const seen = byHref.get(abs);
    if (seen) {
      seen.occurrences += 1;
      if (!seen.text && text) seen.text = text;
      return;
    }
    if (byHref.size >= MAX_LINKS) { truncated = true; return; }
    byHref.set(abs, { href: abs, text, type, nofollow: /\bnofollow\b/i.test(a.getAttribute('rel') || ''), occurrences: 1 });
  });

  const links = Array.from(byHref.values());
  const countOf = (type) => links.filter((l) => l.type === type).length;
  return {
    links,
    count: links.length,
    internalCount: countOf('internal'),
    externalCount: countOf('external'),
    otherCount: countOf('email') + countOf('phone'),
    truncated,
    notice: links.length ? '' : 'No links found in the page source. If the page draws its menus and links with JavaScript, this tool cannot see them.',
  };
}

/** Mode - every HTML table as rows of text (header row split off when the first row is all header cells). */
function extractTables(html, url) {
  const dom = parseDom(html, url);
  const { document } = dom.window;

  const tables = [];
  document.querySelectorAll('table').forEach((table) => {
    if (tables.length >= MAX_TABLES) return;
    if (table.parentElement && table.parentElement.closest('table')) return; // a table inside a cell is read as that cell's text
    const allRows = Array.from(table.rows).slice(0, MAX_TABLE_ROWS);
    const rows = allRows.map((r) => Array.from(r.cells).map((c) => clean(c.textContent)));
    const headerRow = allRows[0] && allRows[0].cells.length && Array.from(allRows[0].cells).every((c) => c.tagName === 'TH');
    const headers = headerRow ? rows.shift() : null;
    const body = rows.filter((r) => r.some(Boolean));
    const colCount = Math.max(headers ? headers.length : 0, ...body.map((r) => r.length), 0);
    // One-cell tables are page layout, not data.
    if (!body.length || (colCount < 2 && body.length < 2)) return;
    tables.push({ caption: clean(table.caption && table.caption.textContent), headers, rows: body, rowCount: body.length, colCount });
  });

  return { tables, count: tables.length, notice: tables.length ? '' : 'No tables found in the page source. If the page draws its tables with JavaScript, this tool cannot see them.' };
}

/** First value of `key` anywhere in the JSON-LD blocks (a few levels deep), as it is written there. */
function jsonLdFind(blocks, key, depth = 0) {
  if (depth > 4 || blocks == null || typeof blocks !== 'object') return undefined;
  if (Array.isArray(blocks)) {
    for (const b of blocks) { const v = jsonLdFind(b, key, depth + 1); if (v !== undefined) return v; }
    return undefined;
  }
  if (blocks[key] != null && blocks[key] !== '') return blocks[key];
  for (const v of Object.values(blocks)) { const found = jsonLdFind(v, key, depth + 1); if (found !== undefined) return found; }
  return undefined;
}

/** A JSON-LD value as short text: a string as is, a person/organisation by name, a list by its first entry. */
function jsonLdText(value) {
  if (Array.isArray(value)) return jsonLdText(value[0]);
  if (value && typeof value === 'object') return jsonLdText(value.name);
  return typeof value === 'string' ? clean(value) : '';
}

const jsonLdValue = (blocks, key) => jsonLdText(jsonLdFind(blocks, key));

/** Mode - what the page says about itself: title, description, dates, social-card tags, structured data and the heading outline. */
function extractMetadata(html, url) {
  const dom = parseDom(html, url);
  const { document } = dom.window;
  const base = baseOf(document, url);

  const og = {}; const twitter = {}; const article = {}; const named = {};
  document.querySelectorAll('meta').forEach((m) => {
    const key = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase();
    const value = clean(m.getAttribute('content'));
    if (!key || !value) return;
    if (key.startsWith('og:')) og[key.slice(3)] = value;
    else if (key.startsWith('twitter:')) twitter[key.slice(8)] = value;
    else if (key.startsWith('article:')) article[key.slice(8)] = value;
    else named[key] = value;
  });

  const jsonLd = [];
  let jsonLdSkipped = 0;
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    if (jsonLd.length >= MAX_JSON_LD_BLOCKS) { jsonLdSkipped += 1; return; }
    try {
      const parsed = JSON.parse(s.textContent);
      if (JSON.stringify(parsed).length > MAX_JSON_LD_CHARS) jsonLdSkipped += 1; else jsonLd.push(parsed);
    } catch { jsonLdSkipped += 1; /* a page's broken JSON-LD is common and not ours to fix */ }
  });

  const headings = [];
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const text = clean(h.textContent);
    if (text && headings.length < MAX_HEADINGS) headings.push({ level: Number(h.tagName[1]), text });
  });

  const canonical = absoluteUrl(document.querySelector('link[rel~="canonical"]')?.getAttribute('href'), base) || '';
  const icons = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]'))
    .map((l) => absoluteUrl(l.getAttribute('href'), base)).filter(Boolean);

  return {
    title: pageTitle(document),
    titleTag: clean(document.querySelector('title')?.textContent),
    description: named.description || og.description || '',
    canonical,
    language: clean(document.documentElement.getAttribute('lang')),
    author: pageByline(document) || jsonLdValue(jsonLd, 'author') || '',
    siteName: og.site_name || '',
    robots: named.robots || '',
    keywords: named.keywords || '',
    published: article.published_time || jsonLdValue(jsonLd, 'datePublished') || clean(document.querySelector('time[datetime]')?.getAttribute('datetime')),
    modified: article.modified_time || jsonLdValue(jsonLd, 'dateModified'),
    og, twitter, article, jsonLd, jsonLdSkipped, headings,
    h1Count: headings.filter((h) => h.level === 1).length,
    icons: Array.from(new Set(icons)),
    notice: '',
  };
}

/** Largest candidate in a srcset ("a.jpg 480w, b.jpg 1080w" or "a.jpg 1x, b.jpg 2x"); the first one is usually the smallest. */
function pickFromSrcset(val) {
  const candidates = String(val || '').split(/,\s+/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const [u, descriptor] = part.split(/\s+/);
    const n = parseFloat(descriptor);
    let weight = 0;
    if (descriptor && Number.isFinite(n)) weight = /w$/i.test(descriptor) ? n : n * 1000;
    return { u, weight };
  }).filter((c) => c.u);
  if (!candidates.length) return '';
  return candidates.reduce((best, c) => (c.weight > best.weight ? c : best)).u;
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;

/** Mode 2 - every image on the page, deduped, with alt text and absolute URLs. */
function extractImages(html, url) {
  const dom = parseDom(html, url);
  const { document } = dom.window;
  const base = baseOf(document, url);

  const seen = new Set();
  const images = [];
  const add = (raw, alt = '', width = null, height = null, front = false) => {
    if (!raw || /^data:/i.test(raw)) return;
    const abs = absoluteUrl(raw, base);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    const entry = { src: abs, alt, width, height };
    if (front) images.unshift(entry); else images.push(entry);
  };

  document.querySelectorAll('img').forEach((img) => {
    // Lazy-load attrs hold the real image; plain src is often a tiny placeholder
    // (base64 blur-up or 1x1 gif) - prefer the lazy attrs when present.
    const raw = img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.getAttribute('data-original')
      || pickFromSrcset(img.getAttribute('data-srcset'))
      || pickFromSrcset(img.getAttribute('srcset'))
      || img.getAttribute('src');
    const w = parseInt(img.getAttribute('width'), 10);
    const h = parseInt(img.getAttribute('height'), 10);
    if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return; // tracking pixel
    add(raw, img.getAttribute('alt') || '', img.getAttribute('width') || null, img.getAttribute('height') || null);
  });

  // <picture><source srcset></picture> images not duplicated by a sibling <img> above.
  document.querySelectorAll('picture source[srcset]').forEach((source) => add(pickFromSrcset(source.getAttribute('srcset'))));
  document.querySelectorAll('video[poster]').forEach((v) => add(v.getAttribute('poster'), 'video poster'));
  document.querySelectorAll('[style]').forEach((el) => {
    for (const m of (el.getAttribute('style') || '').matchAll(CSS_URL)) add(m[2], 'background');
  });

  // Social-card images go first: they are the page's chosen picture.
  add(metaContent(document, 'meta[name="twitter:image"], meta[name="twitter:image:src"]'), 'twitter:image', null, null, true);
  add(metaContent(document, 'meta[property="og:image"]'), 'og:image', null, null, true);

  return {
    images,
    count: images.length,
    notice: images.length ? '' : 'No pictures found in the page source. If the page draws its pictures with JavaScript, this tool cannot see them.',
  };
}

/** Rewrite url(...) and @import in CSS text to absolute addresses (data: and #fragment references are left alone). */
function rewriteCssUrls(css, base) {
  return String(css || '')
    .replace(CSS_URL, (m, q, u) => {
      if (/^(data:|#|about:|blob:)/i.test(u.trim())) return m;
      const abs = absoluteUrl(u.trim(), base);
      return abs ? `url(${q}${abs}${q})` : m;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
      const abs = absoluteUrl(u.trim(), base);
      return abs ? `@import ${q}${abs}${q}` : m;
    });
}

/**
 * Mode 3 - verbatim scrape: original HTML with every relative link/asset URL
 * rewritten absolute so it renders the same when sandboxed (all original
 * inline styles and <style> blocks are kept; only the addresses inside them are made absolute).
 */
function extractStyled(html, url) {
  const dom = parseDom(html, url);
  const { document } = dom.window;
  const base = baseOf(document, url);

  document.querySelectorAll('[src]').forEach((el) => {
    const abs = absoluteUrl(el.getAttribute('src'), base);
    if (abs) el.setAttribute('src', abs);
  });
  document.querySelectorAll('[href]').forEach((el) => {
    const abs = absoluteUrl(el.getAttribute('href'), base);
    if (abs) el.setAttribute('href', abs);
  });
  document.querySelectorAll('[poster]').forEach((el) => {
    const abs = absoluteUrl(el.getAttribute('poster'), base);
    if (abs) el.setAttribute('poster', abs);
  });
  ['srcset', 'data-srcset'].forEach((attr) => {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const rewritten = el.getAttribute(attr)
        .split(/,\s+/)
        .map((part) => {
          const [u, size] = part.trim().split(/\s+/);
          const abs = absoluteUrl(u, base);
          return [abs || u, size].filter(Boolean).join(' ');
        })
        .join(', ');
      el.setAttribute(attr, rewritten);
    });
  });
  // Lazy-load attributes: show the real picture, not the blur-up placeholder, since no script runs to swap it in.
  document.querySelectorAll('img[data-src]').forEach((img) => {
    const abs = absoluteUrl(img.getAttribute('data-src'), base);
    if (abs) img.setAttribute('src', abs);
  });
  document.querySelectorAll('style').forEach((el) => { el.textContent = rewriteCssUrls(el.textContent, base); });
  document.querySelectorAll('[style]').forEach((el) => { el.setAttribute('style', rewriteCssUrls(el.getAttribute('style'), base)); });

  // Scripts stripped - this is a static visual snapshot, not a live re-execution of the page.
  document.querySelectorAll('script').forEach((el) => el.remove());
  // Everything is absolute now, and a redirect inside the preview frame would replace the snapshot with the live page.
  document.querySelectorAll('base, meta[http-equiv="refresh" i]').forEach((el) => el.remove());

  return { html: dom.serialize() };
}

async function runExtraction(rawUrl, mode, customExcludes = [], options = {}) {
  const url = normaliseHttpUrl(rawUrl);
  const { body, statusCode } = await fetchHtml(url);
  if (statusCode >= 400) throw new Error(`Server returned ${statusCode}`);

  if (mode === 'images') return { url, mode, ...extractImages(body, url) };
  if (mode === 'styled') return { url, mode, ...extractStyled(body, url) };
  if (mode === 'links') return { url, mode, ...extractLinks(body, url) };
  if (mode === 'tables') return { url, mode, ...extractTables(body, url) };
  if (mode === 'metadata') return { url, mode, ...extractMetadata(body, url) };
  return { url, mode: 'article', ...extractArticle(body, url, customExcludes, options) };
}

module.exports = { runExtraction, extractArticle, extractImages, extractStyled, extractLinks, extractTables, extractMetadata, fetchBinary, rewriteCssUrls, pickFromSrcset };
