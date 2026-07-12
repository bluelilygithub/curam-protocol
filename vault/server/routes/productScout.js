'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { runProductScout, listRuns, getRun } = require('../services/productScoutService');
const {
  getPriceVariancePct,
  setPriceVariancePct,
  DEFAULT_VARIANCE_PCT,
} = require('../services/productScoutBudget');

function handle(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      console.error('[productScout]', err.message);
      const status = err.message.includes('not set') ? 503 : 500;
      res.status(status).json({ error: err.message || 'Product Scout failed' });
    }
  };
}

router.get('/config-check', handle(async () => {
  const rainforest = Boolean(process.env.RAINFOREST_API_KEY?.trim());
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const search = Boolean(process.env.SEARCH_API_KEY?.trim());
  const priceVariancePct = await getPriceVariancePct(pool);
  return {
    rainforest,
    llm: anthropic || gemini,
    search,
    amazonDomain: process.env.AMAZON_DOMAIN || 'amazon.com.au',
    priceVariancePct,
    defaultPriceVariancePct: DEFAULT_VARIANCE_PCT,
  };
}));

router.get('/settings', handle(async () => ({
  priceVariancePct: await getPriceVariancePct(pool),
  defaultPriceVariancePct: DEFAULT_VARIANCE_PCT,
})));

router.post('/settings', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  try {
    const pct = await setPriceVariancePct(pool, req.body?.priceVariancePct);
    res.json({ ok: true, priceVariancePct: pct });
  } catch (err) {
    console.error('[productScout]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save settings' });
  }
});

router.get('/runs', handle(async (req) => listRuns(req.user.id)));

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
  const { query, maxPrice } = req.body || {};
  if (!query?.trim()) {
    const err = new Error('query is required');
    err.status = 400;
    throw err;
  }
  const max = maxPrice != null && maxPrice !== '' ? Number(maxPrice) : null;
  if (max != null && (!Number.isFinite(max) || max <= 0)) {
    throw new Error('maxPrice must be a positive number');
  }
  return runProductScout(req.user.id, query.trim(), { maxPrice: max });
}));

module.exports = router;
