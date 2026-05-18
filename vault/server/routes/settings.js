'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { FEATURE_ACCESS_DEFAULTS, FEATURE_ACCESS_KEYS } = require('../config/featureAccess');
const { getVaultModelsConfigForUser } = require('../services/modelResolver');

// GET /api/settings/effective-models — vault_models + default_model (user or admin fallback)
router.get('/effective-models', async (req, res) => {
  try {
    const config = await getVaultModelsConfigForUser(req.user.id);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// GET /api/settings/workspace-timezone — returns the workspace IANA timezone
router.get('/workspace-timezone', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM workspace_settings WHERE key='workspace_timezone' LIMIT 1`
    );
    res.json({ timezone: rows[0]?.value?.trim() || 'Australia/Sydney' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/workspace-timezone — admin only; body: { timezone: 'Australia/Sydney' }
router.post('/workspace-timezone', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const { timezone } = req.body || {};
  // Basic IANA format validation: letters, digits, underscore, forward-slash, plus, minus
  if (!timezone || typeof timezone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-\/]+$/.test(timezone.trim())) {
    return res.status(400).json({ error: 'Invalid IANA timezone string' });
  }
  try {
    // Verify the timezone is actually valid before storing
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone.trim() }).format(new Date());
    await pool.query(
      `INSERT INTO workspace_settings (key, value, "updatedAt")
       VALUES ('workspace_timezone', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, "updatedAt"=NOW()`,
      [timezone.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.message?.includes('Invalid time zone')) {
      return res.status(400).json({ error: `Unknown timezone: ${timezone}` });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
