'use strict';

// SERP Tracker: reading the daily tracking rows (serp_rankings, written by rankCollect.js). Every query filters by "userId" AND the site.

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** The latest row for each keyword and device, with the one before it for the change. Failed rows are included (they say why). */
async function listLatest(pool, userId, siteId) {
  const { rows } = await pool.query(
    `SELECT keyword, device, day, status, position, url, depth, "readsJson", error, "costUsd"::float AS cost FROM (
       SELECT keyword, device, "runDate"::text AS day, status, position, url, depth, "readsJson", error, "costUsd",
              ROW_NUMBER() OVER (PARTITION BY keyword, device ORDER BY "runDate" DESC) AS rn
         FROM serp_rankings WHERE "siteId" = $1 AND "userId" = $2) t
      WHERE rn <= 2 ORDER BY keyword, device, rn`,
    [siteId, userId],
  );
  const out = new Map();
  for (const r of rows) {
    const key = `${r.keyword}\u0000${r.device}`;
    const entry = out.get(key) || { keyword: r.keyword, device: r.device, latest: null, previous: null };
    const item = { day: r.day, status: r.status, position: r.position, url: r.url, depth: r.depth, reads: parseJson(r.readsJson) || [], error: r.error, costUsd: r.cost };
    if (!entry.latest) entry.latest = item; else entry.previous = { day: item.day, status: item.status, position: item.position };
    out.set(key, entry);
  }
  return [...out.values()];
}

/** One keyword and device over time, oldest first: { day, status, position } (position null = not found or failed, never 0). */
async function series(pool, userId, siteId, keyword, device, days = 90) {
  const span = days === 'all' ? 100000 : Math.min(Math.max(Number(days) || 90, 1), 100000);
  const { rows } = await pool.query(
    `SELECT "runDate"::text AS day, status, position FROM serp_rankings
      WHERE "siteId" = $1 AND "userId" = $2 AND keyword = $3 AND device = $4 AND "runDate" > CURRENT_DATE - $5::int
      ORDER BY "runDate"`,
    [siteId, userId, String(keyword).slice(0, 200), device === 'mobile' ? 'mobile' : 'desktop', span],
  );
  return rows.map((r) => ({ day: r.day, status: r.status, position: r.position }));
}

module.exports = { listLatest, series };
