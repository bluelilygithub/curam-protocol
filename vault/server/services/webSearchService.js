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

async function getSearchConfig() {
  if (runtimeConfig.disableWebSearch) {
    throw new Error('Web search is disabled (DISABLE_WEB_SEARCH).');
  }
  let apiKey = process.env.SEARCH_API_KEY;
  let provider = (process.env.SEARCH_PROVIDER || '').toLowerCase();
  try {
    const { rows: keyRows } = await pool.query("SELECT value FROM settings WHERE key='SEARCH_API_KEY'");
    if (keyRows[0]?.value) apiKey = keyRows[0].value;
    const { rows: provRows } = await pool.query("SELECT value FROM settings WHERE key='SEARCH_PROVIDER'");
    if (provRows[0]?.value) provider = provRows[0].value.toLowerCase();
  } catch { /* env only */ }
  if (!apiKey?.trim()) {
    throw new Error('SEARCH_API_KEY not configured — add in Settings or Railway variables.');
  }
  if (!provider) {
    if (apiKey.startsWith('BSA')) provider = 'brave';
    else if (/^[a-f0-9]{40}$/i.test(apiKey)) provider = 'serper';
    else provider = 'serpapi';
  }
  return { apiKey: apiKey.trim(), provider };
}

/**
 * @param {string} query
 * @param {{ num?: number }} [opts]
 * @returns {Promise<Array<{title:string,url:string,snippet:string}>>}
 */
async function webSearch(query, { num = 8 } = {}) {
  const { apiKey, provider } = await getSearchConfig();
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

module.exports = { webSearch, getSearchConfig };
