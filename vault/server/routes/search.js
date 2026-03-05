const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/search?q=
router.get('/', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  try {
    const sanitized = q.replace(/['"]/g, '').trim();
    const rows = db.prepare(`
      SELECT type, projectId, title, snippet(search_index, 3, '<mark>', '</mark>', '...', 20) as snippet
      FROM search_index
      WHERE search_index MATCH ?
      LIMIT 20
    `).all(`"${sanitized}"`);

    res.json(rows);
  } catch (err) {
    console.error('Search error:', err);
    res.json([]);
  }
});

module.exports = router;
