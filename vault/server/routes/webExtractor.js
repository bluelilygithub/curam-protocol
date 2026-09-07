'use strict';

const express = require('express');
const { runExtraction } = require('../services/webExtractorService');
const { generateArticlePdf } = require('../services/webExtractorPdf');

const router = express.Router();

function safeFilename(s) {
  return String(s || 'article').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'article';
}

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

router.post('/pdf', async (req, res) => {
  const { title, byline, url, text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const buffer = await generateArticlePdf({ title, byline, url, text });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(title)}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('[web-extractor/pdf]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
