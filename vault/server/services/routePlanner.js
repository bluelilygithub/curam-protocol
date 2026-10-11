'use strict';

// Route Tracer "Plan route": the Vault server asks OpenRouteService for walking / hiking / cycling / driving routes, so the API key stays on
// the server. Pure apart from the injected fetch / clock, so routeTracks.test.js runs it with a fake service.
//   direct: one call = one route plus up to two alternatives between two points (alternatives need exactly two points, under about 100 km)
//   loop:   a round trip of about X km from one point. The service treats the length as a hint and can miss it by a lot, so three loops are
//           asked for (three seeds = three directions), any that miss by more than 12% are asked again with a corrected length, and the
//           results are returned closest-to-target first with how far off each one is.
//   - answers are cached for an hour and cache hits cost no quota
//   - per-user limits (calls a minute, calls a day) and a global per-minute cap, because the free key is shared by everyone; a call is one
//     request to the service, so a loop costs three (and three more if it needs correcting)
// Docs: docs/route-tracer.md ("Plan route").

const geo = require('./routeTracerGeo');

const ORS_BASE = 'https://api.openrouteservice.org';
const PROFILES = { walking: 'foot-walking', hiking: 'foot-hiking', cycling: 'cycling-regular', driving: 'driving-car' };
const ALTERNATIVES_MAX_M = 100000; // OpenRouteService only offers alternatives under about 100 km
const MIN_M = 30;
const MAX_M = 1000000;
const LOOP_MIN_KM = 1;
const LOOP_MAX_KM = 50;
const LOOP_TOLERANCE = 0.12; // a loop within 12% of the target is good enough
const LOOP_POINTS = 5; // "larger values create more circular routes"
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const ATTRIBUTION = '© openrouteservice.org | © OpenStreetMap contributors';

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

