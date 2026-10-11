#!/usr/bin/env node
/**
 * Place lookup vs Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim). Fake clock, fake upstream, no network.
 *   max 1 request/second for the whole application   -> "spacing under concurrency"
 *   identifying User-Agent, not a stock one           -> "identifies the application"
 *   no autocomplete / type-ahead                      -> "short or bad queries never reach Nominatim", route has no per-keystroke path
 *   results must be cached                            -> "repeat queries are cached" (memory + persistent store)
 *   attribution                                       -> "every answer carries the attribution"
 *
 * Run: node server/services/geocode.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createGeocoder, normalizeQuery, isAddressQuery, mapResults, mapReverse, userAgent, MIN_GAP_MS, MAX_PENDING, ATTRIBUTION } = require('./geocode');
const { createRouter } = require('../routes/geocodeRouter');

const ROW = (name, lat, lon, state, code = 'au', postcode = '4064') => ({ display_name: `${name}, Brisbane, ${state}, Australia`, lat: String(lat), lon: String(lon), address: { state, postcode, country_code: code } });

/** A fake clock whose sleep() advances time, and a fake upstream that records when it was called. */
function rig(opts = {}) {
  let t = 1_000_000;
  const calls = [];
  const rig = {
    calls, clock: () => t, advance: (ms) => { t += ms; },
    now: () => t,
    sleep: async (ms) => { t += ms; },
    fetchFn: async (url, init) => {
      calls.push({ at: t, url, ua: init.headers['User-Agent'], accept: init.headers.Accept });
      if (opts.fail) return { ok: false, status: opts.fail, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => [ROW('Paddington', -27.46, 153.0, 'Queensland')] };
    },
  };
  rig.geocoder = createGeocoder({ fetchFn: rig.fetchFn, now: rig.now, sleep: rig.sleep, store: opts.store, userAgent: 'CuramVault-GardenPlanner/1.0 (+https://example.test)' });
  return rig;
}

let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('spacing under concurrency: simultaneous different queries reach Nominatim at least a second apart', async () => {
  const r = rig();
  await Promise.all(['paddington', 'toowong', 'indooroopilly', 'chermside'].map((q) => r.geocoder.search(q)));
  assert.strictEqual(r.calls.length, 4);
  for (let i = 1; i < r.calls.length; i++) assert.ok(r.calls[i].at - r.calls[i - 1].at >= 1000, `gap ${r.calls[i].at - r.calls[i - 1].at} ms between call ${i - 1} and ${i}`);
  assert.ok(MIN_GAP_MS >= 1000);
});

test('the gap is application-wide, not per caller: a second caller right after the first still waits', async () => {
  const r = rig();
  await r.geocoder.search('paddington');
  r.advance(200); // another user, 200 ms later
  await r.geocoder.search('toowong');
  assert.ok(r.calls[1].at - r.calls[0].at >= 1000);
});

test('no wait when the last upstream call was long ago', async () => {
  const r = rig();
  await r.geocoder.search('paddington');
  r.advance(60_000);
  const before = r.clock();
  await r.geocoder.search('toowong');
  assert.strictEqual(r.clock(), before, 'no sleep needed');
});

test('identifies the application with its own User-Agent, never a stock one', async () => {
  const r = rig();
  await r.geocoder.search('paddington');
  assert.match(r.calls[0].ua, /^CuramVault-GardenPlanner\/1\.0/);
  assert.ok(!/node|undici|axios|fetch|python|curl/i.test(r.calls[0].ua));
  assert.match(userAgent({ APP_URL: 'https://vault.example', NOMINATIM_CONTACT: 'ops@example.test' }), /CuramVault-GardenPlanner\/1\.0 \(\+https:\/\/vault\.example; ops@example\.test\)/);
  assert.match(userAgent({}), /^CuramVault-GardenPlanner\/1\.0$/);
});

test('asks only for what it needs: Australia, 5 results, one query (no search-as-you-type parameters)', async () => {
  const r = rig();
  await r.geocoder.search('Paddington QLD');
  const u = new URL(r.calls[0].url);
  assert.strictEqual(u.hostname, 'nominatim.openstreetmap.org');
  assert.strictEqual(u.searchParams.get('countrycodes'), 'au');
  assert.strictEqual(u.searchParams.get('limit'), '5');
  assert.strictEqual(u.searchParams.get('q'), 'paddington qld');
});

