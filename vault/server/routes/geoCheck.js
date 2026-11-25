'use strict';

// Geo-check (docs/geo-check.md). Milestone 1: one admin-only try that captures one page from one country and returns the picture
// without saving anything, to prove the proxy, the exit check and the browser on Railway. Mounted behind requireFeature('restyle') and
// requireFeature('geoCheck'). Logs never carry the proxy username or password, the page address or page text.

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { normaliseHttpUrl, checkSsrf } = require('../services/htmlFetch');
const { getLogger } = require('../middleware/requestContext');
const { renderAvailable } = require('../services/restyle/renderPage');
const proxy = require('../services/geoCheck/proxy');
const { countryOf, DEFAULT_COUNTRIES } = require('../services/geoCheck/countries');
const { captureOne } = require('../services/geoCheck/capture');

const router = express.Router();
let busy = false; // one try at a time server-wide (milestone 2 brings the proper run slot)

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// POST /api/geo-check/try  { url, country = 'AU', width = 1280, height = 900, mobile = false, allowMedia = false }
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

module.exports = router;
