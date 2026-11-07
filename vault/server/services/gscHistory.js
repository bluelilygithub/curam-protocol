'use strict';

// SERP Tracker "Keywords" tab: Search Console history kept in gsc_daily (one row per property, day and query), so a keyword's position can be
// charted over time and the keywords a site really ranks for can be listed. Everything is keyed by "userId" and the Search Console property
// (siteUrl), never trimmed. See docs/serp-tracker.md, "Keywords".
//
//   backfill  up to 16 months (the most Search Console keeps), newest window first so something useful shows early, 31 days a request, 25,000 rows a
//             page; progress is saved after every window ("backfilledTo"), so a cut-off run carries on where it stopped
//   daily     re-pulls the last RESYNC_DAYS days (Google revises recent figures) up to three days ago (the newest day Google has final figures for)
//
// `fetchRows` is injected, so the paging and resume logic is tested with no Google and no network (gscHistory.test.js).

const PAGE_ROWS = 25000;
const WINDOW_DAYS = 31;
const HISTORY_MONTHS = 16;
const END_LAG_DAYS = 3;
const RESYNC_DAYS = 7;
const BATCH = 5000;
const STALE_RUNNING_MS = 60 * 60 * 1000; // a sync marked "running" for over an hour died with its server
const MAX_QUERY_CHARS = 500;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const earliestDay = (today) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - HISTORY_MONTHS); return iso(d); };
const lastDay = (today) => addDays(today, -END_LAG_DAYS);
const toDay = (v) => (v instanceof Date ? iso(v) : v ? String(v).slice(0, 10) : null);

/** Which Search Console property a site reads from: the domain property, else the https then http address (www first). Unverified ones are skipped. */
function pickProperty(domain, properties) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!d) return null;
  const usable = (properties || []).filter((p) => p && p.siteUrl && p.permissionLevel !== 'siteUnverifiedUser');
  for (const want of [`sc-domain:${d}`, `https://www.${d}/`, `https://${d}/`, `http://www.${d}/`, `http://${d}/`]) {
    const hit = usable.find((p) => p.siteUrl.toLowerCase() === want);
    if (hit) return hit.siteUrl;
  }
  return null;
}

/** [from, to] (both included) -> windows of at most WINDOW_DAYS, NEWEST first. */
function planWindows(from, to) {
  const out = [];
  let end = to;
  while (end >= from) {
    let start = addDays(end, -(WINDOW_DAYS - 1));
    if (start < from) start = from;
    out.push({ start, end });
    end = addDays(start, -1);
  }
  return out;
}

async function getState(pool, userId, siteUrl) {
  const { rows } = await pool.query(
    `SELECT status, "backfilledTo"::text AS "backfilledTo", "newestDay"::text AS "newestDay", "totalRows", "startedAt", "finishedAt", "lastError"
       FROM gsc_sync_state WHERE "userId" = $1 AND "siteUrl" = $2`, [userId, siteUrl]);
  return rows[0] || null;
}

async function upsertRows(pool, userId, siteUrl, rows) {
  const seen = new Map(); // one row per day and query inside a batch (a repeat would make Postgres refuse the whole insert)
  for (const r of rows) {
    const day = r.keys && r.keys[0];
    const query = String((r.keys && r.keys[1]) || '').slice(0, MAX_QUERY_CHARS);
    if (!day || !query) continue;
    seen.set(`${day}|${query}`, { day, query, clicks: Math.round(Number(r.clicks) || 0), impressions: Math.round(Number(r.impressions) || 0), position: r.position != null && Number.isFinite(Number(r.position)) ? Number(r.position) : null });
  }
  const list = [...seen.values()];
  for (let i = 0; i < list.length; i += BATCH) {
    const part = list.slice(i, i + BATCH);
    await pool.query(
      `INSERT INTO gsc_daily ("userId", "siteUrl", day, query, clicks, impressions, position)
       SELECT $1, $2, t.d, t.q, t.c, t.i, t.p FROM unnest($3::date[], $4::text[], $5::int[], $6::int[], $7::real[]) AS t(d, q, c, i, p)
       ON CONFLICT ("userId", "siteUrl", day, query) DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, position = EXCLUDED.position`,
      [userId, siteUrl, part.map((r) => r.day), part.map((r) => r.query), part.map((r) => r.clicks), part.map((r) => r.impressions), part.map((r) => r.position)],
    );
  }
  return { count: list.length, maxDay: list.reduce((m, r) => (r.day > m ? r.day : m), '') || null };
}

