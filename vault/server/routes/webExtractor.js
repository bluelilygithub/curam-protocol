'use strict';

const express = require('express');
const { runExtraction } = require('../services/webExtractorService');

const router = express.Router();

const MODES = new Set(['article', 'images', 'styled']);

router.post('/extract', async (req, res) => {
  const { url, mode } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const chosenMode = MODES.has(mode) ? mode : 'article';
  try {
    const result = await runExtraction(url, chosenMode);
    res.json(result);
  } catch (err) {
    console.error('[web-extractor/extract]', err.message);
    const status = /private|DNS|too large|Invalid URL/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
