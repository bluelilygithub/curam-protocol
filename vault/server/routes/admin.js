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

// GET /api/admin/monitor — session monitor: recent sessions + today's cache summary
router.get('/monitor', async (req, res) => {
  const userId = req.user.id;
  try {
    const [summaryRes, sessionsRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(DISTINCT session_id)::INT               AS sessions_today,
          COALESCE(SUM(input_tokens)::INT, 0)           AS input_tokens,
          COALESCE(SUM(output_tokens)::INT, 0)          AS output_tokens,
          COALESCE(SUM(cache_read_tokens)::INT, 0)      AS cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens)::INT, 0)  AS cache_creation_tokens,
          COALESCE(SUM(estimated_cost_usd)::FLOAT, 0)   AS cost_today
        FROM usage_logs
        WHERE user_id = $1
          AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Australia/Sydney') AT TIME ZONE 'Australia/Sydney'
      `, [userId]),
      pool.query(`
        SELECT
          s."sessionId",
          s.title,
          s."updatedAt",
          s."inputTokens",
          s."outputTokens",
          p.name AS "projectName",
          COUNT(DISTINCT m.id)::INT                         AS "messageCount",
          COALESCE(SUM(ul.estimated_cost_usd)::FLOAT, 0)   AS cost,
          COALESCE(SUM(ul.cache_read_tokens)::INT, 0)       AS "cacheReadTokens",
          COALESCE(SUM(ul.cache_creation_tokens)::INT, 0)   AS "cacheCreationTokens",
          array_agg(DISTINCT ul.model_id) FILTER (WHERE ul.model_id IS NOT NULL) AS models
        FROM sessions s
        LEFT JOIN projects p ON p.id = s."projectId"
        LEFT JOIN messages m ON m."sessionId" = s."sessionId"
        LEFT JOIN usage_logs ul ON ul.session_id = s."sessionId" AND ul.user_id = $1
        WHERE s."userId" = $1
        GROUP BY s."sessionId", s.title, s."updatedAt", s."inputTokens", s."outputTokens", p.name
        ORDER BY s."updatedAt" DESC
        LIMIT 25
      `, [userId]),
    ]);

    const raw = summaryRes.rows[0];
    const totalInput = (raw.input_tokens || 0) + (raw.cache_read_tokens || 0) + (raw.cache_creation_tokens || 0);
    const cacheHitPct = totalInput > 0
      ? Math.round((raw.cache_read_tokens / totalInput) * 100)
      : 0;

    res.json({
      summary: {
        sessionsToday:       raw.sessions_today || 0,
        inputTokensToday:    raw.input_tokens || 0,
        outputTokensToday:   raw.output_tokens || 0,
        cacheReadTokens:     raw.cache_read_tokens || 0,
        cacheCreationTokens: raw.cache_creation_tokens || 0,
        cacheHitPct,
        costToday:           raw.cost_today || 0,
      },
      sessions: sessionsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
