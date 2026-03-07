const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/admin/stats?from=ISO&to=ISO
router.get('/stats', (req, res) => {
  const { from, to } = req.query;
  if (!from) return res.status(400).json({ error: 'from required' });
  const toDate = to || new Date().toISOString();

  try {
    const q = (sql) => db.prepare(sql).get(from, toDate);

    const projects    = q('SELECT COUNT(*) as n FROM projects WHERE createdAt >= ? AND createdAt <= ?')?.n ?? 0;
    const sessions    = q('SELECT COUNT(*) as n FROM sessions WHERE createdAt >= ? AND createdAt <= ?')?.n ?? 0;
    const messages    = q('SELECT COUNT(*) as n FROM messages WHERE createdAt >= ? AND createdAt <= ?')?.n ?? 0;
    const searches    = q('SELECT COUNT(*) as n FROM search_logs WHERE createdAt >= ? AND createdAt <= ?')?.n ?? 0;
    const debates     = q('SELECT COUNT(*) as n FROM debates WHERE createdAt >= ? AND createdAt <= ?')?.n ?? 0;
    const comparisons = q('SELECT COUNT(*) as n FROM comparisons WHERE createdAt >= ? AND createdAt <= ?')?.n ?? 0;
    const tokenRow    = q('SELECT COALESCE(SUM(inputTokens),0) as inp, COALESCE(SUM(outputTokens),0) as out FROM sessions WHERE createdAt >= ? AND createdAt <= ?');

    const inputTokens  = tokenRow?.inp ?? 0;
    const outputTokens = tokenRow?.out ?? 0;

    res.json({ projects, sessions, messages, searches, debates, comparisons, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
