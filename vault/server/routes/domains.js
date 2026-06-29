const express = require('express');
const router = express.Router();
const { getModelsForUser } = require('../services/modelResolver');
const { callModel } = require('../services/callModel');

const DOMSCAN_BASE = 'https://domscan.net/v1';

function key() {
  const k = process.env.DOMSCAN_API_KEY;
  if (!k) throw new Error('DOMSCAN_API_KEY environment variable is not set on this server. Add it in Railway → Variables and redeploy.');
  return k;
}

// Quick config check — confirms the key is visible to the process
router.get('/config-check', async (req, res) => {
  const k = process.env.DOMSCAN_API_KEY;
  if (!k) return res.json({ configured: false, prefix: null });
  // Probe DomScan with a lightweight call to confirm the key is valid
  try {
    const probe = await fetch(`${DOMSCAN_BASE}/tlds?limit=1`, {
      headers: { 'X-API-Key': k, Accept: 'application/json' },
    });
    res.json({
      configured: true,
      prefix: k.slice(0, 6) + '…',
      length: k.length,
      domscanStatus: probe.status,
      keyValid: probe.ok,
    });
  } catch (e) {
    res.json({ configured: true, prefix: k.slice(0, 6) + '…', length: k.length, probeError: e.message });
  }
});

async function domscan(path, params = {}) {
  const url = new URL(`${DOMSCAN_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': key(), Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    throw new Error(`DomScan API key is invalid or unauthorised (HTTP ${res.status}). Check the key value in Railway → Variables.`);
  }
  if (!res.ok) throw new Error(body.message || body.error || `DomScan API error ${res.status}`);
  return body;
}

async function domscanPost(path, payload = {}) {
  const res = await fetch(`${DOMSCAN_BASE}${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': key(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    throw new Error(`DomScan API key is invalid or unauthorised (HTTP ${res.status}). Check the key value in Railway → Variables.`);
  }
  if (!res.ok) throw new Error(body.message || body.error || `DomScan API error ${res.status}`);
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

// Use the light AI model to extract brandable keywords from a description
async function extractKeywords(description, userId) {
  try {
    const { light } = await getModelsForUser(userId);
    const prompt = `Extract 6-8 short, brandable keywords from this business description that would work well as domain name building blocks. Return ONLY a comma-separated list of single words or short compound words (no spaces), no explanation.\n\nDescription: ${description}`;
    const result = await callModel(light, prompt, { maxTokens: 60 });
    // Clean up: lowercase, strip non-alphanumeric except commas, collapse whitespace
    return result.toLowerCase().replace(/[^a-z0-9,]/g, ' ').replace(/\s+/g, '').replace(/,+/g, ',').replace(/^,|,$/g, '');
  } catch {
    // Fallback: naive word extraction
    return description.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3).slice(0, 8).join(',');
  }
}

// AI-powered name suggestions based on a description
router.get('/suggest', handle(async (req) => {
  const { q, tlds, limit, style } = req.query;
  if (!q) throw new Error('q (description) is required.');
  const keywords = await extractKeywords(q, req.user.id);
  return domscan('/suggest', {
    keywords,
    tlds: tlds || 'com,io,ai,co,app',
    limit: limit || 20,
    style: style || 'brandable',
  });
}));

// Domain quality / brand score
router.get('/score', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  // DomScan /v1/score uses 'name' param (no TLD needed)
  const name = domain.replace(/\.[^.]+$/, ''); // strip TLD if provided
  return domscan('/score', { name });
}));

// Compare and rank multiple brand names
router.post('/score/compare', handle(async (req) => {
  const { domains } = req.body;
  if (!domains || !Array.isArray(domains) || domains.length < 2) {
    throw new Error('Provide at least 2 domain names to compare.');
  }
  // DomScan /v1/score/compare uses 'names' (strip TLDs)
  const names = domains.map(d => d.replace(/\.[^.]+$/, ''));
  return domscanPost('/score/compare', { names });
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
