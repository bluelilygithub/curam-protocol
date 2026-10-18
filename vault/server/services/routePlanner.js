'use strict';

// Route Tracer "Plan route": the Vault server asks OpenRouteService for walking / hiking / cycling / driving routes, so the API key stays on
// the server. Pure apart from the injected fetch / clock, so routeTracks.test.js runs it with a fake service.
//   direct: one call = one route plus up to two alternatives between two points (alternatives need exactly two points, under about 100 km)
//   loop:   a round trip of about X km from one point. The service treats the length as a hint and can miss it by a lot, so three loops are
//           asked for (three seeds = three directions), any that miss by more than 12% are asked again with a corrected length, and the
//           results are returned closest-to-target first with how far off each one is.
//   detour: A to B but about X km (longer than the direct route). No service does this in one call, so a "via" point is placed off to one
//           side of the A-B line and moved in or out until the route A -> via -> B is about X km. Three shapes are tried (left, right and a
//           lopsided one), each corrected once if it misses by more than 8%, and the results come back closest-to-target first.
//   leg:    one route between two points, for the "Follow roads" switch in Click mode: each click asks for the road or path from the last click
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
const DETOUR_MIN_KM = 1;
const DETOUR_MAX_KM = 100;
const DETOUR_MAX_STRAIGHT_M = 50000; // A and B no more than this far apart (straight line)
const DETOUR_SHORT = 0.98; // a target below 98% of the direct route cannot be met
const DETOUR_SAME = 1.06; // within 6% above the direct route: the direct route will do
const DETOUR_LONG = 4; // longer than 4x the direct route is not a detour any more
const DETOUR_TOLERANCE = 0.08;
// the shapes tried, per round: [side (+1 left of A to B, -1 right), how far along A to B the via point sits]
const DETOUR_SHAPES = [[[1, 0.5], [-1, 0.5], [1, 0.3]], [[1, 0.7], [-1, 0.7], [-1, 0.3]], [[1, 0.4], [-1, 0.4], [1, 0.6]]];
const LEG_MIN_M = 5; // two clicks closer than this are the same place: no call, the segment is just the two points
const TIMEOUT_MS = 30000; // the public routing service is sometimes slow: waiting is better than a failed plan (the page shows a "working" card meanwhile)
const LOOP_TIMEOUT_MS = 30000;
const LEG_TIMEOUT_MS = 15000; // one click of Follow roads: a person is waiting for the line to appear
const DIAGNOSE_TIMEOUT_MS = 45000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const ATTRIBUTION = '© openrouteservice.org | © OpenStreetMap contributors';

