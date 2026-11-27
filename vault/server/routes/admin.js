'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getLogger } = require('../middleware/requestContext');
const { pool } = require('../db');
const { FEATURE_ACCESS_KEYS, flagsFromSettingRows, applyUserOverrides } = require('../config/featureAccess');
const sentryStats = require('../services/sentryStats');
const { cleanLanding, getWorkspaceLanding, setWorkspaceLanding } = require('../utils/landing');
const SALT_ROUNDS = 12;

async function getAdminCount(client = pool) {
  const { rows } = await client.query('SELECT COUNT(*)::INT AS n FROM users WHERE "isAdmin" = TRUE');
  return Number(rows[0]?.n || 0);
}

// GET /api/admin/auth-health: does two-step login work on this server? ok/not-ok and a plain reason, never the key (docs/two-step-login.md)
router.get('/auth-health', (_req, res) => {
  const problem = require('../services/loginChallenge').authKeyProblem();
  res.json({ ok: !problem, problem });
});

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

// GET /api/admin/app-usage?days=90 — per section: visits, people, days with a visit, last day. Sections never opened are absent (the page lists them from the menu).
router.get('/app-usage', async (req, res) => {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 90));
  try {
    const { rows } = await pool.query(
      `SELECT key, SUM(visits)::int AS visits, COUNT(DISTINCT "userId")::int AS people, COUNT(DISTINCT day)::int AS days, MAX(day)::text AS "lastDay"
         FROM app_visits WHERE day >= CURRENT_DATE - $1::int GROUP BY key ORDER BY visits DESC`,
      [days]
    );
    res.json({ days, items: rows });
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

// New accounts and password resets are done by email: the person is sent a single-use link (7 days) to choose their own password,
// so no admin ever knows it. Until they use it, sign-in answers "Password setup required" (mustChangePassword). If the email can't
// be sent, the admin gets the link back to pass on (or uses Set password). Same pattern as the Wellbeing invite.
const LINK_DAYS = 7;
const EMAIL_APP_URL = 'https://vault.curam-ai.com.au'; // the address in welcome and reset emails (owner's choice, 2026-11-27)
const SEND_TIMEOUT_MS = 15000; // MailChannels' request has no timeout of its own
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Inside the caller's transaction: the password stops working until the person sets one, and a fresh link is stored. */
async function issueSetPasswordLink(client, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS); // unknown to anyone
  await client.query('UPDATE users SET "passwordHash"=$1, "mustChangePassword"=TRUE WHERE id=$2', [unusable, user.id]);
  await client.query('DELETE FROM password_resets WHERE email=$1', [user.email]);
  await client.query(`INSERT INTO password_resets (token, email, "expiresAt") VALUES ($1, $2, NOW() + make_interval(days => $3))`, [token, user.email, LINK_DAYS]);
  return token;
}

