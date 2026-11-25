'use strict';

// DNS Lookup: look up a name's records on a public resolver, find its host and registrar, or check its email setup; keep each lookup the
// page shows in dns_lookups. Mounted at /api/dns-lookup behind requireFeature('dnsLookup'). See docs/dns-lookup.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RESOLVERS, TYPES, normalizeInput, lookupRecords, reverseLookup, lookupEmailParts } = require('../services/dnsLookup/lookup');
const { emailChecks } = require('../services/dnsLookup/emailChecks');
const { whoHosts } = require('../services/dnsLookup/whoHosts');
const { pool } = require('../db');
const bin = require('../services/recycleBin');

const router = express.Router();

// A lookup asks the resolver up to eight questions, so keep one person from hammering it. Saved-list calls are not counted.
const lookupLimit = rateLimit({
  windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many lookups, please wait a minute.' },
});

function pickResolver(value) {
  return Object.prototype.hasOwnProperty.call(RESOLVERS, value) ? value : 'cloudflare';
}

router.get('/options', (req, res) => {
  res.json({ types: TYPES, resolvers: Object.entries(RESOLVERS).map(([id, r]) => ({ id, label: r.label })) });
});

router.post('/records', lookupLimit, async (req, res, next) => {
  try {
    const input = normalizeInput(req.body?.name);
    if (input.error) return res.status(400).json({ error: input.error });
    const resolver = pickResolver(req.body?.resolver);
    if (input.ip) {
      const result = await reverseLookup(resolver, input.ip);
      return res.json({ resolver, ip: input.ip, results: [result] });
    }
    const results = await lookupRecords(resolver, input.name, req.body?.types);
    res.json({ resolver, name: input.name, results });
  } catch (err) { next(err); }
});

router.post('/email', lookupLimit, async (req, res, next) => {
  try {
    const input = normalizeInput(req.body?.name);
    if (input.error) return res.status(400).json({ error: input.error });
    if (input.ip) return res.status(400).json({ error: 'Email checks need a domain name, not an IP address.' });
    const resolver = pickResolver(req.body?.resolver);
    const parts = await lookupEmailParts(resolver, input.name);
    const failed = [parts.mx, parts.txt, parts.dmarc].find((p) => p.error);
    if (failed) return res.status(502).json({ error: failed.error });
    res.json({ resolver, name: input.name, mx: parts.mx.records, findings: emailChecks({ mx: parts.mx.records, txt: parts.txt.records, dmarc: parts.dmarc.records }) });
  } catch (err) { next(err); }
});

// Who hosts the address and which registrar the domain is with (RDAP via rdap.org). Slower than /records, so the page asks separately.
router.post('/about', lookupLimit, async (req, res, next) => {
  try {
    const input = normalizeInput(req.body?.name);
    if (input.error) return res.status(400).json({ error: input.error });
    res.json(await whoHosts(pickResolver(req.body?.resolver), input));
  } catch (err) { next(err); }
});

// ── Saved lookups: the page saves each answer it shows, exactly as shown ──────────────────────────────────────────────────────────────

router.get('/saved', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, kind, name, resolver, result, "createdAt" FROM dns_lookups WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 200', [req.user.id]);
    res.json({ lookups: rows });
  } catch (err) { next(err); }
});

router.post('/saved', async (req, res, next) => {
  try {
    const { kind, name, resolver, result } = req.body || {};
    if (!['records', 'email'].includes(kind) || !name || !result || typeof result !== 'object') return res.status(400).json({ error: 'Nothing to save.' });
    const json = JSON.stringify(result);
    if (json.length > 500000) return res.status(413).json({ error: 'That answer is too big to save.' });
    const { rows } = await pool.query(
      'INSERT INTO dns_lookups ("userId", kind, name, resolver, result) VALUES ($1, $2, $3, $4, $5) RETURNING id, kind, name, resolver, result, "createdAt"',
      [req.user.id, kind, String(name).slice(0, 300), resolver ? String(resolver).slice(0, 20) : null, json]);
    res.json({ lookup: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/saved/:id', async (req, res, next) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM dns_lookups WHERE id = $1 AND "userId" = $2 FOR UPDATE', [req.params.id, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'dns-lookup', id: rows[0].id, title: rows[0].name,
      detail: rows[0].kind === 'email' ? 'DNS Lookup: email check' : 'DNS Lookup: records', payload: { lookup: rows[0] },
    });
    await db.query('DELETE FROM dns_lookups WHERE id = $1', [rows[0].id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); next(err); } finally { db.release(); }
});

module.exports = router;
