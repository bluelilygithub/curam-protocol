'use strict';

const http = require('http');
const https = require('https');
const dns = require('dns');
const zlib = require('zlib');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const CHROME_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Accept-Language': 'en-AU,en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

function isPrivateIp(ip) {
  if (ip === '::1') return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function checkSsrf(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) return reject(new Error('DNS lookup failed'));
      if (isPrivateIp(address)) return reject(new Error('URL resolves to a private or internal address'));
      resolve();
    });
  });
}

function decodeBody(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
    if (enc.includes('deflate')) {
      try { return zlib.inflateSync(buffer); } catch {
        return zlib.inflateRawSync(buffer);
      }
    }
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return zlib.gunzipSync(buffer);
    }
  } catch (err) {
    console.warn('[htmlFetch] decompress failed:', err.message);
    return buffer;
  }
  return buffer;
}

function looksLikeHtml(text) {
  const t = String(text || '').slice(0, 2000).toLowerCase();
  return t.includes('<html') || t.includes('<!doctype') || t.includes('<title') || t.includes('<body');
}

function mergeCookies(jar, headers) {
  const next = { ...jar };
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of list) {
    const nv = String(line).split(';')[0];
    const i = nv.indexOf('=');
    if (i > 0) next[nv.slice(0, i).trim()] = nv.slice(i + 1).trim();
  }
  return next;
}

function cookieHeader(jar) {
  const entries = Object.entries(jar || {});
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

function altHostUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname) return null;
    if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4);
    else u.hostname = `www.${u.hostname}`;
    return u.toString();
  } catch {
    return null;
  }
}

function fetchOnce(url, redirectsLeft, timeoutMs, extraHeaders, cookies) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('Only http/https URLs are allowed'));
    }

    checkSsrf(parsed.hostname).then(() => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const cookie = cookieHeader(cookies);
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          ...CHROME_HEADERS,
          ...extraHeaders,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: timeoutMs,
      };

      const req = mod.request(opts, (res) => {
        const jar = mergeCookies(cookies, res.headers || {});
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchOnce(next, redirectsLeft - 1, timeoutMs, extraHeaders, jar));
        }
        if (res.statusCode === 202 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchOnce(next, redirectsLeft - 1, timeoutMs, extraHeaders, jar));
        }
        const chunks = [];
        let bytesReceived = 0;
        res.on('data', (chunk) => {
          bytesReceived += chunk.length;
          if (bytesReceived > MAX_RESPONSE_BYTES) {
            req.destroy();
            return reject(new Error('Response too large'));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const decoded = decodeBody(raw, res.headers['content-encoding']);
          resolve({
            body: decoded.toString('utf8'),
            statusCode: res.statusCode,
            finalUrl: url,
            htmlBytes: raw.length,
            cookies: jar,
          });
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.end();
    }).catch(reject);
  });
}

function isThinResponse(result) {
  const text = String(result?.body || '');
  const status = result?.statusCode || 0;
  if (status === 202 || status === 204 || status === 403 || status === 429) return true;
  if (status >= 200 && status < 300 && !looksLikeHtml(text) && text.replace(/\s+/g, '').length < 80) return true;
  return false;
}

function pickRicher(a, b) {
  if (!b) return a;
  if (!a) return b;
  const aHtml = looksLikeHtml(a.body);
  const bHtml = looksLikeHtml(b.body);
  if (bHtml && !aHtml) return b;
  if (aHtml && !bHtml) return a;
  if (String(b.body || '').length > String(a.body || '').length) return b;
  return a;
}

function hostKey(hostname) {
  return String(hostname || '').replace(/^www\./i, '').toLowerCase();
}

