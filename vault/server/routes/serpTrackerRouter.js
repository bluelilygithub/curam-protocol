'use strict';

// SERP Tracker routes, mounted at /api/serp-tracker behind requireFeature('serpTracker') (server/index.js). Takes the pool and the
// outside pieces as arguments so tests need no database or network. Every query filters by the caller's "userId".
// Stage 1: site profile, status/spend, run history, "Run now". See docs/serp-tracker.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getLogger } = require('../middleware/requestContext');
const { validateProfile, DEFAULTS, localDate } = require('../services/serpTracker/siteProfile');
const { loadSite, saveSite, listRuns } = require('../services/serpTracker/store');
const { runSite, RunAlreadyActive } = require('../services/serpTracker/runner');
const { monthSpend, monthlyCapUsd, logCost } = require('../services/serpTracker/costs');
const { getBalance, hasCredentials } = require('../services/serpTracker/dataforseo');

function createRouter(pool, {
  deps = { getBalance, hasCredentials, logCost },
  env = process.env,
  now = () => new Date(),
  modules = [],
  runsPerHour = 6,
} = {}) {
  const router = express.Router();
  const userId = (req) => req.user.id;

  const runLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: runsPerHour, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `serp-run:${req.user?.id || req.ip}`,
    message: { error: 'Too many manual runs this hour. The daily run happens by itself.' },
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

  return router;
}

module.exports = { createRouter };
