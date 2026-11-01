'use strict';

// Follow a YouTube channel or a search and find out about NEW videos. Channels are cheap to check (a channel's uploads list costs 1 quota unit),
// searches are expensive (100 units), so a person can follow up to 30 channels but only 5 searches, channels are checked about every 5 hours and
// searches about once a day. The first look when you follow something only records what is already there (as seen), so only videos that appear
// AFTERWARDS count as new. New videos show on the Following tab and in "Needs attention".
// The pure parts (what is valid, what is due, which items are new) are tested in youtubeFollows.test.js; the rest reads and writes the tables
// youtube_follows / youtube_follow_videos through the pool and the (cached, quota-counted) `ytGet` it is given.
// YouTube's API terms limit how long API data may be kept, so videos found by a check are deleted after 30 days.

const HOUR = 3600 * 1000;
const LIMITS = { channel: 30, search: 5 };
const EVERY_MS = { channel: 5 * HOUR, search: 20 * HOUR };
const KEEP_DAYS = 30;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const ORDERS = ['date', 'relevance', 'viewCount', 'rating'];
const DURATIONS = ['any', 'short', 'medium', 'long'];

/** A channel's uploads live in a hidden playlist whose id is the channel id with UC changed to UU. */
function uploadsPlaylistId(channelId) {
  return CHANNEL_ID.test(String(channelId || '')) ? 'UU' + String(channelId).slice(2) : null;
}

/** Check what the page sent. Returns { ok: true, value } with clean fields, or { ok: false, error } in plain words. */
function validateFollow(input) {
  const i = input && typeof input === 'object' ? input : {};
  if (i.kind === 'channel') {
    if (!CHANNEL_ID.test(String(i.channelId || ''))) return { ok: false, error: 'That does not look like a YouTube channel.' };
    return { ok: true, value: { kind: 'channel', channelId: i.channelId, channelTitle: String(i.channelTitle || '').trim().slice(0, 120) || 'Channel', query: null, sortOrder: null, duration: null } };
  }
  if (i.kind === 'search') {
    const query = String(i.query || '').trim().replace(/\s+/g, ' ');
    if (query.length < 2 || query.length > 100) return { ok: false, error: 'A search to follow needs 2 to 100 characters.' };
    const sortOrder = ORDERS.includes(i.order) ? i.order : 'date';
    const duration = DURATIONS.includes(i.duration) ? i.duration : 'any';
    return { ok: true, value: { kind: 'search', channelId: null, channelTitle: null, query, sortOrder, duration } };
  }
  return { ok: false, error: 'Choose a channel or a search to follow.' };
}

/** Is this follow due for a look? `minGapMs` overrides how long to leave it (a manual "check now" uses a short gap for channels only). */
function dueForCheck(follow, now = new Date(), { minGapMs } = {}) {
  const gap = minGapMs ?? EVERY_MS[follow.kind] ?? EVERY_MS.search;
  if (!follow.lastCheckedAt) return true;
  return now.getTime() - new Date(follow.lastCheckedAt).getTime() >= gap;
}

/** A playlistItems.list or search.list item as a plain video, or null for one that is private, deleted or has no id. */
function shapeItem(item) {
  const videoId = (item && item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId) || (item && item.id && item.id.videoId) || null;
  const s = item && item.snippet;
  if (!videoId || !s) return null;
  const title = String(s.title || '').trim();
  if (!title || /^(private video|deleted video)$/i.test(title)) return null;
  return {
    videoId,
    title: title.slice(0, 300),
    channel: String(s.channelTitle || '').slice(0, 120),
    thumbnail: (s.thumbnails && ((s.thumbnails.medium && s.thumbnails.medium.url) || (s.thumbnails.default && s.thumbnails.default.url))) || '',
    publishedAt: s.publishedAt || null,
  };
}

/** Of the items a check returned, the videos not seen before, newest first. */
function newVideosFrom(items, knownIds) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const v = shapeItem(item);
    if (!v || known.has(v.videoId) || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
  }
  return out.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

// ── database ────────────────────────────────────────────────────────────────

const COLS = `id, "userId", kind, "channelId", "channelTitle", query, "sortOrder", duration, "createdAt", "lastCheckedAt", "lastError"`;

