'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { FEATURE_ACCESS_DEFAULTS, FEATURE_ACCESS_KEYS } = require('../config/featureAccess');
const { getVaultModelsConfigForUser } = require('../services/modelResolver');
const { getPublicRuntimeConfig } = require('../config/runtime');
const {
  DEFAULT_WELLBEING_INVITE_SUBJECT,
  DEFAULT_WELLBEING_INVITE_BODY,
} = require('../services/wellbeingInviteTemplate');

const CONTENT_RESTRICTIONS_KEY = 'graphics_content_restrictions';
const WELLBEING_INVITE_SUBJECT_KEY = 'wellbeing_invite_subject';
const WELLBEING_INVITE_BODY_KEY = 'wellbeing_invite_body';
const MOBILE_SETTING_KEYS = ['mobile_dashboard_tiles', 'mobile_nav_items'];

function normalizeContentRestrictions(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 200))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

// GET /api/settings/effective-models — vault_models + default_model (user or admin fallback)
router.get('/effective-models', async (req, res) => {
  try {
    const config = await getVaultModelsConfigForUser(req.user.id);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/runtime — environment-derived runtime status for admins.
router.get('/runtime', (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  res.json(getPublicRuntimeConfig());
});

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings WHERE "userId"=$1', [req.user.id]);
    const result = {};
    rows.forEach((r) => { result[r.key] = r.value; });

    const resolved = await getVaultModelsConfigForUser(req.user.id);
    if (resolved.models.length > 0) {
      if (!result.vault_models) {
        result.vault_models = JSON.stringify(resolved.models);
      }
      if (!result.default_model && resolved.defaultModel) {
        result.default_model = resolved.defaultModel;
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings  — body: { key, value }
// Set value to '' or null to delete the key
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    if (value === null || value === undefined || value === '') {
      await pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [req.user.id, key]);
    } else {
      await pool.query(
        'INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value',
        [req.user.id, key, String(value)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/feature-access
router.get('/feature-access', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM workspace_settings WHERE key LIKE 'feature_%'"
    );
    const flags = { ...FEATURE_ACCESS_DEFAULTS };
    rows.forEach((r) => {
      const featureKey = String(r.key || '').replace(/^feature_/, '');
      if (!FEATURE_ACCESS_KEYS.includes(featureKey)) return;
      const rawValue = String(r.value || '').trim().toLowerCase();
      flags[featureKey] = rawValue !== 'false' && rawValue !== '0' && rawValue !== 'off';
    });
    res.json({ flags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/feature-access  — body: { flags: { finance: true, ... } }
router.post('/feature-access', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const flags = req.body?.flags;
  if (!flags || typeof flags !== 'object') return res.status(400).json({ error: 'flags object required' });

  try {
    for (const key of FEATURE_ACCESS_KEYS) {
      if (typeof flags[key] !== 'boolean') continue;
      await pool.query(
        `INSERT INTO workspace_settings (key, value, "updatedAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
        [`feature_${key}`, flags[key] ? 'true' : 'false']
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/mobile — workspace mobile visibility config for all users.
router.get('/mobile', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT key, value FROM workspace_settings WHERE key = ANY($1)',
      [MOBILE_SETTING_KEYS]
    );
    const result = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    // Backwards-compatible fallback for configs saved before mobile became workspace-wide.
    if (!result.mobile_dashboard_tiles || !result.mobile_nav_items) {
      const { rows: userRows } = await pool.query(
        'SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)',
        [req.user.id, MOBILE_SETTING_KEYS]
      );
      userRows.forEach((r) => {
        if (!result[r.key]) result[r.key] = r.value;
      });
    }

    res.json({
      mobile_dashboard_tiles: result.mobile_dashboard_tiles || null,
      mobile_nav_items: result.mobile_nav_items || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/mobile — admin workspace mobile visibility config.
router.post('/mobile', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  try {
    const updates = {
      mobile_dashboard_tiles: req.body?.mobile_dashboard_tiles,
      mobile_nav_items: req.body?.mobile_nav_items,
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      const storedValue = typeof value === 'string' ? value : JSON.stringify(value);
      await pool.query(
        `INSERT INTO workspace_settings (key, value, "updatedAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
        [key, storedValue]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/content-restrictions — workspace graphics safety rules
router.get('/content-restrictions', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  try {
    const { rows } = await pool.query(
      'SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1',
      [CONTENT_RESTRICTIONS_KEY]
    );
    let restrictions = [];
    if (rows[0]?.value) {
      try {
        restrictions = normalizeContentRestrictions(JSON.parse(rows[0].value));
      } catch {
        restrictions = [];
      }
    }
    res.json({ restrictions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/content-restrictions — body: { restrictions: string[] }
router.post('/content-restrictions', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const restrictions = normalizeContentRestrictions(req.body?.restrictions);
  try {
    await pool.query(
      `INSERT INTO workspace_settings (key, value, "updatedAt")
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
      [CONTENT_RESTRICTIONS_KEY, JSON.stringify(restrictions)]
    );
    res.json({ ok: true, restrictions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/wellbeing-invite-template — admin template for wellbeing invites
router.get('/wellbeing-invite-template', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  try {
    const { rows } = await pool.query(
      'SELECT key, value FROM workspace_settings WHERE key = ANY($1)',
      [[WELLBEING_INVITE_SUBJECT_KEY, WELLBEING_INVITE_BODY_KEY]]
    );
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    res.json({
      subject: values[WELLBEING_INVITE_SUBJECT_KEY] || DEFAULT_WELLBEING_INVITE_SUBJECT,
      body: values[WELLBEING_INVITE_BODY_KEY] || DEFAULT_WELLBEING_INVITE_BODY,
      placeholders: ['{{link}}', '{{email}}', '{{password}}'],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/wellbeing-invite-template — body: { subject, body }
router.post('/wellbeing-invite-template', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const subject = String(req.body?.subject || '').trim().slice(0, 180) || DEFAULT_WELLBEING_INVITE_SUBJECT;
  const body = String(req.body?.body || '').trim().slice(0, 12000) || DEFAULT_WELLBEING_INVITE_BODY;
  try {
    for (const [key, value] of [
      [WELLBEING_INVITE_SUBJECT_KEY, subject],
      [WELLBEING_INVITE_BODY_KEY, body],
    ]) {
      await pool.query(
        `INSERT INTO workspace_settings (key, value, "updatedAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
        [key, value]
      );
    }
    res.json({ ok: true, subject, body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/workspace-timezone — returns the admin user's timezone (system default)
router.get('/workspace-timezone', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    res.json({ timezone: rows[0]?.value?.trim() || 'Australia/Sydney' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
