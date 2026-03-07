const express = require('express');
const router = express.Router();
const https = require('https');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const searchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'Too many search requests, please try again later.' },
});

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'VaultSearch/1.0', 'Accept': 'application/json', ...extraHeaders },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
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

// GET /api/web-search?q=query
// Supports Brave Search, Serper.dev, and SerpAPI.
// Set SEARCH_API_KEY in .env or Railway variables.
// Optionally set SEARCH_PROVIDER to 'brave' | 'serper' | 'serpapi' to force a provider.
// Auto-detection: Brave keys start with "BSA", Serper keys are 40-char hex.
router.get('/', searchLimiter, async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'Query required' });

  let apiKey = process.env.SEARCH_API_KEY;
  let provider = (process.env.SEARCH_PROVIDER || '').toLowerCase();
  try {
    const keyRow = db.prepare("SELECT value FROM settings WHERE key='SEARCH_API_KEY'").get();
    if (keyRow?.value) apiKey = keyRow.value;
    const provRow = db.prepare("SELECT value FROM settings WHERE key='SEARCH_PROVIDER'").get();
    if (provRow?.value) provider = provRow.value.toLowerCase();
  } catch (_) {}
  if (!apiKey) {
    return res.status(501).json({
      error: 'Search API key not configured — add SEARCH_API_KEY in your .env or Railway variables.',
    });
  }

  try {
    db.prepare('INSERT INTO search_logs (query) VALUES (?)').run(q.trim());
  } catch (_) {}

  // Auto-detect provider from key shape
  if (!provider) {
    if (apiKey.startsWith('BSA')) provider = 'brave';
    else if (/^[a-f0-9]{40}$/i.test(apiKey)) provider = 'serper';
    else provider = 'serpapi';
  }

  const query = encodeURIComponent(q.trim());

  try {
    let results;

    if (provider === 'brave') {
      // Brave Search API
      const data = await fetchJson(
        `https://api.search.brave.com/res/v1/web/search?q=${query}&count=5`,
        { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
      );
      if (data.message) return res.status(500).json({ error: `Brave: ${data.message}` });
      results = (data.web?.results || []).slice(0, 3).map(r => ({
        url: r.url,
        title: r.title || r.url,
        snippet: r.description || '',
      }));

    } else if (provider === 'serper') {
      // Serper.dev — POST with JSON body
      const data = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ q: q.trim(), num: 5 });
        const req2 = https.request({
          hostname: 'google.serper.dev',
          path: '/search',
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 10000,
        }, (r) => {
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch { reject(new Error('Invalid JSON from Serper')); }
          });
          r.on('error', reject);
        });
        req2.on('error', reject);
        req2.on('timeout', () => { req2.destroy(); reject(new Error('Serper request timed out')); });
        req2.write(body);
        req2.end();
      });
      if (data.message) return res.status(500).json({ error: `Serper: ${data.message}` });
      results = (data.organic || []).slice(0, 3).map(r => ({
        url: r.link,
        title: r.title || r.link,
        snippet: r.snippet || '',
      }));

    } else {
      // SerpAPI (default)
      const data = await fetchJson(
        `https://serpapi.com/search.json?q=${query}&api_key=${apiKey}&num=5&engine=google&gl=us&hl=en`
      );
      if (data.error) return res.status(500).json({ error: `SerpAPI: ${data.error}` });
      results = (data.organic_results || []).slice(0, 3).map(r => ({
        url: r.link,
        title: r.title || r.link,
        snippet: r.snippet || '',
      }));
    }

    res.json({ results });
  } catch (err) {
    console.error('Web search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
