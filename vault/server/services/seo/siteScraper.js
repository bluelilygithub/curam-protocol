'use strict';

const {
  fetchHtml,
  extractTitle,
  htmlToText,
  decodeEntities,
  normaliseHttpUrl,
} = require('../htmlFetch');

const MAX_EXTRA_PAGES = 4;
const PAGE_TIMEOUT_MS = 10000;
const USEFUL_PATH = /about|service|product|pricing|price|shop|store|work|what-we|solution|offer|package|contact|location|industry|who-we|our-|menu|treat|care/i;
const SKIP_PATH = /\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|zip|mp4|mp3)(\?|$)/i;
const SKIP_PREFIX = /^(mailto:|tel:|javascript:)/i;

function metaContent(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{1,400})["']`,
    'i'
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1].replace(/\s+/g, ' ').trim());
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']{1,400})["'][^>]*(?:name|property)=["']${name}["']`,
    'i'
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1].replace(/\s+/g, ' ').trim()) : '';
}

function extractHeadings(html) {
  const out = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 40) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text) out.push({ level: Number(m[1]), text: text.slice(0, 160) });
  }
  return out;
}

function extractJsonLdText(html) {
  const parts = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      walkJsonLd(data, parts);
    } catch { /* ignore broken JSON-LD */ }
  }
  return parts.join('\n').slice(0, 4000);
}

function walkJsonLd(node, parts, depth = 0) {
  if (!node || depth > 8 || parts.length > 80) return;
  if (typeof node === 'string') {
    const t = node.replace(/\s+/g, ' ').trim();
    if (t.length >= 12 && t.length < 400 && !/^https?:/i.test(t)) parts.push(t);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walkJsonLd(item, parts, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  for (const key of ['name', 'legalName', 'alternateName', 'description', 'slogan', 'jobTitle', 'brand']) {
    if (node[key]) walkJsonLd(node[key], parts, depth + 1);
  }
  if (Array.isArray(node.areaServed)) walkJsonLd(node.areaServed, parts, depth + 1);
  if (node.address) {
    const a = node.address;
    const line = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
    if (line) parts.push(line);
  }
  if (node['@graph']) walkJsonLd(node['@graph'], parts, depth + 1);
}

function sameOriginLinks(html, baseUrl) {
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const found = [];
  const seen = new Set();
  const re = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw || SKIP_PREFIX.test(raw) || SKIP_PATH.test(raw)) continue;
    let abs;
    try { abs = new URL(raw, base).toString(); } catch { continue; }
    let parsed;
    try { parsed = new URL(abs); } catch { continue; }
    if (parsed.origin !== base.origin) continue;
    parsed.hash = '';
    const href = parsed.toString();
    if (href === base.toString() || seen.has(href)) continue;
    seen.add(href);
    found.push(href);
  }
  return found;
}

