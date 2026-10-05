'use strict';

// POST /api/geocode  { q: "<suburb, town or postcode>" }  (mounted behind auth and the gardenPlanner flag in server/index.js)
// POST with the text in the body, never a GET with it in the URL: URLs end up in proxy access logs and in error / performance traces,
// and what someone looks up is theirs. Nothing in this route logs the query.
// The only way the planner looks places up. See services/geocode.js for how it follows Nominatim's usage policy.
const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const { createGeocoder, pgStore, GeocodeError } = require('../services/geocode');

const PER_USER_PER_MINUTE = 10; // a person searching, not a script; the shared queue enforces the 1/s upstream limit on top

function createRouter(geocoder, { perMinute = PER_USER_PER_MINUTE, now = Date.now } = {}) {
  const router = express.Router();
  const recent = new Map(); // userId -> timestamps of this minute's lookups

  router.post('/', async (req, res) => {
    const t = now();
    const mine = (recent.get(req.user.id) ?? []).filter((x) => t - x < 60000);
    if (mine.length >= perMinute) {
      res.set('Retry-After', '30');
      return res.status(429).json({ error: 'That is a lot of lookups. Wait a moment, or pick a place from the list.' });
    }
    mine.push(t);
    recent.set(req.user.id, mine);
    try {
      const r = await geocoder.search(req.body?.q);
      res.set('Cache-Control', 'no-store');
      res.json({ results: r.results, attribution: r.attribution, cached: r.cached });
    } catch (err) {
      if (err instanceof GeocodeError) {
        const status = err.code === 'invalid' ? 400 : err.code === 'busy' ? 429 : 502;
        return res.status(status).json({ error: err.message });
      }
      getLogger().error({ err }, 'geocode failed');
      res.status(500).json({ error: 'The place lookup failed.' });
    }
  });

  return router;
}

module.exports = { createRouter, PER_USER_PER_MINUTE };
