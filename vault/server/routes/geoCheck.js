'use strict';

// Geo-check (docs/geo-check.md): runs (background jobs, services/geoCheck/jobs.js), the person's country list, the pictures, and an
// admin-only try that captures one page from one country without saving. Mounted behind requireFeature('restyle') and
// requireFeature('geoCheck'). Every query is the caller's own. Logs never carry the proxy username or password, the page address or page text.

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { normaliseHttpUrl, checkSsrf } = require('../services/htmlFetch');
const { getLogger } = require('../middleware/requestContext');
const { renderAvailable } = require('../services/restyle/renderPage');
const proxy = require('../services/geoCheck/proxy');
const { countryOf, DEFAULT_COUNTRIES } = require('../services/geoCheck/countries');
const { COUNTRIES } = require('../services/geoCheck/countries');
const { captureOne } = require('../services/geoCheck/capture');
const { createGeoJobs, MAX_CAPTURES } = require('../services/geoCheck/jobs');

const SETTINGS_KEY = 'geo_check_countries';


const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// POST /api/geo-check/try  { url, country = 'AU', width = 1280, height = 900, mobile = false, allowMedia = false }
function createRouter({ jobs = createGeoJobs(), pool = require('../db').pool, moveToBin = require('../services/recycleBin').moveToBin } = {}) {
  require('../services/recycleBin').loadAdapters(); // moveToBin refuses a type whose adapter is not loaded
  const router = express.Router();
  let busy = false; // one try at a time server-wide

  const fail = (res, err, where) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err: { name: err && err.name, message: err && err.message } }, `[geo-check${where}]`);
    return res.status(500).json({ error: 'Something went wrong.' });
  };

  async function savedCountries(userId) {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId" = $1 AND key = $2`, [userId, SETTINGS_KEY]);
    try { const list = JSON.parse(rows[0].value); if (Array.isArray(list) && list.length) return list; } catch { /* none saved */ }
    return DEFAULT_COUNTRIES;
  }

  // GET /api/geo-check/config: is it set up, the person's countries, the supported list, limits and the estimate inputs. No credentials.
  router.get('/config', async (req, res) => {
    try {
      const countries = await savedCountries(req.user.id);
      const est = await jobs.estimate(req.user.id, 1);
      res.json({
        configured: proxy.isConfigured(), browser: renderAvailable(), countries, defaults: DEFAULT_COUNTRIES,
        catalogue: COUNTRIES.map(({ code, name }) => ({ code, name })),
        maxCaptures: MAX_CAPTURES, bytesPerCountry: est.perCountry, maxBytes: est.maxBytes, costPerGb: proxy.costPerGb(),
        ...(req.user.isAdmin ? { proxy: proxy.describe() } : {}),
      });
    } catch (err) { fail(res, err, '/config'); }
  });

  // PUT /api/geo-check/countries { countries: ['AU', ...] }: save the person's list
  router.put('/countries', async (req, res) => {
    try {
      const list = require('../services/geoCheck/jobs').cleanCountries(req.body && req.body.countries);
      await pool.query(`INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [req.user.id, SETTINGS_KEY, JSON.stringify(list)]);
      res.json({ countries: list });
    } catch (err) { fail(res, err, '/countries'); }
  });

  router.get('/runs', async (req, res) => {
    try { res.json({ runs: await jobs.list(req.user.id) }); } catch (err) { fail(res, err, '/runs'); }
  });

  // POST /api/geo-check/runs { url, label?, countries: [], screens: [{ id, label, width, height, mobile }], allowMedia? } -> { id }
  router.post('/runs', async (req, res) => {
    const body = req.body || {};
    let url;
    try {
      url = normaliseHttpUrl(body.url);
      await checkSsrf(new URL(url).hostname);
    } catch {
      return res.status(400).json({ error: 'Enter a public web address (http or https).' });
    }
    if (!renderAvailable()) return res.status(503).json({ error: 'The headless browser is not installed on this server.' });
    try {
      const id = await jobs.start(req.user.id, { url, label: body.label, countries: body.countries, screens: body.screens, allowMedia: body.allowMedia === true });
      getLogger().info({ geoCheck: { runId: id, host: new URL(url).hostname } }, '[geo-check/runs] started');
      res.status(202).json({ id });
    } catch (err) { fail(res, err, '/runs'); }
  });

  router.get('/runs/:id', async (req, res) => {
    try { res.json(await jobs.get(req.user.id, Number(req.params.id) || 0)); } catch (err) { fail(res, err, '/runs/:id'); }
  });

  router.post('/runs/:id/stop', async (req, res) => {
    try { res.json({ stopped: await jobs.stop(req.user.id, Number(req.params.id) || 0) }); } catch (err) { fail(res, err, '/runs/:id/stop'); }
  });

  router.get('/runs/:id/captures/:captureId/image', async (req, res) => {
    try {
      const file = await jobs.imagePath(req.user.id, Number(req.params.id) || 0, Number(req.params.captureId) || 0);
      res.set('Cache-Control', 'private, max-age=86400');
      res.type('jpeg').sendFile(file, (e) => { if (e && !res.headersSent) res.status(404).json({ error: 'Picture not found.' }); });
    } catch (err) { fail(res, err, '/image'); }
  });

  router.delete('/runs/:id', async (req, res) => {
    try { res.json({ binId: await jobs.remove(req.user.id, Number(req.params.id) || 0, { moveToBin }) }); } catch (err) { fail(res, err, '/runs/:id delete'); }
  });

  router.post('/try', requireAdmin, async (req, res) => {
    const body = req.body || {};
    if (!proxy.isConfigured()) return res.status(503).json({ error: 'Geo-check is not set up: add GEO_PROXY_SERVER, GEO_PROXY_USERNAME_TEMPLATE and GEO_PROXY_PASSWORD on Railway.' });
    if (!renderAvailable()) return res.status(503).json({ error: 'The headless browser is not installed on this server.' });
    const country = countryOf(body.country || DEFAULT_COUNTRIES[0]);
    if (!country) return res.status(400).json({ error: 'That country is not in the list.' });
    let url;
    try {
      url = normaliseHttpUrl(body.url);
      await checkSsrf(new URL(url).hostname);
    } catch {
      return res.status(400).json({ error: 'Enter a public web address (http or https).' });
    }
    if (busy) return res.status(429).json({ error: 'A country check is already running. Try again in a minute.' });
    busy = true;
    const started = Date.now();
    try {
      const screen = { width: clampInt(body.width, 320, 2560, 1280), height: clampInt(body.height, 480, 1600, 900), mobile: body.mobile === true };
      const out = await captureOne({ url, country: country.code, screen, allowMedia: body.allowMedia === true });
      getLogger().info({
        geoCheck: { country: out.country, status: out.status, exitCountry: out.exitCountry, verified: out.verified, bytes: out.bytes,
          ms: Date.now() - started, host: new URL(url).hostname, proxy: proxy.describe() },
      }, '[geo-check/try]');
      const costPerGb = proxy.costPerGb();
      res.json({
        ...out,
        image: out.image ? `data:image/jpeg;base64,${out.image.toString('base64')}` : null,
        imageBytes: out.image ? out.image.length : 0,
        costAud: costPerGb ? Math.round((out.bytes / 1e9) * costPerGb * 10000) / 10000 : null,
        ms: Date.now() - started,
      });
    } catch (err) {
      getLogger().error({ err: { name: err && err.name } }, '[geo-check/try]');
      res.status(500).json({ error: String(err && err.message).startsWith('Geo-check') || String(err && err.message).startsWith('That country') ? err.message : 'The capture failed.' });
    } finally {
      busy = false;
    }
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