/**
 * Bring one property's history up to date. Safe to call twice at once (the second call returns { started: false }) and safe to run again after
 * a failure (it resumes). @returns {{ started: boolean, ok?: boolean, rows?: number, error?: string }}
 */
async function syncSite({ pool, userId, siteUrl, fetchRows, today = iso(new Date()), log = () => {} }) {
  const claim = await pool.query(
    `INSERT INTO gsc_sync_state ("userId", "siteUrl", status, "startedAt") VALUES ($1, $2, 'running', NOW())
     ON CONFLICT ("userId", "siteUrl") DO UPDATE SET status = 'running', "startedAt" = NOW(), "lastError" = NULL
       WHERE gsc_sync_state.status <> 'running' OR gsc_sync_state."startedAt" < NOW() - make_interval(secs => $3::double precision)
     RETURNING 1`, [userId, siteUrl, STALE_RUNNING_MS / 1000]);
  if (!claim.rowCount) return { started: false };

  const last = lastDay(today);
  const earliest = earliestDay(today);
  let rowsSeen = 0;
  try {
    const st = await getState(pool, userId, siteUrl);
    const windows = [];
    if (st.newestDay) {
      const recentStart = [earliest, addDays(st.newestDay, -RESYNC_DAYS)].reduce((a, b) => (a > b ? a : b));
      if (recentStart <= last) windows.push({ start: recentStart, end: last, kind: 'recent' });
    }
    if (!st.backfilledTo) windows.push(...planWindows(earliest, last).map((w) => ({ ...w, kind: 'back' })));
    else if (st.backfilledTo > earliest) windows.push(...planWindows(earliest, addDays(st.backfilledTo, -1)).map((w) => ({ ...w, kind: 'back' })));

    for (const w of windows) {
      let startRow = 0;
      let maxDay = null;
      for (;;) {
        const page = await fetchRows({ startDate: w.start, endDate: w.end, startRow, rowLimit: PAGE_ROWS });
        const got = await upsertRows(pool, userId, siteUrl, page);
        rowsSeen += got.count;
        if (got.maxDay && (!maxDay || got.maxDay > maxDay)) maxDay = got.maxDay;
        if (page.length < PAGE_ROWS) break;
        startRow += PAGE_ROWS;
      }
      // progress is saved after every window, so a run that is cut off carries on from here next time
      await pool.query(
        `UPDATE gsc_sync_state SET
           "backfilledTo" = CASE WHEN $3 = 'back' THEN LEAST(COALESCE("backfilledTo", $4::date), $4::date) ELSE "backfilledTo" END,
           "newestDay" = CASE WHEN $5::date IS NULL THEN "newestDay" ELSE GREATEST(COALESCE("newestDay", $5::date), $5::date) END,
           "totalRows" = (SELECT COUNT(*) FROM gsc_daily WHERE "userId" = $1 AND "siteUrl" = $2)
         WHERE "userId" = $1 AND "siteUrl" = $2`,
        [userId, siteUrl, w.kind, w.start, maxDay],
      );
    }
    await pool.query(`UPDATE gsc_sync_state SET status = 'ok', "finishedAt" = NOW(), "lastError" = NULL WHERE "userId" = $1 AND "siteUrl" = $2`, [userId, siteUrl]);
    return { started: true, ok: true, rows: rowsSeen };
  } catch (err) {
    const msg = String((err && err.message) || 'The sync failed.').replace(/\s+/g, ' ').slice(0, 300);
    log(`gsc sync failed for ${siteUrl}: ${msg}`);
    await pool.query(`UPDATE gsc_sync_state SET status = 'failed', "finishedAt" = NOW(), "lastError" = $3 WHERE "userId" = $1 AND "siteUrl" = $2`, [userId, siteUrl, msg]).catch(() => {});
    return { started: true, ok: false, error: msg };
  }
}

