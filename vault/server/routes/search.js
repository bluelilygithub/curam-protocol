'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/search?q=
router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  try {
    const { rows } = await pool.query(`
      SELECT type, "projectId", title,
        ts_headline('english', COALESCE(body,''), plainto_tsquery('english', $1),
          'MaxWords=20, MinWords=5, StartSel=<mark>, StopSel=</mark>, FragmentDelimiter=...') as snippet
      FROM search_index
      WHERE to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(body,'')) @@ plainto_tsquery('english', $1)
      LIMIT 20
    `, [q.trim()]);

    // For message results: extract sessionId from title ("Chat: <sessionId>") and
    // replace the raw title with the session's human-readable title if available.
    const processed = await Promise.all(rows.map(async r => {
      if (r.type === 'message' && typeof r.title === 'string' && r.title.startsWith('Chat: ')) {
        const sessionId = r.title.slice(6);
        const { rows: sessionRows } = await pool.query('SELECT title FROM sessions WHERE "sessionId"=$1', [sessionId]);
        const session = sessionRows[0];
        return {
          ...r,
          sessionId,
          title: session?.title || `Chat ${sessionId.slice(-8)}`,
        };
      }
      return r;
    }));

    res.json(processed);
  } catch (err) {
    console.error('Search error:', err);
    res.json([]);
  }
});

module.exports = router;
