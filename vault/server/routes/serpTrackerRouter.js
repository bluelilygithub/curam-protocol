'use strict';

// SERP Tracker routes, mounted at /api/serp-tracker behind requireFeature('serpTracker') (server/index.js). Takes the pool and the
// outside pieces as arguments so tests need no database or network. Every query filters by the caller's "userId".
// Stage 1: site profile, status/spend, run history, "Run now". Lookup: ad-hoc live searches, saved, reopened, deleted (one, several or all).
// See docs/serp-tracker.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getLogger } = require('../middleware/requestContext');
const { validateProfile, DEFAULTS, localDate } = require('../services/serpTracker/siteProfile');
const { loadSite, saveSite, listRuns } = require('../services/serpTracker/store');
const { runSite, RunAlreadyActive } = require('../services/serpTracker/runner');
const { monthSpend, monthlyCapUsd, logCost, capStatus } = require('../services/serpTracker/costs');
const { getBalance, hasCredentials, liveSerp } = require('../services/serpTracker/dataforseo');
const { parseSerp, SerpParseError } = require('../services/serpTracker/serpParse');
const { saveLookup, listLookups, getLookup, deleteLookups, MAX_IDS } = require('../services/serpTracker/lookups');

const MAX_INT = 2147483647;
const MAX_KEYWORD = 200;
const cleanKeyword = (raw) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_KEYWORD) : '');
const parseId = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= MAX_INT ? n : null; };