class PlanError extends Error {
  /** `extra` is sent to the browser with the message (a code and distances the page can word in the person's units). */
  constructor(status, message, retryAfter, extra) { super(message); this.status = status; this.retryAfter = retryAfter; this.extra = extra; }
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

function createPlanner({ getKey, fetchFn = globalThis.fetch, now = Date.now, perUserPerMinute = 24, perUserPerDay = 150, globalPerMinute = 36, log = () => {} } = {}) {
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

  async function post(key, profile, body, timeoutMs = TIMEOUT_MS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(`${ORS_BASE}/v2/directions/${PROFILES[profile]}/geojson`, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // say WHY in the log (a timeout, a refused connection, a DNS failure): the person only ever sees the plain message
      log('route planner: request failed', `${err && err.name}: ${err && err.message}${err && err.cause && (err.cause.code || err.cause.message) ? ` (${err.cause.code || err.cause.message})` : ''} after ${timeoutMs} ms limit`);
      throw Object.assign(new PlanError(502, 'The route planner did not answer. Try again in a moment.'), { transient: true, reason: err && err.name === 'AbortError' ? `no answer within ${timeoutMs / 1000} seconds` : `${err && err.name}: ${err && err.message}${err && err.cause && (err.cause.code || err.cause.message) ? ` (${err.cause.code || err.cause.message})` : ''}` });
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

  /** A route through the given points (2 or 3), plain errors thrown. `alternatives` only for exactly two points under about 100 km. */
  async function route(key, profile, points, alternatives, timeoutMs = TIMEOUT_MS) {
    let alt = alternatives;
    for (;;) {
      try {
        const body = { coordinates: points, instructions: false, elevation: false };
        if (alt) body.alternative_routes = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
        return toRoutes(await post(key, profile, body, timeoutMs));
      } catch (err) {
        const u = err.upstream;
        if (!u) throw err;
        // a request the service will not do with alternatives still works as a single route
        if (alt && (u.code === 2004 || (u.status === 400 && /alternative/i.test(u.message)))) { alt = false; continue; }
        throw explain(u);
      }
    }
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
    const routes = await route(key, profile, [from, to], direct < ALTERNATIVES_MAX_M);
    if (!routes.length) throw new PlanError(422, 'No route could be found between those points for this way of travelling.');
    const value = { routes, attribution: ATTRIBUTION };
    remember(ck, value);
    return { ...value, cached: false };
  }

  /** One round trip from `from` of about `lengthM` metres for a seed (the seed picks the loop's general direction). */
  async function oneLoop(key, profile, from, lengthM, seed) {
    let retried = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const body = { coordinates: [from], instructions: false, elevation: false, options: { [roundTripKey]: { length: Math.round(lengthM), points: LOOP_POINTS, seed } } };
        const json = await post(key, profile, body, LOOP_TIMEOUT_MS);
        const r = toRoutes(json)[0];
        if (!r) throw Object.assign(new Error('upstream'), { upstream: { status: 404, code: 2009, message: '' } });
        return r;
      } catch (err) {
        const u = err.upstream;
        // the service did not answer at all (a slow moment, a dropped connection): one more try before giving up
        if (err.transient && !retried) { retried = true; continue; }
        // an unknown-option answer (not a routing answer): try the other spelling of the option once, and keep the one that works
        if (u && attempt < 2 && u.status === 400 && ![2004, 2009, 2010].includes(u.code)) { roundTripKey = roundTripKey === 'round_trip' ? 'round-trip' : 'round_trip'; continue; }
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

  /**
   * { from, to, profile } -> { route: { distanceM, durationS, coordinates }, attribution }: the road or path from one click to the next.
   * One call (cache hits are free). Points under 5 m apart are the same place and answer with no call.
   */
  async function leg(userId, { from, to, profile }) {
    const key = checkKey(profile);
    if (!validPos(from) || !validPos(to)) throw new PlanError(400, 'The points must be [longitude, latitude] points on the map.');
    const straight = geo.distanceM([[from, to]]);
    if (straight < LEG_MIN_M) return { route: { distanceM: straight, durationS: null, coordinates: [from, to] }, attribution: ATTRIBUTION, cached: true };
    if (straight > MAX_M) throw new PlanError(422, 'Those points are too far apart to follow roads between.');
    const ck = `leg|${profile}|${round5(from[0])},${round5(from[1])}|${round5(to[0])},${round5(to[1])}`;
    const hit = fromCache(ck);
    if (hit) return hit;
    limit(userId, 1);
    const r = (await route(key, profile, [from, to], false, LEG_TIMEOUT_MS))[0];
    if (!r) throw new PlanError(422, 'No route could be found between those points for this way of travelling.');
    const value = { route: r, attribution: ATTRIBUTION };
    remember(ck, value);
    return { ...value, cached: false };
  }

  // ---- detour: A to B, but about X km ------------------------------------------------------------------------------------------

  /** Where the via point goes: `h` metres to the `side` of the point `t` of the way from A to B. */
  function viaPoint(from, to, side, t, h) {
    const lat0 = ((from[1] + to[1]) / 2) * Math.PI / 180;
    const mx = 111320 * Math.cos(lat0);
    const dx = (to[0] - from[0]) * mx;
    const dy = (to[1] - from[1]) * 111320;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * side * h;
    const py = (dx / len) * side * h;
    return [from[0] + (to[0] - from[0]) * t + px / mx, Math.max(-85, Math.min(85, from[1] + (to[1] - from[1]) * t + py / 111320))];
  }

  /** The `h` (metres off the A-B line) at which a road route A -> via -> B would be `targetM` long, if roads wind `w` times as much as a straight line. */
  function solveOffset(straightM, t, w, targetM) {
    const poly = (h) => Math.hypot(t * straightM, h) + Math.hypot((1 - t) * straightM, h);
    if (w * poly(0) >= targetM) return 0.05 * straightM; // barely longer than direct: a small nudge
    let lo = 0;
    let hi = targetM;
    for (let i = 0; i < 50; i += 1) { const mid = (lo + hi) / 2; if (w * poly(mid) < targetM) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  /**
   * { from, to, profile, lengthKm?, round? } -> { routes, attribution, targetM, directM }.
   * Without lengthKm: just the direct route and its length (so the page can say how long the direct way is).
   * With it: up to three routes of about that length, closest first, each with `offPct`. A target shorter than the direct route, or more
   * than four times as long, is refused with a code and the direct distance so the page can say so in the person's units.
   */
  async function detour(userId, { from, to, profile, lengthKm, round = 0 }) {
    const key = checkKey(profile);
    if (!validPos(from) || !validPos(to)) throw new PlanError(400, 'The start and end must be [longitude, latitude] points on the map.');
    const straightM = geo.distanceM([[from, to]]);
    if (straightM < MIN_M) throw new PlanError(422, 'The start and end are almost the same place. Pick points further apart.');
    if (straightM > DETOUR_MAX_STRAIGHT_M) throw new PlanError(422, 'The start and end are too far apart for this. Pick points less than 50 km apart.');
    const wantsLength = lengthKm !== undefined && lengthKm !== null;
    if (wantsLength && (typeof lengthKm !== 'number' || !Number.isFinite(lengthKm) || lengthKm < DETOUR_MIN_KM || lengthKm > DETOUR_MAX_KM)) {
      throw new PlanError(400, `Choose a length between ${DETOUR_MIN_KM} and ${DETOUR_MAX_KM} km.`);
    }
    const r0 = Number.isInteger(round) && round >= 0 && round < 30 ? round : 0;
    const targetM = wantsLength ? Math.round(lengthKm * 10) * 100 : null;
    const ck = `detour|${profile}|${round5(from[0])},${round5(from[1])}|${round5(to[0])},${round5(to[1])}|${targetM}|${r0}`;
    const hit = fromCache(ck);
    if (hit) return hit;

    // the direct route first: it is the shortest there is, so it decides whether the target can be met and how much roads wind here
    limit(userId, 1);
    const directRoute = (await route(key, profile, [from, to], false))[0];
    if (!directRoute) throw new PlanError(422, 'No route could be found between those points for this way of travelling.');
    const directM = directRoute.distanceM;
    const done = (routes) => { const value = { routes, attribution: ATTRIBUTION, targetM, directM }; remember(ck, value); return { ...value, cached: false }; };
    if (!wantsLength) return done([directRoute]);
    if (targetM < directM * DETOUR_SHORT) throw new PlanError(422, 'The shortest route is already longer than that.', undefined, { code: 'TARGET_TOO_SHORT', directM, targetM });
    if (targetM > directM * DETOUR_LONG) throw new PlanError(422, 'That is a lot longer than the direct route.', undefined, { code: 'TARGET_TOO_LONG', directM, targetM, maxM: Math.floor(directM * DETOUR_LONG / 100) * 100 });
    const off = (r) => Math.abs(r.distanceM - targetM) / targetM;
    if (targetM <= directM * DETOUR_SAME) return done([{ ...directRoute, offPct: Math.round(((directM - targetM) / targetM) * 1000) / 10 }]);

    const shapes = DETOUR_SHAPES[r0 % DETOUR_SHAPES.length];
    limit(userId, shapes.length);
    const winding = Math.max(1, directM / straightM);
    const tryShape = async ([side, t]) => {
      let w = winding;
      let h = solveOffset(straightM, t, w, targetM);
      let best = null;
      for (let pass = 0; pass < 2; pass += 1) {
        const via = viaPoint(from, to, side, t, h);
        const r = (await route(key, profile, [from, via, to], false))[0];
        if (!r) break;
        if (!best || off(r) < off(best)) best = r;
        if (off(r) <= DETOUR_TOLERANCE || pass === 1) break;
        // it missed: learn how much the roads wind on this side, move the via point, and try once more (if the quota allows)
        w = r.distanceM / (Math.hypot(t * straightM, h) + Math.hypot((1 - t) * straightM, h));
        h = solveOffset(straightM, t, w, targetM);
        try { limit(userId, 1); } catch (e) { if (e instanceof PlanError && e.status === 429) break; throw e; }
      }
      if (!best) throw new PlanError(422, 'No route could be found for that detour.');
      return best;
    };
    const results = await Promise.allSettled(shapes.map(tryShape));
    const found = results.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    if (!found.length) {
      const why = results.find((s) => s.status === 'rejected').reason;
      if (why instanceof PlanError && why.status !== 422) throw why; // busy, key rejected, no answer: say so
      throw new PlanError(422, 'Could not build a detour of that length here: the points to the side of your route were not near roads or paths. Try a different length, or move A or B.');
    }
    const routes = found
      .map((r) => ({ ...r, offPct: Math.round(((r.distanceM - targetM) / targetM) * 1000) / 10 }))
      .sort((a, b) => Math.abs(a.offPct) - Math.abs(b.offPct))
      .filter((r, i, all) => !all.slice(0, i).some((q) => Math.abs(q.distanceM - r.distanceM) < 5 && geo.distanceM([[q.coordinates[Math.floor(q.coordinates.length / 2)], r.coordinates[Math.floor(r.coordinates.length / 2)]]]) < 50));
    return done(routes);
  }

  /**
   * For the owner: one tiny routing request (a few hundred metres in Dublin) to see whether the routing service answers from this server, and how fast.
   * Never throws; always answers { ok, ms, ... } in plain words. Costs one call of the service's quota. Never includes the key.
   */
  async function diagnose() {
    const key = getKey();
    if (!key) return { ok: false, keySet: false, ms: 0, summary: 'No routing key is set on the server (ORS_API_KEY), so route planning is switched off.' };
    const t0 = now();
    try {
      await post(key, 'walking', { coordinates: [[-6.3108, 53.2895], [-6.3043, 53.2927]], instructions: false, elevation: false }, DIAGNOSE_TIMEOUT_MS);
      const ms = now() - t0;
      return { ok: true, keySet: true, ms, summary: ms > 8000 ? `The routing service answered, but slowly: ${(ms / 1000).toFixed(1)} seconds for a tiny request. Plans may time out at busy moments.` : `The routing service answered in ${(ms / 1000).toFixed(1)} seconds. Route planning is working from this server.` };
    } catch (err) {
      const ms = now() - t0;
      if (err.upstream) {
        const e = explain(err.upstream);
        return { ok: false, keySet: true, ms, status: err.upstream.status, code: Number.isFinite(err.upstream.code) ? err.upstream.code : null, summary: `The routing service answered with an error (${err.upstream.status}): ${e.message}` };
      }
      return { ok: false, keySet: true, ms, reason: err.reason || null, summary: `The routing service did not answer from this server (${err.reason || 'unknown reason'}). It may be slow, down, or unreachable from the host.` };
    }
  }

  return { plan, loops, detour, leg, diagnose };
}

module.exports = { createPlanner, PlanError, PROFILES, ATTRIBUTION, ALTERNATIVES_MAX_M, LOOP_MIN_KM, LOOP_MAX_KM, DETOUR_MIN_KM, DETOUR_MAX_KM };
