'use strict';

// DNS Lookup: look up a name's records on a public resolver, or check its email setup. Stateless: no table, nothing kept. Mounted at
// /api/dns-lookup behind requireFeature('dnsLookup'). See docs/dns-lookup.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RESOLVERS, TYPES, normalizeInput, lookupRecords, reverseLookup, lookupEmailParts } = require('../services/dnsLookup/lookup');
const { emailChecks } = require('../services/dnsLookup/emailChecks');

const router = express.Router();

// A lookup asks the resolver up to eight questions, so keep one person from hammering it.
router.use(rateLimit({
  windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many lookups, please wait a minute.' },
}));

function pickResolver(value) {
  return Object.prototype.hasOwnProperty.call(RESOLVERS, value) ? value : 'cloudflare';
}

router.get('/options', (req, res) => {
  res.json({ types: TYPES, resolvers: Object.entries(RESOLVERS).map(([id, r]) => ({ id, label: r.label })) });
});

router.post('/records', async (req, res, next) => {
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

router.post('/email', async (req, res, next) => {
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

module.exports = router;
