'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { loadFeatureAccess } = require('../middleware/auth');

// GET /api/search/global?q= — the command palette's "things" search: notes, CRM clients and invoices/quotes.
// Each source is its own query so one failing table never blanks the rest; every query is filtered by the caller's own id,
// and clients / invoices only run when the person has that feature (admins always do).
const LIMIT = 6;
const likePattern = (q) => '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

router.get('/global', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ notes: [], clients: [], invoices: [] });

  const userId = req.user.id;
  const like = likePattern(q);
  let flags = {};
  try {
    flags = req.user.isAdmin ? null : await loadFeatureAccess(userId);
  } catch (_) { flags = {}; }
  const can = (key) => flags === null || flags[key] !== false;
  const safe = (p) => p.then((r) => r.rows).catch((err) => { console.error('Global search error:', err.message); return []; });

  const [notes, clients, invoices] = await Promise.all([
    safe(pool.query(
      `SELECT id, title,
              CASE WHEN position(lower($2) in lower(body)) > 0
                   THEN substring(body from greatest(position(lower($2) in lower(body)) - 30, 1) for 100)
                   ELSE left(body, 100) END AS snippet
         FROM notes
        WHERE user_id = $1 AND (title ILIKE $3 OR body ILIKE $3)
        ORDER BY (title ILIKE $3) DESC, updated_at DESC
        LIMIT ${LIMIT}`,
      [userId, q, like]
    )),
    can('clients') ? safe(pool.query(
      `SELECT id, name, company, status
         FROM clients
        WHERE "userId" = $1 AND (name ILIKE $2 OR company ILIKE $2)
        ORDER BY (status = 'archived'), name
        LIMIT ${LIMIT}`,
      [userId, like]
    )) : [],
    can('finance') ? safe(pool.query(
      `SELECT id, number, status, total, "docType"
         FROM fin_invoices
        WHERE "userId" = $1 AND (number ILIKE $2 OR notes ILIKE $2)
        ORDER BY "issueDate" DESC
        LIMIT ${LIMIT}`,
      [userId, like]
    )) : [],
  ]);

  res.json({
    notes: notes.map((n) => ({ id: n.id, title: n.title, snippet: String(n.snippet || '').replace(/\s+/g, ' ').trim() })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, company: c.company, status: c.status })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, total: Number(i.total), docType: i.docType })),
  });
});

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
        AND EXISTS (
          SELECT 1 FROM projects up
          WHERE up.id::text = si."projectId"
            AND up."userId" = $2
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
