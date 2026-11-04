const express = require('express');
const router = express.Router();
const { getVaultModelsConfigForUser } = require('../services/modelResolver');
const { callModel } = require('../services/callModel');
const { pool } = require('../db');
const sets = require('../services/domainSets');
const rateLimit = require('express-rate-limit');

const DOMSCAN_BASE = 'https://domscan.net/v1';

function key() {
  const k = process.env.DOMSCAN_API_KEY;
  if (!k) throw new Error('DOMSCAN_API_KEY environment variable is not set on this server. Add it in Railway → Variables and redeploy.');
  return k;
}

// ── Verify now ──────────────────────────────────────────────
// A live check of the names someone is about to commit to: domain endings straight from the registry (max_age 0, never a saved answer),
// and optionally the social handles. Costs 1 credit per name for domains and 2 more for handles, so it is limited per person.
const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { error: 'You have verified a lot of names this hour. Please wait a while.' },
});

router.post('/verify', verifyLimiter, async (req, res) => {
  try {
    const names = [...new Set((Array.isArray(req.body && req.body.names) ? req.body.names : []).map(sets.labelOf).filter(Boolean))].slice(0, 5);
    if (!names.length) return res.status(400).json({ error: 'Choose at least one name to verify.' });
    const withSocial = !!(req.body && req.body.social);
    const tlds = sets.ENDINGS.join(',');
    const checks = await Promise.all(names.map(async (name) => {
      const out = { name, domains: null, domainsError: null, social: null, socialError: null };
      try { out.domains = sets.shapeStatus(name, await domscan('/status', { name, tlds, max_age: 0 })); } catch (e) { out.domainsError = e.message; }
      if (withSocial) {
        try { out.social = await domscan('/social', { handle: name.replace(/-/g, '') }); } catch (e) { out.socialError = e.message; }
      }
      return out;
    }));
    res.json({ checks, checkedAt: new Date().toISOString() });
  } catch (err) { setFail(res, err); }
});

// ── Saved sets ──────────────────────────────────────────────
// A set is one business idea kept with its names, preferred name and every tool's result, to come back to. Named routes, before any /:id.

const SET_COLS = 'id, name, preferred, data, "createdAt", "updatedAt"';
const setFail = (res, err) => res.status(err && err.status ? err.status : 500).json({ error: err && err.status ? err.message : 'Something went wrong. Please try again.' });
const setId = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };

