'use strict';

const express = require('express');
const router = express.Router();
const { generateDailyBriefing, getBriefingsForUser } = require('../services/sharesNewsService');

// GET /api/shares/news — last 30 days of briefings
router.get('/', async (req, res) => {
  try {
    const rows = await getBriefingsForUser(req.user.id, 30);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/news/generate — manual trigger
router.post('/generate', async (req, res) => {
  try {
    const result = await generateDailyBriefing(req.user.id);
    if (result.skipped) return res.json({ message: result.reason });
    const rows = await getBriefingsForUser(req.user.id, 30);
    res.json({ message: `Generated briefing: ${result.stockCount} stock(s)`, briefings: rows });
  } catch (err) {
    console.error('[sharesNews] generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