function pathsMatch(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const pa = ua.pathname.replace(/\/+$/, '') || '/';
    const pb = ub.pathname.replace(/\/+$/, '') || '/';
    return hostKey(ua.hostname) === hostKey(ub.hostname) && pa === pb;
  } catch {
    return false;
  }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function htmlFromWpItem(item) {
  const title = stripTags(item?.title?.rendered || item?.title || '');
  const content = String(item?.content?.rendered || '').slice(0, 500000);
  const excerpt = String(item?.excerpt?.rendered || '');
  const yoast = String(item?.yoast_head || '');
  const desc = stripTags(excerpt).slice(0, 170);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${yoast}<title>${title}</title>${desc ? `<meta name="description" content="${desc.replace(/"/g, '&quot;')}">` : ''}</head><body><h1>${title}</h1>${excerpt}${content}</body></html>`;
}

async function fetchJsonList(url) {
  try {
    const result = await fetchOnce(url, 3, 10000, { Accept: 'application/json,text/plain,*/*;q=0.8' }, {});
    const text = String(result.body || '').trim();
    if (!text.startsWith('[') && !text.startsWith('{')) return [];
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadSerperKey() {
  const fromEnv = String(process.env.SERPER_SEARCH_API_KEY || '').trim()
    || (/^[a-f0-9]{40}$/i.test(String(process.env.SEARCH_API_KEY || '').trim())
      ? String(process.env.SEARCH_API_KEY).trim()
      : '');
  if (fromEnv) return fromEnv;
  try {
    const { pool } = require('../db');
    const { rows } = await pool.query(
      `SELECT s.key, s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE u."isAdmin" = TRUE AND s.key IN ('SERPER_SEARCH_API_KEY', 'SEARCH_API_KEY')
       ORDER BY s."userId" ASC`
    );
    const serper = rows.find((r) => r.key === 'SERPER_SEARCH_API_KEY' && String(r.value || '').trim());
    if (serper) return String(serper.value).trim();
    const search = rows.find((r) => r.key === 'SEARCH_API_KEY' && /^[a-f0-9]{40}$/i.test(String(r.value || '').trim()));
    if (search) return String(search.value).trim();
  } catch {
    /* no db yet */
  }
  return '';
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectSerperLinks(data) {
  const hrefs = [];
  const push = (href) => {
    if (!href || typeof href !== 'string') return;
    if (!/^https?:\/\//i.test(href)) return;
    hrefs.push(href);
  };
  const walk = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'object') {
      push(value.link || value.url || value.href);
      walk(value.links);
    }
  };
  walk(data.links);
  walk(data.link);
  const md = String(data.markdown || '');
  const re = /\[[^\]]*\]\((https?:[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md))) push(m[1]);
  return [...new Set(hrefs)];
}

function htmlFromSerper(data, pageUrl) {
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const title = meta.title || meta['og:title'] || meta['twitter:title'] || '';
  const desc = meta.description || meta['og:description'] || '';
  const canonical = meta.canonical || meta['og:url'] || pageUrl;
  const lang = meta.language || meta['og:locale'] || 'en';
  const links = collectSerperLinks(data)
    .map((href) => `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`)
    .join('\n');
  const rawText = String(data.text || data.markdown || '').slice(0, 400000);
  const body = escapeHtml(rawText).replace(/\n/g, '<br>\n');
  return `<!DOCTYPE html><html lang="${escapeHtml(String(lang).slice(0, 12))}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${desc ? `<meta name="description" content="${escapeHtml(desc).slice(0, 300)}">` : ''}<link rel="canonical" href="${escapeHtml(canonical)}"></head><body>${title ? `<h1>${escapeHtml(title)}</h1>` : ''}<nav>${links}</nav><main>${body}</main></body></html>`;
}

