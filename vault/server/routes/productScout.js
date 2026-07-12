'use strict';

const express = require('express');
const router = express.Router();
const { runProductScout, listRuns, getRun } = require('../services/productScoutService');

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
  return {
    rainforest,
    llm: anthropic || gemini,
    search,
    amazonDomain: process.env.AMAZON_DOMAIN || 'amazon.com',
  };
}));

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
  const { query } = req.body || {};
  if (!query?.trim()) return res.status(400).json({ error: 'query is required' });
  return runProductScout(req.user.id, query.trim());
}));

module.exports = router;
