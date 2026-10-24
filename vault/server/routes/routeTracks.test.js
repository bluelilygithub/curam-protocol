#!/usr/bin/env node
/**
 * Route Tracer: server geometry, validation and the /api/route-tracks routes (ownership, server-side stats, paging, GPX, limits).
 * Runs against an in-memory stand-in for the pool (queries matched by shape and given the SQL's semantics), so it needs no database.
 * The SQL itself is exercised on staging.
 *
 * Run: node server/routes/routeTracks.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const geo = require('../services/routeTracerGeo');
const { createRouter: realCreateRouter } = require('./routeTracksRouter');
// deletes go to the shared recycle bin: a stand-in that keeps what it was given, so no database is needed
const createRouter = (pool, opts = {}) => realCreateRouter(pool, { getBin: () => ({ moveToBin: async (_db, o) => { pool.bin.push(o); return `bin-${pool.bin.length}`; } }), ...opts });

const within = (actual, expected, pct) => assert.ok(Math.abs(actual - expected) / expected < pct / 100, `${actual} not within ${pct}% of ${expected}`);

// ---------------------------------------------------------------- geometry
{
  within(geo.distanceM([[[0, 0], [0, 1]]]), 111195, 0.5); // 1 degree of latitude
  within(geo.distanceM([[[153.028, -27.468], [153.43, -28.002]]]) / 1000, 71.4, 0.5); // Brisbane CBD -> Surfers Paradise
  assert.strictEqual(geo.distanceM([]), 0);
  assert.strictEqual(geo.distanceM([[[1, 1]]]), 0);
  const a = [[0, 0], [0, 0.1]]; const b = [[1, 0], [1, 0.1]];
  assert.ok(Math.abs(geo.distanceM([a, b]) - (geo.distanceM([a]) + geo.distanceM([b]))) < 1e-6, 'gap between strokes is not counted');
  assert.deepStrictEqual(geo.bboxOf([[[1, 2], [3, 4]], [[-1, 0], [0, 9]]]), [-1, 0, 3, 9]);

  const ok = { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] };
  assert.strictEqual(geo.validateGeometry(ok), null);
  assert.ok(geo.validateGeometry(null));
  assert.ok(geo.validateGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }));
  assert.ok(geo.validateGeometry({ type: 'MultiLineString', coordinates: [] }));
  assert.ok(geo.validateGeometry({ type: 'MultiLineString', coordinates: [[[0, 0]]] }));
  assert.ok(geo.validateGeometry({ type: 'MultiLineString', coordinates: [[[0, 0], [181, 0]]] }));
  assert.ok(geo.validateGeometry({ type: 'MultiLineString', coordinates: [[[0, 0], [0, -90.5]]] }));
  assert.ok(geo.validateGeometry({ type: 'MultiLineString', coordinates: [[[0, 0], ['1', 0]]] }));
  assert.ok(geo.validateGeometry({ type: 'MultiLineString', coordinates: [[[0, 0], [null, 0]]] }));
  const many = { type: 'MultiLineString', coordinates: [Array.from({ length: geo.MAX_POINTS + 1 }, (_, i) => [0, (i % 100) / 100])] };
  assert.ok(geo.validateGeometry(many), 'over 20,000 points');
  const edge = { type: 'MultiLineString', coordinates: [Array.from({ length: geo.MAX_POINTS }, (_, i) => [0, (i % 100) / 100])] };
  assert.strictEqual(geo.validateGeometry(edge), null, 'exactly 20,000 points is allowed');
  assert.deepStrictEqual(geo.cleanLines({ coordinates: [[[1, 2, 99], [3, 4, 99]]] }), [[[1, 2], [3, 4]]]);

  const gpx = geo.toGpx('A & B <1>', 'n"otes', [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]);
  assert.strictEqual((gpx.match(/<trkseg>/g) || []).length, 2);
  assert.ok(gpx.includes('A &amp; B &lt;1&gt;') && gpx.includes('n&quot;otes') && gpx.includes('<trkpt lat="2" lon="1"/>'));
}

// ---------------------------------------------------------------- fake pool
function fakePool() {
  const rows = [];
  let clock = Date.UTC(2026, 9, 11, 12, 0, 0);
  const pool = {
    rows,
    bin: [],
    failNext: false,
    // a transaction client: statements go to the same store; BEGIN/COMMIT/ROLLBACK are no-ops (a failed delete is tested by pool.failNext)
    async connect() { return { query: (sql, params) => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) ? Promise.resolve({ rows: [] }) : pool.query(sql, params)), release() {} }; },
    async query(sql, params) {
      if (pool.failNext) { pool.failNext = false; throw new Error('connection refused: secret-host:5432'); }
      const s = sql.replace(/\s+/g, ' ');
      if (/SELECT COUNT/.test(s)) return { rows: [{ n: String(rows.filter((r) => r.userId === params[0]).length) }] };
      if (/^INSERT INTO route_tracks/.test(s)) {
        const r = {
          id: crypto.randomUUID(), userId: params[0], name: params[1], notes: params[2], color: params[3], geometry: JSON.parse(params[4]),
          distanceM: params[5], pointCount: params[6], bbox: params[7], drawMode: params[8], cues: params[9] ? JSON.parse(params[9]) : null, createdAt: new Date((clock += 1000)), updatedAt: new Date(clock),
        };
        rows.push(r);
        return { rows: [r] };
      }
      if (/^SELECT .* FROM route_tracks WHERE "userId" = \$1/.test(s)) { // list
        let list = rows.filter((r) => r.userId === params[0]);
        let i = 1;
        if (/name ILIKE/.test(s)) {
          const needle = params[i++].replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase();
          list = list.filter((r) => r.name.toLowerCase().includes(needle));
        }
        if (/\("createdAt", id\) </.test(s)) {
          const t = new Date(params[i++]).getTime(); const id = params[i++];
          list = list.filter((r) => r.createdAt.getTime() < t || (r.createdAt.getTime() === t && r.id < id));
        }
        list.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
        return { rows: list.slice(0, params[i]) };
      }
      if (/^SELECT \* FROM route_tracks WHERE id = ANY/.test(s)) return { rows: rows.filter((r) => params[0].includes(r.id) && r.userId === params[1]) };
      if (/^SELECT name, notes, geometry/.test(s)) {
        const r = rows.find((x) => x.id === params[0] && x.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/^SELECT .* FROM route_tracks WHERE id = \$1/.test(s)) {
        const r = rows.find((x) => x.id === params[0] && x.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/^UPDATE route_tracks/.test(s)) {
        const [name, setNotes, notes, color, geometry, dist, pts, bbox, id, userId, setCues, cues] = params;
        const r = rows.find((x) => x.id === id && x.userId === userId);
        if (!r) return { rows: [] };
        if (name !== null) r.name = name;
        if (setNotes) r.notes = notes;
        if (color !== null) r.color = color;
        if (setCues) r.cues = cues ? JSON.parse(cues) : null;
        if (geometry !== null) { r.geometry = JSON.parse(geometry); r.distanceM = dist; r.pointCount = pts; r.bbox = bbox; }
        r.updatedAt = new Date((clock += 1000));
        return { rows: [r] };
      }
      if (/^DELETE FROM route_tracks WHERE id = ANY/.test(s)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) if (params[0].includes(rows[i].id) && rows[i].userId === params[1]) rows.splice(i, 1);
        return { rowCount: before - rows.length };
      }
      if (/^DELETE FROM route_tracks/.test(s)) {
        const i = rows.findIndex((x) => x.id === params[0] && x.userId === params[1]);
        if (i >= 0) rows.splice(i, 1);
        return { rowCount: i >= 0 ? 1 : 0 };
      }
      throw new Error(`fake pool: unhandled SQL ${s.slice(0, 80)}`);
    },
  };
  return pool;
}

function build(pool, userId = 1, opts) {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, res, next) => { req.user = { id: userId }; next(); });
  app.use('/api/route-tracks', createRouter(pool, { emailConfigured: async () => false, ...opts })); // never the real mail check (it would reach for the database)
  return http.createServer(app);
}

async function call(server, method, path, body, headers = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

const line = (n, lat0 = 0) => Array.from({ length: n }, (_, i) => [153 + i * 0.001, lat0 + i * 0.0005]);
const input = (extra = {}) => ({ name: 'Morning loop', geometry: { type: 'MultiLineString', coordinates: [line(5)] }, drawMode: 'freehand', ...extra });

// ---------------------------------------------------------------- route planner (OpenRouteService behind the proxy)
async function planTests() {
  const { createPlanner, PlanError } = require('../services/routePlanner');
  const KEY = 'ors-secret-key-123';
  const from = [153.028, -27.468];
  const to = [153.045, -27.475]; // about 2 km
  const feature = (coords, distance, duration) => ({ type: 'Feature', properties: { summary: { distance, duration } }, geometry: { type: 'LineString', coordinates: coords } });
  const mid = (b) => [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + b];
  const okJson = { type: 'FeatureCollection', features: [feature([from, mid(0.001), to], 2100, 1500), feature([from, mid(-0.003), to], 2500, 1800), feature([from, mid(0.004), to], 2900, 2100)] };
  const calls = [];
  const fakeFetch = (impl) => async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = impl(calls.length);
    return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, json: async () => r.json };
  };
  const mk = (impl, extra = {}) => createPlanner({ getKey: () => KEY, fetchFn: fakeFetch(impl), ...extra });
  const rejects = async (p, status, re) => { try { await p; assert.fail('should have thrown'); } catch (e) { assert.ok(e instanceof PlanError, String(e)); assert.strictEqual(e.status, status, e.message); if (re) assert.match(e.message, re); assert.ok(!e.message.includes(KEY), 'key never in a message'); } };

  // the request: right URL, key in Authorization, [lng, lat] order, alternatives asked for, no key in the body
  let p = mk(() => ({ json: okJson }));
  const r = await p.plan(1, { from, to, profile: 'walking' });
  assert.strictEqual(calls[0].url, 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson');
  assert.strictEqual(calls[0].init.headers.Authorization, KEY);
  assert.deepStrictEqual(calls[0].body.coordinates, [from, to]);
  assert.strictEqual(calls[0].body.alternative_routes.target_count, 3);
  assert.ok(!JSON.stringify(calls[0].body).includes(KEY));
  assert.strictEqual(r.routes.length, 3);
  assert.deepStrictEqual(r.routes[0], { distanceM: 2100, durationS: 1500, coordinates: [from, mid(0.001), to], steps: [] });
  assert.ok(/openstreetmap/i.test(r.attribution) && /openrouteservice/i.test(r.attribution));

  // profiles map to the service's profile names
  for (const [name, ors] of Object.entries({ walking: 'foot-walking', hiking: 'foot-hiking', cycling: 'cycling-regular', driving: 'driving-car' })) {
    calls.length = 0;
    await mk(() => ({ json: okJson })).plan(1, { from, to, profile: name });
    assert.ok(calls[0].url.endsWith(`/${ors}/geojson`), name);
  }

  // a third coordinate (elevation) is dropped; extra routes beyond three are ignored; junk features are skipped
  calls.length = 0;
  const messy = { features: [feature([[1, 2, 99], [3, 4, 99]], 10, 5), { geometry: { type: 'Point', coordinates: [1, 2] } }, feature([[1, 2]], 1, 1), feature([[1, 2], [999, 4]], 1, 1), feature([[1, 2], [3, 4]], 11, 6), feature([[1, 2], [5, 6]], 12, 7), feature([[1, 2], [7, 8]], 13, 8)] };
  const m = await mk(() => ({ json: messy })).plan(1, { from, to, profile: 'walking' });
  assert.deepStrictEqual(m.routes[0].coordinates, [[1, 2], [3, 4]]);
  assert.strictEqual(m.routes.length, 3);

  // validation
  const q = mk(() => ({ json: okJson }));
  await rejects(q.plan(1, { from, to, profile: 'flying' }), 400);
  await rejects(q.plan(1, { from: [1], to, profile: 'walking' }), 400);
  await rejects(q.plan(1, { from: [181, 0], to, profile: 'walking' }), 400);
  await rejects(q.plan(1, { from: ['a', 'b'], to, profile: 'walking' }), 400);
  await rejects(q.plan(1, { from, to: [153.02801, -27.46801], profile: 'walking' }), 422, /almost the same/);
  await rejects(q.plan(1, { from: [0, 0], to: [90, 0], profile: 'walking' }), 422, /too far apart/);
  await rejects(createPlanner({ getKey: () => null, fetchFn: fakeFetch(() => ({ json: okJson })) }).plan(1, { from, to, profile: 'walking' }), 503, /ORS_API_KEY/);

  // ---- turn-by-turn directions: asked for, read, bounded, tied to a place on the map
  {
    calls.length = 0;
    const withSteps = { features: [{ type: 'Feature', properties: { summary: { distance: 900, duration: 700 }, segments: [{ steps: [
      { instruction: 'Head  north on Smith Street', distance: 400.4, duration: 300, type: 11, way_points: [0, 1] },
      { instruction: 'Turn left onto Park Road', distance: 500, duration: 400, type: 0, way_points: [1, 2] },
      { instruction: 'Arrive at your destination', distance: 0, duration: 0, type: 10, way_points: [2, 2] },
      { instruction: '', distance: 1, way_points: [1, 1] },
      { instruction: 'Off the line', distance: 1, way_points: [99, 99] },
    ] }] }, geometry: { type: 'LineString', coordinates: [from, mid(0.001), to] } }] };
    const d = await mk(() => ({ json: withSteps })).plan(1, { from, to, profile: 'walking' });
    assert.strictEqual(calls[0].body.instructions, true);
    assert.strictEqual(calls[0].body.language, 'en');
    assert.deepStrictEqual(d.routes[0].steps.map((x) => x.text), ['Head north on Smith Street', 'Turn left onto Park Road', 'Arrive at your destination'], 'blank and off-the-line steps are dropped, spaces tidied');
    assert.strictEqual(d.routes[0].steps[0].distanceM, 400);
    assert.deepStrictEqual(d.routes[0].steps[1].pos, [Math.round(mid(0.001)[0] * 1e5) / 1e5, Math.round(mid(0.001)[1] * 1e5) / 1e5], 'a step is a place on the map, not an index');
    const many = { features: [{ type: 'Feature', properties: { segments: [{ steps: Array.from({ length: 450 }, (_, i) => ({ instruction: `Step ${i}`, distance: 1, way_points: [0, 1] })) }] }, geometry: { type: 'LineString', coordinates: [from, to] } }] };
    assert.strictEqual((await mk(() => ({ json: many })).plan(1, { from, to, profile: 'walking' })).routes[0].steps.length, 400, 'at most 400 steps');
    // a click of Follow roads does not ask for directions (they would only slow it down)
    calls.length = 0;
    await mk(() => ({ json: okJson })).leg(1, { from, to, profile: 'walking' });
    assert.strictEqual(calls[0].body.instructions, false);
  }

  // ---- multi: one call through a start, stops and an end
  {
    const stop1 = [153.034, -27.471]; const stop2 = [153.04, -27.473];
    calls.length = 0;
    const mp = mk(() => ({ json: okJson }));
    const out = await mp.multi(1, { points: [from, stop1, stop2, to], profile: 'cycling' });
    assert.strictEqual(calls.length, 1, 'one call however many stops');
    assert.deepStrictEqual(calls[0].body.coordinates, [from, stop1, stop2, to]);
    assert.strictEqual(calls[0].body.alternative_routes, undefined, 'alternatives only exist between two points');
    assert.ok(calls[0].url.endsWith('/cycling-regular/geojson'));
    assert.strictEqual(out.route.distanceM, 2100);
    assert.strictEqual((await mp.multi(1, { points: [from, stop1, stop2, to], profile: 'cycling' })).cached, true, 'the same stops are answered from memory');
    assert.strictEqual(calls.length, 1);
    await rejects(mp.multi(1, { points: [from], profile: 'walking' }), 400);
    await rejects(mp.multi(1, { points: Array.from({ length: 11 }, (_, i) => [153 + i * 0.01, -27.4]), profile: 'walking' }), 400, /up to 8 stops/);
    await rejects(mp.multi(1, { points: [from, [999, 0]], profile: 'walking' }), 400);
    await rejects(mp.multi(1, { points: [from, [153.02801, -27.46801], to], profile: 'walking' }), 422, /almost the same/);
    await rejects(mp.multi(1, { points: [from, to], profile: 'flying' }), 400);
    // a round trip (the last stop is the first) is fine: only neighbours must differ
    const rt = await mk(() => ({ json: okJson })).multi(1, { points: [from, to, from], profile: 'walking' });
    assert.ok(rt.route.coordinates.length >= 2);
  }

  // over 100 km: no alternatives requested
  calls.length = 0;
  await mk(() => ({ json: okJson })).plan(1, { from: [153, -27], to: [153, -28.5], profile: 'driving' });
  assert.strictEqual(calls[0].body.alternative_routes, undefined);

  // the service refuses alternatives (2004): retried once as a single route
  calls.length = 0;
  const retry = await mk((n) => (n === 1 ? { status: 400, json: { error: { code: 2004, message: 'Request parameters exceed the server configuration limits.' } } } : { json: okJson })).plan(1, { from, to, profile: 'walking' });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].body.alternative_routes, undefined);
  assert.strictEqual(retry.routes.length, 3);

  // plain messages for the service's errors, nothing internal leaks
  const err = (status, code, message) => mk(() => ({ status, json: { error: { code, message } } }));
  await rejects(err(404, 2010, 'Could not find routable point within a radius of 350.0 meters of specified coordinate 0: 153 -27.').plan(1, { from, to, profile: 'walking' }), 422, /near the start/);
  await rejects(err(404, 2010, 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 153 -27.').plan(1, { from, to, profile: 'walking' }), 422, /near the end/);
  await rejects(err(404, 2009, 'Route could not be found').plan(1, { from, to, profile: 'walking' }), 422, /No route could be found/);
  await rejects(err(400, 2004, 'too far').plan(1, { from: [153, -27], to: [153, -28.5], profile: 'walking' }), 422, /too far apart/);
  await rejects(err(429, 0, 'Rate limit exceeded').plan(1, { from, to, profile: 'walking' }), 429, /busy/);
  await rejects(err(403, 0, 'Access to this API has been disallowed').plan(1, { from, to, profile: 'walking' }), 502, /key was rejected/);
  await rejects(err(500, 2099, 'secret internal stack').plan(1, { from, to, profile: 'walking' }), 502, /problem/);
  await rejects(mk(() => { throw new Error('connect ECONNREFUSED 10.0.0.1'); }).plan(1, { from, to, profile: 'walking' }), 502, /did not answer/);
  await rejects(mk(() => ({ json: { features: [] } })).plan(1, { from, to, profile: 'walking' }), 422, /No route could be found/);

  // cache: the same request (even a metre off) is answered without another call and without using quota
  calls.length = 0;
  let clock = 1000000;
  const c = mk(() => ({ json: okJson }), { now: () => clock, perUserPerMinute: 2 });
  const a1 = await c.plan(1, { from, to, profile: 'walking' });
  const a2 = await c.plan(1, { from: [from[0] + 0.000001, from[1]], to, profile: 'walking' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(a1.cached, false);
  assert.strictEqual(a2.cached, true);
  assert.deepStrictEqual(a2.routes, a1.routes);
  await c.plan(1, { from, to, profile: 'cycling' }); // another profile is a new call
  assert.strictEqual(calls.length, 2);
  clock += 60 * 60 * 1000 + 1;
  await c.plan(1, { from, to, profile: 'walking' }); // past an hour: asked again
  assert.strictEqual(calls.length, 4 - 1);

  // ---- loops: one start point, a length, three seeds; the service misses the length, so the app asks again with a corrected one
  {
    const lcalls = [];
    const KEYS = { current: 'round_trip' };
    // a pretend service: the loop it returns is `bias` times as long as asked for, where bias depends on the seed; it only knows the option under KEYS.current
    const BIAS = { 1: 1.5, 2: 1.0, 3: 0.55, 4: 1.1, 5: 0.9, 6: 1.02 };
    const loopFetch = (url, init) => {
      const body = JSON.parse(init.body);
      lcalls.push({ url, body });
      const opt = body.options && body.options[KEYS.current];
      if (!opt) return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: { code: 2003, message: 'Unknown option' } }) });
      const len = opt.length * (BIAS[opt.seed] ?? 1);
      const out = len / 111320 / 2; // an out-and-back of that length; the seed picks the direction (north, east or west), as the real service does
      const far = opt.seed % 3 === 1 ? [from[0], from[1] + out] : opt.seed % 3 === 2 ? [from[0] + out, from[1]] : [from[0] - out, from[1]];
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: len, duration: len / 1.4 } }, geometry: { type: 'LineString', coordinates: [from, far, from] } }] }) });
    };
    const mkLoop = (extra = {}) => createPlanner({ getKey: () => KEY, fetchFn: loopFetch, ...extra });

    const lp = mkLoop();
    const res = await lp.loops(1, { from, lengthKm: 5, profile: 'walking', round: 0 });
    const first = lcalls.slice(0, 3);
    assert.ok(first.every((c) => c.url === 'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'));
    assert.ok(first.every((c) => c.body.coordinates.length === 1 && c.body.coordinates[0][0] === from[0]), 'one start point only');
    assert.deepStrictEqual(first.map((c) => c.body.options.round_trip.seed), [1, 2, 3], 'three different seeds');
    assert.ok(first.every((c) => c.body.options.round_trip.length === 5000 && c.body.options.round_trip.points === 5));
    assert.ok(first.every((c) => c.body.alternative_routes === undefined), 'no alternatives with a round trip');
    // seed 1 (1.5x) and seed 3 (0.55x) missed by more than 12%, so they were asked again with the length scaled by how far they missed
    assert.strictEqual(lcalls.length, 5);
    const redo = lcalls.slice(3).map((c) => c.body.options.round_trip);
    assert.deepStrictEqual(redo.map((r) => r.seed).sort(), [1, 3]);
    assert.strictEqual(redo.find((r) => r.seed === 1).length, Math.round(5000 * (5000 / 7500)));
    assert.strictEqual(redo.find((r) => r.seed === 3).length, Math.round(5000 * (5000 / 2750)));
    // after correction every loop is within a few per cent, closest first, and each says how far off it is
    assert.strictEqual(res.routes.length, 3);
    assert.ok(res.routes.every((r) => Math.abs(r.offPct) < 12), JSON.stringify(res.routes.map((r) => r.offPct)));
    assert.deepStrictEqual(res.routes.map((r) => Math.abs(r.offPct)), res.routes.map((r) => Math.abs(r.offPct)).slice().sort((a, b) => a - b), 'closest to the target first');
    assert.strictEqual(res.targetM, 5000);
    assert.ok(/openstreetmap/i.test(res.attribution));
    assert.strictEqual(res.cached, false);

    // cached: the same loop request is free; a different round asks for different seeds
    const n = lcalls.length;
    assert.strictEqual((await lp.loops(1, { from, lengthKm: 5.04, profile: 'walking', round: 0 })).cached, true, 'a typed 5.04 is the same loop as 5');
    assert.strictEqual(lcalls.length, n);
    await lp.loops(1, { from, lengthKm: 5, profile: 'walking', round: 1 });
    assert.deepStrictEqual(lcalls.slice(n, n + 3).map((c) => c.body.options.round_trip.seed), [4, 5, 6]);

    // validation
    await rejects(lp.loops(1, { from, lengthKm: 0.5, profile: 'walking' }), 400, /between 1 and 50/);
    await rejects(lp.loops(1, { from, lengthKm: 51, profile: 'walking' }), 400, /between 1 and 50/);
    await rejects(lp.loops(1, { from, lengthKm: 'five', profile: 'walking' }), 400);
    await rejects(lp.loops(1, { from, lengthKm: NaN, profile: 'walking' }), 400);
    await rejects(lp.loops(1, { from: [1], lengthKm: 5, profile: 'walking' }), 400);
    await rejects(lp.loops(1, { from, lengthKm: 5, profile: 'flying' }), 400);
    await rejects(createPlanner({ getKey: () => null, fetchFn: loopFetch }).loops(1, { from, lengthKm: 5, profile: 'walking' }), 503, /ORS_API_KEY/);

    // the other spelling of the option is tried when the service rejects the first, and remembered
    KEYS.current = 'round-trip';
    lcalls.length = 0;
    const alt = mkLoop();
    const altRes = await alt.loops(1, { from, lengthKm: 5, profile: 'cycling' });
    assert.ok(altRes.routes.length >= 1);
    assert.ok(lcalls.some((c) => c.body.options['round-trip']), 'tried round-trip');
    const before = lcalls.length;
    await alt.loops(1, { from: [153.1, -27.2], lengthKm: 5, profile: 'cycling' });
    assert.ok(lcalls.slice(before, before + 3).every((c) => c.body.options['round-trip']), 'then keeps using the one that worked');
    KEYS.current = 'round_trip';

    // errors: nothing near the start; every seed failing; a partial result is still returned
    const noRoad = createPlanner({ getKey: () => KEY, fetchFn: async () => ({ ok: false, status: 404, json: async () => ({ error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 0: 1 2.' } }) }) });
    await rejects(noRoad.loops(1, { from, lengthKm: 5, profile: 'walking' }), 422, /near the start/);
    const flaky = createPlanner({ getKey: () => KEY, fetchFn: (url, init) => { const b = JSON.parse(init.body); return b.options.round_trip.seed === 2 ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : loopFetch(url, init); } });
    const part = await flaky.loops(1, { from, lengthKm: 5, profile: 'walking' });
    assert.strictEqual(part.routes.length, 2, 'the loops that worked are returned');
    await rejects(createPlanner({ getKey: () => KEY, fetchFn: async () => { throw new Error('boom'); } }).loops(1, { from, lengthKm: 5, profile: 'walking' }), 502, /did not answer/);
    // a slow or dropped connection is tried once more before giving up (a voice request used to fail on one such moment), and the reason is logged
    let dropped = 0; const logged = [];
    const blip = createPlanner({ getKey: () => KEY, log: (m, d) => logged.push(`${m} ${d}`), fetchFn: (url, init) => { dropped += 1; if (dropped <= 3) return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })); return loopFetch(url, init); } });
    const blipRes = await blip.loops(1, { from, lengthKm: 5, profile: 'walking' });
    assert.ok(blipRes.routes.length >= 1, 'the loops come back after one dropped connection per seed');
    assert.ok(logged.length >= 1 && /TypeError: fetch failed \(ECONNRESET\)/.test(logged[0]), 'the log says why: ' + logged[0]);
    assert.ok(!logged.join(' ').includes(KEY), 'the key is never logged');
    const gone = createPlanner({ getKey: () => KEY, fetchFn: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
    await rejects(gone.loops(1, { from, lengthKm: 5, profile: 'walking' }), 502, /did not answer/);

    // quota: a loop costs three calls; running out during the correction keeps the first answers
    let tt = 9000000;
    const quota = createPlanner({ getKey: () => KEY, fetchFn: loopFetch, now: () => tt, perUserPerMinute: 4 });
    const q1 = await quota.loops(1, { from, lengthKm: 5, profile: 'walking' }); // 3 calls, correction (2 more) does not fit in 4: first answers stand
    assert.strictEqual(q1.routes.length, 3);
    await rejects(quota.loops(1, { from: [153.2, -27.3], lengthKm: 5, profile: 'walking' }), 429, /minute/);
    const perDay = createPlanner({ getKey: () => KEY, fetchFn: loopFetch, now: () => tt, perUserPerDay: 5 });
    await perDay.loops(1, { from: [153.3, -27.1], lengthKm: 5, profile: 'walking' });
    await rejects(perDay.loops(1, { from: [153.4, -27.1], lengthKm: 5, profile: 'walking' }), 429, /today/);
  }

  // ---- detour: A to B but about X km. The pretend service winds roads 1.3x; with `viaWind` it winds more when asked to go through a via point.
  {
    const A = [153.0, -27.5];
    const B = [153.03, -27.5]; // about 2.97 km apart
    const dcalls = [];
    const make = (viaWind = 1.3, fail = null) => createPlanner({
      getKey: () => KEY,
      fetchFn: async (url, init) => {
        const body = JSON.parse(init.body);
        dcalls.push(body);
        if (fail) { const f = fail(body); if (f) return { ok: false, status: f.status, json: async () => f.json }; }
        const pts = body.coordinates;
        const len = require('../services/routeTracerGeo').distanceM([pts]) * (pts.length === 3 ? viaWind : 1.3);
        return { ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: len, duration: len / 1.4 } }, geometry: { type: 'LineString', coordinates: pts } }] }) };
      },
    });
    const cross = (a, b, v) => (b[0] - a[0]) * (v[1] - a[1]) - (b[1] - a[1]) * (v[0] - a[0]); // > 0: v is to the left of A -> B
    const detourBody = { from: A, to: B, profile: 'walking' };
    const directKm = require('../services/routeTracerGeo').distanceM([[A, B]]) * 1.3 / 1000; // about 3.86

    // no length: just the direct route and its length, with one call and no alternatives
    let d = make();
    let res = await d.detour(1, detourBody);
    assert.strictEqual(dcalls.length, 1);
    assert.strictEqual(dcalls[0].coordinates.length, 2);
    assert.strictEqual(dcalls[0].alternative_routes, undefined);
    assert.strictEqual(res.routes.length, 1);
    assert.ok(Math.abs(res.directM / 1000 - directKm) < 0.001);
    assert.strictEqual(res.targetM, null);

    // a target shorter than the direct route cannot be met, and the answer carries the numbers for the page to word
    dcalls.length = 0;
    d = make();
    try { await d.detour(1, { ...detourBody, lengthKm: 2 }); assert.fail('should refuse'); } catch (e) {
      assert.ok(e instanceof PlanError); assert.strictEqual(e.status, 422);
      assert.strictEqual(e.extra.code, 'TARGET_TOO_SHORT');
      assert.ok(Math.abs(e.extra.directM / 1000 - directKm) < 0.001);
      assert.strictEqual(e.extra.targetM, 2000);
    }
    assert.strictEqual(dcalls.length, 1, 'only the direct route was asked for');
    // a target more than four times the direct route is refused too
    try { await make().detour(1, { ...detourBody, lengthKm: 40 }); assert.fail('should refuse'); } catch (e) {
      assert.strictEqual(e.extra.code, 'TARGET_TOO_LONG');
      assert.ok(e.extra.maxM > 15000 && e.extra.maxM < 16000, String(e.extra.maxM));
    }
    // within 6% above the direct route: the direct route is the answer
    dcalls.length = 0;
    res = await make().detour(1, { ...detourBody, lengthKm: 4 });
    assert.strictEqual(res.routes.length, 1);
    assert.strictEqual(dcalls.length, 1);
    assert.ok(Math.abs(res.routes[0].offPct) < 5);

    // a real detour: 8 km. A, a via point, B; three shapes, sides and positions as designed; the length lands on the target
    dcalls.length = 0;
    d = make();
    res = await d.detour(1, { ...detourBody, lengthKm: 8 });
    assert.strictEqual(dcalls.length, 4, 'one direct call and one per shape (the first try is right when roads wind evenly)');
    const via = dcalls.slice(1).map((c) => { assert.strictEqual(c.coordinates.length, 3); assert.deepStrictEqual(c.coordinates[0], A); assert.deepStrictEqual(c.coordinates[2], B); assert.strictEqual(c.alternative_routes, undefined); return c.coordinates[1]; });
    assert.ok(cross(A, B, via[0]) > 0 && cross(A, B, via[1]) < 0 && cross(A, B, via[2]) > 0, 'left, right and left again');
    assert.ok(Math.abs((via[0][0] - A[0]) / (B[0] - A[0]) - 0.5) < 0.01 && Math.abs((via[2][0] - A[0]) / (B[0] - A[0]) - 0.3) < 0.01, 'the via points sit 0.5 and 0.3 of the way along');
    assert.strictEqual(res.routes.length, 3);
    assert.ok(res.routes.every((r) => Math.abs(r.offPct) < 3), JSON.stringify(res.routes.map((r) => r.offPct)));
    assert.deepStrictEqual(res.routes.map((r) => Math.abs(r.offPct)), res.routes.map((r) => Math.abs(r.offPct)).slice().sort((a, b) => a - b));
    assert.strictEqual(res.targetM, 8000);
    assert.ok(res.routes.every((r) => r.coordinates.length === 3 && r.coordinates[0][0] === A[0] && r.coordinates.at(-1)[0] === B[0]), 'each route runs from A to B');

    // cached: the same request is free; a different round uses different shapes
    const n = dcalls.length;
    assert.strictEqual((await d.detour(1, { ...detourBody, lengthKm: 8.04 })).cached, true);
    assert.strictEqual(dcalls.length, n);
    dcalls.length = 0;
    await d.detour(1, { ...detourBody, lengthKm: 8, round: 1 });
    const via1 = dcalls.slice(1).map((c) => c.coordinates[1]);
    assert.ok(Math.abs((via1[0][0] - A[0]) / (B[0] - A[0]) - 0.7) < 0.01, 'round 1 puts the via point 0.7 of the way along');

    // roads that wind more through the via point than the direct estimate: each shape is corrected once and ends close to the target
    dcalls.length = 0;
    res = await make(1.7).detour(1, { ...detourBody, lengthKm: 8 });
    assert.strictEqual(dcalls.length, 7, 'one direct, three first tries and three corrections');
    assert.ok(res.routes.every((r) => Math.abs(r.offPct) <= 8), JSON.stringify(res.routes.map((r) => r.offPct)));

    // out of quota for the corrections: the first tries stand, however far off, and the answer says how far
    dcalls.length = 0;
    const tight = createPlanner({ getKey: () => KEY, perUserPerMinute: 4, fetchFn: async (url, init) => {
      const b = JSON.parse(init.body); dcalls.push(b);
      const len = require('../services/routeTracerGeo').distanceM([b.coordinates]) * (b.coordinates.length === 3 ? 1.7 : 1.3);
      return { ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: len, duration: 1 } }, geometry: { type: 'LineString', coordinates: b.coordinates } }] }) };
    } });
    res = await tight.detour(1, { ...detourBody, lengthKm: 8 });
    assert.strictEqual(dcalls.length, 4);
    assert.ok(res.routes.length >= 1 && res.routes.some((r) => Math.abs(r.offPct) > 8), JSON.stringify(res.routes.map((r) => r.offPct)));

    // validation and errors
    await rejects(make().detour(1, { ...detourBody, lengthKm: 0.5 }), 400, /between 1 and 100/);
    await rejects(make().detour(1, { ...detourBody, lengthKm: 101 }), 400, /between 1 and 100/);
    await rejects(make().detour(1, { ...detourBody, lengthKm: 'x' }), 400);
    await rejects(make().detour(1, { ...detourBody, from: [1] }), 400);
    await rejects(make().detour(1, { ...detourBody, profile: 'flying' }), 400);
    await rejects(make().detour(1, { ...detourBody, to: [153.0001, -27.5] }), 422, /almost the same/);
    await rejects(make().detour(1, { ...detourBody, to: [154, -27.5] }), 422, /too far apart/);
    await rejects(createPlanner({ getKey: () => null, fetchFn: async () => ({}) }).detour(1, detourBody), 503, /ORS_API_KEY/);
    // the direct route itself fails: the plain reason
    await rejects(make(1.3, () => ({ status: 404, json: { error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 0: 1 2.' } } })).detour(1, { ...detourBody, lengthKm: 8 }), 422, /near the start/);
    // the via points are not near roads (the direct route is fine): a friendly explanation of what to try
    await rejects(make(1.3, (b) => (b.coordinates.length === 3 ? { status: 404, json: { error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 1 2.' } } } : null)).detour(1, { ...detourBody, lengthKm: 8 }), 422, /not near roads or paths/);
    // some shapes fail and others work: the ones that worked are returned
    res = await make(1.3, (b) => (b.coordinates.length === 3 && cross(A, B, b.coordinates[1]) < 0 ? { status: 404, json: { error: { code: 2010, message: 'coordinate 1' } } } : null)).detour(1, { ...detourBody, lengthKm: 8 });
    assert.strictEqual(res.routes.length, 2);
    // a busy or broken service is reported as that, not as "no roads"
    await rejects(make(1.3, (b) => (b.coordinates.length === 3 ? { status: 500, json: {} } : null)).detour(1, { ...detourBody, lengthKm: 8 }), 502, /problem/);
    await rejects(make(1.3, (b) => (b.coordinates.length === 3 ? { status: 429, json: {} } : null)).detour(1, { ...detourBody, lengthKm: 8 }), 429, /busy/);
  }

  // ---- leg: one road or path between two clicks (Follow roads in Click mode)
  {
    const A = [153.0, -27.5];
    const B = [153.004, -27.5]; // about 400 m
    const lcalls = [];
    const road = (b) => [b.coordinates[0], [(b.coordinates[0][0] + b.coordinates[1][0]) / 2, b.coordinates[0][1] + 0.0008], b.coordinates[1]];
    const mkLeg = (extra = {}, fail = null) => createPlanner({
      getKey: () => KEY,
      fetchFn: async (url, init) => {
        const body = JSON.parse(init.body); lcalls.push({ url, body });
        if (fail) { const f = fail(body); if (f) return { ok: false, status: f.status, json: async () => f.json }; }
        const pts = road(body); const len = require('../services/routeTracerGeo').distanceM([pts]);
        return { ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: len, duration: len / 1.4 } }, geometry: { type: 'LineString', coordinates: pts } }] }) };
      },
      ...extra,
    });
    const g = mkLeg();
    const a = await g.leg(1, { from: A, to: B, profile: 'cycling' });
    assert.strictEqual(lcalls.length, 1);
    assert.strictEqual(lcalls[0].url, 'https://api.openrouteservice.org/v2/directions/cycling-regular/geojson');
    assert.deepStrictEqual(lcalls[0].body.coordinates, [A, B], 'two points, in order');
    assert.strictEqual(lcalls[0].body.alternative_routes, undefined, 'one route, no alternatives');
    assert.strictEqual(a.route.coordinates.length, 3, 'the road geometry, not just the two clicks');
    assert.ok(a.route.distanceM > 400);
    assert.strictEqual(a.cached, false);
    // the same two clicks again (to about a metre): free
    const b = await g.leg(1, { from: [A[0] + 0.000001, A[1]], to: B, profile: 'cycling' });
    assert.strictEqual(b.cached, true);
    assert.strictEqual(lcalls.length, 1);
    // a different way of travelling is a different road
    await g.leg(1, { from: A, to: B, profile: 'driving' });
    assert.strictEqual(lcalls.length, 2);
    // two clicks on the same spot: no call at all
    const same = await g.leg(1, { from: A, to: [A[0] + 0.00001, A[1]], profile: 'walking' });
    assert.strictEqual(lcalls.length, 2);
    assert.strictEqual(same.route.coordinates.length, 2);
    // validation and errors
    await rejects(g.leg(1, { from: [1], to: B, profile: 'walking' }), 400);
    await rejects(g.leg(1, { from: A, to: B, profile: 'flying' }), 400);
    await rejects(g.leg(1, { from: A, to: [153.0, -90.5], profile: 'walking' }), 400);
    await rejects(g.leg(1, { from: [0, 0], to: [90, 0], profile: 'walking' }), 422, /too far apart/);
    await rejects(createPlanner({ getKey: () => null, fetchFn: async () => ({}) }).leg(1, { from: A, to: B, profile: 'walking' }), 503, /ORS_API_KEY/);
    await rejects(mkLeg({}, () => ({ status: 404, json: { error: { code: 2010, message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate 1: 1 2.' } } })).leg(1, { from: A, to: B, profile: 'walking' }), 422, /near the end/);
    await rejects(mkLeg({}, () => ({ status: 404, json: { error: { code: 2009, message: 'Route could not be found' } } })).leg(1, { from: A, to: B, profile: 'walking' }), 422, /No route could be found/);
    await rejects(mkLeg({}, () => ({ status: 429, json: {} })).leg(1, { from: A, to: B, profile: 'walking' }), 429, /busy/);
    await rejects(mkLeg({}, () => ({ status: 500, json: {} })).leg(1, { from: A, to: B, profile: 'walking' }), 502, /problem/);
    // each leg is one call against the user's allowance; a click-heavy minute is allowed up to the limit, then it says so
    let tt = 7000000;
    const lim = mkLeg({ now: () => tt, perUserPerMinute: 3 });
    for (let i = 0; i < 3; i += 1) await lim.leg(1, { from: [153 + i * 0.01, -27.5], to: [153 + i * 0.01 + 0.004, -27.5], profile: 'walking' });
    await rejects(lim.leg(1, { from: [153.5, -27.5], to: [153.504, -27.5], profile: 'walking' }), 429, /minute/);
    tt += 61000;
    await lim.leg(1, { from: [153.5, -27.5], to: [153.504, -27.5], profile: 'walking' });
    // the defaults are generous enough for a person building a route
    const def = createPlanner({ getKey: () => KEY, fetchFn: async (u, i) => ({ ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: 1, duration: 1 } }, geometry: { type: 'LineString', coordinates: JSON.parse(i.body).coordinates } }] }) }) });
    for (let i = 0; i < 20; i += 1) await def.leg(1, { from: [153 + i * 0.01, -27.5], to: [153 + i * 0.01 + 0.004, -27.5], profile: 'walking' });
  }

  // limits: per user per minute, per day, and across everyone per minute; they reset
  let t = 5000000;
  const lim = createPlanner({ getKey: () => KEY, fetchFn: fakeFetch(() => ({ json: okJson })), now: () => t, perUserPerMinute: 3, perUserPerDay: 5, globalPerMinute: 4 });
  const far = (i) => ({ from: [153 + i * 0.01, -27], to: [153 + i * 0.01, -27.02], profile: 'walking' });
  for (let i = 0; i < 3; i += 1) await lim.plan(1, far(i));
  await rejects(lim.plan(1, far(3)), 429, /minute/);
  await lim.plan(2, far(4)); // another user, still within the global cap (4th call this minute)
  await rejects(lim.plan(3, far(5)), 429, /busy/); // global cap reached
  t += 61000;
  await lim.plan(1, far(6)); // minute over: allowed (user 1's 4th call today)
  await lim.plan(1, far(7)); // 5th today
  await rejects(lim.plan(1, far(8)), 429, /today/);
  t += 86400000 + 1000;
  await lim.plan(1, far(9)); // a new day
}

(async () => {
  await planTests();

  // ---- config

  {
    const s = build(fakePool(), 1, { getMapKey: () => 'KEY123' }).listen(0);
    const r = await call(s, 'GET', '/api/route-tracks/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.maptilerKey, 'KEY123');
    assert.strictEqual(r.headers.get('cache-control'), 'no-store');
    s.close();
  }
  {
    const s = build(fakePool(), 1, { getMapKey: () => null }).listen(0);
    assert.strictEqual((await call(s, 'GET', '/api/route-tracks/config')).json.maptilerKey, null);
    s.close();
  }

  // ---- the owner's check: does the routing service answer from this server, and how fast (admin only, never the key)
  {
    const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: 500, duration: 360 } }, geometry: { type: 'LineString', coordinates: [[-6.31, 53.29], [-6.30, 53.29]] } }] }) });
    const opened = [];
    const asAdmin = (fetchFn, getOrsKey = () => 'ors-secret', isAdmin = true) => {
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => { req.user = { id: 1, isAdmin }; next(); });
      app.use('/api/route-tracks', createRouter(fakePool(), { emailConfigured: async () => false, getMapKey: () => 'K', getOrsKey, fetchFn }));
      const srv = http.createServer(app).listen(0);
      opened.push(srv);
      return srv;
    };
    const good = await call(asAdmin(okFetch), 'GET', '/api/route-tracks/diagnose');
    assert.strictEqual(good.status, 200);
    assert.strictEqual(good.json.ok, true);
    assert.match(good.json.summary, /working from this server/);
    assert.ok(!good.text.includes('ors-secret'), 'the key is never in the answer');
    assert.strictEqual((await call(asAdmin(okFetch, () => 'k', false), 'GET', '/api/route-tracks/diagnose')).status, 403, 'only an administrator');
    const noKey = await call(asAdmin(okFetch, () => null), 'GET', '/api/route-tracks/diagnose');
    assert.strictEqual(noKey.json.ok, false); assert.strictEqual(noKey.json.keySet, false);
    const refused = await call(asAdmin(async () => ({ ok: false, status: 403, json: async () => ({}) })), 'GET', '/api/route-tracks/diagnose');
    assert.strictEqual(refused.json.ok, false); assert.strictEqual(refused.json.route.status, 403); assert.match(refused.json.summary, /rejected/);
    const down = await call(asAdmin(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }), 'GET', '/api/route-tracks/diagnose');
    assert.strictEqual(down.json.ok, false); assert.match(down.json.summary, /Nothing answered from this server/); assert.match(down.json.summary, /ENOTFOUND/);
    // only the routing service silent: the control site answers
    const only = await call(asAdmin(async (url) => { if (String(url).includes('openrouteservice')) throw Object.assign(new Error('x'), { name: 'AbortError' }); return { ok: true, status: 204, text: async () => '' }; }), 'GET', '/api/route-tracks/diagnose');
    assert.strictEqual(only.json.ok, false); assert.match(only.json.summary, /routing service is down, or it is blocking this host/); assert.strictEqual(only.json.control.ok, true);
    // everything answers except the routing request itself
    const ping = await call(asAdmin(async (url, init) => { if (init && init.method === 'POST') throw Object.assign(new Error('x'), { name: 'AbortError' }); return { ok: true, status: 200, text: async () => '' }; }), 'GET', '/api/route-tracks/diagnose');
    assert.match(ping.json.summary, /service is up but is not answering routing requests/);
    assert.strictEqual((await call(asAdmin(okFetch), 'GET', '/api/route-tracks/config')).json.isAdmin, true, 'config tells the page whether to show the check');
    assert.strictEqual((await call(asAdmin(okFetch, () => 'k', false), 'GET', '/api/route-tracks/config')).json.isAdmin, false);
    opened.forEach((srv) => srv.close());
  }

  // ---- /plan through the router: signed-in user's id for the limits, errors become JSON with the right status, the key stays out
  {
    const calls = [];
    const orsFetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: 2100, duration: 1500 } }, geometry: { type: 'LineString', coordinates: [[153.028, -27.468], [153.045, -27.475]] } }] }) }; };
    const ps = build(fakePool(), 1, { getMapKey: () => 'K', getOrsKey: () => 'ors-secret', fetchFn: orsFetch }).listen(0);
    assert.strictEqual((await call(ps, 'GET', '/api/route-tracks/config')).json.routePlanning, true);
    const ok = await call(ps, 'POST', '/api/route-tracks/plan', { from: [153.028, -27.468], to: [153.045, -27.475], profile: 'walking' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.routes[0].distanceM, 2100);
    assert.ok(!ok.text.includes('ors-secret'), 'the key never reaches the browser');
    assert.strictEqual(calls[0].init.headers.Authorization, 'ors-secret');
    const bad = await call(ps, 'POST', '/api/route-tracks/plan', { from: [153.028, -27.468], to: [153.045, -27.475], profile: 'teleport' });
    assert.strictEqual(bad.status, 400);
    assert.ok(bad.json.error);
    assert.strictEqual((await call(ps, 'POST', '/api/route-tracks/plan', {})).status, 400);
    ps.close();
    // /loop through the router
    const loopCalls = [];
    const loopFetch2 = async (url, init) => { loopCalls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ features: [{ properties: { summary: { distance: 5000, duration: 3600 } }, geometry: { type: 'LineString', coordinates: [[153.028, -27.468], [153.03, -27.47], [153.028, -27.468]] } }] }) }; };
    const ls = build(fakePool(), 1, { getMapKey: () => 'K', getOrsKey: () => 'ors-secret', fetchFn: loopFetch2 }).listen(0);
    const lc = await call(ls, 'GET', '/api/route-tracks/config');
    assert.deepStrictEqual(lc.json.loopKm, { min: 1, max: 50 });
    const lr = await call(ls, 'POST', '/api/route-tracks/loop', { from: [153.028, -27.468], lengthKm: 5, profile: 'walking' });
    assert.strictEqual(lr.status, 200);
    assert.strictEqual(lr.json.routes[0].distanceM, 5000);
    assert.strictEqual(lr.json.routes[0].offPct, 0);
    assert.ok(!lr.text.includes('ors-secret'));
    assert.strictEqual((await call(ls, 'POST', '/api/route-tracks/loop', { from: [153.028, -27.468], lengthKm: 500, profile: 'walking' })).status, 400);
    assert.strictEqual((await call(ls, 'POST', '/api/route-tracks/loop', {})).status, 400);
    // /email through the router
    {
      const sent = [];
      const pdfB64 = Buffer.from('%PDF-1.7\n' + 'x'.repeat(300)).toString('base64');
      const mkEmail = (opts = {}, user = 1, userEmail = 'me@example.com') => {
        const app = express();
        app.use(express.json({ limit: '30mb' }));
        app.use((req, res, next) => { req.user = { id: user, email: userEmail }; next(); });
        app.use('/api/route-tracks', createRouter(fakePool(), { getMapKey: () => 'K', sendEmailFn: async (m) => { sent.push(m); return { ok: true, provider: 'test' }; }, emailConfigured: async () => true, ...opts }));
        return http.createServer(app).listen(0);
      };
      const es = mkEmail();
      const body = { to: 'friend@example.com', message: 'Here is the route <b>now</b> & more', subject: 'Morning loop\r\nBcc: evil@example.com', filename: '../Morning loop?.pdf', pdf: pdfB64, copyToMe: true };
      const ok = await call(es, 'POST', '/api/route-tracks/email', body);
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(ok.json, { ok: true, copied: true });
      const m = sent[0];
      assert.strictEqual(m.to, 'friend@example.com');
      assert.strictEqual(m.cc, 'me@example.com', 'a copy to the sender when asked');
      assert.strictEqual(m.replyTo, 'me@example.com', 'replies go to the sender');
      assert.ok(!/[\r\n]/.test(m.subject) && m.subject.startsWith('Morning loop'), 'the subject cannot carry a header');
      assert.ok(!/<b>/.test(m.html) && /&lt;b&gt;now&lt;\/b&gt; &amp; more/.test(m.html), 'the message is escaped: plain text only');
      assert.strictEqual(m.attachments.length, 1);
      assert.strictEqual(m.attachments[0].contentType, 'application/pdf');
      assert.ok(/^[\w\-. ]+\.pdf$/.test(m.attachments[0].filename) && !m.attachments[0].filename.includes('/') && !m.attachments[0].filename.includes('..'.repeat(2)), m.attachments[0].filename);
      assert.strictEqual(m.attachments[0].content.subarray(0, 5).toString('latin1'), '%PDF-');
      // no copy unless asked, and none to the same address
      sent.length = 0;
      await call(es, 'POST', '/api/route-tracks/email', { ...body, copyToMe: false });
      assert.strictEqual(sent[0].cc, undefined);
      await call(es, 'POST', '/api/route-tracks/email', { ...body, to: 'ME@example.com' });
      assert.strictEqual(sent[1].cc, undefined);
      // one recipient only, a real address
      sent.length = 0;
      for (const to of ['', 'nobody', 'a@b', 'a@b.com, c@d.com', 'a@b.com;c@d.com', 'a@b.com\nBcc: c@d.com', '<a@b.com>', 'x'.repeat(300) + '@b.com', 'a b@c.com', undefined, 5, ['a@b.com']]) {
        assert.strictEqual((await call(es, 'POST', '/api/route-tracks/email', { ...body, to })).status, 400, JSON.stringify(to));
      }
      // the attachment must be a PDF, not too big, and base64
      for (const pdf of ['', undefined, 'not base64!!', Buffer.from('hello world, this is not a pdf '.repeat(10)).toString('base64'), Buffer.from('%PDF-').toString('base64'), 123]) {
        assert.strictEqual((await call(es, 'POST', '/api/route-tracks/email', { ...body, pdf })).status, 400, String(pdf).slice(0, 20));
      }
      const huge = Buffer.alloc(8 * 1024 * 1024 + 10, 65); huge.write('%PDF-', 0, 'latin1');
      assert.strictEqual((await call(es, 'POST', '/api/route-tracks/email', { ...body, pdf: huge.toString('base64') })).status, 413);
      assert.strictEqual((await call(es, 'POST', '/api/route-tracks/email', { ...body, message: 'x'.repeat(2001) })).status, 400);
      assert.strictEqual(sent.length, 0, 'nothing was sent for any refused request');
      // the data-url form a browser might send
      assert.strictEqual((await call(es, 'POST', '/api/route-tracks/email', { ...body, pdf: `data:application/pdf;base64,${pdfB64}` })).status, 200);
      es.close();
      // allowances: per hour and per day, per person; they reset
      let tt = 1000000;
      const lim = mkEmail({ emailLimits: { now: () => tt, perHour: 2, perDay: 3 } });
      for (let i = 0; i < 2; i += 1) assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/email', body)).status, 200);
      const hr = await call(lim, 'POST', '/api/route-tracks/email', body);
      assert.strictEqual(hr.status, 429);
      assert.ok(hr.headers.get('retry-after'));
      tt += 3600001;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/email', body)).status, 200);
      const day = await call(lim, 'POST', '/api/route-tracks/email', body);
      assert.strictEqual(day.status, 429);
      assert.match(day.json.error, /today/);
      tt += 86400001;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/email', body)).status, 200);
      lim.close();
      // a failed send does not use an allowance, says plainly why, and never leaks the provider text
      const bad = mkEmail({ sendEmailFn: async () => { throw new Error('MailChannels error 401: secret-key-leak'); } });
      const f = await call(bad, 'POST', '/api/route-tracks/email', body);
      assert.strictEqual(f.status, 502);
      assert.ok(!/secret-key-leak|MailChannels/.test(f.text));
      bad.close();
      const notSet = mkEmail({ sendEmailFn: async () => { throw new Error('Email delivery is not configured. Set MAIL_CHANNEL_API_KEY'); } });
      const n = await call(notSet, 'POST', '/api/route-tracks/email', body);
      assert.strictEqual(n.status, 503);
      assert.match(n.json.error, /not set up/);
      notSet.close();
      const off = mkEmail({ sendEmailFn: async () => ({ ok: false, skipped: true }) });
      assert.strictEqual((await call(off, 'POST', '/api/route-tracks/email', body)).status, 503);
      off.close();
      // /:id/email-file: the file is made on the server from the stored track
      {
        const fe = mkEmail();
        const made = await call(fe, 'POST', '/api/route-tracks', input({ name: 'Bip <loop>' }));
        const tid = made.json.track.id;
        sent.length = 0;
        const em = await call(fe, 'POST', `/api/route-tracks/${tid}/email-file`, { to: 'friend@example.com', format: 'tcx', message: 'Hi <b>', copyToMe: true });
        assert.strictEqual(em.status, 200);
        assert.deepStrictEqual(em.json, { ok: true, copied: true });
        const fm = sent[0];
        assert.strictEqual(fm.cc, 'me@example.com');
        assert.ok(/^[\w\-. ]+\.tcx$/.test(fm.attachments[0].filename), fm.attachments[0].filename);
        assert.ok(fm.attachments[0].content.toString('utf8').includes('<Course>'), 'a TCX course made from the stored track');
        assert.ok(!/<b>/.test(fm.html), 'message escaped');
        sent.length = 0;
        assert.strictEqual((await call(fe, 'POST', `/api/route-tracks/${tid}/email-file`, { to: 'friend@example.com' })).status, 200, 'default gpx');
        assert.ok(sent[0].attachments[0].filename.endsWith('.gpx'));
        assert.strictEqual((await call(fe, 'POST', `/api/route-tracks/${tid}/email-file`, { to: 'friend@example.com', format: 'exe' })).status, 400);
        assert.strictEqual((await call(fe, 'POST', `/api/route-tracks/${tid}/email-file`, { to: 'a@b.com, c@d.com', format: 'gpx' })).status, 400, 'one recipient');
        assert.strictEqual((await call(fe, 'POST', `/api/route-tracks/${crypto.randomUUID()}/email-file`, { to: 'friend@example.com' })).status, 404);
        assert.strictEqual((await call(fe, 'POST', '/api/route-tracks/nope/email-file', { to: 'friend@example.com' })).status, 404);
        fe.close();
        // another person cannot email a track that is not theirs
        const stranger = mkEmail({}, 2, 'x@example.com');
        assert.strictEqual((await call(stranger, 'POST', `/api/route-tracks/${tid}/email-file`, { to: 'friend@example.com' })).status, 404);
        stranger.close();
      }
      // /config says whether email is set up
      const withMail = mkEmail();
      assert.strictEqual((await call(withMail, 'GET', '/api/route-tracks/config')).json.emailEnabled, true);
      withMail.close();
      const noMail = mkEmail({ emailConfigured: async () => false });
      assert.strictEqual((await call(noMail, 'GET', '/api/route-tracks/config')).json.emailEnabled, false);
      noMail.close();
      const brokenCheck = mkEmail({ emailConfigured: async () => { throw new Error('db down'); } });
      assert.strictEqual((await call(brokenCheck, 'GET', '/api/route-tracks/config')).json.emailEnabled, false);
      brokenCheck.close();
    }

    // /ask through the router
    {
      const asked = [];
      const mkAsk = (opts = {}) => {
        const app = express();
        app.use(express.json({ limit: '30mb' }));
        app.use((req, res, next) => { req.user = { id: 1, email: 'me@example.com' }; next(); });
        app.use('/api/route-tracks', createRouter(fakePool(), { getMapKey: () => 'K', emailConfigured: async () => false, ...opts }));
        return http.createServer(app).listen(0);
      };
      const aiAnswer = { intent: { kind: 'direct', from: 'A Town', to: 'B Town', lengthKm: null, profile: 'cycling' }, via: 'ai' };
      const as = mkAsk({ understandFn: async (text, user) => { asked.push({ text, user }); return /unclear/.test(text) ? aiAnswer : { intent: { kind: 'direct', from: 'Morningside', to: 'Carindale', lengthKm: null, profile: null }, via: 'local' }; }, needsAiFn: (text) => /unclear/.test(text) });
      const good = await call(as, 'POST', '/api/route-tracks/ask', { text: '  give me a route   from Morningside to Carindale ' });
      assert.strictEqual(good.status, 200);
      assert.deepStrictEqual(good.json, { intent: { kind: 'direct', from: 'Morningside', to: 'Carindale', lengthKm: null, profile: null }, via: 'local' });
      assert.strictEqual(asked[0].text, 'give me a route from Morningside to Carindale', 'spaces tidied');
      assert.strictEqual(asked[0].user.id, 1);
      // text must be a sentence
      asked.length = 0;
      for (const text of ['', '   ', undefined, null, 5, {}, ['route from a to b']]) assert.strictEqual((await call(as, 'POST', '/api/route-tracks/ask', { text })).status, 400, JSON.stringify(text));
      assert.strictEqual((await call(as, 'POST', '/api/route-tracks/ask', { text: 'x'.repeat(301) })).status, 400);
      assert.strictEqual((await call(as, 'POST', '/api/route-tracks/ask', undefined)).status, 400);
      assert.strictEqual(asked.length, 0, 'nothing understood for a refused request');
      as.close();
      // allowance counts only the requests that used the AI
      let tt = 5000000;
      const lim = mkAsk({ askLimits: { now: () => tt, perHour: 2, perDay: 3 }, understandFn: async (text) => (/unclear/.test(text) ? aiAnswer : { intent: { kind: 'none' }, via: 'local' }), needsAiFn: (text) => /unclear/.test(text) });
      for (let i = 0; i < 10; i += 1) assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/ask', { text: 'route from a to b' })).status, 200, 'pattern requests are free');
      for (let i = 0; i < 2; i += 1) assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/ask', { text: 'something unclear' })).status, 200);
      const hr = await call(lim, 'POST', '/api/route-tracks/ask', { text: 'something unclear' });
      assert.strictEqual(hr.status, 429);
      assert.ok(hr.headers.get('retry-after'));
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/ask', { text: 'route from a to b' })).status, 200, 'and pattern requests still work when the AI allowance is used up');
      tt += 3600001;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/ask', { text: 'something unclear' })).status, 200);
      const day = await call(lim, 'POST', '/api/route-tracks/ask', { text: 'something unclear' });
      assert.strictEqual(day.status, 429);
      assert.match(day.json.error, /today/);
      tt += 86400001;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/ask', { text: 'something unclear' })).status, 200);
      lim.close();
      // a failing model is a plain message, never its own text, and uses no allowance
      let fails = 0;
      const bad = mkAsk({ askLimits: { perHour: 1, perDay: 1 }, understandFn: async () => { fails += 1; throw new Error('Anthropic 401 secret-key-leak'); }, needsAiFn: () => true });
      for (let i = 0; i < 3; i += 1) {
        const f = await call(bad, 'POST', '/api/route-tracks/ask', { text: 'something unclear' });
        assert.strictEqual(f.status, 502);
        assert.ok(!/secret-key-leak|Anthropic/.test(f.text));
      }
      assert.strictEqual(fails, 3);
      bad.close();
    }

    // /places through the router
    {
      const { PlacesError } = require('../services/routePlaces');
      const asked = [];
      const sample = { places: [{ id: 'n1', name: 'Near Museum', category: 'museums', lat: -27.5, lng: 153.05, distKm: 0.1, notable: false }], counts: { museums: 1 }, truncated: false, radiusKm: 2, routeKm: 9.9, cached: false };
      const mkPlaces = (svc, limits) => {
        const app = express();
        app.use(express.json({ limit: '30mb' }));
        app.use((req, res, next) => { req.user = { id: 1, email: 'me@example.com' }; next(); });
        app.use('/api/route-tracks', createRouter(fakePool(), { getMapKey: () => 'K', emailConfigured: async () => false, placesService: svc, placesLimits: limits }));
        return http.createServer(app).listen(0);
      };
      const ps = mkPlaces({ near: async (a) => { asked.push(a); return sample; } });
      const line = [[153, -27.5], [153.05, -27.5]];
      const ok = await call(ps, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 });
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(ok.json.places, sample.places);
      assert.deepStrictEqual(ok.json.counts, { museums: 1 });
      assert.strictEqual(ok.json.categories.length, 9, 'the categories come from the server: one list of labels and colours');
      assert.ok(ok.json.categories.every((c) => c.id && c.label && /^#[0-9a-f]{6}$/i.test(c.color)));
      assert.match(ok.json.attribution, /OpenStreetMap/);
      assert.deepStrictEqual(asked[0], { line, radiusKm: 2 });
      assert.ok(!('cached' in ok.json));
      ps.close();
      // what the service refuses is passed on in plain words with its status; anything else is a plain 502 with no internals
      for (const [status, msg] of [[400, 'Choose a route first.'], [422, 'Too much ground.'], [503, 'Busy.']]) {
        const bad = mkPlaces({ near: async () => { throw new PlacesError(status, msg); } });
        const r = await call(bad, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 });
        assert.strictEqual(r.status, status);
        assert.strictEqual(r.json.error, msg);
        bad.close();
      }
      const broken = mkPlaces({ near: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1 secret-internal'); } });
      const br = await call(broken, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 });
      assert.strictEqual(br.status, 502);
      assert.ok(!/ECONNREFUSED|secret|10\.0/.test(br.text));
      broken.close();
      const typeBug = mkPlaces({ near: async () => { null.x; } });
      assert.strictEqual((await call(typeBug, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 })).status, 502);
      typeBug.close();
      // the real service validates the body (no body, no line, no distance)
      const real = mkPlaces(undefined);
      for (const body of [undefined, {}, { line }, { radiusKm: 2 }, { line: 'x', radiusKm: 2 }, { line, radiusKm: '2' }, { line, radiusKm: 50 }, { line: [[1, 1]], radiusKm: 2 }]) {
        const r = await call(real, 'POST', '/api/route-tracks/places', body);
        assert.ok(r.status === 400, `${JSON.stringify(body)} -> ${r.status}`);
      }
      real.close();
      // allowance: only NEW questions count (a cached answer is free); per hour and per day; a failed one counts nothing
      let tt = 9000000; let n = 0; let cached = false; let failing = false;
      const lim = mkPlaces({ near: async () => { n += 1; if (failing) throw new PlacesError(503, 'Busy.'); return { ...sample, cached }; } }, { now: () => tt, perHour: 2, perDay: 3 });
      for (let i = 0; i < 2; i += 1) assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 })).status, 200);
      const hr = await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 });
      assert.strictEqual(hr.status, 429);
      assert.ok(hr.headers.get('retry-after'));
      assert.strictEqual(n, 2, 'the service was not asked once the allowance was used');
      tt += 3600001;
      failing = true;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 })).status, 503);
      failing = false; cached = true;
      for (let i = 0; i < 5; i += 1) assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 })).status, 200, 'cached answers are free');
      cached = false;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 })).status, 200);
      const day = await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 });
      assert.strictEqual(day.status, 429);
      assert.match(day.json.error, /today/);
      tt += 86400001;
      assert.strictEqual((await call(lim, 'POST', '/api/route-tracks/places', { line, radiusKm: 2 })).status, 200);
      lim.close();
    }

    // /leg through the router
    const legRes = await call(ls, 'POST', '/api/route-tracks/leg', { from: [153.028, -27.468], to: [153.03, -27.469], profile: 'walking' });
    assert.strictEqual(legRes.status, 200);
    assert.ok(Array.isArray(legRes.json.route.coordinates) && legRes.json.route.coordinates.length >= 2);
    assert.ok(!legRes.text.includes('ors-secret'));
    assert.strictEqual((await call(ls, 'POST', '/api/route-tracks/leg', { from: [1], to: [2], profile: 'walking' })).status, 400);
    // /detour through the router: the error carries the code and distances for the page
    const dr = await call(ls, 'POST', '/api/route-tracks/detour', { from: [153.028, -27.468], to: [153.045, -27.475], profile: 'walking' });
    assert.strictEqual(dr.status, 200);
    assert.strictEqual(dr.json.directM, 5000);
    assert.strictEqual(dr.json.targetM, null);
    const short = await call(ls, 'POST', '/api/route-tracks/detour', { from: [153.028, -27.468], to: [153.045, -27.475], profile: 'walking', lengthKm: 1 });
    assert.strictEqual(short.status, 422);
    assert.strictEqual(short.json.code, 'TARGET_TOO_SHORT');
    assert.strictEqual(short.json.directM, 5000);
    assert.ok(!short.text.includes('ors-secret'));
    assert.strictEqual((await call(ls, 'POST', '/api/route-tracks/detour', {})).status, 400);
    assert.deepStrictEqual((await call(ls, 'GET', '/api/route-tracks/config')).json.detourKm, { min: 1, max: 100 });
    ls.close();
    const off = build(fakePool(), 1, { getMapKey: () => 'K', getOrsKey: () => null }).listen(0);
    assert.strictEqual((await call(off, 'GET', '/api/route-tracks/config')).json.routePlanning, false);
    const r503 = await call(off, 'POST', '/api/route-tracks/plan', { from: [153.028, -27.468], to: [153.045, -27.475], profile: 'walking' });
    assert.strictEqual(r503.status, 503);
    assert.match(r503.json.error, /ORS_API_KEY/);
    off.close();
    const slow = build(fakePool(), 1, { getOrsKey: () => 'k', fetchFn: orsFetch, planLimits: { perUserPerMinute: 1 } }).listen(0);
    const one = { from: [153.028, -27.468], to: [153.045, -27.475], profile: 'walking' };
    assert.strictEqual((await call(slow, 'POST', '/api/route-tracks/plan', one)).status, 200);
    const two = await call(slow, 'POST', '/api/route-tracks/plan', { ...one, to: [153.05, -27.48] });
    assert.strictEqual(two.status, 429);
    assert.ok(two.headers.get('retry-after'));
    slow.close();
  }

  // ---- create ignores client-sent numbers and recomputes them
  const pool = fakePool();
  const s = build(pool, 1).listen(0);
  const created = await call(s, 'POST', '/api/route-tracks', input({ distanceM: 1, pointCount: 1, bbox: [0, 0, 0, 0], notes: '  hello ', color: '#1d6fa5' }));
  assert.strictEqual(created.status, 201);
  const t = created.json.track;
  assert.strictEqual(t.pointCount, 5);
  assert.ok(Math.abs(t.distanceM - geo.distanceM([line(5)])) < 1e-6 && t.distanceM > 100, 'distance is recomputed');
  assert.deepStrictEqual(t.bbox, geo.bboxOf([line(5)]));
  assert.strictEqual(t.notes, 'hello');
  assert.strictEqual(t.color, '#1D6FA5');
  assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ color: undefined }))).json.track.color, '#E4572E', 'default colour');
  assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ drawMode: 'import' }))).json.track.drawMode, 'import', 'imported tracks say so');
  assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ drawMode: 'route' }))).json.track.drawMode, 'route', 'planned routes say so');

  // ---- validation
  for (const bad of [
    input({ name: '   ' }), input({ name: undefined }), input({ drawMode: 'pen' }), input({ color: 'red' }), input({ notes: 'x'.repeat(2001) }),
    input({ geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [200, 0]]] } }),
    input({ geometry: { type: 'MultiLineString', coordinates: [] } }),
    input({ geometry: undefined }),
  ]) {
    const r = await call(s, 'POST', '/api/route-tracks', bad);
    assert.strictEqual(r.status, 400, JSON.stringify(bad).slice(0, 80));
    assert.ok(r.json.error);
  }
  const big = await call(s, 'POST', '/api/route-tracks', { ...input(), geometry: { type: 'MultiLineString', coordinates: [Array.from({ length: geo.MAX_POINTS + 1 }, () => [1, 1])] } });
  assert.strictEqual(big.status, 400);
  { // a real body over 1 MB is refused with 413, before it is looked at
    const huge = input({ notes: 'x'.repeat(1.2 * 1024 * 1024) });
    const r = await call(s, 'POST', '/api/route-tracks', huge);
    assert.strictEqual(r.status, 413);
  }
  assert.strictEqual(pool.rows.length, 4, 'refused requests stored nothing');

  // ---- get / ownership
  const id = t.id;
  const got = await call(s, 'GET', `/api/route-tracks/${id}`);
  assert.strictEqual(got.status, 200);
  assert.deepStrictEqual(got.json.track.geometry.coordinates, [line(5)]);
  assert.strictEqual((await call(s, 'GET', '/api/route-tracks/not-a-uuid')).status, 404);
  assert.strictEqual((await call(s, 'GET', `/api/route-tracks/${crypto.randomUUID()}`)).status, 404);
  const other = build(pool, 2).listen(0);
  assert.strictEqual((await call(other, 'GET', `/api/route-tracks/${id}`)).status, 404, 'another user cannot read it');
  assert.strictEqual((await call(other, 'PATCH', `/api/route-tracks/${id}`, { name: 'mine now' })).status, 404);
  assert.strictEqual((await call(other, 'DELETE', `/api/route-tracks/${id}`)).status, 404);
  assert.strictEqual((await call(other, 'GET', `/api/route-tracks/${id}/gpx`)).status, 404);
  assert.strictEqual((await call(other, 'GET', `/api/route-tracks/${id}/file?format=tcx`)).status, 404, 'file export is owner-only too');
  assert.strictEqual((await call(other, 'GET', '/api/route-tracks')).json.tracks.length, 0, 'another user sees none');
  other.close();

  // ---- patch: rename, notes, colour, geometry (extend) recomputes stats
  let r = await call(s, 'PATCH', `/api/route-tracks/${id}`, { name: 'Renamed', color: '#2e7d32' });
  assert.strictEqual(r.json.track.name, 'Renamed');
  assert.strictEqual(r.json.track.color, '#2E7D32');
  assert.strictEqual(r.json.track.notes, 'hello', 'untouched fields stay');
  assert.strictEqual((await call(s, 'PATCH', `/api/route-tracks/${id}`, { notes: null })).json.track.notes, null, 'notes can be cleared');
  const longer = [line(5), line(4, 1)];
  r = await call(s, 'PATCH', `/api/route-tracks/${id}`, { geometry: { type: 'MultiLineString', coordinates: longer }, distanceM: 5 });
  assert.strictEqual(r.json.track.pointCount, 9);
  assert.ok(Math.abs(r.json.track.distanceM - geo.distanceM(longer)) < 1e-6);
  assert.strictEqual((await call(s, 'PATCH', `/api/route-tracks/${id}`, { name: '' })).status, 400);
  assert.strictEqual((await call(s, 'PATCH', `/api/route-tracks/${id}`, { geometry: { type: 'MultiLineString', coordinates: [[[0, 0]]] } })).status, 400);

  // ---- list: newest first, search, paging
  for (let i = 0; i < 5; i += 1) await call(s, 'POST', '/api/route-tracks', input({ name: `Run ${i}` }));
  let list = await call(s, 'GET', '/api/route-tracks');
  assert.strictEqual(list.json.tracks.length, 9);
  assert.strictEqual(list.json.tracks[0].name, 'Run 4', 'newest first');
  assert.ok(!('geometry' in list.json.tracks[0]), 'summaries carry no geometry');
  assert.strictEqual(list.json.nextCursor, null);
  const seen = [];
  let cursor = null;
  do {
    const p = await call(s, 'GET', `/api/route-tracks?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
    assert.strictEqual(p.status, 200);
    seen.push(...p.json.tracks.map((x) => x.id));
    cursor = p.json.nextCursor;
  } while (cursor);
  assert.strictEqual(new Set(seen).size, 9, 'paging visits each track once');
  assert.deepStrictEqual(seen, list.json.tracks.map((x) => x.id), 'paging keeps the order');
  assert.strictEqual((await call(s, 'GET', '/api/route-tracks?q=run%203')).json.tracks.length, 1);
  assert.strictEqual((await call(s, 'GET', '/api/route-tracks?q=%25')).json.tracks.length, 0, '% is not a wildcard');
  assert.strictEqual((await call(s, 'GET', '/api/route-tracks?cursor=garbage')).status, 400);

  // ---- gpx
  const g = await call(s, 'GET', `/api/route-tracks/${id}/gpx`);
  assert.strictEqual(g.status, 200);
  assert.ok(g.headers.get('content-type').startsWith('application/gpx+xml'));
  assert.ok(/attachment; filename="Renamed\.gpx"/.test(g.headers.get('content-disposition')));
  assert.strictEqual((g.text.match(/<trkseg>/g) || []).length, 2);

  // ---- tcx / kml (Zepp watch import)
  const tcx = await call(s, 'GET', `/api/route-tracks/${id}/file?format=tcx`);
  assert.strictEqual(tcx.status, 200);
  assert.ok(/attachment; filename="Renamed\.tcx"/.test(tcx.headers.get('content-disposition')));
  assert.ok(tcx.text.includes('<Course>') && tcx.text.includes('<Time>2000-01-01T00:00:00.000Z</Time>'));
  const kml = await call(s, 'GET', `/api/route-tracks/${id}/file?format=kml`);
  assert.strictEqual(kml.status, 200);
  assert.strictEqual((kml.text.match(/<LineString>/g) || []).length, 2, 'one LineString per stroke');
  assert.strictEqual((await call(s, 'GET', `/api/route-tracks/${id}/file`)).status, 200, 'default is gpx');
  assert.strictEqual((await call(s, 'GET', `/api/route-tracks/${id}/file?format=exe`)).status, 400);

  // ---- bulk delete: own tracks only, validated, counted
  {
    const keep = (await call(s, 'GET', '/api/route-tracks?limit=100')).json.tracks.map((x) => x.id);
    const mine = keep.slice(0, 3);
    const stranger = crypto.randomUUID();
    pool.rows.push({ id: stranger, userId: 2, name: 'not yours' });
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks/delete', {})).status, 400, 'no ids');
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks/delete', { ids: [] })).status, 400);
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks/delete', { ids: ['nope'] })).status, 400, 'bad id');
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks/delete', { ids: Array.from({ length: 201 }, () => crypto.randomUUID()) })).status, 400, 'too many');
    assert.strictEqual(pool.rows.length, keep.length + 1, 'refused requests deleted nothing');
    const r = await call(s, 'POST', '/api/route-tracks/delete', { ids: [...mine, mine[0], stranger] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.deleted, 3, 'deletes only the caller\'s own, once each');
    assert.ok(pool.rows.some((x) => x.id === stranger), 'another user\'s track is untouched');
    assert.strictEqual((await call(s, 'GET', '/api/route-tracks?limit=100')).json.tracks.length, keep.length - 3);
    pool.rows.splice(pool.rows.findIndex((x) => x.id === stranger), 1);
  }

  // ---- directions saved with a track: kept for the exact line, cleaned, bounded, dropped when the line changes without them
  {
    const cue = (n) => ({ text: `Turn left onto Park Road ${n}`, distanceM: 120.4, durationS: 90, type: 0, pos: [0.00001 * n, 0.00001 * n] });
    const made = await call(s, 'POST', '/api/route-tracks', input({ name: 'With directions', drawMode: 'route', cues: [cue(1), cue(2)] }));
    assert.strictEqual(made.status, 201);
    assert.strictEqual(made.json.track.cues.length, 2);
    assert.strictEqual(made.json.track.cues[0].distanceM, 120, 'rounded to whole metres');
    assert.strictEqual((await call(s, 'GET', `/api/route-tracks/${made.json.track.id}`)).json.track.cues.length, 2);
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ cues: 'turn left' }))).status, 400);
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ cues: [{ text: '', distanceM: 1, pos: [0, 0] }] }))).status, 400, 'blank direction');
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ cues: [{ text: 'x', distanceM: 1, pos: [500, 0] }] }))).status, 400, 'off the map');
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ cues: Array.from({ length: 401 }, (_, i) => cue(i)) }))).status, 400, 'over 400');
    assert.strictEqual((await call(s, 'POST', '/api/route-tracks', input({ cues: [] }))).json.track.cues, null, 'an empty list is no directions');
    // renaming leaves them; changing the line without sending them removes them (they would point at the wrong places)
    const tid = made.json.track.id;
    assert.strictEqual((await call(s, 'PATCH', `/api/route-tracks/${tid}`, { name: 'Renamed' })).json.track.cues.length, 2);
    const moved = await call(s, 'PATCH', `/api/route-tracks/${tid}`, { geometry: { type: 'MultiLineString', coordinates: [line(6)] } });
    assert.strictEqual(moved.json.track.cues, null, 'a changed line has no stale directions');
    const again = await call(s, 'PATCH', `/api/route-tracks/${tid}`, { geometry: { type: 'MultiLineString', coordinates: [line(6)] }, cues: [cue(3)] });
    assert.strictEqual(again.json.track.cues.length, 1, 'sent together with the line, they are kept');
    assert.ok(!('cues' in (await call(s, 'GET', '/api/route-tracks?limit=100')).json.tracks[0]), 'the list stays light: no directions');
    await call(s, 'DELETE', `/api/route-tracks/${tid}`);
  }

  // ---- multi-stop planning route
  {
    const orsFetchMulti = async () => ({ ok: true, status: 200, json: async () => ({ features: [{ type: 'Feature', properties: { summary: { distance: 3000, duration: 2000 }, segments: [{ steps: [{ instruction: 'Head east', distance: 3000, duration: 2000, type: 11, way_points: [0, 1] }] }] }, geometry: { type: 'LineString', coordinates: [[153.0, -27.4], [153.01, -27.41]] } }] }) });
    const ms = build(fakePool(), 1, { getMapKey: () => 'K', getOrsKey: () => 'ors-secret', fetchFn: orsFetchMulti }).listen(0);
    const ok = await call(ms, 'POST', '/api/route-tracks/multi', { points: [[153.0, -27.4], [153.005, -27.405], [153.01, -27.41]], profile: 'walking' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.route.steps[0].text, 'Head east');
    assert.ok(!ok.text.includes('ors-secret'));
    assert.strictEqual((await call(ms, 'POST', '/api/route-tracks/multi', { points: [[153.0, -27.4]], profile: 'walking' })).status, 400);
    ms.close();
  }

  // ---- delete (into the shared recycle bin)
  {
    const binBefore = pool.bin.length;
    const d = await call(s, 'DELETE', `/api/route-tracks/${id}`);
    assert.strictEqual(d.status, 200);
    assert.ok(d.json.binId, 'the answer carries the recycle bin id (for Undo)');
    assert.strictEqual(pool.bin.length, binBefore + 1);
    const kept = pool.bin[pool.bin.length - 1];
    assert.strictEqual(kept.type, 'route-track');
    assert.strictEqual(kept.id, id);
    assert.ok(kept.payload.track && kept.payload.track.geometry, 'the whole track row travels in the bin');
    assert.strictEqual((await call(s, 'GET', `/api/route-tracks/${id}`)).status, 404);
    assert.strictEqual((await call(s, 'DELETE', `/api/route-tracks/${id}`)).status, 404, 'deleting twice finds nothing');
    assert.strictEqual(pool.bin.length, binBefore + 1, 'a track that is not there adds nothing to the bin');
  }

  // ---- errors never leak internals
  pool.failNext = true;
  r = await call(s, 'GET', '/api/route-tracks');
  assert.strictEqual(r.status, 500);
  assert.ok(!/secret-host/.test(r.text));

  // ---- per-user cap
  const { MAX_TRACKS_PER_USER } = require('./routeTracksRouter');
  const capPool = fakePool();
  for (let i = 0; i < MAX_TRACKS_PER_USER; i += 1) capPool.rows.push({ id: crypto.randomUUID(), userId: 1 });
  const cs = build(capPool, 1).listen(0);
  assert.strictEqual((await call(cs, 'POST', '/api/route-tracks', input())).status, 400);
  cs.close();

  s.close();
  console.log('routeTracks.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
