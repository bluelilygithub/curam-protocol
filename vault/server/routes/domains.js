'use strict';

// The Domain tool's API (/api/domains, flag `domains`). A guided journey: brief -> generate and refine -> shortlist -> check -> decide.
// Named routes only; nothing here is bought or registered. Credits (DomScan docs): domain check 1 per name, social handles 2 per name.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { aiLimiter } = require('../middleware/aiRateLimit');
const sets = require('../services/domainSets');
const { cleanBrief } = require('../services/domainNaming/brief');
const { askAboutNames } = require('../services/domainNaming/ask');
const { generateRound, CHECK_BATCH, VARIATION_BATCH, WIDE_COUNT, SHOW } = require('../services/domainNaming/generate');
const { getProviders } = require('../services/domainNaming/providers');
const { DOMSCAN_BASE, key } = require('../services/domainNaming/domscan');

const router = express.Router();

const fail = (res, err) => {
  const status = err && err.status ? err.status : 500;
  if (status === 500) console.error('domains route error:', err);
  res.status(status).json({ error: status === 500 ? (err && err.message) || 'Something went wrong. Please try again.' : err.message });
};
const perUser = (req) => String(req.user?.id || req.ip);

// ── What this server is set up to do ─────────────────────────
// The page shows the cost of a round before it runs, and says so when it is running on stand-in data.
router.get('/config', (req, res) => {
  const fake = process.env.DOMAIN_PROVIDER === 'fake';
  res.json({
    provider: fake ? 'fake' : 'live',
    generate: { wide: WIDE_COUNT, domainChecks: CHECK_BATCH, shown: SHOW, credits: CHECK_BATCH },
    variations: { domainChecks: VARIATION_BATCH, credits: VARIATION_BATCH },
    endings: sets.ENDINGS,
  });
});

router.get('/config-check', async (req, res) => {
  try {
    const k = key();
    const probe = await fetch(`${DOMSCAN_BASE}/tlds?limit=1`, { headers: { 'X-API-Key': k, Accept: 'application/json' } });
    res.json({ configured: true, keyPreview: `${k.slice(0, 4)}…`, status: probe.status });
  } catch (err) { res.status(200).json({ configured: false, error: err.message }); }
});

// ── Generate and refine ──────────────────────────────────────
// One round: wide generation, free filtering in code, domain checks for the best few only, then reasons for the finalists.
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser,
  message: { error: 'You have generated a lot of names this hour. Please wait a while.' },
});

router.post('/generate', aiLimiter, generateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const brief = cleanBrief(body.brief);
    if (!brief.what && !brief.own) return res.status(400).json({ error: 'Say what it is, or give a name you already have.' });
    const mode = body.mode === 'variations' ? 'variations' : 'round';
    const seed = sets.labelOf(body.seed);
    if (mode === 'variations' && !seed) return res.status(400).json({ error: 'Choose a name to make variations of.' });
    const names = (v, n) => [...new Set((Array.isArray(v) ? v : []).map(sets.labelOf).filter(Boolean))].slice(0, n);
    const p = getProviders();
    const out = await generateRound({
      userId: req.user.id, brief, mode, seed,
      feedback: { more: names(body.feedback && body.feedback.more, 8), less: names(body.feedback && body.feedback.less, 12) },
      seen: names(body.seen, 300),
      round: Math.max(1, Math.min(99, Math.round(Number(body.round)) || 1)),
    }, { getModels: p.getModels, callModel: p.callModel, logUsage: p.logUsage, statusFor: p.statusFor });
    res.json(out);
  } catch (err) { fail(res, err); }
});

// ── Talk it through ──────────────────────────────────────────
// A question, or extra detail, about the names so far. The answer comes from the names and their checks; nothing is changed or bought.
const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser,
  message: { error: 'You have asked a lot of questions this hour. Please wait a while.' },
});

