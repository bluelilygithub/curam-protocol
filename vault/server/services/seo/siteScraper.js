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
    title: extractTitle(body),
    description: metaContent(body, 'description') || metaContent(body, 'og:description'),
    headings: extractHeadings(body),
    text: htmlToText(body, 8000),
    html: body,
  };
}

function combinedText(snapshot) {
  const parts = [];
  if (snapshot.title) parts.push(`Title: ${snapshot.title}`);
  if (snapshot.description) parts.push(`Description: ${snapshot.description}`);
  const headings = (snapshot.headings || []).map((h) => h.text).filter(Boolean);
  if (headings.length) parts.push(`Headings:\n${headings.join('\n')}`);
  for (const page of snapshot.pages || []) {
    parts.push(`--- ${page.url} ---\n${page.title || ''}\n${page.text || ''}`);
  }
  return parts.join('\n\n').slice(0, 18000);
}

async function scrapeSite(rawUrl) {
  const homeUrl = normaliseHttpUrl(rawUrl);
  const home = await fetchPage(homeUrl);
  const extraUrls = rankExtraUrls(sameOriginLinks(home.html, home.url), home.url);

  const extraPages = await Promise.all(extraUrls.map(async (url) => {
    try {
      const page = await fetchPage(url);
      return { url: page.url, title: page.title, text: page.text };
    } catch (err) {
      console.warn('[seo] extra page failed', url, err.message);
      return null;
    }
  }));

  const pages = [
    { url: home.url, title: home.title, text: home.text },
    ...extraPages.filter(Boolean),
  ];

  const snapshot = {
    url: homeUrl,
    finalUrl: home.url,
    title: home.title,
    description: home.description,
    headings: home.headings,
    pages,
    scrapedAt: new Date().toISOString(),
  };
  snapshot.text = combinedText(snapshot);
  snapshot.charCount = snapshot.text.length;
  return snapshot;
}

module.exports = { scrapeSite, combinedText };
