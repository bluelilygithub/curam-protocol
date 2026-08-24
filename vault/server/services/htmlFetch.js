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

async function fetchHtml(url, redirectsLeft = 5, timeoutMs = 12000) {
  let cookies = {};
  let result = await fetchOnce(url, redirectsLeft, timeoutMs, {}, cookies);
  cookies = result.cookies || cookies;
  if (!isThinResponse(result)) return result;

  await new Promise((r) => setTimeout(r, 1200));
  const identity = await fetchOnce(url, redirectsLeft, timeoutMs, {
    'Accept-Encoding': 'identity',
    Referer: result.finalUrl || url,
    'Sec-Fetch-Site': 'same-origin',
  }, cookies);
  cookies = identity.cookies || cookies;
  result = pickRicher(result, identity);
  if (!isThinResponse(result)) return result;

  const alt = altHostUrl(result.finalUrl || url);
  if (alt && alt !== url) {
    const swapped = await fetchOnce(alt, redirectsLeft, timeoutMs, {
      Referer: url,
      'Sec-Fetch-Site': 'same-site',
    }, cookies);
    result = pickRicher(result, swapped);
  }
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
};
