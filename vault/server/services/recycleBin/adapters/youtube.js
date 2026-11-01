'use strict';

// How the recycle bin handles YouTube things a person deletes: a saved list (with its videos), a followed channel or search (with the videos its
// checks found), and a saved favourite (with its labels and kept caption text). The routes call the bin* functions, which copy the rows into the
// bin and remove them in one transaction; the registrations say how to put them back. See docs/recycle-bin.md.

const { register, moveToBin } = require('../index');
const { insertRow } = require('../rowRestore');

// ── Saved lists ─────────────────────────────────────────────────────────────

/** Move one saved list (and its videos) to the bin. Returns the bin id, or null when the person has no such list. */
async function binList(pool, userId, listId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM youtube_saved_lists WHERE id=$1 AND "userId"=$2 FOR UPDATE', [listId, userId]);
    if (!rows[0]) { await db.query('ROLLBACK'); return null; }
    const items = (await db.query('SELECT * FROM youtube_saved_list_items WHERE "listId"=$1 ORDER BY position, id', [listId])).rows;
    const binId = await moveToBin(db, {
      userId, type: 'youtube-list', id: listId, title: rows[0].title,
      detail: `${items.length} video${items.length === 1 ? '' : 's'}`, payload: { list: rows[0], items },
    });
    await db.query('DELETE FROM youtube_saved_lists WHERE id=$1 AND "userId"=$2', [listId, userId]);
    await db.query('COMMIT');
    return binId;
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; } finally { db.release(); }
}

register('youtube-list', {
  label: 'YouTube list',
  async restore(db, userId, payload) {
    if (!payload?.list) throw new Error('This deleted list has nothing to restore.');
    const listId = await insertRow(db, 'youtube_saved_lists', payload.list, { userId });
    for (const it of Array.isArray(payload.items) ? payload.items : []) await insertRow(db, 'youtube_saved_list_items', it, { override: { listId } });
    return { entityId: listId };
  },
});

// ── Followed channels and searches ──────────────────────────────────────────

/** Move one follow (and the videos its checks found) to the bin. Returns the bin id, or null when the person does not follow that. */
async function binFollow(pool, userId, followId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM youtube_follows WHERE id=$1 AND "userId"=$2 FOR UPDATE', [followId, userId]);
    const f = rows[0];
    if (!f) { await db.query('ROLLBACK'); return null; }
    const videos = (await db.query('SELECT * FROM youtube_follow_videos WHERE "followId"=$1', [followId])).rows;
    const binId = await moveToBin(db, {
      userId, type: 'youtube-follow', id: followId,
      title: f.kind === 'channel' ? (f.channelTitle || 'Channel') : `Search: ${f.query}`,
      detail: f.kind === 'channel' ? 'Followed channel' : 'Followed search', payload: { follow: f, videos },
    });
    await db.query('DELETE FROM youtube_follows WHERE id=$1 AND "userId"=$2', [followId, userId]);
    await db.query('COMMIT');
    return binId;
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; } finally { db.release(); }
}

register('youtube-follow', {
  label: 'Followed channel or search',
  async restore(db, userId, payload) {
    const f = payload?.follow;
    if (!f) throw new Error('This deleted follow has nothing to restore.');
    // Following the same channel or search again in the meantime: keep that one and drop the copy.
    const same = f.kind === 'channel'
      ? await db.query(`SELECT id FROM youtube_follows WHERE "userId"=$1 AND kind='channel' AND "channelId"=$2`, [userId, f.channelId])
      : await db.query(`SELECT id FROM youtube_follows WHERE "userId"=$1 AND kind='search' AND lower(query)=lower($2)`, [userId, f.query]);
    if (same.rows[0]) return { entityId: same.rows[0].id };
    const followId = await insertRow(db, 'youtube_follows', f, { userId });
    for (const v of Array.isArray(payload.videos) ? payload.videos : []) {
      await db.query(
        `INSERT INTO youtube_follow_videos ("followId","videoId",title,channel,thumbnail,"publishedAt","seenAt","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, NOW())) ON CONFLICT DO NOTHING`,
        [followId, v.videoId, v.title, v.channel, v.thumbnail, v.publishedAt, v.seenAt, v.createdAt]);
    }
    return { entityId: followId };
  },
});

// ── Favourites ──────────────────────────────────────────────────────────────

