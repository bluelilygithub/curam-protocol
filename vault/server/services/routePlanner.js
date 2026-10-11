'use strict';

// Route Tracer "Plan route": the Vault server asks OpenRouteService for walking / hiking / cycling / driving routes between two points,
// so the API key stays on the server. Pure apart from the injected fetch / clock, so routeTracks.test.js runs it with a fake service.
//   - one call = one route plus up to two alternatives (alternatives only work between exactly two points, and under about 100 km)
//   - answers are cached for an hour (same two points within about a metre, same profile) and cache hits cost no quota
//   - per-user limits (a few a minute, a couple of hundred a day) and a global per-minute cap, because the free key is shared by everyone
// Docs: docs/route-tracer.md ("Plan a route").

const geo = require('./routeTracerGeo');

const ORS_BASE = 'https://api.openrouteservice.org';
const PROFILES = { walking: 'foot-walking', hiking: 'foot-hiking', cycling: 'cycling-regular', driving: 'driving-car' };
const ALTERNATIVES_MAX_M = 100000; // OpenRouteService only offers alternatives under about 100 km
const MIN_M = 30;
const MAX_M = 1000000;
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const ATTRIBUTION = '\u00a9 openrouteservice.org | \u00a9 OpenStreetMap contributors';

class PlanError extends Error {
  constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

const validPos = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** Which end a routing error is about, from OpenRouteService's "coordinate 0" / "coordinate 1" wording. */
function whichEnd(message) {
  const m = /coordinate\s+(\d)/i.exec(String(message || ''));
  return m ? (m[1] === '0' ? 'start' : 'end') : null;
}

function parseError(status, json) {
  const e = json && json.error;
  const code = e && typeof e === 'object' ? Number(e.code) : NaN;
  const message = e && typeof e === 'object' ? String(e.message || '') : String(e || '');
  return { status, code, message };
}

function createPlanner({ getKey, fetchFn = globalThis.fetch, now = Date.now, perUserPerMinute = 8, perUserPerDay = 150, globalPerMinute = 30, log = () => {} } = {}) {
  const cache = new Map(); // key -> { at, value }
  const userHits = new Map(); // userId -> timestamps (last 24 h)
  let globalHits = [];

  function limit(userId) {
    const t = now();
    globalHits = globalHits.filter((x) => t - x < 60000);
    const mine = (userHits.get(userId) || []).filter((x) => t - x < 86400000);
    const lastMinute = mine.filter((x) => t - x < 60000).length;
    if (mine.length >= perUserPerDay) throw new PlanError(429, 'You have used today\'s route planning. It resets tomorrow.', 3600);
    if (lastMinute >= perUserPerMinute) throw new PlanError(429, 'That is a lot of routes in a minute. Wait a little and try again.', 30);
    if (globalHits.length >= globalPerMinute) throw new PlanError(429, 'The route planner is busy. Try again in a minute.', 30);
    mine.push(t);
    globalHits.push(t);
    userHits.set(userId, mine);
  }

  async function ors(key, profile, from, to, alternatives) {
    const body = { coordinates: [from, to], instructions: false, elevation: false };
    if (alternatives) body.alternative_routes = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchFn(`${ORS_BASE}/v2/directions/${PROFILES[profile]}/geojson`, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      log('route planner: request failed', err && err.name);
      throw new PlanError(502, 'The route planner did not answer. Try again in a moment.');
    } finally { clearTimeout(timer); }
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (res.ok) return json;
    throw Object.assign(new Error('upstream'), { upstream: parseError(res.status, json) });
  }

  function toRoutes(json) {
    const features = json && Array.isArray(json.features) ? json.features : [];
    const routes = [];
    for (const f of features) {
      const c = f && f.geometry && f.geometry.type === 'LineString' ? f.geometry.coordinates : null;
      if (!Array.isArray(c) || c.length < 2) continue;
      const coordinates = c.map((p) => [Number(p[0]), Number(p[1])]);
      if (coordinates.some((p) => !validPos(p))) continue;
      const s = f.properties && f.properties.summary;
      routes.push({
        distanceM: s && Number.isFinite(Number(s.distance)) ? Number(s.distance) : geo.distanceM([coordinates]),
        durationS: s && Number.isFinite(Number(s.duration)) ? Number(s.duration) : null,
        coordinates,
      });
    }
    return routes.slice(0, 3);
  }

  /** { from: [lng, lat], to: [lng, lat], profile } -> { routes, attribution }. Throws PlanError with a plain message and an HTTP status. */
  async function plan(userId, { from, to, profile }) {
    const key = getKey();
    if (!key) throw new PlanError(503, 'Route planning is not set up on the server (ORS_API_KEY).');
    if (!PROFILES[profile]) throw new PlanError(400, 'Pick walking, hiking, cycling or driving.');
    if (!validPos(from) || !validPos(to)) throw new PlanError(400, 'The start and end must be [longitude, latitude] points on the map.');
    const direct = geo.distanceM([[from, to]]);
    if (direct < MIN_M) throw new PlanError(422, 'The start and end are almost the same place. Pick points further apart.');
    if (direct > MAX_M) throw new PlanError(422, 'Those points are too far apart for route planning.');

    const ck = `${profile}|${round5(from[0])},${round5(from[1])}|${round5(to[0])},${round5(to[1])}`;
    const hit = cache.get(ck);
    if (hit && now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

    limit(userId);
    let json;
    let alternatives = direct < ALTERNATIVES_MAX_M;
    for (;;) {
      try {
        json = await ors(key, profile, from, to, alternatives);
        break;
      } catch (err) {
        const u = err.upstream;
        if (!u) throw err;
        // a request the service will not do with alternatives still works as a single route
        if (alternatives && (u.code === 2004 || (u.status === 400 && /alternative/i.test(u.message)))) { alternatives = false; continue; }
        if (u.status === 429) throw new PlanError(429, 'The routing service is busy. Try again in a minute.', 60);
        if (u.status === 401 || u.status === 403) { log('route planner: key rejected'); throw new PlanError(502, 'Route planning is not available: the routing key was rejected.'); }
        if (u.code === 2010) {
          const end = whichEnd(u.message);
          throw new PlanError(422, `No road or path was found near ${end === 'start' ? 'the start' : end === 'end' ? 'the end' : 'one of the points'}. Move it closer to a road or footpath.`);
        }
        if (u.code === 2009 || u.status === 404) throw new PlanError(422, 'No route could be found between those points for this way of travelling.');
        if (u.code === 2004) throw new PlanError(422, 'Those points are too far apart for the route planner.');
        if (u.status >= 500) throw new PlanError(502, 'The route planner had a problem. Try again in a moment.');
        throw new PlanError(422, 'The route planner could not plan that route.');
      }
    }
    const routes = toRoutes(json);
    if (!routes.length) throw new PlanError(422, 'No route could be found between those points for this way of travelling.');
    const value = { routes, attribution: ATTRIBUTION };
    cache.set(ck, { at: now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return { ...value, cached: false };
  }

  return { plan };
}

module.exports = { createPlanner, PlanError, PROFILES, ATTRIBUTION, ALTERNATIVES_MAX_M };
