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
      SELECT si.type, si."projectId", si.title,
        ts_headline('english', COALESCE(si.body,''), plainto_tsquery('english', $1),
          'MaxWords=20, MinWords=5, StartSel=<mark>, StopSel=</mark>, FragmentDelimiter=...') as snippet
      FROM search_index si
      WHERE to_tsvector('english', COALESCE(si.title,'') || ' ' || COALESCE(si.body,'')) @@ plainto_tsquery('english', $1)
        AND NOT EXISTS (
          SELECT 1 FROM projects ap
          WHERE ap.id::text = si."projectId"
            AND ap."archived_at" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM sessions ds
          WHERE si.type = 'message'
            AND si.title = 'Chat: ' || ds."sessionId"
            AND ds."deletedAt" IS NOT NULL
        )
        AND (
          si."projectId" IS NULL
          OR EXISTS (
            SELECT 1 FROM projects up
            WHERE up.id::text = si."projectId"
              AND up."userId" = $2
          )
        )
      LIMIT 20
    `, [q.trim(), req.user.id]);

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