/** Move saved videos to the bin, one bin item each (with their labels and kept caption text). Returns the bin ids. */
async function binFavourites(pool, userId, videoIds) {
  const db = await pool.connect();
  const binIds = [];
  try {
    await db.query('BEGIN');
    const favs = (await db.query('SELECT * FROM youtube_favourites WHERE "userId"=$1 AND "videoId" = ANY($2::text[]) FOR UPDATE', [userId, videoIds])).rows;
    const caps = new Map((await db.query('SELECT * FROM youtube_caption_segments WHERE "userId"=$1 AND "videoId" = ANY($2::text[])', [userId, videoIds])).rows.map((r) => [r.videoId, r]));
    for (const fav of favs) {
      const item = { userId, type: 'youtube-favourite', id: fav.videoId, title: fav.title, detail: fav.category ? `Category: ${fav.category}` : fav.channel, payload: { favourite: fav, captions: caps.get(fav.videoId) || null } };
      try { binIds.push(await moveToBin(db, item)); }
      catch (err) { if (err.code !== 'TOO_LARGE') throw err; binIds.push(await moveToBin(db, { ...item, payload: { favourite: fav, captions: null } })); } // a huge transcript is not kept
    }
    await db.query('DELETE FROM youtube_favourites WHERE "userId"=$1 AND "videoId" = ANY($2::text[])', [userId, videoIds]);
    await db.query('DELETE FROM youtube_caption_segments WHERE "userId"=$1 AND "videoId" = ANY($2::text[])', [userId, videoIds]);
    await db.query('COMMIT');
    return binIds;
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; } finally { db.release(); }
}

register('youtube-favourite', {
  label: 'Saved YouTube video',
  async restore(db, userId, payload) {
    const fav = payload?.favourite;
    if (!fav) throw new Error('This deleted video has nothing to restore.');
    const there = await db.query('SELECT id FROM youtube_favourites WHERE "userId"=$1 AND "videoId"=$2', [userId, fav.videoId]);
    let id = there.rows[0]?.id;
    if (!id) id = await insertRow(db, 'youtube_favourites', fav, { userId });
    const c = payload.captions;
    if (c && Array.isArray(c.segments)) {
      await db.query(
        `INSERT INTO youtube_caption_segments ("userId","videoId",language,segments) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
        [userId, c.videoId, c.language || '', JSON.stringify(c.segments)]);
    }
    return { entityId: id };
  },
});

// ── Search history and recently watched (one bin item per delete, however many rows) ──

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Move search-history rows to the bin as one item. `ids` null = all of them. Returns bin ids ([] when nothing matched). */
async function binSearches(pool, userId, ids) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const rows = (ids
      ? await db.query('SELECT * FROM youtube_search_history WHERE "userId"=$1 AND id = ANY($2::int[]) ORDER BY id', [userId, ids])
      : await db.query('SELECT * FROM youtube_search_history WHERE "userId"=$1 ORDER BY id', [userId])).rows;
    if (!rows.length) { await db.query('ROLLBACK'); return []; }
    const binId = await moveToBin(db, {
      userId, type: 'youtube-searches', id: rows[0].id,
      title: rows.length === 1 ? `Search: ${rows[0].query}` : `${plural(rows.length, 'search')} from YouTube history`,
      detail: rows.length === 1 ? null : rows.slice(0, 3).map((r) => r.query).join(', '), payload: { rows },
    });
    await db.query('DELETE FROM youtube_search_history WHERE "userId"=$1 AND id = ANY($2::int[])', [userId, rows.map((r) => r.id)]);
    await db.query('COMMIT');
    return [binId];
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; } finally { db.release(); }
}

register('youtube-searches', {
  label: 'YouTube searches',
  async restore(db, userId, payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) throw new Error('These deleted searches have nothing to restore.');
    let first = null;
    for (const r of rows) { const id = await insertRow(db, 'youtube_search_history', r, { userId }); first = first ?? id; }
    return { entityId: first };
  },
});

/** Move watched videos to the bin as one item. `videoIds` null = all of them. Returns bin ids ([] when nothing matched). */
async function binWatched(pool, userId, videoIds) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const rows = (videoIds
      ? await db.query('SELECT * FROM youtube_watch_history WHERE "userId"=$1 AND "videoId" = ANY($2::text[]) ORDER BY id', [userId, videoIds])
      : await db.query('SELECT * FROM youtube_watch_history WHERE "userId"=$1 ORDER BY id', [userId])).rows;
    if (!rows.length) { await db.query('ROLLBACK'); return []; }
    const binId = await moveToBin(db, {
      userId, type: 'youtube-watched', id: rows[0].videoId,
      title: rows.length === 1 ? rows[0].title : plural(rows.length, 'recently watched video'),
      detail: rows.length === 1 ? rows[0].channel : rows.slice(0, 3).map((r) => r.title).join(', '), payload: { rows },
    });
    await db.query('DELETE FROM youtube_watch_history WHERE "userId"=$1 AND "videoId" = ANY($2::text[])', [userId, rows.map((r) => r.videoId)]);
    await db.query('COMMIT');
    return [binId];
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; } finally { db.release(); }
}

register('youtube-watched', {
  label: 'Recently watched videos',
  async restore(db, userId, payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) throw new Error('These deleted videos have nothing to restore.');
    for (const r of rows) {
      // Watched again in the meantime: keep the newer row.
      if ((await db.query('SELECT 1 FROM youtube_watch_history WHERE "userId"=$1 AND "videoId"=$2', [userId, r.videoId])).rows.length) continue;
      await insertRow(db, 'youtube_watch_history', r, { userId });
    }
    return { entityId: rows[0].videoId };
  },
});

module.exports = { binList, binFollow, binFavourites, binSearches, binWatched };
