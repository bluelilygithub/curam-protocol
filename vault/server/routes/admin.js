'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const SALT_ROUNDS = 12;

async function getAdminCount(client = pool) {
  const { rows } = await client.query('SELECT COUNT(*)::INT AS n FROM users WHERE "isAdmin" = TRUE');
  return Number(rows[0]?.n || 0);
}

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
    const [summaryRes, sessionsRes, featuresRes] = await Promise.all([
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
      pool.query(`
        SELECT
          feature,
          model_id                                          AS model,
          COUNT(*)::INT                                     AS runs,
          COALESCE(SUM(input_tokens)::INT, 0)               AS input_tokens,
          COALESCE(SUM(output_tokens)::INT, 0)              AS output_tokens,
          COALESCE(SUM(estimated_cost_usd)::FLOAT, 0)       AS total_cost,
          MAX(created_at)                                   AS last_run
        FROM usage_logs
        WHERE session_id IS NULL
          AND feature IS NOT NULL
        GROUP BY feature, model_id
        ORDER BY total_cost DESC
      `, []),
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
      features: featuresRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.email,
        u."isAdmin",
        u."createdAt",
        MAX(s."createdAt") AS "lastLoginAt",
        COUNT(*) FILTER (WHERE s."expiresAt" > NOW())::INT AS "activeSessions"
      FROM users u
      LEFT JOIN auth_sessions s ON s."userId" = u.id
      GROUP BY u.id
      ORDER BY u."createdAt" ASC
    `);
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users
router.post('/users', async (req, res) => {
  const { email, password, isAdmin } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) return res.status(400).json({ error: 'email and password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const { rows } = await pool.query(
      'INSERT INTO users (email, "passwordHash", "isAdmin") VALUES ($1, $2, $3) RETURNING id, email, "isAdmin", "createdAt"',
      [normalizedEmail, passwordHash, !!isAdmin]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/password
router.put('/users/:id/password', async (req, res) => {
  const userId = Number(req.params.id);
  const { password } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const hash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const update = await pool.query('UPDATE users SET "passwordHash"=$1 WHERE id=$2 RETURNING id', [hash, userId]);
    if (!update.rows[0]) return res.status(404).json({ error: 'User not found' });
    await pool.query('DELETE FROM auth_sessions WHERE "userId"=$1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/admin
router.put('/users/:id/admin', async (req, res) => {
  const userId = Number(req.params.id);
  const makeAdmin = !!req.body?.isAdmin;
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });

  try {
    const { rows: targetRows } = await pool.query('SELECT id, "isAdmin" FROM users WHERE id=$1', [userId]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id && !makeAdmin) return res.status(400).json({ error: 'You cannot remove your own admin access' });

    if (target.isAdmin && !makeAdmin) {
      const adminCount = await getAdminCount();
      if (adminCount <= 1) return res.status(400).json({ error: 'At least one admin is required' });
    }

    const { rows } = await pool.query(
      'UPDATE users SET "isAdmin"=$1 WHERE id=$2 RETURNING id, email, "isAdmin", "createdAt"',
      [makeAdmin, userId]
    );
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: targetRows } = await client.query('SELECT id, email, "isAdmin" FROM users WHERE id=$1', [userId]);
    const target = targetRows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.isAdmin) {
      const adminCount = await getAdminCount(client);
      if (adminCount <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'At least one admin is required' });
      }
    }

    await client.query('DELETE FROM password_resets WHERE email=$1', [target.email]);
    await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