function rankExtraUrls(urls, homeUrl) {
  const homePath = (() => {
    try { return new URL(homeUrl).pathname.replace(/\/$/, '') || '/'; } catch { return '/'; }
  })();
  return urls
    .filter((u) => {
      try {
        const p = new URL(u).pathname.replace(/\/$/, '') || '/';
        return p !== homePath && p !== '/';
      } catch { return false; }
    })
    .sort((a, b) => {
      const sa = USEFUL_PATH.test(a) ? 0 : 1;
      const sb = USEFUL_PATH.test(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.length - b.length;
    })
    .slice(0, MAX_EXTRA_PAGES);
}

async function fetchPage(url) {
  const { body, statusCode, finalUrl } = await fetchHtml(url, 5, PAGE_TIMEOUT_MS);
  if (statusCode >= 400) {
    throw new Error(`Server returned ${statusCode}`);
  }
  return {
    url: finalUrl || url,
    title: extractTitle(body) || metaContent(body, 'og:title'),
    description: metaContent(body, 'description') || metaContent(body, 'og:description'),
    headings: extractHeadings(body),
    jsonLd: extractJsonLdText(body),
    text: htmlToText(body, 12000),
    html: body,
    htmlBytes: body.length,
    statusCode,
  };
}

function combinedText(snapshot) {
  const parts = [];
  if (snapshot.title) parts.push(`Title: ${snapshot.title}`);
  if (snapshot.description) parts.push(`Description: ${snapshot.description}`);
  const headings = (snapshot.headings || []).map((h) => h.text).filter(Boolean);
  if (headings.length) parts.push(`Headings:\n${headings.join('\n')}`);
  if (snapshot.jsonLd) parts.push(`Structured data:\n${snapshot.jsonLd}`);
  for (const page of snapshot.pages || []) {
    parts.push(`--- ${page.url} ---\n${page.title || ''}\n${page.jsonLd || ''}\n${page.text || ''}`);
  }
  return parts.join('\n\n').slice(0, 18000);
}

async function scrapeSite(rawUrl, { includeHtml = false } = {}) {
  const homeUrl = normaliseHttpUrl(rawUrl);
  const home = await fetchPage(homeUrl);
  const extraUrls = rankExtraUrls(sameOriginLinks(home.html, home.url), home.url);

  const extraPages = await Promise.all(extraUrls.map(async (url) => {
    try {
      const page = await fetchPage(url);
      return { url: page.url, title: page.title, text: page.text, jsonLd: page.jsonLd };
    } catch (err) {
      console.warn('[seo] extra page failed', url, err.message);
      return null;
    }
  }));

  const pages = [
    { url: home.url, title: home.title, text: home.text, jsonLd: home.jsonLd },
    ...extraPages.filter(Boolean),
  ];

  const snapshot = {
    url: homeUrl,
    finalUrl: home.url,
    title: home.title,
    description: home.description,
    headings: home.headings,
    jsonLd: home.jsonLd,
    pages,
    scrapedAt: new Date().toISOString(),
    htmlBytes: home.htmlBytes || 0,
    statusCode: home.statusCode,
  };
  if (includeHtml) snapshot.html = home.html;
  snapshot.text = combinedText(snapshot);
  snapshot.charCount = snapshot.text.length;
  console.log('[seo] scrape', {
    url: snapshot.finalUrl,
    status: snapshot.statusCode,
    htmlBytes: snapshot.htmlBytes,
    charCount: snapshot.charCount,
    pages: pages.length,
    title: (snapshot.title || '').slice(0, 80),
  });
  return snapshot;
}

function siteSignal(snapshot) {
  return [snapshot?.title, snapshot?.description, snapshot?.jsonLd, snapshot?.text]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertUsableScrape(snapshot) {
  const signal = siteSignal(snapshot);
  if (signal.length >= 40) return;
  const status = snapshot?.statusCode || 0;
  const bytes = snapshot?.htmlBytes || 0;
  if (status >= 400 || bytes < 80) {
    throw new Error(
      `Could not read that page (HTTP ${status || 'unknown'}, ${bytes} bytes). The site may be blocking scrapes or the URL may be wrong.`
    );
  }
}

const OFFER_STOP = new Set([
  'that', 'this', 'with', 'from', 'your', 'their', 'about', 'have', 'been',
  'were', 'will', 'would', 'could', 'should', 'into', 'over', 'under',
  'services', 'service', 'and', 'for', 'the',
]);

function scrapeConflictsWithOffer(snapshot, offer) {
  const raw = String(offer || '').trim();
  if (!raw) return false;
  const terms = (raw.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !OFFER_STOP.has(w));
  if (!terms.length) return false;
  const title = String(snapshot?.title || '').trim();
  const description = String(snapshot?.description || '').trim();
  if (!title && !description) return false;
  const hay = `${title} ${description} ${String(snapshot?.text || '').slice(0, 2500)}`.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t));
  return hits.length === 0;
}

module.exports = { scrapeSite, combinedText, siteSignal, assertUsableScrape, scrapeConflictsWithOffer };
