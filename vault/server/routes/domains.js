const express = require('express');
const router = express.Router();

const DOMSCAN_BASE = 'https://domscan.net/v1';

function key() {
  const k = process.env.DOMSCAN_API_KEY;
  if (!k) throw new Error('DOMSCAN_API_KEY is not configured.');
  return k;
}

async function domscan(path, params = {}) {
  const url = new URL(`${DOMSCAN_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': key(), Accept: 'application/json' },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || body.error || `DomScan error ${res.status}`);
  return body;
}

async function domscanPost(path, payload = {}) {
  const res = await fetch(`${DOMSCAN_BASE}${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': key(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || body.error || `DomScan error ${res.status}`);
  return body;
}

function handle(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      console.error('domains route error:', err);
      res.status(500).json({ error: err.message || 'DomScan request failed.' });
    }
  };
}

// ── Discover ────────────────────────────────────────────────────────────────

// AI-powered name suggestions based on keywords/description
router.get('/suggest', handle(async (req) => {
  const { q, tlds, limit } = req.query;
  if (!q) throw new Error('q (keywords) is required.');
  return domscan('/suggest', { q, tlds: tlds || 'com,io,ai,co,app', limit: limit || 10 });
}));

// Domain quality / brand score
router.get('/score', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/score', { domain });
}));

// Compare and rank multiple brand names
router.post('/score/compare', handle(async (req) => {
  const { domains } = req.body;
  if (!domains || !Array.isArray(domains) || domains.length < 2) {
    throw new Error('Provide at least 2 domain names to compare.');
  }
  return domscanPost('/score/compare', { domains });
}));

// Typosquatting variants for a domain
router.get('/typos', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/typos', { domain });
}));

// Domain availability across TLDs
router.get('/availability', handle(async (req) => {
  const { name, tlds } = req.query;
  if (!name) throw new Error('name is required.');
  return domscan('/status', { name, tlds: tlds || 'com,io,ai,co,app,net,org,dev' });
}));

// ── Research ────────────────────────────────────────────────────────────────

// Full domain overview: WHOIS + lifecycle + reputation + DNS in one call
router.get('/overview', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/overview', { domain });
}));

// Competitor infrastructure analysis
router.get('/competitor', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/recipes/competitor-intel', { domain });
}));

// Domain market valuation
router.get('/value', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/value', { domain });
}));

// ── Launch Readiness ─────────────────────────────────────────────────────────

// Social handle availability (Instagram, X, TikTok, LinkedIn, YouTube, GitHub…)
router.get('/social', handle(async (req) => {
  const { username } = req.query;
  if (!username) throw new Error('username is required.');
  return domscan('/social', { username });
}));

// Brand launch readiness bundle (domain + social + health + typos combined)
router.get('/brand-launch', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/recipes/brand-launch', { domain });
}));

// Compare registrar prices for a domain
router.get('/pricing', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  const [name, ...tldParts] = domain.replace(/^www\./, '').split('.');
  const tld = tldParts.join('.');
  return domscan('/prices/compare', { tld: tld || 'com' });
}));

// ── Monitor ──────────────────────────────────────────────────────────────────

// Get current watchlist
router.get('/watchlist', handle(async () => domscan('/watchlist')));

// Add a domain to the watchlist
router.post('/watchlist', handle(async (req) => {
  const { domain } = req.body;
  if (!domain) throw new Error('domain is required.');
  return domscanPost('/watchlist', { domain });
}));

// Remove from watchlist
router.delete('/watchlist', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  const res = await fetch(`${DOMSCAN_BASE}/watchlist?domain=${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': key() },
  });
  const body = await res.json().catch(() => ({}));
  return body;
}));

// Get expiring watched domains
router.get('/watchlist/expiring', handle(async () => domscan('/watchlist/expiring')));

// Trigger a brand monitor scan (copycat / typosquatting threats)
router.get('/brand-monitor/scan', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/brand-monitor/scan', { domain });
}));

// Create a brand monitor
router.post('/brand-monitor', handle(async (req) => {
  const { domain } = req.body;
  if (!domain) throw new Error('domain is required.');
  return domscanPost('/brand-monitor', { domain });
}));

// List active brand monitors
router.get('/brand-monitor', handle(async () => domscan('/brand-monitor')));

module.exports = router;