/** The welcome or reset email, with everything the person needs to sign in. Throws when it was not sent. */
async function sendSetPasswordEmail({ kind, to, isAdmin, link, appUrl, from }) {
  const sendEmail = require('../utils/sendEmail');
  const welcome = kind === 'welcome';
  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#888;">${k}</td><td style="padding:4px 0;"><strong>${v}</strong></td></tr>`;
  const steps = isAdmin
    ? '<li>The first time, Vault asks you to set up an authenticator app on your phone (such as Google or Microsoft Authenticator): scan the QR code, type the 6-digit code, then save the 10 backup codes somewhere safe.</li><li>After that, each sign-in on a new device asks for the 6-digit code from the app.</li>'
    : '<li>On a device Vault doesn\'t know yet, it emails you a 6-digit code: type it in. Tick "Remember this device" to skip the code on that device for 30 days.</li>';
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
<h2 style="margin-top:0;">${welcome ? 'Welcome to Project Vault' : 'Your Project Vault password was reset'}</h2>
<p>${welcome
    ? `${esc(from)} has made you a Project Vault account${isAdmin ? ' with admin access' : ''}. Here are your details:`
    : `${esc(from)} has reset your Project Vault password and signed you out everywhere. Your old password no longer works. Your details:`}</p>
<table style="border-collapse:collapse;margin:8px 0 20px;">
${row('Vault', `<a href="${esc(appUrl)}">${esc(appUrl)}</a>`)}
${row('Sign in with', esc(to))}
${row('Password', 'you choose it with the button below')}
</table>
<a href="${esc(link)}" style="display:inline-block;background:#CC785C;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${welcome ? 'Set your password' : 'Choose a new password'}</a>
<p style="font-size:13px;color:#555;">The button works once, for ${LINK_DAYS} days. If it has run out, use "Forgot password" on the sign-in page, or ask ${esc(from)}.</p>
<h3 style="margin:24px 0 8px;font-size:15px;">Signing in</h3>
<ol style="padding-left:20px;margin:0;line-height:1.6;">
<li>Go to <a href="${esc(appUrl)}/login">${esc(appUrl)}/login</a> and type your email and password.</li>
${steps}
</ol>
<p style="margin-top:20px;">Questions? Ask ${esc(from)}.</p>
<p style="margin-top:24px;font-size:12px;color:#888;">${welcome ? "If you weren't expecting this, you can ignore this email." : `If you didn't expect this, tell ${esc(from)}.`}</p>
</div></body></html>`;
  const subject = welcome ? 'Welcome to Project Vault: your sign-in details' : 'Your Project Vault password was reset';
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('send timed out')), SEND_TIMEOUT_MS); });
  try {
    const result = await Promise.race([sendEmail({ to, subject, html }), timeout]);
    if (!result || result.ok === false) throw new Error(result?.reason || 'email not sent'); // DISABLE_EMAIL returns { ok: false, skipped: true }
  } finally {
    clearTimeout(timer);
  }
}

/** Send the email; hand the link back to the admin only when it could not be sent. */
async function emailLinkAndAnswer(req, res, { kind, user, token, status, failText }) {
  // People are sent to the Vault's own domain, not whichever address the admin happened to use; local runs keep local links
  const requestUrl = require('../utils/appUrl').getAppUrl(req);
  const appUrl = /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(requestUrl) ? requestUrl : EMAIL_APP_URL;
  const link = `${appUrl}/reset-password?token=${token}`;
  try {
    await sendSetPasswordEmail({ kind, to: user.email, isAdmin: user.isAdmin, link, appUrl, from: req.user.email || 'your administrator' });
    res.status(status).json({ user, emailSent: true });
  } catch (err) {
    getLogger().warn({ userId: user.id, kind, err: err.message }, 'set-password email not sent');
    res.status(status).json({ user, emailSent: false, link, emailError: `${failText} (${err.message}). Send them this link yourself, or use Set password.` });
  }
}

// POST /api/admin/users { email, isAdmin } -> 201 { user, emailSent, link? }: the account, and a welcome email with their details
router.post('/users', async (req, res) => {
  const { email, isAdmin } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'A valid email address is required' });

  let user;
  let token;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (email, "passwordHash", "isAdmin", "mustChangePassword") VALUES ($1, 'x', $2, TRUE) RETURNING id, email, "isAdmin", "createdAt"`,
      [normalizedEmail, !!isAdmin]
    );
    user = rows[0];
    token = await issueSetPasswordLink(client, user); // replaces the placeholder hash at once
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
  await emailLinkAndAnswer(req, res, { kind: 'welcome', user, token, status: 201, failText: 'The account was made, but the welcome email could not be sent' });
});

// POST /api/admin/users/:id/reset-password-email -> { user, emailSent, link? }: their password stops working, every session and
// remembered device goes, and they are emailed a link to choose a new one. Also resends an expired welcome. Not for your own account.
router.post('/users/:id/reset-password-email', async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Use Forgot password on the sign-in page for your own account' });
  let user;
  let token;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, email, "isAdmin" FROM users WHERE id=$1 FOR UPDATE', [userId]);
    user = rows[0];
    if (!user) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    token = await issueSetPasswordLink(client, user);
    await client.query('DELETE FROM auth_sessions WHERE "userId"=$1', [userId]);
    await require('../services/trustedDevices').forgetAllDevices(client, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
  await emailLinkAndAnswer(req, res, { kind: 'reset', user, token, status: 200, failText: 'Their password was reset and they are signed out, but the email could not be sent' });
});

// PUT /api/admin/users/:id/password
router.put('/users/:id/password', async (req, res) => {
  const userId = Number(req.params.id);
  const { password } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const hash = await bcrypt.hash(String(password), SALT_ROUNDS);
    // an admin-chosen password is usable at once, so it also ends a pending "set your password" invite
    const update = await pool.query('UPDATE users SET "passwordHash"=$1, "mustChangePassword"=FALSE WHERE id=$2 RETURNING id', [hash, userId]);
    if (!update.rows[0]) return res.status(404).json({ error: 'User not found' });
    await pool.query('DELETE FROM auth_sessions WHERE "userId"=$1', [userId]);
    await require('../services/trustedDevices').forgetAllDevices(pool, userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/reset-2fa: authenticator, backup codes, remembered devices and every session go (docs/two-step-login.md)
router.post('/users/:id/reset-2fa', async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id=$1', [userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const removed = await require('../services/twoStepReset').resetTwoStep(pool, userId);
    res.json({ ok: true, removed });
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

module.exports = router;
