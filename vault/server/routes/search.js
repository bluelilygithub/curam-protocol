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

    // For message results: extract sessionId from title ("Chat: <sessionId>") and
    // replace the raw title with the session's human-readable title if available.
    const sessionStmt = db.prepare('SELECT title FROM sessions WHERE sessionId=?');
    const processed = rows.map(r => {
      if (r.type === 'message' && typeof r.title === 'string' && r.title.startsWith('Chat: ')) {
        const sessionId = r.title.slice(6);
        const session = sessionStmt.get(sessionId);
        return {
          ...r,
          sessionId,
          title: session?.title || `Chat ${sessionId.slice(-8)}`,
        };
      }
      return r;
    });

    res.json(processed);
  } catch (err) {
    console.error('Search error:', err);
    res.json([]);
  }
});

module.exports = router;