async function ask(pool, ytGet, follow, now) {
  const key = require('./youtubeApi').getKey();
  if (follow.kind === 'channel') {
    const playlistId = uploadsPlaylistId(follow.channelId);
    if (!playlistId) throw new Error('Not a valid channel.');
    const p = new URLSearchParams({ part: 'snippet', playlistId, maxResults: '10', key });
    return (await ytGet(`/youtube/v3/playlistItems?${p}`)).items || [];
  }
  const since = follow.lastCheckedAt ? new Date(follow.lastCheckedAt) : new Date(now.getTime() - 7 * 24 * HOUR);
  const p = new URLSearchParams({
    part: 'snippet', q: follow.query, type: 'video', order: follow.sortOrder || 'date', maxResults: '10',
    safeSearch: 'moderate', videoEmbeddable: 'true', publishedAfter: since.toISOString(), key,
  });
  if (follow.duration && follow.duration !== 'any') p.set('videoDuration', follow.duration);
  return (await ytGet(`/youtube/v3/search?${p}`)).items || [];
}

/** Look at one follow. With `baseline` everything found is recorded as already seen (the first look). Returns how many new videos were found. */
async function checkFollow(pool, ytGet, follow, { baseline = false, now = new Date() } = {}) {
  const items = await ask(pool, ytGet, follow, now);
  const { rows } = await pool.query('SELECT "videoId" FROM youtube_follow_videos WHERE "followId" = $1', [follow.id]);
  const fresh = newVideosFrom(items, new Set(rows.map((r) => r.videoId)));
  for (const v of fresh) {
    await pool.query(
      `INSERT INTO youtube_follow_videos ("followId","videoId",title,channel,thumbnail,"publishedAt","seenAt")
       VALUES ($1,$2,$3,$4,$5,$6, ${baseline ? 'NOW()' : 'NULL'}) ON CONFLICT ("followId","videoId") DO NOTHING`,
      [follow.id, v.videoId, v.title, v.channel, v.thumbnail, v.publishedAt]
    );
  }
  await pool.query('UPDATE youtube_follows SET "lastCheckedAt" = $2, "lastError" = NULL WHERE id = $1', [follow.id, now]);
  return baseline ? 0 : fresh.length;
}

async function listFollows(pool, userId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.kind, f."channelId", f."channelTitle", f.query, f."sortOrder", f.duration, f."createdAt", f."lastCheckedAt", f."lastError",
            COUNT(v."videoId") FILTER (WHERE v."seenAt" IS NULL)::int AS "newCount"
       FROM youtube_follows f LEFT JOIN youtube_follow_videos v ON v."followId" = f.id
      WHERE f."userId" = $1 GROUP BY f.id ORDER BY f."createdAt" DESC`,
    [userId]
  );
  return rows;
}

/** Follow something. Returns { follow } or { error, status } (too many, already followed, not valid). */
async function addFollow(pool, ytGet, userId, input) {
  const v = validateFollow(input);
  if (!v.ok) return { error: v.error, status: 400 };
  const f = v.value;
  const { rows: count } = await pool.query('SELECT COUNT(*)::int AS n FROM youtube_follows WHERE "userId" = $1 AND kind = $2', [userId, f.kind]);
  if (count[0].n >= LIMITS[f.kind]) {
    return { error: f.kind === 'channel' ? `You can follow up to ${LIMITS.channel} channels. Unfollow one first.` : `You can follow up to ${LIMITS.search} searches (each uses a lot of YouTube's daily allowance). Unfollow one first.`, status: 409 };
  }
  const dupe = await pool.query(
    `SELECT id FROM youtube_follows WHERE "userId" = $1 AND kind = $2 AND COALESCE("channelId",'') = COALESCE($3,'') AND LOWER(COALESCE(query,'')) = LOWER(COALESCE($4,''))`,
    [userId, f.kind, f.channelId, f.query]
  );
  if (dupe.rows[0]) return { error: f.kind === 'channel' ? 'You already follow that channel.' : 'You already follow that search.', status: 409 };
  const { rows } = await pool.query(
    `INSERT INTO youtube_follows ("userId", kind, "channelId", "channelTitle", query, "sortOrder", duration) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
    [userId, f.kind, f.channelId, f.channelTitle, f.query, f.sortOrder, f.duration]
  );
  try {
    await checkFollow(pool, ytGet, rows[0], { baseline: true }); // what is already there is not "new"
  } catch (err) {
    if (err && err.name === 'QuotaError') {
      await pool.query('DELETE FROM youtube_follows WHERE id = $1', [rows[0].id]);
      return { error: err.message, status: 429 };
    }
    await pool.query('UPDATE youtube_follows SET "lastError" = $2 WHERE id = $1', [rows[0].id, String(err.message || 'Could not check yet.').slice(0, 200)]);
  }
  return { follow: (await listFollows(pool, userId)).find((x) => x.id === rows[0].id) };
}

async function removeFollow(pool, userId, id) {
  const r = await pool.query('DELETE FROM youtube_follows WHERE id = $1 AND "userId" = $2', [id, userId]);
  return r.rowCount > 0;
}

/** Unseen videos across everything the person follows (one entry per video even if two follows found it), newest first. */
async function listNew(pool, userId, limit = 60) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (v."videoId") v."videoId" AS id, v.title, v.channel, v.thumbnail, v."publishedAt", f.id AS "followId"
         FROM youtube_follow_videos v JOIN youtube_follows f ON f.id = v."followId"
        WHERE f."userId" = $1 AND v."seenAt" IS NULL ORDER BY v."videoId", v."publishedAt" DESC
     ) t ORDER BY "publishedAt" DESC NULLS LAST LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function markSeen(pool, userId, { videoIds, all } = {}) {
  if (all) {
    const r = await pool.query(
      `UPDATE youtube_follow_videos SET "seenAt" = NOW() WHERE "seenAt" IS NULL AND "followId" IN (SELECT id FROM youtube_follows WHERE "userId" = $1)`, [userId]);
    return r.rowCount;
  }
  const ids = (Array.isArray(videoIds) ? videoIds : []).map(String).filter((x) => /^[A-Za-z0-9_-]{11}$/.test(x)).slice(0, 200);
  if (!ids.length) return 0;
  const r = await pool.query(
    `UPDATE youtube_follow_videos SET "seenAt" = NOW() WHERE "seenAt" IS NULL AND "videoId" = ANY($2::text[]) AND "followId" IN (SELECT id FROM youtube_follows WHERE "userId" = $1)`,
    [userId, ids]
  );
  return r.rowCount;
}

/** For Needs attention: how many unseen videos and a few titles. */
async function unseenSummary(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT v."videoId")::int AS n FROM youtube_follow_videos v JOIN youtube_follows f ON f.id = v."followId" WHERE f."userId" = $1 AND v."seenAt" IS NULL`, [userId]);
  const n = rows[0] ? rows[0].n : 0;
  if (!n) return { count: 0, sample: [] };
  const latest = await listNew(pool, userId, 3);
  return { count: n, sample: latest.map((x) => x.title) };
}

