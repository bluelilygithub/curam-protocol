'use strict';

/**
 * Web search for the AI Visibility audit.
 *
 * This is the provider logic from server/routes/webSearch.js moved into a service so
 * an audit can call it without an HTTP round-trip. The key can come from the
 * environment or the caller's/admin's settings, and DISABLE_WEB_SEARCH still wins.
 * The difference from the route: this returns up to `limit` results and the provider
 * name, because the report needs to explain where a citation came from.
 */

const https = require('https');
const { runtimeConfig } = require('../../config/runtime');
const { getSettingForUser } = require('../../utils/settingsLookup');

// The HTTP status rides along on a non-enumerable property so callers can tell an error
// response from an empty result list.
function withStatus(data, statusCode) {
  const out = data && typeof data === 'object' ? data : {};
  Object.defineProperty(out, '__status', { value: statusCode, enumerable: false });
  return out;
}

/**
 * The error a search provider reported, or '' when the response is usable. Providers report
 * errors in different shapes, and an unrecognised error used to read as "no results", which
 * made an audit say the site was not found when the search had actually failed (for example
 * Brave's {type:"ErrorResponse", error:{detail}} for an invalid key or a used-up quota).
 */
function providerError(provider, data, statusCode) {
  const d = data && typeof data === 'object' ? data : {};
  const name = provider === 'brave' ? 'Brave' : provider === 'serper' ? 'Serper' : 'SerpAPI';
  const errObj = d.error && typeof d.error === 'object' ? d.error : null;
  const detail = (errObj && (errObj.detail || errObj.message || errObj.code))
    || (typeof d.error === 'string' ? d.error : '')
    || d.message
    || (d.type === 'ErrorResponse' ? 'error response' : '');
  const status = Number(statusCode) || 0;
  if (detail) return `${name}: ${detail}${status >= 400 ? ` (HTTP ${status})` : ''}`;
  if (status >= 400) return `${name}: HTTP ${status}`;
  return '';
}

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'VaultSearch/1.0', Accept: 'application/json', ...extraHeaders },
      timeout: 12000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch {
          reject(new Error(`Invalid JSON from search API (HTTP ${res.statusCode})`));
          return;
        }
        resolve(withStatus(data, res.statusCode));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Search request timed out')); });
  });
}

function postJson(hostname, path, headers, body, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch {
          reject(new Error(`Invalid JSON from search API (HTTP ${res.statusCode})`));
          return;
        }
        resolve(withStatus(data, res.statusCode));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Search request timed out')); });
    req.write(payload);
    req.end();
  });
}

async function resolveCredentials(userId) {
  let apiKey = process.env.SEARCH_API_KEY;
  let provider = (process.env.SEARCH_PROVIDER || '').toLowerCase();
  try {
    // The caller's own setting, else an administrator's. Never another member's.
    const storedKey = await getSettingForUser(userId, 'SEARCH_API_KEY');
    if (storedKey) apiKey = storedKey;
    const storedProvider = await getSettingForUser(userId, 'SEARCH_PROVIDER');
    if (storedProvider) provider = storedProvider.toLowerCase();
  } catch { /* settings are optional */ }

  if (!provider && apiKey) {
    if (String(apiKey).startsWith('BSA')) provider = 'brave';
    else if (/^[a-f0-9]{40}$/i.test(String(apiKey))) provider = 'serper';
    else provider = 'serpapi';
  }
  return { apiKey: String(apiKey || '').trim(), provider: provider || 'serpapi' };
}

/**
 * Search the web. Throws an Error with `.status` when search is disabled or has no key,
 * so the route can answer with a useful message and the audit can record it per query.
 */
async function searchWeb(query, { userId, limit = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) throw Object.assign(new Error('Query required'), { status: 400 });
  if (runtimeConfig.disableWebSearch) {
    throw Object.assign(new Error('Web search is disabled by DISABLE_WEB_SEARCH.'), { status: 503 });
  }

  const { apiKey, provider } = await resolveCredentials(userId);
  if (!apiKey) {
    throw Object.assign(
      new Error('Search API key not configured — add SEARCH_API_KEY in your .env or Railway variables.'),
      { status: 501 },
    );
  }

  const encoded = encodeURIComponent(q);
  const take = Math.max(1, Math.min(10, Number(limit) || 5));
  let results = [];

  if (provider === 'brave') {
    const data = await fetchJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${take}`,
      { 'X-Subscription-Token': apiKey },
    );
    const err = providerError('brave', data, data.__status);
    if (err) throw new Error(err);
    results = (data.web?.results || []).slice(0, take).map((r) => ({
      url: r.url,
      title: r.title || r.url,
      snippet: r.description || '',
    }));
  } else if (provider === 'serper') {
    const data = await postJson('google.serper.dev', '/search', { 'X-API-KEY': apiKey }, { q, num: take });
    const err = providerError('serper', data, data.__status);
    if (err) throw new Error(err);
    results = (data.organic || []).slice(0, take).map((r) => ({
      url: r.link,
      title: r.title || r.link,
      snippet: r.snippet || '',
    }));
  } else {
    const data = await fetchJson(
      `https://serpapi.com/search.json?q=${encoded}&api_key=${encodeURIComponent(apiKey)}&num=${take}&engine=google&gl=au&hl=en`,
    );
    const err = providerError('serpapi', data, data.__status);
    if (err) throw new Error(err);
    results = (data.organic_results || []).slice(0, take).map((r) => ({
      url: r.link,
      title: r.title || r.link,
      snippet: r.snippet || '',
    }));
  }

  return { provider, query: q, results };
}

module.exports = { searchWeb, resolveCredentials, providerError };
