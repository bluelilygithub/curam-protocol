'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { runProductScout, listRuns, getRun, deleteRuns } = require('../services/productScoutService');
const { compareUrlToScout } = require('../services/productScoutCompareUrl');
const { buildGuideBrief, runBuyGuide } = require('../services/productScoutGuideService');
const {
  getPriceVariancePct,
  setPriceVariancePct,
  getAmazonDomain,
  setAmazonDomain,
  getProductScoutSettings,
  marketplaceLabel,
} = require('../services/productScoutSettings');

function handle(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      console.error('[productScout]', err.message);
      const status = err.status || (err.message.includes('not set') ? 503 : 500);
      res.status(status).json({ error: err.message || 'Product Scout failed' });
    }
  };
}

router.get('/config-check', handle(async () => {
  const rainforest = Boolean(process.env.RAINFOREST_API_KEY?.trim());
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const search = Boolean(process.env.SEARCH_API_KEY?.trim());
  const settings = await getProductScoutSettings(pool);
  return {
    rainforest,
    llm: anthropic || gemini,
    search,
    ...settings,
  };
}));

router.get('/settings', handle(async () => getProductScoutSettings(pool)));

router.post('/settings', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  try {
    const out = {};
    if (req.body?.priceVariancePct != null) {
      out.priceVariancePct = await setPriceVariancePct(pool, req.body.priceVariancePct);
    }
    if (req.body?.amazonDomain != null) {
      out.amazonDomain = await setAmazonDomain(pool, req.body.amazonDomain);
      out.amazonCountry = marketplaceLabel(out.amazonDomain);
    }
    res.json({ ok: true, ...(await getProductScoutSettings(pool)), ...out });
  } catch (err) {
    console.error('[productScout]', err.message);
    res.status(err.message.includes('Invalid') ? 400 : 500).json({ error: err.message || 'Failed to save settings' });
  }
});

router.post('/guide/brief', handle(async (req) => {
  const { query, userFeatures, budgetHint } = req.body || {};
  if (!query?.trim()) throw new Error('query is required');
  const hint = budgetHint != null && budgetHint !== '' ? Number(budgetHint) : null;
  if (hint != null && (!Number.isFinite(hint) || hint <= 0)) {
    throw new Error('budgetHint must be a positive number');
  }
  return buildGuideBrief(req.user.id, query.trim(), userFeatures, hint);
}));

router.post('/guide/run', handle(async (req) => {
  const { query, userFeatures, budgetHint, featureBrief } = req.body || {};
  if (!query?.trim()) throw new Error('query is required');
  if (!featureBrief) throw new Error('featureBrief is required');
  const hint = budgetHint != null && budgetHint !== '' ? Number(budgetHint) : null;
  return runBuyGuide(req.user.id, {
    query: query.trim(),
    userFeatures: userFeatures || [],
    budgetHint: hint,
    featureBrief,
  });
}));

router.post('/compare-url', handle(async (req) => {
  const { url, runId } = req.body || {};
  if (!url?.trim()) throw new Error('url is required');
  const id = runId != null && runId !== '' ? Number(runId) : null;
  if (!id || !Number.isFinite(id)) throw new Error('runId is required — run a scout search first');
  return compareUrlToScout(req.user.id, { url: url.trim(), runId: id });
}));

router.get('/runs', handle(async (req) => listRuns(req.user.id)));

router.post('/runs/delete', handle(async (req) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length) {
    throw new Error('ids array is required');
  }
  return deleteRuns(req.user.id, ids);
}));

router.get('/runs/:id', async (req, res) => {
  try {
    const run = await getRun(req.user.id, Number(req.params.id));
    if (!run) return res.status(404).json({ error: 'Not found' });
    res.json(run);
  } catch (err) {
    console.error('[productScout]', err.message);
    res.status(500).json({ error: err.message || 'Product Scout failed' });
  }
});

router.post('/run', handle(async (req) => {
  const { query, maxPrice, freeDelivery, within2Days } = req.body || {};
  if (!query?.trim()) {
    const err = new Error('query is required');
    err.status = 400;
    throw err;
  }
  const max = maxPrice != null && maxPrice !== '' ? Number(maxPrice) : null;
  if (max != null && (!Number.isFinite(max) || max <= 0)) {
    throw new Error('maxPrice must be a positive number');
  }
  return runProductScout(req.user.id, query.trim(), {
    maxPrice: max,
    freeDelivery: Boolean(freeDelivery),
    within2Days: Boolean(within2Days),
  });
}));

module.exports = router;
