'use strict';
const assert = require('assert');
const { createPlacesService, PlacesError, CATEGORY_IDS, classify, rank, buildQuery, prepareLine, distToLineM, checkRadius, PER_CATEGORY } = require('./routePlaces');

// a straight route east along latitude -27.5, about 10 km
const route = Array.from({ length: 11 }, (_, i) => [153.0 + i * 0.01, -27.5]);
const el = (id, name, lon, lat, tags) => ({ type: 'node', id, lat, lon, tags: { name, ...tags } });

// ---- what counts as what
assert.strictEqual(classify({ tourism: 'museum' }), 'museums');
assert.strictEqual(classify({ tourism: 'gallery' }), 'museums');
assert.strictEqual(classify({ amenity: 'arts_centre' }), 'museums');
assert.strictEqual(classify({ amenity: 'theatre' }), 'shows');
assert.strictEqual(classify({ amenity: 'cinema' }), 'shows');
assert.strictEqual(classify({ leisure: 'stadium' }), 'sport');
assert.strictEqual(classify({ tourism: 'zoo' }), 'fun');
assert.strictEqual(classify({ leisure: 'water_park' }), 'fun');
assert.strictEqual(classify({ amenity: 'nightclub' }), 'nightlife');
assert.strictEqual(classify({ amenity: 'casino' }), 'nightlife');
assert.strictEqual(classify({ amenity: 'townhall' }), 'civic');
assert.strictEqual(classify({ amenity: 'library' }), 'civic');
assert.strictEqual(classify({ amenity: 'university' }), 'campus');
assert.strictEqual(classify({ amenity: 'hospital' }), 'campus');
assert.strictEqual(classify({ tourism: 'attraction' }), 'landmarks');
assert.strictEqual(classify({ tourism: 'viewpoint' }), 'landmarks');
assert.strictEqual(classify({ historic: 'monument' }), 'landmarks');
assert.strictEqual(classify({ man_made: 'lighthouse' }), 'landmarks');
assert.strictEqual(classify({ amenity: 'place_of_worship' }), null, 'an ordinary church is not shown');
assert.strictEqual(classify({ amenity: 'place_of_worship', wikidata: 'Q1' }), 'worship', 'a notable one is');
assert.strictEqual(classify({ amenity: 'place_of_worship', building: 'cathedral' }), 'worship');
assert.strictEqual(classify({ amenity: 'cafe' }), null);
assert.strictEqual(classify({}), null);
assert.strictEqual(classify(null), null);
assert.strictEqual(classify('x'), null);
assert.ok(CATEGORY_IDS.length === 9);

// ---- the route sent is checked and thinned
assert.throws(() => prepareLine(null), PlacesError);
assert.throws(() => prepareLine([]), PlacesError);
assert.throws(() => prepareLine([[153, -27]]), PlacesError);
assert.throws(() => prepareLine([[153, -27], [153, -27]]), /goes somewhere/);
assert.throws(() => prepareLine([[153, -27], [181, -27]]), /not on the map/);
assert.throws(() => prepareLine([[153, -27], [153, 91]]), /not on the map/);
assert.throws(() => prepareLine([[153, -27], ['a', 1]]), /not on the map/);
assert.throws(() => prepareLine([[153, -27], null]), /not on the map/);
assert.throws(() => prepareLine(new Array(20001).fill([153, -27])), /too many/);
const wiggly = Array.from({ length: 5000 }, (_, i) => [153 + i * 0.0001, -27.5 + Math.sin(i / 20) * 0.01]);
const thin = prepareLine(wiggly);
assert.ok(thin.length <= 120 && thin.length > 10, `thinned to ${thin.length}`);
assert.deepStrictEqual(thin[0], [153, -27.5]);
assert.deepStrictEqual(thin.at(-1), [Math.round((153 + 4999 * 0.0001) * 1e5) / 1e5, Math.round((-27.5 + Math.sin(4999 / 20) * 0.01) * 1e5) / 1e5], 'the ends are kept');
assert.strictEqual(prepareLine([[153, -27], [153, -27], [153.1, -27]]).length, 2, 'repeated points are dropped');

