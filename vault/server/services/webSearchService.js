'use strict';

const https = require('https');
const { pool } = require('../db');
const { runtimeConfig } = require('../config/runtime');

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'VaultSearch/1.0', Accept: 'application/json', ...extraHeaders },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('Invalid JSON from search API')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Search request timed out')); });
  });
}

async function loadSetting(key) {
  try {
    const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function resolveShoppingSearchProvider() {
  const raw = (await loadSetting('shopping_search_provider') || '').toLowerCase();
  if (raw === 'serpapi' || raw === 'serper') return raw;

  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE u."isAdmin" = TRUE AND s.key = 'vault_models'
       ORDER BY s."userId" ASC LIMIT 1`
    );
    const catalog = rows[0]?.value;
    if (catalog) {
      const parsed = JSON.parse(catalog);
      if (Array.isArray(parsed)) {
        const entry = parsed.find((m) => m?.provider === 'serper' || m?.provider === 'serpapi');
        if (entry?.provider === 'serpapi') return 'serpapi';
        if (entry?.provider === 'serper') return 'serper';
      }
    }
  } catch { /* ignore */ }

  return 'serper';
}

/**
 * Grocery/shopping lookups — separate from chat @search (Brave etc.).
 * Provider selected in Settings → AI & Chat; keys are Railway env vars only.
 */
async function getShoppingSearchConfig() {
  const provider = await resolveShoppingSearchProvider();
  if (provider === 'serpapi') {
    let apiKey = process.env.SEARCH_API_KEY;
    const settingsKey = await loadSetting('SEARCH_API_KEY');
    if (settingsKey) apiKey = settingsKey;
    if (!apiKey?.trim()) {
      throw new Error('SEARCH_API_KEY not configured — add on Railway for SerpAPI grocery prices.');
    }
    return { apiKey: apiKey.trim(), provider: 'serpapi' };
  }
  const serperKey = process.env.SERPER_SEARCH_API_KEY?.trim()
    || await loadSetting('SERPER_SEARCH_API_KEY');
  if (serperKey) {
    return { apiKey: serperKey, provider: 'serper' };
  }
  throw new Error('SERPER_SEARCH_API_KEY not configured — add on Railway for grocery prices.');
}

/**
 * @param {{ preferSerper?: boolean }} [opts]
 * preferSerper — grocery/shopping path (see getShoppingSearchConfig).
 */
async function getSearchConfig({ preferSerper = false } = {}) {
  if (runtimeConfig.disableWebSearch) {
    throw new Error('Web search is disabled (DISABLE_WEB_SEARCH).');
  }

  if (preferSerper) {
    return getShoppingSearchConfig();
  }

  let apiKey = process.env.SEARCH_API_KEY;
  let provider = (process.env.SEARCH_PROVIDER || '').toLowerCase();
  const settingsKey = await loadSetting('SEARCH_API_KEY');
  if (settingsKey) apiKey = settingsKey;
  const settingsProvider = await loadSetting('SEARCH_PROVIDER');
  if (settingsProvider) provider = settingsProvider.toLowerCase();

  if (!apiKey?.trim()) {
    throw new Error('SEARCH_API_KEY not configured — add on Railway.');
  }
  if (!provider) {
    if (apiKey.startsWith('BSA')) provider = 'brave';
    else if (/^[a-f0-9]{40}$/i.test(apiKey)) provider = 'serper';
    else provider = 'serpapi';
  }
  return { apiKey: apiKey.trim(), provider };
}

async function isSearchConfigured({ preferSerper = false } = {}) {
  try {
    await getSearchConfig({ preferSerper });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} query
 * @param {{ num?: number }} [opts]
 * @returns {Promise<Array<{title:string,url:string,snippet:string}>>}
 */
async function webSearch(query, { num = 8, preferSerper = false } = {}) {
  const { apiKey, provider } = await getSearchConfig({ preferSerper });
  const encoded = encodeURIComponent(query.trim());

  if (provider === 'brave') {
    const data = await fetchJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${num}`,
      { 'X-Subscription-Token': apiKey }
    );
    if (data.message) throw new Error(`Brave: ${data.message}`);
    return (data.web?.results || []).slice(0, num).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.description || '',
    })).filter((r) => r.url);
  }

  if (provider === 'serper') {
    const data = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ q: query.trim(), num });
      const req2 = https.request({
        hostname: 'google.serper.dev',
        path: '/search',
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('Invalid JSON from Serper')); }
        });
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });
    return (data.organic || []).slice(0, num).map((r) => ({
      title: r.title || r.link,
      url: r.link,
      snippet: r.snippet || '',
    })).filter((r) => r.url);
  }

  // serpapi
  const data = await fetchJson(
    `https://serpapi.com/search.json?q=${encoded}&api_key=${encodeURIComponent(apiKey)}&num=${num}&engine=google`
  );
  return (data.organic_results || []).slice(0, num).map((r) => ({
    title: r.title || r.link,
    url: r.link,
    snippet: r.snippet || '',
  })).filter((r) => r.url);
}

/**
 * Parses a dollar price from search text. Requires "$" (or "A$") before the amount,
 * or an "X.XX each" pattern — never bare numbers like pack weights ("250g").
 */
function parsePriceString(str) {
  const text = String(str || '');
  const dollar = text.match(/(?:A?\$)\s?(\d{1,3}(?:[.,]\d{2})?)/);
  if (dollar) {
    const n = Number(dollar[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const each = text.match(/\b(\d{1,2}\.\d{2})\s*(?:each|ea)\b/i);
  if (each) {
    const n = Number(each[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Dedicated price field from shopping APIs — must look like currency (≤2 digits before decimal). */
function parseShoppingPrice(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val) && val > 0 && val < 1000) return val;
  return parsePriceString(String(val));
}

/**
 * Real shopping-engine results (price + retailer name) — Serper and SerpApi only.
 * Brave has no shopping index; returns null so callers can fall back to organic search.
 * @param {string} query
 * @returns {Promise<Array<{title:string,source:string,price:number|null,url:string,image?:string}>|null>}
 */
async function shoppingSearch(query, { num = 15, country = 'au' } = {}) {
  const { apiKey, provider } = await getShoppingSearchConfig();
  const encoded = encodeURIComponent(query.trim());

  if (provider === 'serper') {
    const data = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ q: query.trim(), gl: country, num });
      const req2 = https.request({
        hostname: 'google.serper.dev',
        path: '/shopping',
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error('Invalid JSON from Serper shopping')); }
        });
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });
    return (data.shopping || []).slice(0, num).map((r) => ({
      title: r.title || '',
      source: r.source || '',
      price: parseShoppingPrice(r.price),
      url: r.link || r.productLink || null,
      image: r.imageUrl || null,
    })).filter((r) => r.title);
  }

  if (provider === 'serpapi') {
    const data = await fetchJson(
      `https://serpapi.com/search.json?q=${encoded}&api_key=${encodeURIComponent(apiKey)}&num=${num}&engine=google_shopping&gl=${country}`
    );
    return (data.shopping_results || []).slice(0, num).map((r) => ({
      title: r.title || '',
      source: r.source || '',
      price: Number.isFinite(Number(r.extracted_price)) ? Number(r.extracted_price) : parseShoppingPrice(r.price),
      url: r.product_link || r.link || null,
      image: r.thumbnail || null,
    })).filter((r) => r.title);
  }

  return null;
}

module.exports = { webSearch, shoppingSearch, parsePriceString, parseShoppingPrice, getSearchConfig, isSearchConfigured };
