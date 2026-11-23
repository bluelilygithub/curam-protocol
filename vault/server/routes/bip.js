'use strict';

// Business Profiler API (/api/bip, flag `bip`). Profiles are looked up in the background so a slow registry or a blocked review site
// cannot hold a web request open. See docs/bip.md.

const express = require('express');
const { pool } = require('../db');
const { domain: normaliseDomain } = require('../services/bip/normalise');
const store = require('../services/bip/store');
const { runProfile, configured, ENRICHMENT, ALL_MODULES } = require('../services/bip/run');
const { MODULES } = require('../services/bip/sources');
const jobs = require('../services/bip/jobs');
const { buildBipPdfBuffer } = require('../services/bip/pdf');
const { moveToBin } = require('../services/recycleBin');
require('../services/recycleBin/adapters/bip');

const router = express.Router();

const fail = (res, err) => {
  const status = err?.status || 500;
  if (status === 500) console.error('[bip]', err);
  res.status(status).json({ error: status === 500 ? 'Business Profiler could not complete that request.' : err.message });
};

const safeFile = (s) => String(s || 'profile').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'profile';

router.get('/config', (req, res) => {
  res.json({
    modules: MODULES.map(({ name, label, group }) => ({ name, label, group })),
    enrichmentModules: ENRICHMENT,
    cacheDays: store.CACHE_DAYS,
    configured: configured(),
  });
});

router.get('/profiles', async (req, res) => {
  try { res.json({ profiles: await store.listProfiles(req.user.id) }); }
  catch (err) { fail(res, err); }
});

router.post('/profiles', async (req, res) => {
  try {
    const domain = normaliseDomain(req.body?.domain);
    if (!domain) return res.status(400).json({ error: 'Enter a domain name such as example.com.' });
    if (req.body?.force !== true) {
      const cached = await store.cachedProfile(req.user.id, domain);
      if (cached) {
        const profile = await store.getProfile(req.user.id, cached.id);
        return res.json({ profile, cached: true });
      }
    }
    const profile = await store.createProfile(req.user.id, domain);
    const jobId = jobs.startJob(req.user.id, `profile ${domain}`, (onProgress) => runProfile({
      profileId: profile.id, userId: req.user.id, domain, decisions: {}, onProgress,
    }));
    res.status(202).json({ jobId, profileId: profile.id, domain, cached: false });
  } catch (err) { fail(res, err); }
});

router.get('/profiles/:id', async (req, res) => {
  try {
    const profile = await store.getProfile(req.user.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile });
  } catch (err) { fail(res, err); }
});

router.post('/profiles/:id/rescan', async (req, res) => {
  try {
    const profile = await store.getRow(req.user.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    const requested = Array.isArray(req.body?.modules) ? req.body.modules.filter((n) => ALL_MODULES.includes(n)) : null;
    if (Array.isArray(req.body?.modules) && !requested?.length) return res.status(400).json({ error: 'Choose at least one known module to refresh.' });
    const jobId = jobs.startJob(req.user.id, `re-scan ${profile.domain}`, (onProgress) => runProfile({
      profileId: profile.id, userId: req.user.id, domain: profile.domain, modules: requested,
      decisions: profile.decisions ? store.parse(profile.decisions) : {}, onProgress,
    }));
    res.status(202).json({ jobId, profileId: profile.id, domain: profile.domain, modules: requested || 'all', cached: false });
  } catch (err) { fail(res, err); }
});

router.patch('/profiles/:id', async (req, res) => {
  try {
    const profile = await store.getRow(req.user.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    const decisions = req.body?.decisions;
    if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) return res.status(400).json({ error: 'decisions must be an object.' });
    await store.saveDecisions(profile.id, req.user.id, decisions);
    res.json({ decisions });
  } catch (err) { fail(res, err); }
});

router.get('/profiles/:id/pdf', async (req, res) => {
  try {
    const profile = await store.getProfile(req.user.id, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    if (profile.status !== 'done') return res.status(409).json({ error: 'This profile has not finished yet.' });
    const buffer = await buildBipPdfBuffer(profile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFile(profile.domain)}-business-profile.pdf"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[bip/pdf]', err);
    res.status(500).json({ error: 'Could not generate the PDF.' });
  }
});

router.delete('/profiles/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM bip_profiles WHERE id = $1 AND "userId" = $2', [Number(req.params.id) || 0, req.user.id]);
    const profile = rows[0];
    if (!profile) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Profile not found.' }); }
    const src = await client.query('SELECT * FROM bip_sources WHERE "profileId" = $1 AND "userId" = $2', [profile.id, req.user.id]);
    await moveToBin(client, {
      userId: req.user.id, type: 'bip-profile', id: profile.id,
      title: profile.businessName || profile.domain,
      detail: `Business Profiler profile for ${profile.domain}`,
      payload: { profile, sources: src.rows },
      maxBytes: 20 * 1024 * 1024,
    });
    await client.query('DELETE FROM bip_profiles WHERE id = $1 AND "userId" = $2', [profile.id, req.user.id]);
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.get('/jobs/:jobId', (req, res) => {
  const job = jobs.getJob(req.params.jobId, req.user.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job });
});

module.exports = router;