// ---- distance
assert.ok(Math.abs(distToLineM([153.05, -27.49], route) - 1112) < 5, 'about 1.1 km north of the line');
assert.ok(distToLineM([153.05, -27.5], route) < 1);
assert.ok(Math.abs(distToLineM([152.99, -27.5], route) - 990) < 10, 'beyond the end: distance to the end point');
assert.ok(distToLineM([153, -27.5], [[153, -27.5]]) < 1);

// ---- the distance asked for
for (const bad of [0, 0.05, 11, -1, NaN, Infinity, '2', null, undefined]) assert.throws(() => checkRadius(bad), PlacesError, String(bad));
assert.strictEqual(checkRadius(2), 2);
assert.strictEqual(checkRadius(0.5), 0.5);

// ---- the question put to Overpass
const q = buildQuery([[153, -27.5], [153.01, -27.5]], 2000);
assert.ok(q.startsWith('[out:json]'));
assert.ok(q.includes('(around:2000,-27.5,153,-27.5,153.01)'), 'latitude first, as Overpass wants it');
assert.strictEqual((q.match(/nwr\(around/g) || []).length, 5, 'one clause per tag key');
assert.ok(/\["name"\]/.test(q), 'only places with a name');
assert.ok(/out center tags \d+;/.test(q));

// ---- ranking
{
  const elements = [
    el(1, 'Near Museum', 153.05, -27.499, { tourism: 'museum' }),
    el(2, 'Far Museum', 153.05, -27.45, { tourism: 'museum' }), // 5.5 km away
    el(3, 'Famous Gallery', 153.02, -27.501, { tourism: 'gallery', wikidata: 'Q9', wikipedia: 'en:Famous' }),
    el(4, 'Plain Church', 153.03, -27.5, { amenity: 'place_of_worship' }),
    el(5, 'Cathedral', 153.04, -27.5, { amenity: 'place_of_worship', wikidata: 'Q5' }),
    el(6, 'A Cafe', 153.04, -27.5, { amenity: 'cafe' }),
    { type: 'way', id: 7, center: { lat: -27.5, lon: 153.06 }, tags: { name: 'The Stadium', leisure: 'stadium' } },
    { type: 'node', id: 8, lat: -27.5, lon: 153.06, tags: { tourism: 'museum' } }, // no name
    { type: 'node', id: 9, lat: 'x', lon: 153.06, tags: { name: 'Bad Point', tourism: 'museum' } },
    null, 5, 'x', { tags: 'nope' }, {},
    el(10, '  Spaced   Name  ', 153.07, -27.5, { tourism: 'attraction' }),
    el(11, 'Same Place', 153.08, -27.5, { tourism: 'museum' }),
    { type: 'way', id: 12, center: { lat: -27.5, lon: 153.08 }, tags: { name: 'Same Place', tourism: 'museum', wikidata: 'Q7' } }, // its outline: one place, the better-known entry kept
  ];
  const r = rank(elements, route, 2000);
  const names = r.places.map((p) => p.name);
  assert.deepStrictEqual(names.sort(), ['Cathedral', 'Famous Gallery', 'Near Museum', 'Same Place', 'Spaced Name', 'The Stadium'].sort());
  assert.ok(!names.includes('Far Museum') && !names.includes('Plain Church') && !names.includes('A Cafe'));
  assert.deepStrictEqual(r.places.map((p) => p.distKm), [...r.places.map((p) => p.distKm)].sort((a, b) => a - b), 'nearest first');
  assert.strictEqual(r.places.find((p) => p.name === 'Same Place').notable, true);
  assert.strictEqual(r.places.find((p) => p.name === 'Famous Gallery').category, 'museums');
  assert.strictEqual(r.counts.museums, 3);
  assert.strictEqual(r.counts.sport, 1);
  assert.strictEqual(r.counts.civic, 0);
  assert.strictEqual(r.truncated, false);
  for (const p of r.places) { assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180); assert.strictEqual(typeof p.id, 'string'); assert.ok(!('_s' in p)); }
  assert.deepStrictEqual(rank(null, route, 2000).places, []);
  assert.deepStrictEqual(rank('x', route, 2000).places, []);
}
{ // a long route through a city: notable places first, and each category capped
  const many = Array.from({ length: 100 }, (_, i) => el(100 + i, `Gallery ${i}`, 153.0 + i * 0.0009, -27.5, i % 10 === 0 ? { tourism: 'gallery', wikidata: `Q${i}` } : { tourism: 'gallery' }));
  const r = rank(many, route, 2000);
  assert.strictEqual(r.counts.museums, PER_CATEGORY);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.places.filter((p) => p.notable).length, 10, 'every notable place made it');
}