function createRouter(pool, {
  deps = { getBalance, hasCredentials, logCost },
  live = liveSerp,
  getBin = () => { require('../services/recycleBin/adapters'); return require('../services/recycleBin'); },
  env = process.env,
  now = () => new Date(),
  modules = [],
  runsPerHour = 6,
  lookupsPerHour = 30,
} = {}) {
  const router = express.Router();
  const userId = (req) => req.user.id;

  const runLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: runsPerHour, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `serp-run:${req.user?.id || req.ip}`,
    message: { error: 'Too many manual runs this hour. The daily run happens by itself.' },
  });

  const lookupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: lookupsPerHour, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `serp-lookup:${req.user?.id || req.ip}`,
    message: { error: 'Too many lookups this hour. Each one costs money, so there is a limit.' },
  });

  // what the page needs before a site exists: is DataForSEO set up, the cap, this month's and last month's spend (whole workspace)
  router.get('/status', async (req, res) => {
    try {
      const today = localDate(now(), DEFAULTS.timezone);
      const [thisMonth, lastMonth] = await Promise.all([monthSpend(pool, today, 0), monthSpend(pool, today, 1)]);
      res.json({ dataForSeoConfigured: deps.hasCredentials(env), capUsd: monthlyCapUsd(env), spentThisMonthUsd: thisMonth, spentLastMonthUsd: lastMonth, defaults: DEFAULTS });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker status failed');
      res.status(500).json({ error: 'Could not load the SERP Tracker status.' });
    }
  });

  router.get('/site', async (req, res) => {
    try {
      const site = await loadSite(pool, userId(req));
      res.json({ site });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker site load failed');
      res.status(500).json({ error: 'Could not load the site.' });
    }
  });

  router.put('/site', async (req, res) => {
    const v = validateProfile(req.body && req.body.profile);
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    try {
      const site = await saveSite(pool, userId(req), v.profile);
      res.json({ site });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker site save failed');
      res.status(500).json({ error: 'Could not save the site.' });
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      const site = await loadSite(pool, userId(req));
      res.json({ runs: site ? await listRuns(pool, userId(req), site.id) : [] });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker runs failed');
      res.status(500).json({ error: 'Could not load the runs.' });
    }
  });

  router.post('/run', runLimiter, async (req, res) => {
    try {
      const site = await loadSite(pool, userId(req));
      if (!site) return res.status(400).json({ error: 'Save your site details first.' });
      const result = await runSite({ pool, site, trigger: 'manual', deps: { ...deps, now, log: (m) => getLogger().warn(m) }, modules });
      res.json({ run: result });
    } catch (err) {
      if (err instanceof RunAlreadyActive) return res.status(409).json({ error: err.message });
      getLogger().error({ err }, 'serp-tracker manual run failed');
      res.status(500).json({ error: 'The run could not be started.' });
    }
  });

  // ---- Lookup: a live search now, saved so it can be reopened. Named routes first, then /lookups/:id.
  router.post('/lookups', lookupLimiter, async (req, res) => {
    const keyword = cleanKeyword(req.body && req.body.keyword);
    if (!keyword) return res.status(400).json({ error: 'Type the search you want to look up.' });
    const device = req.body && req.body.device === 'mobile' ? 'mobile' : 'desktop';
    const rawDepth = req.body && req.body.depth != null && req.body.depth !== '' ? Number(req.body.depth) : 10;
    if (!Number.isInteger(rawDepth) || rawDepth < 10 || rawDepth > 100 || rawDepth % 10) return res.status(400).json({ error: 'Results to request must be a whole number from 10 to 100, in steps of 10.' });
    const aiOverview = !(req.body && req.body.aiOverview === false);
    if (!deps.hasCredentials(env)) return res.status(503).json({ error: 'DataForSEO is not connected on this server.' });
    try {
      const site = await loadSite(pool, userId(req));
      const profile = site ? site.profile : null;
      const costDate = localDate(now(), (profile && profile.timezone) || DEFAULTS.timezone);
      const cap = await capStatus(pool, costDate, env);
      if (cap.over) return res.status(402).json({ error: `The monthly spending limit (US$${cap.cap.toFixed(2)}) has been reached, so no more searches are made this month.` });

      const task = { keyword, locationName: (profile && profile.locationName) || DEFAULTS.locationName, languageCode: (profile && profile.languageCode) || DEFAULTS.languageCode, device, depth: rawDepth, loadAiOverview: aiOverview };
      const got = await live(task, { env });
      // DataForSEO charges for the search whether or not it can be read, so the cost is logged first
      await deps.logCost(pool, { userId: userId(req), siteId: site ? site.id : null, runId: null, costDate, endpoint: `/v3/serp/google/organic/live/advanced depth=${rawDepth} ${device}`, costUsd: got.costUsd });

      let summary;
      try {
        summary = parseSerp(got.result, { myDomain: profile ? profile.domain : null, competitors: profile ? profile.competitors.map((c) => c.domain) : [], depth: rawDepth });
      } catch (err) {
        if (err instanceof SerpParseError) return res.status(502).json({ error: `${err.message} (The search was charged: US$${got.costUsd}.)` });
        throw err;
      }
      const saved = await saveLookup(pool, { userId: userId(req), siteId: site ? site.id : null, ...task, domain: profile ? profile.domain : null, costUsd: got.costUsd, summary, raw: got.raw });
      res.json({ lookup: await getLookup(pool, userId(req), saved.id) });
    } catch (err) {
      // an error from DataForSEO (a refused login, an account that needs verifying) is worded safely and says what happened
      if (err && err.name === 'DataForSeoError') {
        getLogger().warn({ code: err.code, status: err.status }, 'serp-tracker lookup refused');
        return res.status(502).json({ error: err.message });
      }
      getLogger().error({ err }, 'serp-tracker lookup failed');
      res.status(500).json({ error: 'The lookup could not be done.' });
    }
  });

  router.get('/lookups', async (req, res) => {
    try {
      res.json({ lookups: await listLookups(pool, userId(req)) });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker lookups list failed');
      res.status(500).json({ error: 'Could not load the saved lookups.' });
    }
  });

  // delete several or all of the person's own lookups: { ids: [1,2,3] } or { all: true }. Each goes to the recycle bin (30 days, Undo).
  router.delete('/lookups', async (req, res) => {
    const body = req.body || {};
    const all = body.all === true;
    let ids = [];
    if (!all) {
      if (!Array.isArray(body.ids) || !body.ids.length) return res.status(400).json({ error: 'Choose at least one lookup to delete.' });
      if (body.ids.length > MAX_IDS) return res.status(400).json({ error: `Delete at most ${MAX_IDS} at a time.` });
      ids = body.ids.map(parseId);
      if (ids.some((n) => n === null)) return res.status(400).json({ error: 'Those are not valid lookups.' });
    }
    try {
      const bin = getBin();
      const out = await deleteLookups(pool, bin, userId(req), { ids, all });
      res.json({ ok: true, deleted: out.deleted, binIds: out.binIds, retentionDays: bin.RETENTION_DAYS });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker lookups delete failed');
      res.status(500).json({ error: 'The lookups could not be deleted. Nothing was removed.' });
    }
  });

  router.get('/lookups/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const lookup = await getLookup(pool, userId(req), id);
      if (!lookup) return res.status(404).json({ error: 'Not found' });
      res.json({ lookup });
    } catch (err) {
      getLogger().error({ err }, 'serp-tracker lookup load failed');
      res.status(500).json({ error: 'Could not load that lookup.' });
    }
  });

  return router;
}

module.exports = { createRouter };