test('repeat queries are cached: the same search (any spacing or case) never reaches Nominatim twice', async () => {
  const r = rig();
  const a = await r.geocoder.search('Paddington   QLD');
  const b = await r.geocoder.search(' paddington qld ');
  assert.strictEqual(a.cached, false);
  assert.strictEqual(b.cached, true);
  assert.strictEqual(r.calls.length, 1);
  assert.deepStrictEqual(a.results, b.results);
});

test('two identical queries at the same moment make one upstream call', async () => {
  const r = rig();
  const [a, b] = await Promise.all([r.geocoder.search('paddington'), r.geocoder.search('Paddington')]);
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(a.cached !== b.cached, true, 'one fetched, one from cache');
});

test('the cache lasts 30 days, then asks again', async () => {
  const r = rig();
  await r.geocoder.search('paddington');
  r.advance(29 * 24 * 3600 * 1000);
  assert.strictEqual((await r.geocoder.search('paddington')).cached, true);
  r.advance(2 * 24 * 3600 * 1000);
  assert.strictEqual((await r.geocoder.search('paddington')).cached, false);
  assert.strictEqual(r.calls.length, 2);
});

test('persistent cache survives a restart (a new geocoder with the same store makes no upstream call)', async () => {
  const data = new Map();
  const store = { get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); } };
  const first = rig({ store });
  await first.geocoder.search('paddington');
  assert.strictEqual(data.size, 1);
  const second = rig({ store });
  second.advance(1000);
  assert.strictEqual((await second.geocoder.search('paddington')).cached, true);
  assert.strictEqual(second.calls.length, 0);
});

test('a broken cache store never breaks lookups', async () => {
  const store = { get: async () => { throw new Error('db down'); }, set: async () => { throw new Error('db down'); } };
  const r = rig({ store });
  assert.strictEqual((await r.geocoder.search('paddington')).results.length, 1);
});

test('no type-ahead: queries that are too short, empty, or not text never reach Nominatim', async () => {
  const r = rig();
  for (const q of ['', ' ', 'a', 'pa', undefined, null, 42, 'x'.repeat(200)]) {
    await assert.rejects(() => r.geocoder.search(q), (e) => e.code === 'invalid', JSON.stringify(q));
  }
  assert.strictEqual(r.calls.length, 0);
  assert.strictEqual(normalizeQuery('  Pad  '), 'pad');
});

test('every answer carries the attribution to display', async () => {
  const r = rig();
  assert.strictEqual((await r.geocoder.search('paddington')).attribution, '© OpenStreetMap contributors');
  assert.strictEqual((await r.geocoder.search('paddington')).attribution, ATTRIBUTION, 'cached answers too');
});

test('too many waiting at once: refuses (busy) instead of queuing without limit', async () => {
  const r = rig();
  const results = await Promise.allSettled(Array.from({ length: MAX_PENDING + 3 }, (_, i) => r.geocoder.search(`suburb number ${i}`)));
  const busy = results.filter((x) => x.status === 'rejected' && x.reason.code === 'busy');
  assert.strictEqual(busy.length, 3);
  assert.strictEqual(r.calls.length, MAX_PENDING);
});

test('upstream trouble: 429/403 is "busy", other errors are "unavailable", and the queue keeps working', async () => {
  const busy = rig({ fail: 429 });
  await assert.rejects(() => busy.geocoder.search('paddington'), (e) => e.code === 'busy');
  const down = rig({ fail: 500 });
  await assert.rejects(() => down.geocoder.search('paddington'), (e) => e.code === 'unavailable');
  let n = 0;
  const flaky = createGeocoder({
    now: () => 1e6 + n * 5000, sleep: async () => undefined,
    fetchFn: async () => { n += 1; if (n === 1) throw new Error('network'); return { ok: true, status: 200, json: async () => [ROW('Toowong', -27.48, 153.0, 'Queensland')] }; },
  });
  await assert.rejects(() => flaky.search('paddington'), (e) => e.code === 'unavailable');
  assert.strictEqual((await flaky.search('toowong')).results.length, 1);
  assert.ok(busy.calls.length === 1, 'a failure is not retried in a loop');
});