// ---- the service
(async () => {
  const body = (elements, extra = {}) => ({ ok: true, status: 200, json: async () => ({ elements, ...extra }) });
  let calls = 0; let lastInit = null; let lastUrl = '';
  const mk = (handler, opts = {}) => createPlacesService({ fetchFn: async (url, init) => { calls += 1; lastUrl = url; lastInit = init; return handler(url, init); }, getUrl: () => 'https://overpass.test/api', userAgent: () => 'UA-test', ...opts });
  const good = [el(1, 'Near Museum', 153.05, -27.499, { tourism: 'museum' })];

  let svc = mk(async () => body(good));
  let r = await svc.near({ line: route, radiusKm: 2 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(lastUrl, 'https://overpass.test/api');
  assert.strictEqual(lastInit.method, 'POST');
  assert.strictEqual(lastInit.headers['User-Agent'], 'UA-test');
  assert.ok(decodeURIComponent(lastInit.body).startsWith('data=[out:json]'));
  assert.strictEqual(r.places.length, 1);
  assert.strictEqual(r.cached, false);
  assert.strictEqual(r.radiusKm, 2);
  assert.ok(r.routeKm > 9.5 && r.routeKm < 10.5, String(r.routeKm));

  // the same route and distance again is answered from memory, a different distance is not
  r = await svc.near({ line: route, radiusKm: 2 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(r.cached, true);
  await svc.near({ line: route, radiusKm: 1 });
  assert.strictEqual(calls, 2);

  // the cache expires
  let t = 1000;
  calls = 0;
  svc = mk(async () => body(good), { now: () => t });
  await svc.near({ line: route, radiusKm: 2 });
  t += 31 * 60 * 1000;
  await svc.near({ line: route, radiusKm: 2 });
  assert.strictEqual(calls, 2);

  // one question at a time, and two people asking for the same route make one request
  calls = 0;
  let live = 0; let maxLive = 0;
  svc = mk(async () => { live += 1; maxLive = Math.max(maxLive, live); await new Promise((res) => setTimeout(res, 20)); live -= 1; return body(good); });
  await Promise.all([svc.near({ line: route, radiusKm: 2 }), svc.near({ line: route, radiusKm: 2 }), svc.near({ line: route, radiusKm: 3 })]);
  assert.strictEqual(maxLive, 1, 'never two requests at once');
  assert.strictEqual(calls, 2, 'the repeated route did not ask again');

  // limits are checked before anything is sent
  calls = 0;
  svc = mk(async () => body(good));
  const long = Array.from({ length: 30 }, (_, i) => [150 + i * 0.1, -27.5]); // about 300 km
  await assert.rejects(() => svc.near({ line: long, radiusKm: 1 }), (e) => e.status === 422 && /over 200 km/.test(e.message));
  const wide = Array.from({ length: 20 }, (_, i) => [153 + i * 0.05, -27.5]); // about 90 km
  await assert.rejects(() => svc.near({ line: wide, radiusKm: 10 }), (e) => e.status === 422 && /too much ground/.test(e.message));
  await assert.rejects(() => svc.near({ line: route, radiusKm: 99 }), (e) => e.status === 400);
  await assert.rejects(() => svc.near({ line: [[1, 1]], radiusKm: 2 }), (e) => e.status === 400);
  assert.strictEqual(calls, 0);

  // every way Overpass can say no is a plain message, and nothing of its own text
  for (const [status, expected, re] of [[429, 503, /busy/], [504, 503, /busy/], [503, 503, /busy/], [500, 502, /did not answer/], [404, 502, /did not answer/]]) {
    svc = mk(async () => ({ ok: false, status, json: async () => ({}) }));
    await assert.rejects(() => svc.near({ line: route, radiusKm: 2 }), (e) => e.status === expected && re.test(e.message), String(status));
  }
  svc = mk(async () => { throw new Error('ECONNREFUSED secret-host'); });
  await assert.rejects(() => svc.near({ line: route, radiusKm: 2 }), (e) => e.status === 502 && /could not be reached/.test(e.message) && !/secret/.test(e.message));
  svc = mk(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
  await assert.rejects(() => svc.near({ line: route, radiusKm: 2 }), (e) => e.status === 502 && /took too long/.test(e.message));
  svc = mk(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
  await assert.rejects(() => svc.near({ line: route, radiusKm: 2 }), (e) => e.status === 502 && /unreadable/.test(e.message));
  svc = mk(async () => ({ ok: true, status: 200, json: async () => ({ remark: 'runtime error: Query timed out in "query" at line 3' }) }));
  await assert.rejects(() => svc.near({ line: route, radiusKm: 2 }), (e) => e.status === 503 && /smaller distance/.test(e.message));
  // a failure is not remembered
  calls = 0;
  let fail = true;
  svc = mk(async () => (fail ? { ok: false, status: 429, json: async () => ({}) } : body(good)));
  await assert.rejects(() => svc.near({ line: route, radiusKm: 2 }));
  fail = false;
  assert.strictEqual((await svc.near({ line: route, radiusKm: 2 })).places.length, 1);
  assert.strictEqual(calls, 2);
  // an answer with no elements is just no places
  svc = mk(async () => body(undefined));
  assert.deepStrictEqual((await svc.near({ line: route, radiusKm: 2 })).places, []);

  // several public servers: a dead or busy one is skipped and the next answers; a refusal of the query itself is not retried
  const urls = ['https://one.test/api', 'https://two.test/api', 'https://three.test/api'];
  const tried = []; const logged = [];
  const multi = (handler) => createPlacesService({ fetchFn: async (url, init) => { tried.push(url); return handler(url, init); }, getUrls: () => urls, log: (m, d) => logged.push(`${m} ${d}`), userAgent: () => 'UA-test' });
  tried.length = 0;
  let m = multi(async (url) => { if (url.includes('one')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); return body(good); });
  assert.strictEqual((await m.near({ line: route, radiusKm: 2 })).places.length, 1);
  assert.deepStrictEqual(tried, [urls[0], urls[1]], 'the second server answered, the third was not needed');
  assert.ok(/one\.test.*ECONNRESET/.test(logged[0]), 'the log says which server failed and why: ' + logged[0]);
  tried.length = 0;
  m = multi(async (url) => (url.includes('three') ? body(good) : { ok: false, status: url.includes('one') ? 429 : 504, json: async () => ({}) }));
  assert.strictEqual((await m.near({ line: route, radiusKm: 3 })).places.length, 1);
  assert.deepStrictEqual(tried, urls, 'busy servers are skipped one after another');
  tried.length = 0;
  m = multi(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
  await assert.rejects(() => m.near({ line: route, radiusKm: 4 }), (e) => e.status === 502 && /took too long/.test(e.message));
  assert.deepStrictEqual(tried, urls, 'every server is tried before giving up');
  tried.length = 0;
  m = multi(async () => ({ ok: false, status: 400, json: async () => ({}) }));
  await assert.rejects(() => m.near({ line: route, radiusKm: 5 }), (e) => e.status === 502);
  assert.strictEqual(tried.length, 1, 'a refused query is not sent to the other servers');
  assert.ok(require('./routePlaces').createPlacesService, 'exported');

  console.log('routePlaces.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