/** How far the history has got, for the page: { status, months (of 16), from, to, rows, lastError, finishedAt } or null if never synced. */
async function syncProgress(pool, userId, siteUrl, today = iso(new Date())) {
  const st = await getState(pool, userId, siteUrl);
  if (!st) return null;
  const running = st.status === 'running' && st.startedAt && Date.now() - new Date(st.startedAt).getTime() < STALE_RUNNING_MS;
  const earliest = earliestDay(today);
  const last = lastDay(today);
  const spanDays = Math.max(1, (new Date(`${last}T00:00:00Z`) - new Date(`${earliest}T00:00:00Z`)) / 86400000);
  const doneDays = st.backfilledTo ? Math.max(0, (new Date(`${last}T00:00:00Z`) - new Date(`${st.backfilledTo}T00:00:00Z`)) / 86400000) : 0;
  return {
    status: running ? 'running' : st.status === 'running' ? 'failed' : st.status,
    percent: Math.min(100, Math.round((doneDays / spanDays) * 100)),
    from: st.backfilledTo, to: st.newestDay, rows: Number(st.totalRows) || 0,
    lastError: st.status === 'running' && !running ? 'The last sync was interrupted. Press Update to carry on.' : st.lastError,
    finishedAt: st.finishedAt,
  };
}

const LIKE_ESCAPE = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
const SORTS = { clicks: 'clicks', impressions: 'impressions', position: 'position', keyword: 'query', change: 'change' };

/**
 * The keywords a property ranks for over the last `days` days (or all history), with the position from the period before for comparison.
 * Position is the average weighted by impressions. `striking` keeps positions 8 to 20 with at least `minImpressions` impressions.
 */
/**
 * `newOnly` keeps keywords whose FIRST day anywhere in the stored history falls inside the period (searches the site has just started to show for).
 * It only means something when the history reaches back before the period (otherwise every keyword in a freshly loaded history looks new), so it
 * returns nothing until then and says so in `history.newReady`.
 */