test('failed lookups are not cached (a later try can succeed)', async () => {
  let n = 0;
  const g = createGeocoder({
    now: () => 1e6 + n * 5000, sleep: async () => undefined,
    fetchFn: async () => { n += 1; if (n === 1) return { ok: false, status: 500, json: async () => ({}) }; return { ok: true, status: 200, json: async () => [ROW('Toowong', -27.48, 153.0, 'Queensland')] }; },
  });
  await assert.rejects(() => g.search('toowong'));
  assert.strictEqual((await g.search('toowong')).cached, false);
});

test('results: Australian rows only, state from the address, label trimmed, junk dropped', () => {
  const rows = [ROW('Paddington', -27.46, 153.0, 'Queensland'), ROW('Paddington', 51.5, -0.18, 'England', 'gb'), { display_name: 'x', lat: 'abc', lon: '1' }, { display_name: '', lat: '1', lon: '2' }];
  const out = mapResults(rows);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { label: 'Paddington, Brisbane, Queensland', lat: -27.46, lng: 153.0, state: 'QLD', postcode: '4064', precision: 'place', address: null });
  assert.deepStrictEqual(mapResults('nope'), []);
});

// ---------------------------------------------------------------- street addresses
const HOUSE = (n, road, suburb, extra = {}) => ({ display_name: n + ', ' + road + ', ' + suburb + ', Brisbane, Queensland, 4064, Australia', lat: '-27.4605', lon: '153.0012', address: { house_number: n, road, suburb, city: 'Brisbane', state: 'Queensland', postcode: '4064', country_code: 'au', ...extra } });

test('an address result says how exactly it is known: a house on a street, only a street, or only a place', () => {
  const house = mapResults([HOUSE('12', 'Smith Street', 'Paddington')])[0];
  assert.deepStrictEqual(house, { label: 'Paddington QLD', lat: -27.4605, lng: 153.0012, state: 'QLD', postcode: '4064', precision: 'address', address: '12 Smith Street, Paddington QLD 4064' });
  const street = mapResults([{ ...HOUSE('', 'Smith Street', 'Paddington'), address: { road: 'Smith Street', suburb: 'Paddington', state: 'Queensland', postcode: '4064', country_code: 'au' } }])[0];
  assert.strictEqual(street.precision, 'street');
  assert.strictEqual(street.address, 'Smith Street, Paddington QLD 4064');
  assert.strictEqual(street.label, 'Paddington QLD');
  const place = mapResults([ROW('Paddington', -27.46, 153.0, 'Queensland')])[0];
  assert.strictEqual(place.precision, 'place');
  assert.strictEqual(place.address, null);
});

test('unit numbers, towns without suburbs, and missing postcodes still make a sensible address', () => {
  const unit = mapResults([HOUSE('3/45', 'Smith Street', 'Paddington')])[0];
  assert.strictEqual(unit.address, '3/45 Smith Street, Paddington QLD 4064');
  const town = mapResults([{ lat: '-30', lon: '150', display_name: 'x', address: { house_number: '7', road: 'Main Road', town: 'Tamworth', state: 'New South Wales', country_code: 'au' } }])[0];
  assert.strictEqual(town.address, '7 Main Road, Tamworth NSW');
  assert.strictEqual(town.label, 'Tamworth NSW');
  assert.strictEqual(town.postcode, null);
});

test('what counts as an address: any word with a digit that is not a bare four-digit postcode', () => {
  for (const q of ['12 smith st', '12 smith street, paddington', '3/45 smith st', '12a smith st', 'unit 4 12 smith st']) assert.strictEqual(isAddressQuery(normalizeQuery(q)), true, q);
  for (const q of ['paddington', 'paddington qld 4064', '4064', 'paddington, 4064', 'mount gravatt east']) assert.strictEqual(isAddressQuery(normalizeQuery(q)), false, q);
});

test('a street address is answered and remembered in MEMORY ONLY: it never touches the table, in either direction', async () => {
  const writes = [], reads = [];
  const store = { get: async (k) => { reads.push(k); return null; }, set: async (k) => { writes.push(k); } };
  const r = rig({ store });
  const a = await r.geocoder.search('12 Smith Street Paddington');
  assert.strictEqual(a.cached, false);
  assert.deepStrictEqual(writes, [], 'the address was not written to the table');
  assert.deepStrictEqual(reads, [], 'and the table was not asked about it');
  const b = await r.geocoder.search('12 smith street  paddington');
  assert.strictEqual(b.cached, true, 'a retry is answered from memory without another upstream call');
  assert.strictEqual(r.calls.length, 1);
  // a suburb is still cached in the table
  await r.geocoder.search('toowong');
  assert.deepStrictEqual(writes, ['toowong']);
});