router.get('/sets', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${SET_COLS} FROM domain_sets WHERE "userId"=$1 ORDER BY "updatedAt" DESC LIMIT 200`, [req.user.id]);
    res.json({ sets: rows.map(sets.summarise) });
  } catch (err) { setFail(res, err); }
});

router.post('/sets', async (req, res) => {
  try {
    const name = sets.cleanSetName(req.body && req.body.name);
    const data = sets.cleanSetData(req.body && req.body.data);
    const { rows: n } = await pool.query('SELECT COUNT(*) AS n FROM domain_sets WHERE "userId"=$1', [req.user.id]);
    if (Number(n[0].n) >= sets.MAX_SETS_PER_USER) return res.status(409).json({ error: `You have ${sets.MAX_SETS_PER_USER} saved sets. Delete some to save another.` });
    const { rows } = await pool.query(
      `INSERT INTO domain_sets ("userId", name, preferred, data) VALUES ($1,$2,$3,$4) RETURNING ${SET_COLS}`,
      [req.user.id, name, data.preferred || null, JSON.stringify(data)]);
    res.status(201).json({ set: { ...sets.summarise(rows[0]), data: rows[0].data } });
  } catch (err) { setFail(res, err); }
});

router.get('/sets/:id', async (req, res) => {
  try {
    const id = setId(req);
    if (!id) return res.status(400).json({ error: 'Bad set.' });
    const { rows } = await pool.query(`SELECT ${SET_COLS} FROM domain_sets WHERE id=$1 AND "userId"=$2`, [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'That set was not found.' });
    res.json({ set: { ...sets.summarise(rows[0]), data: rows[0].data } });
  } catch (err) { setFail(res, err); }
});

router.put('/sets/:id', async (req, res) => {
  try {
    const id = setId(req);
    if (!id) return res.status(400).json({ error: 'Bad set.' });
    const name = sets.cleanSetName(req.body && req.body.name);
    const data = sets.cleanSetData(req.body && req.body.data);
    const { rows } = await pool.query(
      `UPDATE domain_sets SET name=$1, preferred=$2, data=$3, "updatedAt"=NOW() WHERE id=$4 AND "userId"=$5 RETURNING ${SET_COLS}`,
      [name, data.preferred || null, JSON.stringify(data), id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'That set was not found.' });
    res.json({ set: { ...sets.summarise(rows[0]), data: rows[0].data } });
  } catch (err) { setFail(res, err); }
});

// Deleting goes to the shared 30-day recycle bin, in the same transaction as the delete.
router.delete('/sets/:id', async (req, res) => {
  const id = setId(req);
  if (!id) return res.status(400).json({ error: 'Bad set.' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM domain_sets WHERE id=$1 AND "userId"=$2 FOR UPDATE', [id, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That set was not found.' }); }
    require('../services/recycleBin/adapters');
    const bin = require('../services/recycleBin');
    const d = rows[0].data || {};
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'domain-set', id: rows[0].id, title: rows[0].name,
      detail: `${(d.suggestions || []).length} names${rows[0].preferred ? ` · preferred: ${rows[0].preferred}` : ''}`,
      payload: { set: rows[0] },
    });
    await db.query('DELETE FROM domain_sets WHERE id=$1 AND "userId"=$2', [id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    setFail(res, err);
  } finally { db.release(); }
});

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

// Step 1: LLM generates creative names. Step 2: DomScan checks availability.
router.get('/suggest', handle(async (req) => {
  const { q, tlds } = req.query;
  if (!q) throw new Error('q (description) is required.');

  // Get all configured text models so we can try them all as fallbacks
  const { models: allModels, defaultModel } = await getVaultModelsConfigForUser(req.user.id);
  const textModels = allModels
    .filter(m => !['fal', 'seedance'].includes(String(m.provider || '').toLowerCase()))
    .map(m => m.id)
    .filter(Boolean);

  // Put the default model first, then the rest
  const candidates = [...new Set([defaultModel, ...textModels].filter(Boolean))];

  const prompt = `You are an expert brand naming consultant. A client needs domain name ideas for this business:

"${q}"

Generate exactly 16 creative, memorable domain name candidates.

Rules:
- Output one name per line, nothing else — no numbering, no TLDs, no explanation
- Names should be 5–14 characters, lowercase
- Mix styles: invented words, portmanteaus, metaphors, evocative compounds
- Avoid generic filler: "hub", "pro", "app", "best", "my", "get", "go"
- Every name must feel like a real brand

Example output:
chillvault
vinoguard
cellrmate
frostelier`;

  let raw = '';
  let usedModel = '';
  for (const modelId of candidates) {
    try {
      console.log(`[domains/suggest] trying model=${modelId}`);
      const result = await callModel(modelId, prompt, { maxTokens: 300 });
      if (result && result.trim()) {
        raw = result;
        usedModel = modelId;
        break;
      }
      console.log(`[domains/suggest] model=${modelId} returned empty, trying next`);
    } catch (e) {
      console.warn(`[domains/suggest] model=${modelId} error: ${e.message}, trying next`);
    }
  }

  console.log(`[domains/suggest] used=${usedModel} raw (${raw.length} chars): ${raw.slice(0, 200)}`);

  if (!raw || !raw.trim()) {
    const tried = candidates.join(', ');
    throw new Error(`All configured AI models returned empty responses (tried: ${tried}). Check your models in Settings → AI & Chat.`);
  }

  // Parse: try JSON array first, then fall back to one-name-per-line
  let names = [];
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try { names = JSON.parse(jsonMatch[0]); } catch { /* fall through to line parsing */ }
  }
  if (!names.length) {
    names = raw
      .split(/[\n,]+/)
      .map(l => l.trim().replace(/^["'\d.\-\s]+|["'\s]+$/g, ''))
      .filter(l => l.length >= 3 && l.length <= 30 && /^[a-z0-9-]+$/i.test(l));
  }

  // Sanitise: lowercase, alphanumeric + hyphens only, deduplicate
  names = [...new Set(
    names
      .map(n => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30))
      .filter(n => n.length >= 3)
  )].slice(0, 16);

  if (!names.length) throw new Error('The AI did not return usable names. Please rephrase your description and try again.');

  // Step 2: check availability in parallel (not sequentially — avoids timeout)
  const tldList = tlds || 'com,com.au,org,io,ai,co,app';

  const results = await Promise.allSettled(
    names.map(async (name) => {
      // max_age is how old a saved answer may be (seconds). The old prefer_cache meant up to 30 days, which could show a name as free after
      // it was registered. Five minutes keeps the first look quick; Verify now asks for a live answer (max_age 0).
      const avail = await domscan('/status', { name, tlds: tldList, max_age: sets.GENERATE_MAX_AGE });
      return sets.shapeStatus(name, avail);
    })
  );

  const suggestions = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { name: names[i], results: [], hasAvailable: null, checkedAt: null }
  );

  // Sort: names with an available .com or .com.au first, then other available, then unknown
  suggestions.sort((a, b) => {
    const score = (s) => {
      if (s.results.find(r => (r.tld === 'com' || r.tld === 'com.au') && r.available)) return 2;
      if (s.hasAvailable) return 1;
      return 0;
    };
    return score(b) - score(a);
  });

  return { suggestions, source: 'llm', tlds: tldList };
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

// ── Research ────────────────────────────────────────────────────────────────

// Full domain overview: WHOIS + lifecycle + reputation + DNS in one call
router.get('/overview', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  return domscan('/overview', { domain });
}));

// ── Launch Readiness ─────────────────────────────────────────────────────────

// Social handle availability — API uses 'handle' param
router.get('/social', handle(async (req) => {
  const { username } = req.query;
  if (!username) throw new Error('username is required.');
  return domscan('/social', { handle: username });
}));

// Compare registrar prices for a domain
router.get('/pricing', handle(async (req) => {
  const { domain } = req.query;
  if (!domain) throw new Error('domain is required.');
  const [name, ...tldParts] = domain.replace(/^www\./, '').split('.');
  const tld = tldParts.join('.');
  return domscan('/prices/compare', { tld: tld || 'com' });
}));

module.exports = router;
