'use strict';

// Satellite map tiles for Garden Planner, from MapTiler (satellite-v2). Vault fetches them for the signed-in user so the MapTiler key stays
// on the server (MAPTILER_API_KEY) and never reaches the browser, a URL the browser can see, a log or an error report.
//   GET /api/map-tiles/status       { enabled, attribution, maxZoom }
//   GET /api/map-tiles/:z/:x/:y     the tile (image/jpeg), only for a valid tile address; never stored here
// Mounted behind auth and the gardenPlanner flag. Tiles are passed straight through: nothing is cached on disk or in the database (the
// provider's terms limit that), the browser may keep them for a day. Per-user limit so a script cannot run up the bill.
const express = require('express');
const { getLogger } = require('../middleware/requestContext');

const TILE_URL = 'https://api.maptiler.com/tiles/satellite-v2';
const MAX_ZOOM = 20;
const PER_USER_PER_MINUTE = 900; // a busy pan or zoom loads a few dozen tiles at a time
const TIMEOUT_MS = 10000;
const FALLBACK_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors';

function createRouter({ env = process.env, fetchFn = (...a) => fetch(...a), now = Date.now, perMinute = PER_USER_PER_MINUTE } = {}) {
  const router = express.Router();
  const recent = new Map();
  let info = null; // { attribution, maxZoom, at }
  let warnedKey = 0;
  const key = () => env.MAPTILER_API_KEY || '';

  async function tileJson() {
    if (info && now() - info.at < 24 * 3600 * 1000) return info;
    try {
      const res = await fetchFn(`${TILE_URL}/tiles.json?key=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const j = await res.json();
        // the provider's own attribution text, as plain text (it arrives as HTML links)
        const text = String(j.attribution ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        info = { attribution: text || FALLBACK_ATTRIBUTION, maxZoom: Math.min(MAX_ZOOM, Number(j.maxzoom) || MAX_ZOOM), at: now() };
        return info;
      }
    } catch { /* fall back below */ }
    return { attribution: FALLBACK_ATTRIBUTION, maxZoom: MAX_ZOOM, at: now() };
  }

  router.get('/status', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!key()) return res.json({ enabled: false, attribution: FALLBACK_ATTRIBUTION, maxZoom: MAX_ZOOM });
    const i = await tileJson();
    res.json({ enabled: true, attribution: i.attribution, maxZoom: i.maxZoom });
  });

  router.get('/:z/:x/:y', async (req, res) => {
    if (!key()) return res.status(503).json({ error: 'The satellite map is not set up on this server (MAPTILER_API_KEY).' });
    const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y.replace(/\.jpg$/, ''));
    const ok = /^\d{1,2}$/.test(req.params.z) && /^\d{1,7}$/.test(req.params.x) && /^\d{1,7}(\.jpg)?$/.test(req.params.y);
    if (!ok || z < 0 || z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return res.status(400).json({ error: 'That is not a map tile.' });
    const t = now();
    const mine = (recent.get(req.user.id) ?? []).filter((v) => t - v < 60000);
    if (mine.length >= perMinute) { res.set('Retry-After', '20'); return res.status(429).json({ error: 'Too many map tiles. Wait a moment.' }); }
    mine.push(t);
    recent.set(req.user.id, mine);
    let up;
    try {
      up = await fetchFn(`${TILE_URL}/${z}/${x}/${y}.jpg?key=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return res.status(502).json({ error: 'The map provider could not be reached.' });
    }
    if (up.status === 404) return res.status(404).json({ error: 'No imagery for that tile.' });
    if (!up.ok) {
      // a rejected key is the server owner's problem, not the user's: log it (never the URL, which carries the key), once a minute
      if ((up.status === 401 || up.status === 403) && t - warnedKey > 60000) { warnedKey = t; getLogger().error({ status: up.status }, 'MapTiler rejected the key or the plan limit is used up'); }
      return res.status(502).json({ error: 'The map provider refused the request.' });
    }
    const bytes = Buffer.from(await up.arrayBuffer());
    res.set({ 'Content-Type': up.headers?.get?.('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'Content-Length': String(bytes.length) });
    res.end(bytes);
  });

  return router;
}

module.exports = { createRouter, TILE_URL, MAX_ZOOM };