function createPlanner({ getKey, fetchFn = globalThis.fetch, now = Date.now, perUserPerMinute = 12, perUserPerDay = 150, globalPerMinute = 30, log = () => {} } = {}) {
  const cache = new Map(); // key -> { at, value }
  const userHits = new Map(); // userId -> timestamps (last 24 h), one per call to the service
  let globalHits = [];
  // the documentation and the forum disagree on the spelling of the round-trip option; remember the one the service accepted
  let roundTripKey = 'round_trip';

  /** Reserve `cost` calls for this user and for everyone, or throw a 429 that says why. */
  function limit(userId, cost = 1) {
    const t = now();
    globalHits = globalHits.filter((x) => t - x < 60000);
    const mine = (userHits.get(userId) || []).filter((x) => t - x < 86400000);
    const lastMinute = mine.filter((x) => t - x < 60000).length;
    if (mine.length + cost > perUserPerDay) throw new PlanError(429, 'You have used today\'s route planning. It resets tomorrow.', 3600);
    if (lastMinute + cost > perUserPerMinute) throw new PlanError(429, 'That is a lot of routes in a minute. Wait a little and try again.', 30);
    if (globalHits.length + cost > globalPerMinute) throw new PlanError(429, 'The route planner is busy. Try again in a minute.', 30);
    for (let i = 0; i < cost; i += 1) { mine.push(t); globalHits.push(t); }
    userHits.set(userId, mine);
  }

  async function post(key, profile, body) {
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

  /** A plain PlanError for what the service said (never its own text, never the key). `what` is the start/end wording for "not found". */
  function explain(u) {
    if (u.status === 429) return new PlanError(429, 'The routing service is busy. Try again in a minute.', 60);
    if (u.status === 401 || u.status === 403) { log('route planner: key rejected'); return new PlanError(502, 'Route planning is not available: the routing key was rejected.'); }
    if (u.code === 2010) {
      const end = whichEnd(u.message);
      return new PlanError(422, `No road or path was found near ${end === 'start' ? 'the start' : end === 'end' ? 'the end' : 'one of the points'}. Move it closer to a road or footpath.`);
    }
    if (u.code === 2009 || u.status === 404) return new PlanError(422, 'No route could be found between those points for this way of travelling.');
    if (u.code === 2004) return new PlanError(422, 'Those points are too far apart for the route planner.');
    if (u.status >= 500) return new PlanError(502, 'The route planner had a problem. Try again in a moment.');
    return new PlanError(422, 'The route planner could not plan that route.');
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

  function remember(ck, value) {
    cache.set(ck, { at: now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  const fromCache = (ck) => { const hit = cache.get(ck); return hit && now() - hit.at < CACHE_TTL_MS ? { ...hit.value, cached: true } : null; };

  function checkKey(profile) {
    const key = getKey();
    if (!key) throw new PlanError(503, 'Route planning is not set up on the server (ORS_API_KEY).');
    if (!PROFILES[profile]) throw new PlanError(400, 'Pick walking, hiking, cycling or driving.');
    return key;
  }

  /** { from: [lng, lat], to: [lng, lat], profile } -> { routes, attribution }. Throws PlanError with a plain message and an HTTP status. */
  async function plan(userId, { from, to, profile }) {
    const key = checkKey(profile);
    if (!validPos(from) || !validPos(to)) throw new PlanError(400, 'The start and end must be [longitude, latitude] points on the map.');
    const direct = geo.distanceM([[from, to]]);
    if (direct < MIN_M) throw new PlanError(422, 'The start and end are almost the same place. Pick points further apart.');
    if (direct > MAX_M) throw new PlanError(422, 'Those points are too far apart for route planning.');

    const ck = `direct|${profile}|${round5(from[0])},${round5(from[1])}|${round5(to[0])},${round5(to[1])}`;
    const hit = fromCache(ck);
    if (hit) return hit;

    limit(userId);
    let json;
    let alternatives = direct < ALTERNATIVES_MAX_M;
    for (;;) {
      try {
        const body = { coordinates: [from, to], instructions: false, elevation: false };
        if (alternatives) body.alternative_routes = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
        json = await post(key, profile, body);
        break;
      } catch (err) {
        const u = err.upstream;
        if (!u) throw err;
        // a request the service will not do with alternatives still works as a single route
        if (alternatives && (u.code === 2004 || (u.status === 400 && /alternative/i.test(u.message)))) { alternatives = false; continue; }
        throw explain(u);
      }
    }
    const routes = toRoutes(json);
    if (!routes.length) throw new PlanError(422, 'No route could be found between those points for this way of travelling.');
    const value = { routes, attribution: ATTRIBUTION };
    remember(ck, value);
    return { ...value, cached: false };
  }

  /** One round trip from `from` of about `lengthM` metres for a seed (the seed picks the loop's general direction). */
  async function oneLoop(key, profile, from, lengthM, seed) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const body = { coordinates: [from], instructions: false, elevation: false, options: { [roundTripKey]: { length: Math.round(lengthM), points: LOOP_POINTS, seed } } };
        const json = await post(key, profile, body);
        const r = toRoutes(json)[0];
        if (!r) throw Object.assign(new Error('upstream'), { upstream: { status: 404, code: 2009, message: '' } });
        return r;
      } catch (err) {
        const u = err.upstream;
        // an unknown-option answer (not a routing answer): try the other spelling of the option once, and keep the one that works
        if (u && attempt === 0 && u.status === 400 && ![2004, 2009, 2010].includes(u.code)) { roundTripKey = roundTripKey === 'round_trip' ? 'round-trip' : 'round_trip'; continue; }
        throw err;
      }
    }
    throw new PlanError(422, 'The route planner could not plan that route.');
  }

  /**
   * { from: [lng, lat], lengthKm, profile, round } -> { routes, attribution, targetM } with up to three loops, closest to the target first.
   * Each route carries `offPct`: how far its length is from the target (+8 means 8% too long). `round` 0, 1, 2 ... gives different loops.
   */
  async function loops(userId, { from, lengthKm, profile, round = 0 }) {
    const key = checkKey(profile);
    if (!validPos(from)) throw new PlanError(400, 'The start must be a [longitude, latitude] point on the map.');
    if (typeof lengthKm !== 'number' || !Number.isFinite(lengthKm) || lengthKm < LOOP_MIN_KM || lengthKm > LOOP_MAX_KM) {
      throw new PlanError(400, `Choose a loop between ${LOOP_MIN_KM} and ${LOOP_MAX_KM} km.`);
    }
    const r0 = Number.isInteger(round) && round >= 0 && round < 20 ? round : 0;
    const targetM = Math.round(lengthKm * 10) * 100; // to the nearest 100 m, so a typed 5 and 5.04 are the same loop
    const ck = `loop|${profile}|${round5(from[0])},${round5(from[1])}|${targetM}|${r0}`;
    const hit = fromCache(ck);
    if (hit) return hit;

    const seeds = [3 * r0 + 1, 3 * r0 + 2, 3 * r0 + 3];
    limit(userId, seeds.length);
    const attempt = (lengthM, list) => Promise.allSettled(list.map((seed) => oneLoop(key, profile, from, lengthM, seed)));
    const off = (r) => Math.abs(r.distanceM - targetM) / targetM;

    const first = await attempt(targetM, seeds);
    let found = first.map((s, i) => (s.status === 'fulfilled' ? { seed: seeds[i], route: s.value } : null));
    if (!found.some(Boolean)) {
      const why = first.find((s) => s.status === 'rejected').reason;
      throw why instanceof PlanError ? why : why && why.upstream ? explain(why.upstream) : new PlanError(502, 'The route planner did not answer. Try again in a moment.');
    }

    // the service treats the length as a hint: ask again, with the length scaled by how far it missed, for the loops that missed by too much
    const needFix = found.filter((f) => f && off(f.route) > LOOP_TOLERANCE);
    if (needFix.length) {
      try {
        limit(userId, needFix.length);
        const redo = await Promise.allSettled(needFix.map((f) => {
          const scale = Math.min(2.5, Math.max(0.4, targetM / f.route.distanceM));
          return oneLoop(key, profile, from, targetM * scale, f.seed);
        }));
        redo.forEach((s, i) => {
          if (s.status !== 'fulfilled') return;
          const slot = found.indexOf(needFix[i]);
          if (off(s.value) < off(found[slot].route)) found[slot] = { seed: needFix[i].seed, route: s.value };
        });
      } catch (err) {
        if (!(err instanceof PlanError) || err.status !== 429) throw err; // out of quota for the correction: the first answers stand
      }
    }

    found = found.filter(Boolean);
    const routes = found
      .map((f) => ({ ...f.route, offPct: Math.round(((f.route.distanceM - targetM) / targetM) * 1000) / 10 }))
      .sort((a, b) => Math.abs(a.offPct) - Math.abs(b.offPct))
      // two seeds can give the same loop: the same length and the same shape (the farthest-along point within 50 m)
      .filter((r, i, all) => !all.slice(0, i).some((q) => Math.abs(q.distanceM - r.distanceM) < 5 && geo.distanceM([[q.coordinates[Math.floor(q.coordinates.length / 2)], r.coordinates[Math.floor(r.coordinates.length / 2)]]]) < 50));
    const value = { routes, attribution: ATTRIBUTION, targetM };
    remember(ck, value);
    return { ...value, cached: false };
  }

  return { plan, loops };
}

module.exports = { createPlanner, PlanError, PROFILES, ATTRIBUTION, ALTERNATIVES_MAX_M, LOOP_MIN_KM, LOOP_MAX_KM };