test('an address is forgotten from memory after about 15 minutes', async () => {
  const r = rig();
  await r.geocoder.search('12 smith street paddington');
  r.advance(14 * 60 * 1000);
  assert.strictEqual((await r.geocoder.search('12 smith street paddington')).cached, true);
  r.advance(2 * 60 * 1000);
  assert.strictEqual((await r.geocoder.search('12 smith street paddington')).cached, false);
  assert.strictEqual(r.calls.length, 2);
});

test('an address search is still one deliberate request at the polite pace, with the identifying agent', async () => {
  const r = rig();
  await Promise.all(['1 a street paddington', '2 b street toowong'].map((q) => r.geocoder.search(q)));
  assert.strictEqual(r.calls.length, 2);
  assert.ok(r.calls[1].at - r.calls[0].at >= 1000);
  assert.ok(r.calls.every((c) => c.ua.startsWith('CuramVault-GardenPlanner/1.0') && new URL(c.url).searchParams.get('countrycodes') === 'au'));
});

// ---------------------------------------------------------------- the route
async function withRoute(geocoder, opts, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-test-user') || 1) }; next(); });
  app.use('/api/geocode', (opts.router ?? createRouter)(geocoder, opts));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const get = async (q, user = 1) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/geocode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, body: JSON.stringify({ q }),
    });
    return { status: res.status, body: await res.json() };
  };
  get.raw = (method, path) => fetch(`http://127.0.0.1:${server.address().port}/api/geocode${path}`, { method, headers: { 'x-test-user': '1' } });
  try { await fn(get); } finally { await new Promise((r) => server.close(r)); }
}

test('route: returns results with the attribution; short queries are 400 and never reach upstream', async () => {
  const r = rig();
  await withRoute(r.geocoder, {}, async (get) => {
    const ok = await get('paddington');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.attribution, '© OpenStreetMap contributors');
    assert.strictEqual(ok.body.results[0].state, 'QLD');
    assert.strictEqual((await get('pa')).status, 400);
    assert.strictEqual((await get('')).status, 400);
  });
  assert.strictEqual(r.calls.length, 1);
});

test('route: one user cannot hammer it (10 a minute), and another user is unaffected', async () => {
  const r = rig();
  let t = 0;
  await withRoute(r.geocoder, { now: () => t }, async (get) => {
    for (let i = 0; i < 10; i++) assert.strictEqual((await get(`suburb${i}name`)).status, 200);
    const limited = await get('anothername');
    assert.strictEqual(limited.status, 429);
    assert.strictEqual((await get('anothername', 2)).status, 200);
    t += 61000;
    assert.strictEqual((await get('anothername')).status, 200);
  });
});

test('route: upstream failure is a plain 502/429 message, never a crash or a leak', async () => {
  const r = rig({ fail: 500 });
  await withRoute(r.geocoder, {}, async (get) => {
    const res = await get('paddington');
    assert.strictEqual(res.status, 502);
    assert.ok(typeof res.body.error === 'string' && !/500|nominatim/i.test(res.body.error));
  });
});

// ---------------------------------------------------------------- privacy: what is stored and logged
test('the lookup is a POST: the text is never in a URL (proxy logs, traces), and a GET with it is not an endpoint', async () => {
  const r = rig();
  await withRoute(r.geocoder, {}, async (get) => {
    assert.strictEqual((await get.raw('GET', '?q=paddington')).status, 404);
    assert.strictEqual((await get('paddington')).status, 200);
  });
});

