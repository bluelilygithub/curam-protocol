'use strict';

// Topic Research: read the text of the articles that matter most, politely. For each page, in order:
//   1. robots.txt (robots.js) says whether this site lets us read it; if not (or it cannot be read), the page is left alone;
//   2. at most one request every two seconds to one site (longer if the site's Crawl-delay asks), four sites at a time;
//   3. downloaded through the SSRF-safe fetcher with the honest agent name, 2 MB at most, HTML only;
//   4. the readable text comes from webExtractorService.extractArticle (the Web Extractor's own code), nothing is run or followed.
// Nothing is retried or worked around: a page that blocks, errors or is mostly empty keeps its snippet and the search moves on. The text is
// kept for analysis only and is never sent to the browser. Work stops starting new pages once the time budget is spent.
// See docs/topic-research.md.

const { classify } = require('./pageKind');
const { fetchPublicFile } = require('../../utils/safeFetch');
const { createRobotsChecker } = require('./robots');
const { createThrottle } = require('./sources/http');

const SPACING_MS = 2000;
const CONCURRENCY = 4;
const DEFAULT_BUDGET_MS = 25000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 12000;
const MAX_TEXT_CHARS = 60000;
const THIN_CHARS = 200;
const HTML_ACCEPT = 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1';

/** Page bytes -> text, using the charset the server declared (or the page's own <meta charset>), else UTF-8. */
function decodeBody(buffer, contentType = '') {
  let label = (/charset=["']?([\w-]+)/i.exec(contentType) || [])[1];
  if (!label) label = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 4096).toString('latin1')) || [])[1];
  try { return new TextDecoder(label || 'utf-8').decode(buffer); } catch { return new TextDecoder('utf-8').decode(buffer); }
}

const wordCountOf = (text) => text.split(/\s+/).filter(Boolean).length;
const statusOfHttp = (err) => {
  const m = /HTTP (\d{3})/.exec(String(err?.message || ''));
  return m ? Number(m[1]) : null;
};

/** A date a page gives for itself, if it is a believable one. */
function believableDate(raw, nowMs) {
  if (!raw) return null;
  const d = new Date(raw);
  const t = d.getTime();
  if (Number.isNaN(t) || t > nowMs + 86400000 || t < Date.UTC(2000, 0, 1)) return null;
  return d;
}

/**
 * @param deps all injectable so tests need no network: fetchFile, robots, extractArticle, extractMetadata, now, sleep
 * @returns { async readPages(candidates, { budgetMs }) -> Array<{ id, status, text?, wordCount?, published? }> }
 *   candidates: [{ id, url, publishedAt }]. status: ok | thin | robots | blocked | not-html | error | skipped
 *   (robots = the site's robots.txt says no; blocked = robots.txt unreadable or the site refused us; skipped = out of time)
 */
function createExtractor({
  fetchFile = fetchPublicFile,
  robots = createRobotsChecker(),
  extractArticle = (html, url) => require('../webExtractorService').extractArticle(html, url),
  extractMetadata = (html, url) => require('../webExtractorService').extractMetadata(html, url),
  now = Date.now,
  sleep,
  spacingMs = SPACING_MS,
  concurrency = CONCURRENCY,
} = {}) {
  // kept for the life of the extractor, not one search: two searches a few seconds apart must still leave two seconds between pages of one site
  const throttles = new Map(); // host -> { gap, run }
  const throttleFor = (host, crawlDelayMs) => {
    const gap = Math.max(spacingMs, crawlDelayMs || 0);
    let t = throttles.get(host);
    if (!t || t.gap !== gap) { t = { gap, run: createThrottle({ gapMs: gap, now, ...(sleep ? { sleep } : {}) }) }; throttles.set(host, t); }
    return t.run;
  };
  return {
    async readPages(candidates, { budgetMs = DEFAULT_BUDGET_MS, onEach } = {}) {
      const started = now();
      const results = new Array(candidates.length);
      let next = 0;
      let readSoFar = 0;

      async function readOne(c) {
        const rule = await robots.check(c.url);
        if (!rule.allowed) return { id: c.id, status: rule.reason === 'disallowed' ? 'robots' : 'blocked' };
        let host;
        try { host = new URL(c.url).host; } catch { return { id: c.id, status: 'error' }; }
        let file;
        try {
          file = await throttleFor(host, rule.crawlDelayMs)(() => fetchFile(c.url, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, accept: HTML_ACCEPT }));
        } catch (err) {
          const status = statusOfHttp(err);
          return { id: c.id, status: status === 401 || status === 403 || status === 429 ? 'blocked' : 'error' };
        }
        const type = String(file.contentType || '').toLowerCase();
        if (type && !/html|xml/.test(type)) return { id: c.id, status: 'not-html' };
        const html = decodeBody(file.buffer, type);
        let article;
        try { article = extractArticle(html, file.finalUrl || c.url); } catch { return { id: c.id, status: 'error' }; }
        const text = String(article?.text || '').trim();
        let published = null;
        if (!c.publishedAt) {
          try { published = believableDate(extractMetadata(html, file.finalUrl || c.url)?.published, now()); } catch { /* a page with no usable metadata is common */ }
        }
        const pageKind = classify({ url: file.finalUrl || c.url, html, text });
        if (text.length < THIN_CHARS) return { id: c.id, status: 'thin', published, pageKind };
        const kept = text.slice(0, MAX_TEXT_CHARS);
        return { id: c.id, status: 'ok', text: kept, wordCount: wordCountOf(kept), published, pageKind };
      }

      async function worker() {
        while (next < candidates.length) {
          const i = next; next += 1;
          const c = candidates[i];
          if (now() - started >= budgetMs) { results[i] = { id: c.id, status: 'skipped' }; readSoFar += 1; try { onEach?.(readSoFar, candidates.length); } catch { /* a progress note never stops a read */ } continue; }
          try { results[i] = await readOne(c); } catch { results[i] = { id: c.id, status: 'error' }; }
          readSoFar += 1;
          try { onEach?.(readSoFar, candidates.length); } catch { /* a progress note never stops a read */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
      return results;
    },
  };
}

module.exports = {
  createExtractor, decodeBody, believableDate,
  SPACING_MS, CONCURRENCY, DEFAULT_BUDGET_MS, MAX_TEXT_CHARS, THIN_CHARS, MAX_PAGE_BYTES,
};