/**
 * Look at every follow that is due (one person's with `userId`, or everyone's from the daily job). Stops at once if the day's quota is spent.
 * `searchesLeft` (optional) keeps a reserve: search follows are skipped when fewer than 10 are left. Returns { checked, found, skipped, errors }.
 */
async function runChecks(pool, ytGet, { userId = null, now = new Date(), channelsOnly = false, minGapMs, searchesLeft = null } = {}) {
  const { rows } = userId
    ? await pool.query(`SELECT ${COLS} FROM youtube_follows WHERE "userId" = $1 ORDER BY "lastCheckedAt" NULLS FIRST`, [userId])
    : await pool.query(`SELECT ${COLS} FROM youtube_follows ORDER BY "lastCheckedAt" NULLS FIRST`);
  const out = { checked: 0, found: 0, skipped: 0, errors: 0 };
  for (const f of rows) {
    if (channelsOnly && f.kind !== 'channel') { out.skipped += 1; continue; }
    if (!dueForCheck(f, now, f.kind === 'channel' ? { minGapMs } : {})) { out.skipped += 1; continue; }
    if (f.kind === 'search' && searchesLeft !== null && searchesLeft < 10) { out.skipped += 1; continue; }
    try {
      out.found += await checkFollow(pool, ytGet, f, { now });
      out.checked += 1;
    } catch (err) {
      if (err && err.name === 'QuotaError') { out.errors += 1; break; }
      out.errors += 1;
      await pool.query('UPDATE youtube_follows SET "lastError" = $2, "lastCheckedAt" = $3 WHERE id = $1', [f.id, String(err.message || 'Could not check.').slice(0, 200), now]).catch(() => {});
    }
  }
  await pool.query(`DELETE FROM youtube_follow_videos WHERE "createdAt" < NOW() - ($1 || ' days')::interval`, [String(KEEP_DAYS)]).catch(() => {});
  return out;
}

module.exports = {
  LIMITS, EVERY_MS, KEEP_DAYS,
  uploadsPlaylistId, validateFollow, dueForCheck, shapeItem, newVideosFrom,
  checkFollow, listFollows, addFollow, removeFollow, listNew, markSeen, unseenSummary, runChecks,
};