function postJson(hostname, pathname, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        resolve({ statusCode: res.statusCode, data, text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

async function fetchViaSerper(pageUrl) {
  try {
    await checkSsrf(new URL(pageUrl).hostname);
  } catch {
    return null;
  }
  const apiKey = await loadSerperKey();
  if (!apiKey) {
    console.warn('[htmlFetch] Serper scrape skipped — set SERPER_SEARCH_API_KEY');
    return null;
  }
  try {
    const res = await postJson('scrape.serper.dev', '/', {
      'X-API-KEY': apiKey,
    }, {
      url: pageUrl,
      includeMarkdown: true,
      includeLinks: true,
    }, 25000);
    if (res.statusCode >= 400 || !res.data) {
      console.warn('[htmlFetch] Serper scrape HTTP', res.statusCode, String(res.text || '').slice(0, 180));
      return null;
    }
    const text = String(res.data.text || res.data.markdown || '');
    const links = collectSerperLinks(res.data);
    if (text.replace(/\s+/g, '').length < 40 && !links.length && !res.data.metadata) return null;
    return {
      body: htmlFromSerper(res.data, pageUrl),
      statusCode: 200,
      finalUrl: pageUrl,
      htmlBytes: text.length,
      cookies: {},
      via: 'serper',
    };
  } catch (err) {
    console.warn('[htmlFetch] Serper scrape failed:', err.message);
    return null;
  }
}

async function fetchViaWordpress(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  const endpoints = [
    `${origin}/wp-json/wp/v2/pages?per_page=40&_fields=link,slug,title,content,excerpt,yoast_head`,
    `${origin}/wp-json/wp/v2/posts?per_page=20&_fields=link,slug,title,content,excerpt,yoast_head`,
  ];
  const wantedHome = (() => {
    try { return (new URL(pageUrl).pathname.replace(/\/+$/, '') || '/') === '/'; } catch { return false; }
  })();
  for (const endpoint of endpoints) {
    const items = await fetchJsonList(endpoint);
    const match = items.find((item) => item?.link && pathsMatch(item.link, pageUrl))
      || (wantedHome ? items.find((item) => {
        try {
          const p = new URL(item.link).pathname.replace(/\/+$/, '') || '/';
          return p === '/' || item.slug === 'home' || item.slug === 'homepage' || item.slug === 'front-page';
        } catch { return false; }
      }) : null);
    if (match) {
      return {
        body: htmlFromWpItem(match),
        statusCode: 200,
        finalUrl: match.link || pageUrl,
        htmlBytes: 0,
        cookies: {},
        via: 'wordpress',
      };
    }
  }
  return null;
}

async function fetchViaJina(pageUrl) {
  try {
    const result = await fetchOnce(`https://r.jina.ai/${pageUrl}`, 3, 20000, {
      Accept: 'text/html, text/plain',
      'X-Return-Format': 'html',
      'X-Timeout': '15',
    }, {});
    const body = String(result.body || '');
    if (result.statusCode >= 400 || body.length < 80) return null;
    if (!looksLikeHtml(body) && body.length < 200) return null;
    const html = looksLikeHtml(body)
      ? body
      : `<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body><pre>${body.replace(/</g, '&lt;').slice(0, 400000)}</pre></body></html>`;
    return {
      body: html,
      statusCode: 200,
      finalUrl: pageUrl,
      htmlBytes: body.length,
      cookies: {},
      via: 'jina',
    };
  } catch {
    return null;
  }
}

async function discoverSiteUrls(startUrl) {
  let origin;
  try { origin = new URL(startUrl).origin; } catch { return []; }
  const found = [];
  const seen = new Set();
  const add = (raw) => {
    try {
      const u = new URL(raw);
      if (hostKey(u.hostname) !== hostKey(new URL(origin).hostname)) return;
      u.hash = '';
      const href = u.toString();
      if (seen.has(href)) return;
      if (/\.(xml|xsl|jpg|jpeg|png|gif|webp|pdf|css|js)(\?|$)/i.test(u.pathname)) return;
      seen.add(href);
      found.push(href);
    } catch { /* skip */ }
  };

  for (const path of ['/sitemap.xml', '/wp-sitemap.xml', '/sitemap_index.xml', '/page-sitemap.xml', '/wp-sitemap-pages-1.xml']) {
    try {
      const result = await fetchOnce(`${origin}${path}`, 3, 10000, { Accept: 'application/xml,text/xml,text/plain,*/*;q=0.8' }, {});
      const locs = String(result.body || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi);
      for (const m of locs) add(m[1].trim());
    } catch { /* skip */ }
  }

  for (const path of [
    '/wp-json/wp/v2/pages?per_page=40&_fields=link',
    '/wp-json/wp/v2/posts?per_page=20&_fields=link',
  ]) {
    const items = await fetchJsonList(`${origin}${path}`);
    for (const item of items) if (item?.link) add(item.link);
  }
  return found;
}

async function fetchHtml(url, redirectsLeft = 5, timeoutMs = 12000) {
  let cookies = {};
  let result = await fetchOnce(url, redirectsLeft, timeoutMs, {}, cookies);
  cookies = result.cookies || cookies;
  if (!isThinResponse(result)) return { ...result, via: result.via || 'direct' };

  await new Promise((r) => setTimeout(r, 1200));
  const identity = await fetchOnce(url, redirectsLeft, timeoutMs, {
    'Accept-Encoding': 'identity',
    Referer: result.finalUrl || url,
    'Sec-Fetch-Site': 'same-origin',
  }, cookies);
  cookies = identity.cookies || cookies;
  result = pickRicher(result, identity);
  if (!isThinResponse(result)) return { ...result, via: result.via || 'direct' };

  const alt = altHostUrl(result.finalUrl || url);
  if (alt && alt !== url) {
    const swapped = await fetchOnce(alt, redirectsLeft, timeoutMs, {
      Referer: url,
      'Sec-Fetch-Site': 'same-site',
    }, cookies);
    result = pickRicher(result, swapped);
    if (!isThinResponse(result)) return { ...result, via: result.via || 'direct' };
  }

  const bot = await fetchOnce(url, redirectsLeft, timeoutMs, {
    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }, cookies);
  result = pickRicher(result, bot);
  if (!isThinResponse(result)) return { ...result, via: result.via || 'direct' };

  const serper = await fetchViaSerper(url);
  result = pickRicher(result, serper);
  if (!isThinResponse(result)) return { ...result, via: result.via || 'serper' };

  const wp = await fetchViaWordpress(url);
  result = pickRicher(result, wp);
  if (!isThinResponse(result)) return { ...result, via: result.via || 'wordpress' };

  const jina = await fetchViaJina(url);
  result = pickRicher(result, jina);
  if (!isThinResponse(result)) return { ...result, via: result.via || 'jina' };
  return result;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : '';
}

function htmlToText(html, maxChars = 15000) {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|article|section|main|h[1-6]|li|tr|br|blockquote|header|footer|nav|aside)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, maxChars));
}

function normaliseHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('url is required');
  let normalised = raw.trim();
  if (!normalised.startsWith('http://') && !normalised.startsWith('https://')) {
    normalised = 'https://' + normalised;
  }
  const parsed = new URL(normalised);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid URL');
  }
  return parsed.toString();
}

module.exports = {
  fetchHtml,
  extractTitle,
  htmlToText,
  decodeEntities,
  normaliseHttpUrl,
  discoverSiteUrls,
};