async function listKeywords(pool, userId, siteUrl, { days = 28, sort = 'clicks', dir, q = '', striking = false, newOnly = false, minImpressions = 10, limit = 200 } = {}) {
  const span = days === 'all' ? 100000 : Math.min(Math.max(Number(days) || 28, 1), 100000);
  const col = SORTS[sort] || 'clicks';
  const direction = (dir || (col === 'position' || col === 'query' ? 'asc' : 'desc')) === 'asc' ? 'ASC' : 'DESC';
  const params = [userId, siteUrl, span];
  let like = '';
  if (q && String(q).trim()) { params.push(`%${LIKE_ESCAPE(String(q).trim().slice(0, 100))}%`); like = `AND query ILIKE $${params.length}`; }
  const where = [];
  if (striking) { params.push(minImpressions); where.push(`cur.position >= 8 AND cur.position <= 20 AND cur.impressions >= $${params.length}`); }
  if (newOnly) where.push('first.first_day > latest.d - $3::int AND latest.s <= latest.d - $3::int');
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const sql = `
    WITH latest AS (SELECT MAX(day) AS d, MIN(day) AS s FROM gsc_daily WHERE "userId" = $1 AND "siteUrl" = $2),
    cur AS (
      SELECT query, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
             (SUM(position * impressions) / NULLIF(SUM(impressions), 0))::float AS position
        FROM gsc_daily, latest WHERE "userId" = $1 AND "siteUrl" = $2 AND day > latest.d - $3::int AND day <= latest.d ${like} GROUP BY query),
    prev AS (
      SELECT query, (SUM(position * impressions) / NULLIF(SUM(impressions), 0))::float AS position
        FROM gsc_daily, latest WHERE "userId" = $1 AND "siteUrl" = $2 AND day > latest.d - 2 * $3::int AND day <= latest.d - $3::int GROUP BY query)
    ${newOnly ? `, first AS (SELECT query, MIN(day) AS first_day FROM gsc_daily WHERE "userId" = $1 AND "siteUrl" = $2 GROUP BY query)` : ''}
    SELECT cur.query, cur.clicks, cur.impressions, cur.position, prev.position AS "prevPosition",
           (prev.position - cur.position) AS change, COUNT(*) OVER () AS total${newOnly ? ', first.first_day::text AS "firstSeen"' : ''}
      FROM cur LEFT JOIN prev USING (query)${newOnly ? ' JOIN first USING (query) CROSS JOIN latest' : ''}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${col === 'query' ? 'cur.query' : col === 'change' ? 'change' : `cur.${col}`} ${direction} NULLS LAST, cur.query
     LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  const bounds = (await pool.query('SELECT MIN(day)::text AS s, MAX(day)::text AS d FROM gsc_daily WHERE "userId" = $1 AND "siteUrl" = $2', [userId, siteUrl])).rows[0];
  const spanDays = days === 'all' ? null : span;
  return {
    // how far the history reaches, so the page can say why "new" is empty (it needs history from before the period) 
    history: { from: bounds.s, to: bounds.d, newReady: Boolean(bounds.s && bounds.d && spanDays != null && bounds.s <= addDays(bounds.d, -spanDays)) },
    total: rows.length ? Number(rows[0].total) : 0,
    keywords: rows.map((r) => ({
      query: r.query, clicks: r.clicks, impressions: r.impressions,
      position: r.position == null ? null : Number(r.position), prevPosition: r.prevPosition == null ? null : Number(r.prevPosition),
      change: r.change == null ? null : Number(r.change), // positive = moved up (a smaller position number is better)
      ...(r.firstSeen ? { firstSeen: r.firstSeen } : {}),
    })),
  };
}

/** One keyword's daily figures. @returns {{ day, clicks, impressions, position }[]} oldest first */
async function keywordHistory(pool, userId, siteUrl, query, { days = 'all' } = {}) {
  const span = days === 'all' ? 100000 : Math.min(Math.max(Number(days) || 90, 1), 100000);
  const { rows } = await pool.query(
    `SELECT day::text AS day, clicks, impressions, position FROM gsc_daily
      WHERE "userId" = $1 AND "siteUrl" = $2 AND query = $3
        AND day > (SELECT MAX(day) FROM gsc_daily WHERE "userId" = $1 AND "siteUrl" = $2) - $4::int
      ORDER BY day`, [userId, siteUrl, String(query).slice(0, MAX_QUERY_CHARS), span]);
  return rows.map((r) => ({ day: r.day, clicks: r.clicks, impressions: r.impressions, position: r.position == null ? null : Number(r.position) }));
}

/** Keywords that fell back sharply: the last 7 days against the 28 before, with real impressions in both. Worst first. */
async function findDrops(pool, userId, siteUrl, { minPrevImpressions = 50, minCurImpressions = 10, minDrop = 5, limit = 5 } = {}) {
  const { rows } = await pool.query(
    `WITH latest AS (SELECT MAX(day) AS d FROM gsc_daily WHERE "userId" = $1 AND "siteUrl" = $2),
     cur AS (SELECT query, SUM(impressions)::int AS impressions, (SUM(position * impressions) / NULLIF(SUM(impressions), 0))::float AS position
               FROM gsc_daily, latest WHERE "userId" = $1 AND "siteUrl" = $2 AND day > latest.d - 7 AND day <= latest.d GROUP BY query),
     prev AS (SELECT query, SUM(impressions)::int AS impressions, (SUM(position * impressions) / NULLIF(SUM(impressions), 0))::float AS position
               FROM gsc_daily, latest WHERE "userId" = $1 AND "siteUrl" = $2 AND day > latest.d - 35 AND day <= latest.d - 7 GROUP BY query)
     SELECT cur.query, prev.position AS "from", cur.position AS "to", prev.impressions AS "prevImpressions"
       FROM cur JOIN prev USING (query)
      WHERE prev.impressions >= $3 AND cur.impressions >= $4 AND cur.position - prev.position >= $5
      ORDER BY prev.impressions DESC LIMIT $6`, [userId, siteUrl, minPrevImpressions, minCurImpressions, minDrop, limit]);
  return rows.map((r) => ({ query: r.query, from: Number(r.from), to: Number(r.to), prevImpressions: r.prevImpressions }));
}

/** The daily job's alert: one Suggestions-inbox item per dropped keyword per week (the fingerprint stops repeats). */
async function captureDrops({ pool, userId, siteUrl, label, capture, makeFingerprint, today = iso(new Date()) }) {
  const drops = await findDrops(pool, userId, siteUrl);
  const week = Math.floor(new Date(`${today}T00:00:00Z`).getTime() / (7 * 86400000));
  for (const d of drops) {
    await capture({
      userId, source: 'serpTracker', category: 'alert',
      fingerprint: makeFingerprint('serpTracker', `gscdrop:${siteUrl}:${d.query}:${week}`),
      title: `"${d.query}" slipped on Google (${label})`,
      body: `Its average position went from about ${d.from.toFixed(1)} to ${d.to.toFixed(1)} over the last 7 days (the 28 days before had ${d.prevImpressions} impressions). Source: Search Console. Open SERP Tracker, Keywords, to see the chart.`,
      context: '/serp-tracker',
    });
  }
  return drops.length;
}

module.exports = {
  pickProperty, planWindows, syncSite, syncProgress, listKeywords, keywordHistory, findDrops, captureDrops,
  addDays, earliestDay, lastDay, toDay, PAGE_ROWS, WINDOW_DAYS, HISTORY_MONTHS, END_LAG_DAYS, RESYNC_DAYS,
};
