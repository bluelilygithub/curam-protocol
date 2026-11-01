'use strict';

// Every call Vault makes to the YouTube Data API goes through here, so two things happen in ONE place:
//   - answers are CACHED for a few hours (the same search twice costs nothing), and
//   - the day's QUOTA is counted, so the page can warn before the key runs dry and refuse politely instead of showing a raw Google error.
// A search costs 100 quota units (everything else about 1) and the free allowance is 10,000 a day, so about 100 searches. The pure parts
// (what a call costs, the cache key, the quota day) are tested in youtubeApi.test.js; the database parts are small and read the pool you pass.
// Cached answers are deleted after 7 days: YouTube's API terms do not let API data be kept for long.

const https = require('https');

const DAILY_QUOTA = () => Math.max(1, parseInt(process.env.YOUTUBE_DAILY_QUOTA, 10) || 10000);
const HOUR = 3600 * 1000;
const CACHE_PURGE_DAYS = 7;

/** What a call costs in quota units and how long its answer stays fresh. Unknown endpoints are treated as 1 unit and not cached long. */
function endpointInfo(path) {
  const p = String(path || '').split('?')[0];
  if (p.endsWith('/search')) return { cost: 100, ttlMs: 6 * HOUR };
  if (p.endsWith('/videos')) return { cost: 1, ttlMs: 6 * HOUR };
  if (p.endsWith('/playlistItems')) return { cost: 1, ttlMs: 6 * HOUR };
  if (p.endsWith('/channels')) return { cost: 1, ttlMs: 12 * HOUR };
  if (p.endsWith('/videoCategories')) return { cost: 1, ttlMs: 24 * HOUR };
  if (p.endsWith('/commentThreads')) return { cost: 1, ttlMs: 1 * HOUR };
  return { cost: 1, ttlMs: 1 * HOUR };
}

/** The same question always gives the same key: parameters sorted, the secret key left out. */
function cacheKey(path) {
  const [base, query = ''] = String(path || '').split('?');
  const params = new URLSearchParams(query);
  params.delete('key');
  const sorted = [...params.entries()].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  return base + '?' + sorted.map(([k, v]) => `${k}=${v}`).join('&');
}

/** YouTube's quota resets at midnight Pacific time, so "today" is the date in Los Angeles. */
function quotaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
}

const canSpend = (used, cost, limit) => Number(used || 0) + cost <= limit;
const searchesLeft = (used, limit) => Math.max(0, Math.floor((limit - Number(used || 0)) / 100));

function isQuotaError(message) {
  return /quota/i.test(String(message || ''));
}

class QuotaError extends Error {
  constructor(message) { super(message); this.name = 'QuotaError'; this.status = 429; }
}
const QUOTA_MESSAGE = "YouTube's daily search allowance for this key is used up. It resets at midnight Pacific time. Searches you have already run still work.";

async function readCache(pool, key, ttlMs) {
  try {
    const { rows } = await pool.query('SELECT payload, "createdAt" FROM youtube_api_cache WHERE key = $1', [key]);
    if (!rows[0]) return null;
    if (Date.now() - new Date(rows[0].createdAt).getTime() > ttlMs) return null;
    return rows[0].payload;
  } catch (_) { return null; }
}

async function writeCache(pool, key, payload) {
  try {
    await pool.query(
      `INSERT INTO youtube_api_cache (key, payload, "createdAt") VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, "createdAt" = NOW()`,
      [key, JSON.stringify(payload)]
    );
    await pool.query(`DELETE FROM youtube_api_cache WHERE "createdAt" < NOW() - ($1 || ' days')::interval`, [String(CACHE_PURGE_DAYS)]);
  } catch (_) { /* a cache that cannot be written is only a missed saving */ }
}

async function quotaUsed(pool, day = quotaDay()) {
  try {
    const { rows } = await pool.query('SELECT units FROM youtube_quota WHERE day = $1::date', [day]);
    return Number(rows[0]?.units || 0);
  } catch (_) { return 0; }
}

async function addQuota(pool, units, day = quotaDay()) {
  try {
    await pool.query(
      `INSERT INTO youtube_quota (day, units) VALUES ($1::date, $2)
       ON CONFLICT (day) DO UPDATE SET units = youtube_quota.units + EXCLUDED.units`,
      [day, units]
    );
  } catch (_) { /* counting is best effort */ }
}

/**
 * A YouTube Data API GET with caching and quota counting. `rawGet(path)` does the real request (and throws on a Google error).
 * Returns the JSON. Throws QuotaError (status 429) when today's allowance is spent or Google says so.
 */
async function cachedGet(pool, rawGet, path, { now = new Date() } = {}) {
  const { cost, ttlMs } = endpointInfo(path);
  const key = cacheKey(path);
  const hit = await readCache(pool, key, ttlMs);
  if (hit) return hit;

  const day = quotaDay(now);
  const used = await quotaUsed(pool, day);
  if (!canSpend(used, cost, DAILY_QUOTA())) throw new QuotaError(QUOTA_MESSAGE);

  let data;
  try {
    data = await rawGet(path);
  } catch (err) {
    if (isQuotaError(err.message)) {
      await addQuota(pool, DAILY_QUOTA(), day); // Google says it is spent: stop asking until tomorrow
      throw new QuotaError(QUOTA_MESSAGE);
    }
    throw err;
  }
  await addQuota(pool, cost, day);
  await writeCache(pool, key, data);
  return data;
}

async function quotaStatus(pool) {
  const used = await quotaUsed(pool);
  const limit = DAILY_QUOTA();
  return { used, limit, searchesLeft: searchesLeft(used, limit) };
}

function getKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY not configured');
  return k;
}

/** The real request to the YouTube Data API (no cache, no counting). Resolves the JSON, rejects with Google's message. */
function ytRawGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://www.googleapis.com${path}`);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 400) reject(new Error((json.error && json.error.message) || `YouTube API error HTTP ${res.statusCode}`));
            else resolve(json);
          } catch {
            reject(new Error('Invalid response from YouTube API'));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** Cached, quota-counted GET: what every route and the daily job use. */
const ytGet = (pool, path) => cachedGet(pool, ytRawGet, path);

module.exports = {
  getKey, ytRawGet, ytGet,
  DAILY_QUOTA, CACHE_PURGE_DAYS, QUOTA_MESSAGE, QuotaError,
  endpointInfo, cacheKey, quotaDay, canSpend, searchesLeft, isQuotaError,
  cachedGet, quotaStatus,
};
