'use strict';
// node server/services/youtubeApi.test.js   (npm run test:youtube-api). No network, no database: a small fake pool stands in.
const assert = require('node:assert/strict');
const A = require('./youtubeApi');

// ---- cost and freshness
assert.equal(A.endpointInfo('/youtube/v3/search?q=x').cost, 100);
assert.equal(A.endpointInfo('/youtube/v3/videos?id=1').cost, 1);
assert.equal(A.endpointInfo('/youtube/v3/commentThreads?videoId=1').ttlMs, 3600 * 1000);
assert.equal(A.endpointInfo('/youtube/v3/somethingNew').cost, 1, 'unknown calls count as one unit');

// ---- the cache key ignores the secret key and parameter order
assert.equal(A.cacheKey('/youtube/v3/search?q=bread&order=date&key=SECRET'), A.cacheKey('/youtube/v3/search?key=OTHER&order=date&q=bread'));
assert.ok(!A.cacheKey('/youtube/v3/search?q=bread&key=SECRET').includes('SECRET'), 'the API key never reaches the cache');
assert.notEqual(A.cacheKey('/youtube/v3/search?q=bread'), A.cacheKey('/youtube/v3/search?q=cake'));

// ---- the quota day follows Los Angeles, not the server clock
assert.equal(A.quotaDay(new Date('2026-11-02T06:00:00Z')), '2026-11-01', 'early on the 2nd in UTC is still the 1st in Los Angeles');
assert.equal(A.quotaDay(new Date('2026-11-02T09:00:00Z')), '2026-11-02');

// ---- budget arithmetic
assert.equal(A.canSpend(9900, 100, 10000), true);
assert.equal(A.canSpend(9901, 100, 10000), false);
assert.equal(A.searchesLeft(0, 10000), 100);
assert.equal(A.searchesLeft(9950, 10000), 0);
assert.equal(A.searchesLeft(20000, 10000), 0, 'never negative');
assert.equal(A.isQuotaError('The request cannot be completed because you have exceeded your quota.'), true);
assert.equal(A.isQuotaError('Invalid value'), false);

// ---- cachedGet with a fake pool
function fakePool(startUnits = 0) {
  const db = { cache: new Map(), units: new Map() };
  return {
    db,
    async query(sql, params) {
      if (/FROM youtube_api_cache/.test(sql)) { const r = db.cache.get(params[0]); return { rows: r ? [{ payload: r.payload, createdAt: r.at }] : [] }; }
      if (/INSERT INTO youtube_api_cache/.test(sql)) { db.cache.set(params[0], { payload: JSON.parse(params[1]), at: new Date() }); return { rows: [] }; }
      if (/DELETE FROM youtube_api_cache/.test(sql)) return { rows: [] };
      if (/FROM youtube_quota/.test(sql)) { const u = db.units.get(params[0]); return { rows: u === undefined ? [] : [{ units: u }] }; }
      if (/INSERT INTO youtube_quota/.test(sql)) { db.units.set(params[0], (db.units.get(params[0]) ?? 0) + params[1]); return { rows: [] }; }
      throw new Error('unexpected sql ' + sql);
    },
    seed(day, units) { db.units.set(day, units); },
  };
}

(async () => {
  const now = new Date('2026-11-02T15:00:00Z');
  const day = A.quotaDay(now);
  let calls = 0;
  const raw = async (p) => { calls += 1; return { items: [p], n: calls }; };

  const pool = fakePool();
  const path = '/youtube/v3/search?q=bread&key=SECRET';
  const first = await A.cachedGet(pool, raw, path, { now });
  const second = await A.cachedGet(pool, raw, '/youtube/v3/search?key=OTHER&q=bread', { now });
  assert.equal(calls, 1, 'the second identical search came from the cache');
  assert.deepEqual(first, second);
  assert.equal(pool.db.units.get(day), 100, 'only the real call was counted');

  await A.cachedGet(pool, raw, '/youtube/v3/videos?id=abc', { now });
  assert.equal(pool.db.units.get(day), 101);

  // a stale cache entry is not used
  const stale = fakePool();
  stale.db.cache.set(A.cacheKey('/youtube/v3/search?q=old'), { payload: { old: true }, at: new Date(Date.now() - 7 * 3600 * 1000) });
  calls = 0;
  const fresh = await A.cachedGet(stale, raw, '/youtube/v3/search?q=old', { now });
  assert.equal(calls, 1);
  assert.ok(!fresh.old, 'a six-hour-old search is asked again');

  // allowance used up: refused politely, Google not called
  const full = fakePool();
  full.seed(day, 9950);
  calls = 0;
  await assert.rejects(() => A.cachedGet(full, raw, '/youtube/v3/search?q=nope', { now }), (e) => e instanceof A.QuotaError && e.status === 429 && /midnight Pacific/.test(e.message));
  assert.equal(calls, 0);
  // ...but a cheap call still goes through, and a cached search still works
  await A.cachedGet(full, raw, '/youtube/v3/videos?id=zzz', { now });
  assert.equal(calls, 1);

  // Google says the quota is spent: we remember, and stop asking
  const google = fakePool();
  const gRaw = async () => { throw new Error('The request cannot be completed because you have exceeded your quota.'); };
  await assert.rejects(() => A.cachedGet(google, gRaw, '/youtube/v3/search?q=x', { now }), A.QuotaError);
  assert.ok(google.db.units.get(day) >= A.DAILY_QUOTA(), 'the day is marked as spent');
  calls = 0;
  await assert.rejects(() => A.cachedGet(google, raw, '/youtube/v3/search?q=y', { now }), A.QuotaError);
  assert.equal(calls, 0, 'no more calls today');

  // any other error passes through untouched and is not counted
  const bad = fakePool();
  await assert.rejects(() => A.cachedGet(bad, async () => { throw new Error('Invalid value'); }, '/youtube/v3/search?q=z', { now }), /Invalid value/);
  assert.equal(bad.db.units.get(day), undefined);

  console.log('youtubeApi: ok');
})().catch((e) => { console.error(e); process.exit(1); });
