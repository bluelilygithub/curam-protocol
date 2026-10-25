'use strict';

// POST /api/graphics/describe { imageDataUrl, context? } -> { alt, filename, decorative }
// Suggests alt text and a file name for one picture (services/graphicsDescribe.js). Behind the paid-tool guard like the other AI
// tools: it uses the AI service, shows up on the Usage dashboard (feature graphics_describe) and counts towards the daily limit.

const express = require('express');
const router = express.Router();
const { imageDataUrlToBuffer } = require('./shared');
const { describeImage } = require('../../services/graphicsDescribe');

router.post('/describe', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    if (!imageDataUrlToBuffer(imageDataUrl)) return res.status(400).json({ error: 'A valid image is required' });
    const out = await describeImage(req.user.id, imageDataUrl, { context: req.body?.context });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Describe failed' });
  }
});

module.exports = router;
