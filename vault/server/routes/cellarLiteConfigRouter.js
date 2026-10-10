'use strict';

// Cellar Planner LITE settings. Two routers, built here so the test can run them without a database:
//   publicRouter  GET /api/cellar-lite/config  -- no login. The public tool (static files on the business's own website) reads this when it loads.
//                 Read-only, no cookies, so any site may read it (Access-Control-Allow-Origin: *). Prices are only included when "show" is on.
//   adminRouter   /api/admin/cellar-lite/config -- behind requireAdmin where it is mounted (server/index.js). GET (with the defaults), PUT, DELETE.
// Stored as one JSON value in workspace_settings (KEY). Docs: docs/cellar-planner.md ("Settings the owner controls").

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const { KEY, DEFAULTS, validateConfig, publicView } = require('../config/cellarLiteConfig');

const CACHE_MS = 30 * 1000; // the public endpoint is read on every visit to the planner; one database read per 30 s is plenty

function createCellarLiteConfigRouters({ pool, now = () => Date.now() }) {
  let cache = null; // { at, config }

  async function load() {
    const { rows } = await pool.query('SELECT value, "updatedAt" FROM workspace_settings WHERE key=$1 LIMIT 1', [KEY]);
    if (!rows.length) return { config: validateConfig(undefined).config, updatedAt: null, errors: [] };
    let raw = null;
    try { raw = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value; } catch { raw = null; }
    const { config, errors } = validateConfig(raw);
    return { config, updatedAt: rows[0].updatedAt ? new Date(rows[0].updatedAt).toISOString() : null, errors };
  }

  const publicRouter = express.Router();
  publicRouter.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET, HEAD, OPTIONS').end();
    next();
  });
  publicRouter.get('/', async (req, res) => {
    try {
      if (!cache || now() - cache.at > CACHE_MS) cache = { at: now(), config: (await load()).config };
      res.set('Cache-Control', 'public, max-age=60').json(publicView(cache.config));
    } catch (err) {
      // the tool falls back to its built-in defaults when this fails, so a plain 503 is the right answer
      getLogger().error({ err: err.message }, '[cellar-lite] could not read the settings');
      res.status(503).set('Cache-Control', 'no-store').json({ error: 'Settings are not available right now.' });
    }
  });

  const adminRouter = express.Router();
  adminRouter.get('/', async (req, res) => {
    try {
      const { config, updatedAt, errors } = await load();
      res.json({ config, updatedAt, defaults: DEFAULTS, warnings: errors });
    } catch (err) {
      getLogger().error({ err: err.message }, '[cellar-lite] admin read failed');
      res.status(500).json({ error: 'Could not read the settings.' });
    }
  });
  adminRouter.put('/', async (req, res) => {
    try {
      const { config, errors } = validateConfig(req.body?.config);
      if (!req.body || typeof req.body.config !== 'object' || req.body.config === null) return res.status(400).json({ error: 'No settings were sent.', errors: ['No settings were sent.'] });
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      await pool.query(
        `INSERT INTO workspace_settings (key, value, "updatedAt") VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
        [KEY, JSON.stringify(config)],
      );
      cache = null;
      getLogger().info({ userId: req.user?.id }, '[cellar-lite] settings saved');
      res.json({ config, updatedAt: new Date(now()).toISOString() });
    } catch (err) {
      getLogger().error({ err: err.message }, '[cellar-lite] save failed');
      res.status(500).json({ error: 'Could not save the settings.' });
    }
  });
  adminRouter.delete('/', async (req, res) => {
    try {
      await pool.query('DELETE FROM workspace_settings WHERE key=$1', [KEY]);
      cache = null;
      res.json({ config: validateConfig(undefined).config });
    } catch (err) {
      getLogger().error({ err: err.message }, '[cellar-lite] reset failed');
      res.status(500).json({ error: 'Could not reset the settings.' });
    }
  });

  return { publicRouter, adminRouter, load };
}

module.exports = { createCellarLiteConfigRouters };
