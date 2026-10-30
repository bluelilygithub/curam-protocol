'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { FEATURE_ACCESS_KEYS, flagsFromSettingRows, applyUserOverrides } = require('../config/featureAccess');
const sentryStats = require('../services/sentryStats');
const { cleanLanding, getWorkspaceLanding, setWorkspaceLanding } = require('../utils/landing');
const SALT_ROUNDS = 12;

const DEFAULT_SHOP_GMAIL_QUERY = 'from:(delivery@amazon.com.au OR auto-confirm@amazon.com OR shipment-tracking@amazon.com OR *shopify.com OR *shop.app) (shipped OR delivered OR "tracking number" OR "order confirmation" OR "your order" OR "dispatch" OR "out for delivery")';

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

// GET /api/admin/sentry-overview — unresolved issues + 24h event count, or
// { enabled: false } until SENTRY_AUTH_TOKEN is set on Railway.
router.get('/sentry-overview', async (_req, res) => {
  if (!sentryStats.enabled()) {
    return res.json({ enabled: false, projectUrl: `https://${sentryStats.SENTRY_ORG}.sentry.io/projects/${sentryStats.SENTRY_PROJECT}/` });
  }
  try {
    const overview = await sentryStats.getOverview();
    res.json({ enabled: true, ...overview });
  } catch (err) {
    res.status(502).json({
      enabled: true,
      error: err.message,
      projectUrl: `https://${sentryStats.SENTRY_ORG}.sentry.io/projects/${sentryStats.SENTRY_PROJECT}/`,
    });
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
        u."lastLoginAt",
        u."lastActiveAt",
        u."landingPath",
        (u."accountantOfUserId" IS NOT NULL) AS "isAccountant",
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
    const { rows: targetRows } = await pool.query('SELECT id, "isAdmin", "accountantOfUserId" FROM users WHERE id=$1', [userId]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.accountantOfUserId) return res.status(400).json({ error: 'Accountant logins cannot be made admin' });
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

// GET /api/admin/users/:id/feature-access — workspace defaults + this user's overrides.
router.get('/users/:id/feature-access', async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });

  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, "isAdmin", "featureOverrides" FROM users WHERE id=$1', [userId]
    );
    const target = userRows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { rows } = await pool.query(
      "SELECT key, value FROM workspace_settings WHERE key LIKE 'feature_%'"
    );
    const workspaceFlags = flagsFromSettingRows(rows);
    const overrides = target.featureOverrides || {};
    const effectiveFlags = applyUserOverrides(workspaceFlags, overrides);

    res.json({ workspaceFlags, overrides, effectiveFlags, isAdmin: target.isAdmin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/feature-access — body: { overrides: { finance: false, ... } }
// Overrides can only turn a workspace-enabled feature OFF for this user, never turn one on.
router.post('/users/:id/feature-access', async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  const overrides = req.body?.overrides;
  if (!overrides || typeof overrides !== 'object') return res.status(400).json({ error: 'overrides object required' });

  const cleaned = {};
  for (const key of FEATURE_ACCESS_KEYS) {
    if (overrides[key] === false) cleaned[key] = false;
  }

  try {
    const { rows } = await pool.query(
      'UPDATE users SET "featureOverrides"=$1 WHERE id=$2 RETURNING id, "featureOverrides"',
      [Object.keys(cleaned).length ? JSON.stringify(cleaned) : null, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, overrides: rows[0].featureOverrides || {} });
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

// ── Landing page: where Vault opens (in-app path or https link) ──────────────
// GET /api/admin/landing -> { workspaceDefault }
router.get('/landing', async (_req, res) => {
  try {
    res.json({ workspaceDefault: await getWorkspaceLanding() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/landing { path }  (empty = none) -- default for every member without their own
router.put('/landing', async (req, res) => {
  const v = cleanLanding(req.body?.path);
  if (v === null) return res.status(400).json({ error: 'Use an app path such as /finance, or a full https:// link' });
  try {
    await setWorkspaceLanding(v);
    res.json({ ok: true, workspaceDefault: v });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/landing { path }  (empty = use the workspace default)
router.put('/users/:id/landing', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid user id' });
  const v = cleanLanding(req.body?.path);
  if (v === null) return res.status(400).json({ error: 'Use an app path such as /finance, or a full https:// link' });
  try {
    const r = await pool.query('UPDATE users SET "landingPath"=$1 WHERE id=$2 RETURNING id', [v || null, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Accountant logins ─────────────────────────────────────────────────────────
// Read-only, Finance-only view of the calling admin's own data; every request is written to
// accountant_access_log (append-only). See server/services/accountantAccess.js.

// GET /api/admin/accountants
router.get('/accountants', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u."createdAt", u."lastLoginAt", u."lastActiveAt", u."accessExpiresAt", u."disabledAt",
             COALESCE((u."featureOverrides"->>'shares') = 'true', FALSE) AS "sharesAccess",
             COUNT(s.token) FILTER (WHERE s."expiresAt" > NOW())::INT AS "activeSessions"
      FROM users u
      LEFT JOIN auth_sessions s ON s."userId" = u.id
      WHERE u."accountantOfUserId" = $1
      GROUP BY u.id
      ORDER BY u."createdAt" ASC`, [req.user.id]);
    res.json({ accountants: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/accountants { email, password, expiresAt? }
router.post('/accountants', async (req, res) => {
  const { email, password, expiresAt, shares } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) return res.status(400).json({ error: 'email and password required' });
  if (String(password).length < 12) return res.status(400).json({ error: 'Accountant password must be at least 12 characters' });
  let expires = null;
  if (expiresAt) {
    expires = new Date(expiresAt);
    if (Number.isNaN(expires.getTime()) || expires < new Date()) return res.status(400).json({ error: 'Expiry must be a future date' });
  }
  // Belt and braces: everything except Finance is also switched off in the feature flags.
  const overrides = {};
  for (const k of FEATURE_ACCESS_KEYS) if (k !== 'finance') overrides[k] = false;
  // Shares (the owner's private trading account) is opt-in: read-only, see accountantAccess.js.
  if (shares === true) overrides.shares = true;
  try {
    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO users (email, "passwordHash", "isAdmin", "featureOverrides", "accountantOfUserId", "accessExpiresAt")
       VALUES ($1, $2, FALSE, $3, $4, $5) RETURNING id, email, "accessExpiresAt", "createdAt"`,
      [normalizedEmail, passwordHash, JSON.stringify(overrides), req.user.id, expires]
    );
    res.status(201).json({ accountant: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/accountants/:id { expiresAt?: iso|null, disabled?: boolean, shares?: boolean }
router.put('/accountants/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const body = req.body || {};
  try {
    const { rows: found } = await pool.query(
      'SELECT id FROM users WHERE id=$1 AND "accountantOfUserId"=$2', [id, req.user.id]);
    if (!found[0]) return res.status(404).json({ error: 'Accountant not found' });
    if ('expiresAt' in body) {
      const d = body.expiresAt ? new Date(body.expiresAt) : null;
      if (body.expiresAt && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid expiry' });
      await pool.query('UPDATE users SET "accessExpiresAt"=$1 WHERE id=$2', [d, id]);
    }
    if ('shares' in body) {
      await pool.query(
        `UPDATE users SET "featureOverrides" = jsonb_set(COALESCE("featureOverrides", '{}'::jsonb), '{shares}', $1::jsonb) WHERE id=$2`,
        [body.shares === true ? 'true' : 'false', id]
      );
    }
    if ('disabled' in body) {
      await pool.query('UPDATE users SET "disabledAt"=$1 WHERE id=$2', [body.disabled ? new Date() : null, id]);
      if (body.disabled) await pool.query('DELETE FROM auth_sessions WHERE "userId"=$1', [id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/accountants/log?limit=200&actorId=&kind=
router.get('/accountants/log', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const params = [req.user.id];
  let where = '"ownerId" = $1';
  if (req.query.actorId) { params.push(Number(req.query.actorId)); where += ` AND "actorId" = $${params.length}`; }
  if (['login', 'view', 'export', 'denied'].includes(req.query.kind)) { params.push(req.query.kind); where += ` AND kind = $${params.length}`; }
  params.push(limit);
  try {
    const { rows } = await pool.query(
      `SELECT id, "actorId", "actorEmail", kind, method, path, query, status, ip, "userAgent", "createdAt"
       FROM accountant_access_log WHERE ${where} ORDER BY "createdAt" DESC, id DESC LIMIT $${params.length}`, params);
    res.json({ log: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/gmail-routing
router.get('/gmail-routing', async (req, res) => {
  try {
    let result = await pool.query('SELECT * FROM gmail_routing_rules WHERE "ruleType" = $1', ['shop']);
    if (result.rows.length === 0) {
      result = await pool.query(
        `INSERT INTO gmail_routing_rules ("ruleType", label, query, enabled)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT ("ruleType") DO UPDATE SET "updatedAt" = NOW()
         RETURNING *`,
        ['shop', 'Deliveries/ToProcess', DEFAULT_SHOP_GMAIL_QUERY]
      );
    }
    const rule = result.rows[0];
    res.json({
      ruleType: rule.ruleType,
      label: rule.label,
      query: rule.query || '',
      enabled: !!rule.enabled,
      updatedAt: rule.updatedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/gmail-routing
router.put('/gmail-routing', async (req, res) => {
  const { label, query, enabled } = req.body || {};
  const nextLabel = typeof label === 'string' && label.trim() ? label.trim() : 'Deliveries/ToProcess';
  const nextQuery = typeof query === 'string' ? query : DEFAULT_SHOP_GMAIL_QUERY;
  const nextEnabled = typeof enabled === 'boolean' ? enabled : true;

  try {
    const result = await pool.query(
      `INSERT INTO gmail_routing_rules ("ruleType", label, query, enabled, "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT ("ruleType") DO UPDATE SET
         label = EXCLUDED.label,
         query = EXCLUDED.query,
         enabled = EXCLUDED.enabled,
         "updatedAt" = NOW()
       RETURNING *`,
      ['shop', nextLabel, nextQuery, nextEnabled]
    );
    const rule = result.rows[0];
    res.json({
      ruleType: rule.ruleType,
      label: rule.label,
      query: rule.query || '',
      enabled: !!rule.enabled,
      updatedAt: rule.updatedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