router.post('/ask', aiLimiter, askLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const p = getProviders();
    const out = await askAboutNames({
      userId: req.user.id,
      brief: cleanBrief(body.brief),
      cards: (Array.isArray(body.cards) ? body.cards : []).slice(0, 30).map(sets.cleanCard).filter(Boolean),
      history: sets.cleanConversation(body.history),
      question: body.question,
    }, { getModels: p.getModels, callModel: p.callModel, logUsage: p.logUsage });
    res.json(out);
  } catch (err) { fail(res, err); }
});

// ── Verify now ───────────────────────────────────────────────
// A live check (never a saved answer) of the names someone is about to commit to: domain endings straight from the registry, and
// optionally the social handles. 1 credit per name for domains and 2 more for handles, so it is limited per person.
const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser,
  message: { error: 'You have verified a lot of names this hour. Please wait a while.' },
});

router.post('/verify', verifyLimiter, async (req, res) => {
  try {
    const names = [...new Set((Array.isArray(req.body && req.body.names) ? req.body.names : []).map(sets.labelOf).filter(Boolean))].slice(0, 5);
    if (!names.length) return res.status(400).json({ error: 'Choose at least one name to verify.' });
    const withSocial = !!(req.body && req.body.social);
    const tlds = sets.ENDINGS.join(',');
    const p = getProviders();
    const checks = await Promise.all(names.map(async (name) => {
      const out = { name, domains: null, domainsError: null, social: null, socialError: null };
      try { out.domains = sets.shapeStatus(name, await p.statusFor(name, tlds, 0)); } catch (e) { out.domainsError = e.message; }
      if (withSocial) {
        try { out.social = await p.domscan('/social', { handle: name.replace(/-/g, '') }); } catch (e) { out.socialError = e.message; }
      }
      return out;
    }));
    res.json({ checks, checkedAt: new Date().toISOString() });
  } catch (err) { fail(res, err); }
});

// ── Small links on a name card ───────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const domain = String(req.query.domain || '').trim().toLowerCase();
    if (!domain) return res.status(400).json({ error: 'domain is required.' });
    res.json(await getProviders().domscan('/overview', { domain }));
  } catch (err) { fail(res, err); }
});

router.get('/social', async (req, res) => {
  try {
    const username = sets.labelOf(req.query.username).replace(/-/g, '');
    if (!username) return res.status(400).json({ error: 'username is required.' });
    res.json(await getProviders().domscan('/social', { handle: username }));
  } catch (err) { fail(res, err); }
});

// ── Saved sets ───────────────────────────────────────────────
// A set is one naming brief kept with its names, shortlist and results, to come back to. A set saved by the old toolbox opens converted.

const SET_COLS = 'id, name, preferred, data, "createdAt", "updatedAt"';
const setId = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
const withData = (row) => ({ ...sets.summarise(row), data: sets.upgradeSetData(row.data) });

router.get('/sets', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${SET_COLS} FROM domain_sets WHERE "userId"=$1 ORDER BY "updatedAt" DESC LIMIT 200`, [req.user.id]);
    res.json({ sets: rows.map(sets.summarise) });
  } catch (err) { fail(res, err); }
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
    res.status(201).json({ set: withData(rows[0]) });
  } catch (err) { fail(res, err); }
});

router.get('/sets/:id', async (req, res) => {
  try {
    const id = setId(req);
    if (!id) return res.status(400).json({ error: 'Bad set.' });
    const { rows } = await pool.query(`SELECT ${SET_COLS} FROM domain_sets WHERE id=$1 AND "userId"=$2`, [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'That set was not found.' });
    res.json({ set: withData(rows[0]) });
  } catch (err) { fail(res, err); }
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
    res.json({ set: withData(rows[0]) });
  } catch (err) { fail(res, err); }
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
    const s = sets.summarise(rows[0]);
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'domain-set', id: rows[0].id, title: rows[0].name,
      detail: `${s.names} names${rows[0].preferred ? ` · preferred: ${rows[0].preferred}` : ''}`,
      payload: { set: rows[0] },
    });
    await db.query('DELETE FROM domain_sets WHERE id=$1 AND "userId"=$2', [id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { db.release(); }
});

module.exports = router;