test('the cache stores only the query text and its result: never who asked', async () => {
  const { pgStore } = require('./geocode');
  const seen = [];
  const store = pgStore({ query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } });
  await store.set('paddington', { at: 1_000_000, results: [{ label: 'Paddington' }] });
  await store.get('paddington');
  assert.strictEqual(seen.length, 2);
  const write = seen[0];
  assert.deepStrictEqual(write.params.length, 3, 'query, results, time: nothing else is written');
  assert.ok(!/user|ip|session|token/i.test(write.sql), 'no user-ish column in the write');
  assert.ok(!/user|ip|session|token/i.test(seen[1].sql));
  // and the table itself has no such column
  const db = require('fs').readFileSync(require('path').join(__dirname, '..', 'db.js'), 'utf8');
  const block = /CREATE TABLE IF NOT EXISTS geocode_cache \(([\s\S]*?)\n\s*\)/.exec(db)?.[1] ?? '';
  assert.ok(block.includes('query') && block.includes('results'), 'found the table definition');
  assert.ok(!/userId|user_id|ip|session/i.test(block), 'the table has no user column: ' + block.replace(/\s+/g, ' '));
});

test('server logs never contain what was looked up (success, too short, upstream failure, rate limit)', async () => {
  const records = [];
  const fakeLogger = new Proxy({}, { get: () => (...a) => { records.push(JSON.stringify(a)); } });
  // load the request logger and the route with a logger we can read
  const ctxPath = require.resolve('../middleware/requestContext');
  const real = require(ctxPath);
  const original = real.getLogger;
  real.getLogger = () => fakeLogger;
  for (const p of ['../middleware/httpLogger', '../routes/geocodeRouter']) delete require.cache[require.resolve(p)];
  const { httpLogger } = require('../middleware/httpLogger');
  const { createRouter: freshRouter } = require('../routes/geocodeRouter');
  try {
    for (const scenario of [{ fail: 0 }, { fail: 500 }]) {
      const r = rig(scenario);
      const app = express();
      app.use(express.json());
      app.use(httpLogger);
      app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
      app.use('/api/geocode', freshRouter(r.geocoder, { perMinute: 2 }));
      const server = http.createServer(app);
      await new Promise((res) => server.listen(0, res));
      const post = (q) => fetch(`http://127.0.0.1:${server.address().port}/api/geocode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) });
      try {
        await post('secretsuburbname');  // success or upstream failure
        await post('zz');                // too short
        await post('anothersecretname'); // second allowed
        await post('thirdsecretname');   // rate limited
      } finally { await new Promise((res) => server.close(res)); }
    }
  } finally { real.getLogger = original; }
  assert.ok(records.length > 0, 'the request logger did log something');
  const all = records.join('\n').toLowerCase();
  for (const word of ['secretsuburbname', 'anothersecretname', 'thirdsecretname']) assert.ok(!all.includes(word), `a log line contains "${word}"`);
  assert.ok(all.includes('/'), 'logs do carry the path');
});

test('error traces are scrubbed too: lookup text is removed from Sentry events, spans and breadcrumbs', () => {
  const { scrubEvent } = require('../lib/sentry');
  const ev = {
    request: { url: 'https://vault.example/api/geocode?q=paddington', query_string: 'q=paddington', data: { q: 'paddington' }, cookies: { a: 'b' } },
    transaction: 'POST /api/geocode?q=paddington',
    spans: [
      { description: 'GET https://nominatim.openstreetmap.org/search?q=paddington&limit=5', data: { 'http.url': 'https://nominatim.openstreetmap.org/search?q=paddington', 'http.query': '?q=paddington' } },
      { description: 'SELECT 1', data: { 'http.url': 'https://vault.example/api/other?x=1' } },
    ],
    breadcrumbs: [{ data: { url: 'https://nominatim.openstreetmap.org/search?q=paddington' } }],
  };
  scrubEvent(ev);
  assert.ok(!JSON.stringify(ev).includes('paddington'), JSON.stringify(ev));
  assert.strictEqual(ev.request.url, 'https://vault.example/api/geocode');
  assert.strictEqual(ev.spans[1].data['http.url'], 'https://vault.example/api/other?x=1', 'other endpoints are left alone');
  assert.strictEqual(scrubEvent(null), null);
});

// ---------------------------------------------------------------- reverse lookups (a point -> the name of the place)
const REV = (extra = {}) => ({ lat: '-27.4698', lon: '153.0251', name: '', display_name: '12, Smith Street, Morningside, Brisbane, Queensland, Australia', address: { house_number: '12', road: 'Smith Street', suburb: 'Morningside', state: 'Queensland', country_code: 'au' }, ...extra });

function revRig(opts = {}) {
  let t = 1_000_000;
  const calls = [];
  const rg = {
    calls, advance: (ms) => { t += ms; },
    fetchFn: async (url, init) => {
      calls.push({ at: t, url, ua: init.headers['User-Agent'] });
      if (opts.fail) return { ok: false, status: opts.fail, json: async () => ({}) };
      const isReverse = new URL(url).pathname.endsWith('/reverse');
      return { ok: true, status: 200, json: async () => (isReverse ? (opts.row ?? REV()) : [ROW('Paddington', -27.46, 153.0, 'Queensland')]) };
    },
  };
  rg.geocoder = createGeocoder({ fetchFn: rg.fetchFn, now: () => t, sleep: async (ms) => { t += ms; }, store: opts.store, userAgent: 'CuramVault-GardenPlanner/1.0 (+https://example.test)' });
  return rg;
}

test('reverse: a named place wins, else the street with its number, then the suburb', () => {
  assert.deepStrictEqual(mapReverse(REV({ name: 'Hawthorne Park', address: { road: 'Riverview Tce', suburb: 'Hawthorne', country_code: 'au' } })), { label: 'Hawthorne Park, Hawthorne', lat: -27.4698, lng: 153.0251 });
  assert.strictEqual(mapReverse(REV()).label, '12 Smith Street, Morningside');
  assert.strictEqual(mapReverse(REV({ name: '12' })).label, '12 Smith Street, Morningside', 'a name that is only a number is the house number, not a place');
  assert.strictEqual(mapReverse(REV({ address: { road: 'Smith Street', town: 'Samford Village' } })).label, 'Smith Street, Samford Village');
  assert.strictEqual(mapReverse(REV({ address: { footway: 'River Walk', suburb: 'Bulimba' } })).label, 'River Walk, Bulimba');
  assert.strictEqual(mapReverse(REV({ address: {}, display_name: 'Somewhere Rd, Hamlet, Queensland, Australia' })).label, 'Somewhere Rd, Hamlet');
});

test('reverse: nothing known, an error row, junk and no coordinates all give null', () => {
  assert.strictEqual(mapReverse({ error: 'Unable to geocode' }), null);
  assert.strictEqual(mapReverse(null), null);
  assert.strictEqual(mapReverse('x'), null);
  assert.strictEqual(mapReverse({ lat: 'a', lon: 'b', display_name: 'x' }), null);
  assert.strictEqual(mapReverse({ lat: '1', lon: '2', address: {}, display_name: '' }), null);
});

test('reverse: asks the reverse endpoint for one point, with the identifying agent, and carries the attribution', async () => {
  const r = revRig();
  const a = await r.geocoder.reverse(-27.4698, 153.0251);
  assert.strictEqual(a.result.label, '12 Smith Street, Morningside');
  assert.strictEqual(a.cached, false);
  assert.strictEqual(a.attribution, ATTRIBUTION);
  const u = new URL(r.calls[0].url);
  assert.ok(u.pathname.endsWith('/reverse'));
  assert.strictEqual(u.searchParams.get('lat'), '-27.4698');
  assert.strictEqual(u.searchParams.get('lon'), '153.0251');
  assert.strictEqual(u.searchParams.get('format'), 'jsonv2');
  assert.ok(r.calls[0].ua.startsWith('CuramVault-GardenPlanner/1.0'));
});

test('reverse: shares the one-a-second queue with searches', async () => {
  const r = revRig();
  await Promise.all([r.geocoder.search('toowong'), r.geocoder.reverse(-27.47, 153.03), r.geocoder.reverse(-27.5, 153.1)]);
  assert.strictEqual(r.calls.length, 3);
  assert.ok(r.calls[1].at - r.calls[0].at >= MIN_GAP_MS - 100 && r.calls[2].at - r.calls[1].at >= MIN_GAP_MS - 100, JSON.stringify(r.calls.map((c) => c.at)));
});

test('reverse: the same spot (to about 11 m) is one upstream call, remembered in MEMORY ONLY for about 15 minutes', async () => {
  const writes = [], reads = [];
  const store = { get: async (k) => { reads.push(k); return null; }, set: async (k) => { writes.push(k); } };
  const r = revRig({ store });
  await r.geocoder.reverse(-27.46981, 153.02512);
  const b = await r.geocoder.reverse(-27.46984, 153.02514);
  assert.strictEqual(b.cached, true);
  assert.strictEqual(r.calls.length, 1);
  assert.deepStrictEqual(writes, [], 'never written to the table');
  assert.deepStrictEqual(reads, [], 'and the table is never asked');
  r.advance(14 * 60 * 1000);
  assert.strictEqual((await r.geocoder.reverse(-27.4698, 153.0251)).cached, true);
  r.advance(2 * 60 * 1000);
  assert.strictEqual((await r.geocoder.reverse(-27.4698, 153.0251)).cached, false);
  assert.strictEqual(r.calls.length, 2);
});

test('reverse: nothing known at a spot is a null result (and is remembered), not an error', async () => {
  const r = revRig({ row: { error: 'Unable to geocode' } });
  const a = await r.geocoder.reverse(-10, 100);
  assert.strictEqual(a.result, null);
  assert.strictEqual((await r.geocoder.reverse(-10, 100)).cached, true);
});

test('reverse: bad points never reach Nominatim', async () => {
  const r = revRig();
  for (const [lat, lng] of [['a', 1], [1, 'b'], [NaN, 1], [1, Infinity], [91, 0], [0, 181], [null, null], [undefined, 5]]) {
    await assert.rejects(r.geocoder.reverse(lat, lng), (e) => e.code === 'invalid', `${lat},${lng}`);
  }
  assert.strictEqual(r.calls.length, 0);
});

test('reverse: upstream trouble is "busy" or "unavailable", is not cached, and the queue keeps working', async () => {
  let fail = 429;
  let t = 1_000_000;
  const g = createGeocoder({ fetchFn: async () => (fail ? { ok: false, status: fail, json: async () => ({}) } : { ok: true, status: 200, json: async () => REV() }), now: () => t, sleep: async (ms) => { t += ms; } });
  await assert.rejects(g.reverse(-27.4, 153.0), (e) => e.code === 'busy');
  fail = 500;
  await assert.rejects(g.reverse(-27.4, 153.0), (e) => e.code === 'unavailable');
  fail = 0;
  assert.strictEqual((await g.reverse(-27.4, 153.0)).result.label, '12 Smith Street, Morningside');
});

async function withReverse(geocoder, opts, fn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-test-user') || 1) }; next(); });
  app.use('/api/geocode', createRouter(geocoder, opts));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const post = async (body, user = 1) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/geocode/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
  };
  try { await fn(post); } finally { await new Promise((r) => server.close(r)); }
}

test('route /reverse: returns the place and the attribution; bad points are 400 and never reach upstream', async () => {
  const r = revRig();
  await withReverse(r.geocoder, {}, async (post) => {
    const ok = await post({ lat: -27.4698, lng: 153.0251 });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.result.label, '12 Smith Street, Morningside');
    assert.strictEqual(ok.json.attribution, ATTRIBUTION);
    assert.strictEqual(ok.headers.get('cache-control'), 'no-store');
    assert.strictEqual((await post({ lat: 'x', lng: 1 })).status, 400);
    assert.strictEqual((await post({})).status, 400);
    assert.strictEqual(r.calls.length, 1);
  });
});

test('route /reverse: 20 a minute per user, another user unaffected, and upstream trouble is a plain message', async () => {
  const r = revRig();
  let t = 5_000_000;
  await withReverse(r.geocoder, { now: () => t }, async (post) => {
    for (let i = 0; i < 20; i += 1) assert.strictEqual((await post({ lat: -27 - i * 0.01, lng: 153 })).status, 200);
    const limited = await post({ lat: -28, lng: 153 });
    assert.strictEqual(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
    assert.strictEqual((await post({ lat: -28, lng: 153 }, 2)).status, 200, 'another user');
    t += 61000;
    assert.strictEqual((await post({ lat: -28.1, lng: 153 })).status, 200, 'the minute passes');
  });
  const bad = revRig({ fail: 500 });
  await withReverse(bad.geocoder, {}, async (post) => {
    const x = await post({ lat: -27, lng: 153 });
    assert.strictEqual(x.status, 502);
    assert.ok(/could not answer|reached/i.test(x.json.error) && !/500/.test(x.json.error));
  });
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(), 50).unref?.();
})();
