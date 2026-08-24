'use strict';

const {
  fetchHtml,
  extractTitle,
  htmlToText,
  normaliseHttpUrl,
  discoverSiteUrls,
} = require('../htmlFetch');

const MIN_PAGES = 1;
const MAX_PAGES = 40;
const DEFAULT_PAGES = 15;
const PAGE_TIMEOUT_MS = 10000;
const SKIP_PATH = /\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|mjs|map|zip|mp4|mp3|woff2?|ttf|eot)(\?|$)/i;
const SKIP_PREFIX = /^(mailto:|tel|javascript:|data:)/i;

function clampPageLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PAGES;
  return Math.max(MIN_PAGES, Math.min(MAX_PAGES, Math.round(n)));
}

function hostKey(hostname) {
  return String(hostname || '').replace(/^www\./i, '').toLowerCase();
}

function sameSite(urlA, urlB) {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.protocol === b.protocol && hostKey(a.hostname) === hostKey(b.hostname);
  } catch {
    return false;
  }
}

function canonicalUrl(raw, base) {
  let u;
  try { u = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach((k) => {
    u.searchParams.delete(k);
  });
  return u.toString();
}

function parseRobots(text) {
  const disallows = [];
  let apply = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    const ua = trimmed.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      apply = ua[1].trim() === '*';
      continue;
    }
    const d = trimmed.match(/^disallow:\s*(.*)$/i);
    if (d && apply) disallows.push(d[1].trim());
  }
  return disallows;
}

function robotsAllows(url, disallows) {
  let path;
  try { path = new URL(url).pathname || '/'; } catch { return false; }
  for (const rule of disallows) {
    if (!rule) continue;
    if (path.startsWith(rule)) return false;
  }
  return true;
}

function sameOriginLinks(html, pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return []; }
  const found = [];
  const seen = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const raw = String(m[1] || '').trim();
    if (!raw || SKIP_PREFIX.test(raw) || SKIP_PATH.test(raw)) continue;
    const abs = canonicalUrl(raw, pageUrl);
    if (!abs) continue;
    let parsed;
    try { parsed = new URL(abs); } catch { continue; }
    if (hostKey(parsed.hostname) !== hostKey(new URL(origin).hostname)) continue;
    if (SKIP_PATH.test(parsed.pathname)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    found.push(abs);
  }
  return found;
}

function pathScore(url) {
  try {
    const p = new URL(url).pathname;
    const useful = /about|service|product|pricing|blog|contact|location|work|shop|store|faq|team|case/i.test(p);
    return (useful ? 0 : 1) * 1000 + p.split('/').length * 10 + p.length;
  } catch {
    return 9999;
  }
}

async function fetchRobots(startUrl) {
  try {
    const origin = new URL(normaliseHttpUrl(startUrl)).origin;
    const result = await fetchHtml(`${origin}/robots.txt`, 3, 8000);
    const text = String(result.body || '');
    const statusCode = result.statusCode;
    const ok = statusCode < 400 && /user-agent/i.test(text);
    return {
      ok,
      statusCode,
      body: text.slice(0, 8000),
      disallows: ok ? parseRobots(text) : [],
    };
  } catch (err) {
    return { ok: false, statusCode: 0, body: '', disallows: [], error: err.message };
  }
}

async function fetchPage(url) {
  try {
    const result = await fetchHtml(url, 4, PAGE_TIMEOUT_MS);
    const html = String(result.body || '');
    const statusCode = result.statusCode;
    const finalUrl = result.finalUrl || url;
    return {
      url: canonicalUrl(finalUrl) || url,
      requestedUrl: url,
      statusCode,
      html,
      title: extractTitle(html),
      text: htmlToText(html, 8000),
      via: result.via || 'direct',
      error: null,
    };
  } catch (err) {
    return {
      url,
      requestedUrl: url,
      statusCode: 0,
      html: '',
      title: '',
      text: '',
      via: null,
      error: err.message,
    };
  }
}

async function crawlSite(rawUrl, { pageLimit } = {}) {
  const limit = clampPageLimit(pageLimit);
  const start = canonicalUrl(normaliseHttpUrl(rawUrl));
  if (!start) throw new Error('Invalid URL');

  const robots = await fetchRobots(start);
  const origin = new URL(start).origin;
  const queue = [start];
  const queued = new Set([start]);
  const visited = new Set();
  const pages = [];

  const extras = await discoverSiteUrls(start);
  for (const href of extras) {
    if (queued.has(href)) continue;
    if (!sameSite(href, start)) continue;
    if (SKIP_PATH.test(href) || /\.xml(\?|$)/i.test(href)) continue;
    if (!robotsAllows(href, robots.disallows)) continue;
    queued.add(href);
    queue.push(href);
  }

  while (queue.length && pages.length < limit) {
    queue.sort((a, b) => pathScore(a) - pathScore(b));
    const next = queue.shift();
    if (visited.has(next)) continue;
    visited.add(next);
    if (!robotsAllows(next, robots.disallows)) continue;

    const page = await fetchPage(next);
    pages.push(page);

    if (page.statusCode >= 400 || page.error || !page.html) continue;
    for (const href of sameOriginLinks(page.html, page.url || next)) {
      if (queued.has(href)) continue;
      if (!sameSite(href, start)) continue;
      if (!robotsAllows(href, robots.disallows)) continue;
      queued.add(href);
      queue.push(href);
    }
  }

  return {
    startUrl: start,
    origin,
    pageLimit: limit,
    discovered: queued.size,
    crawled: pages.length,
    robots,
    pages,
  };
}

module.exports = {
  crawlSite,
  clampPageLimit,
  MIN_PAGES,
  MAX_PAGES,
  DEFAULT_PAGES,
};
