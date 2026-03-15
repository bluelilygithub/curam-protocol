'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/admin/stats?from=ISO&to=ISO
router.get('/stats', async (req, res) => {
  const { from, to } = req.query;
  if (!from) return res.status(400).json({ error: 'from required' });
  const toDate = to || new Date().toISOString();

  try {
    const [
      projectsRes,
      archivedProjectsRes,
      sessionsRes,
      messagesRes,
      searchesRes,
      debatesRes,
      comparisonsRes,
      tokensRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as n FROM projects WHERE "archived_at" IS NULL AND "createdAt" >= $1 AND "createdAt" <= $2', [from, toDate]),
      pool.query('SELECT COUNT(*) as n FROM projects WHERE "archived_at" IS NOT NULL', []),
      pool.query('SELECT COUNT(*) as n FROM sessions WHERE "createdAt" >= $1 AND "createdAt" <= $2', [from, toDate]),
      pool.query('SELECT COUNT(*) as n FROM messages WHERE "createdAt" >= $1 AND "createdAt" <= $2', [from, toDate]),
      pool.query('SELECT COUNT(*) as n FROM search_logs WHERE "createdAt" >= $1 AND "createdAt" <= $2', [from, toDate]),
      pool.query('SELECT COUNT(*) as n FROM debates WHERE "createdAt" >= $1 AND "createdAt" <= $2', [from, toDate]),
      pool.query('SELECT COUNT(*) as n FROM comparisons WHERE "createdAt" >= $1 AND "createdAt" <= $2', [from, toDate]),
      pool.query(
        'SELECT COALESCE(SUM("inputTokens"),0) as inp, COALESCE(SUM("outputTokens"),0) as out FROM sessions WHERE "createdAt" >= $1 AND "createdAt" <= $2',
        [from, toDate]
      ),
    ]);

    // pg returns COUNT/SUM as strings — convert to numbers
    const projects         = Number(projectsRes.rows[0].n);
    const archivedProjects = Number(archivedProjectsRes.rows[0].n);
    const sessions    = Number(sessionsRes.rows[0].n);
    const messages    = Number(messagesRes.rows[0].n);
    const searches    = Number(searchesRes.rows[0].n);
    const debates     = Number(debatesRes.rows[0].n);
    const comparisons = Number(comparisonsRes.rows[0].n);
    const inputTokens  = Number(tokensRes.rows[0].inp);
    const outputTokens = Number(tokensRes.rows[0].out);

    res.json({ projects, archivedProjects, sessions, messages, searches, debates, comparisons, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
