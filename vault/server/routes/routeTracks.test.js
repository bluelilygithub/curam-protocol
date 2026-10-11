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
const { createRouter } = require('./routeTracksRouter');

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
    failNext: false,
    async query(sql, params) {
      if (pool.failNext) { pool.failNext = false; throw new Error('connection refused: secret-host:5432'); }
      const s = sql.replace(/\s+/g, ' ');
      if (/SELECT COUNT/.test(s)) return { rows: [{ n: String(rows.filter((r) => r.userId === params[0]).length) }] };
      if (/^INSERT INTO route_tracks/.test(s)) {
        const r = {
          id: crypto.randomUUID(), userId: params[0], name: params[1], notes: params[2], color: params[3], geometry: JSON.parse(params[4]),
          distanceM: params[5], pointCount: params[6], bbox: params[7], drawMode: params[8], createdAt: new Date((clock += 1000)), updatedAt: new Date(clock),
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
      if (/^SELECT name, notes, geometry/.test(s)) {
        const r = rows.find((x) => x.id === params[0] && x.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/^SELECT .* FROM route_tracks WHERE id = \$1/.test(s)) {
        const r = rows.find((x) => x.id === params[0] && x.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/^UPDATE route_tracks/.test(s)) {
        const [name, setNotes, notes, color, geometry, dist, pts, bbox, id, userId] = params;
        const r = rows.find((x) => x.id === id && x.userId === userId);
        if (!r) return { rows: [] };
        if (name !== null) r.name = name;
        if (setNotes) r.notes = notes;
        if (color !== null) r.color = color;
        if (geometry !== null) { r.geometry = JSON.parse(geometry); r.distanceM = dist; r.pointCount = pts; r.bbox = bbox; }
        r.updatedAt = new Date((clock += 1000));
        return { rows: [r] };
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
  app.use('/api/route-tracks', createRouter(pool, opts));
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

(async () => {
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
  assert.strictEqual(pool.rows.length, 2, 'refused requests stored nothing');

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
  assert.strictEqual(list.json.tracks.length, 7);
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
  assert.strictEqual(new Set(seen).size, 7, 'paging visits each track once');
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

  // ---- delete
  assert.strictEqual((await call(s, 'DELETE', `/api/route-tracks/${id}`)).status, 204);
  assert.strictEqual((await call(s, 'GET', `/api/route-tracks/${id}`)).status, 404);

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
