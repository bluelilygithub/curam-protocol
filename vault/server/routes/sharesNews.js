'use strict';

const express = require('express');
const router = express.Router();
const { generateDailyBriefing, generateMonthlySummary, getBriefingsForUser } = require('../services/sharesNewsService');

// GET /api/shares/news — last 45 days of daily briefings + all monthly summaries
router.get('/', async (req, res) => {
  try {
    const rows = await getBriefingsForUser(req.user.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/news/generate — manual trigger for today's daily briefing
router.post('/generate', async (req, res) => {
  try {
    const result = await generateDailyBriefing(req.user.id);
    if (result.skipped) return res.json({ message: result.reason });
    const rows = await getBriefingsForUser(req.user.id);
    res.json({ message: `Generated briefing: ${result.stockCount} stock(s)`, briefings: rows });
  } catch (err) {
    console.error('[sharesNews] generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/news/generate-summary — manual trigger for 30-day summary
router.post('/generate-summary', async (req, res) => {
  try {
    const result = await generateMonthlySummary(req.user.id);
    if (result.skipped) return res.json({ message: result.reason });
    const rows = await getBriefingsForUser(req.user.id);
    res.json({ message: '30-day summary generated', briefings: rows });
  } catch (err) {
    console.error('[sharesNews] generate-summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
