'use strict';

// Live TV (docs/live-tv.md): browse the free channels listed by the public iptv-org project, keep favourites, and remember which streams
// played. Mounted at /api/live-tv behind requireFeature('liveTv'). Vault never fetches or relays video: the browser plays a stream itself,
// inside the separate player page (routes/liveTvPlayer.js). The only things stored are each person's own favourites and play results.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { getCatalogue, filterChannels } = require('../services/liveTv/catalogue');
const guide = require('../services/liveTv/guide');
const { requireAdmin } = require('../middleware/auth');

const guideDeps = { pool, getCatalogue };

const router = express.Router();

router.use(rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many requests, please wait a minute.' },
}));

const VIEWS = ['all', 'favourites', 'recent'];
const cleanId = (v) => String(v || '').trim().slice(0, 200);
const KEEP_PLAYS = 300; // play results kept per person (older ones are tidied after each new one)

async function favouriteIds(userId) {
  const { rows } = await pool.query(
    'SELECT "channelId" FROM live_tv_favourites WHERE "userId" = $1 ORDER BY "createdAt" DESC', [userId]);
  return rows.map((r) => r.channelId);
}

async function recentIds(userId) {
  const { rows } = await pool.query(
    `SELECT "channelId", MAX("playedAt") AS last FROM live_tv_plays WHERE "userId" = $1
      GROUP BY "channelId" ORDER BY last DESC LIMIT 40`, [userId]);
  return rows.map((r) => r.channelId);
}

// The latest play result for each stream of the channels shown, so the page can say "played last time" / "did not play last time".
async function lastPlays(userId, channelIds) {
  if (!channelIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON ("channelId", url) "channelId", url, ok, "playedAt"
       FROM live_tv_plays WHERE "userId" = $1 AND "channelId" = ANY($2::text[])
      ORDER BY "channelId", url, "playedAt" DESC`, [userId, channelIds]);
  const out = new Map();
  for (const r of rows) {
    const m = out.get(r.channelId) || {};
    m[r.url] = { ok: r.ok, at: r.playedAt };
    out.set(r.channelId, m);
  }
  return out;
}

// What is on now and next for each channel shown (one query for the page of channels).
async function nowNext(channelIds) {
  if (!channelIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT "channelId", title, "subTitle", start, stop FROM (
       SELECT "channelId", title, "subTitle", start, stop, ROW_NUMBER() OVER (PARTITION BY "channelId" ORDER BY start) AS n
         FROM live_tv_programmes WHERE "channelId" = ANY($1::text[]) AND stop > NOW()) x
      WHERE n <= 2 ORDER BY "channelId", start`, [channelIds]);
  const out = new Map();
  for (const r of rows) {
    const list = out.get(r.channelId) || [];
    list.push({ title: r.title, subTitle: r.subTitle, start: r.start, stop: r.stop });
    out.set(r.channelId, list);
  }
  return out;
}

const programmeOut = (r, cat) => {
  const c = cat.byId.get(r.channelId);
  return {
    channelId: r.channelId, channelName: c?.name || r.channelId, canPlay: !!c?.browserOk,
    title: r.title, subTitle: r.subTitle, description: r.description, category: r.category, episode: r.episode,
    start: r.start, stop: r.stop, titleKey: r.titleKey,
  };
};

// Search text for ILIKE: the person's words, with % and _ taken literally.
const likeText = (q) => `%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

router.get('/meta', async (req, res, next) => {
  try {
    const cat = await getCatalogue();
    guide.ensureFresh(guideDeps).catch(() => {}); // the guide refreshes itself in the background when it is old or missing
    const favs = await favouriteIds(req.user.id);
    res.json({
      countries: cat.countries,
      categories: cat.categories,
      total: cat.channels.length,
      fetchedAt: cat.fetchedAt,
      favouriteCount: favs.length,
      source: 'https://github.com/iptv-org/iptv',
    });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});

router.get('/channels', async (req, res, next) => {
  try {
    const cat = await getCatalogue();
    const view = VIEWS.includes(req.query.view) ? req.query.view : 'all';
    const favs = await favouriteIds(req.user.id);
    let ids = null;
    // ?ids=a,b: exactly these channels (a programme result opening its channel)
    if (req.query.ids) ids = String(req.query.ids).split(',').map(cleanId).filter(Boolean).slice(0, 60);
    else if (view === 'favourites') ids = favs;
    if (view === 'recent') ids = await recentIds(req.user.id);
    const { total, channels } = filterChannels(cat, {
      ids,
      country: view === 'all' && !req.query.ids ? String(req.query.country || '').toUpperCase().slice(0, 3) : '',
      category: String(req.query.category || '').slice(0, 40),
      q: String(req.query.q || '').slice(0, 100),
      browserOnly: req.query.browserOnly === '1',
      offset: req.query.offset,
      limit: req.query.limit,
    });
    const plays = await lastPlays(req.user.id, channels.map((c) => c.id));
    const onAir = await nowNext(channels.map((c) => c.id));
    const favSet = new Set(favs);
    res.json({
      total,
      fetchedAt: cat.fetchedAt,
      channels: channels.map((c) => {
        const played = plays.get(c.id) || {};
        const country = cat.countryNames.get(c.country);
        return {
          id: c.id, name: c.name, network: c.network, country: c.country, countryName: country?.name || c.country, flag: country?.flag || '',
          categories: c.categories, website: c.website, browserOk: c.browserOk, favourite: favSet.has(c.id), onAir: onAir.get(c.id) || [],
          streams: c.streams.map((s) => ({ ...s, lastPlay: played[s.url] || null })),
        };
      }),
    });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});

router.post('/favourites', async (req, res, next) => {
  try {
    const channelId = cleanId(req.body?.channelId);
    if (!channelId) return res.status(400).json({ error: 'Which channel?' });
    const cat = await getCatalogue();
    if (!cat.byId.has(channelId)) return res.status(404).json({ error: 'That channel is not in the list any more.' });
    await pool.query(
      `INSERT INTO live_tv_favourites ("userId", "channelId") VALUES ($1, $2) ON CONFLICT ("userId", "channelId") DO NOTHING`,
      [req.user.id, channelId]);
    // A newly starred channel outside the guide so far: fetch its guide file now rather than at the next 6-hourly refresh.
    const { rows } = await pool.query('SELECT 1 FROM live_tv_programmes WHERE "channelId" = $1 LIMIT 1', [channelId]);
    if (!rows.length) guide.refreshGuide(guideDeps).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Taking a channel off favourites is a toggle (one tap puts it back), so it does not go to the recycle bin.
router.delete('/favourites/:channelId', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM live_tv_favourites WHERE "userId" = $1 AND "channelId" = $2', [req.user.id, cleanId(req.params.channelId)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- TV guide (shared by the workspace: public schedule facts, no "userId"; see services/liveTv/guide.js) ----

router.get('/guide/status', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT "channelId") AS channels, MAX("fetchedAt") AS at FROM live_tv_programmes WHERE stop > NOW()');
    res.json({
      region: await guide.getRegion(pool), regions: guide.REGIONS,
      programmes: Number(rows[0].n), channels: Number(rows[0].channels), refreshedAt: rows[0].at, ...guide.status(),
    });
  } catch (err) { next(err); }
});

// Admin: which Australian city's guide to use (local news and times differ by city), then refresh.
router.put('/guide/region', requireAdmin, async (req, res, next) => {
  try {
    await guide.setRegion(pool, String(req.body?.region || ''));
    guide.refreshGuide(guideDeps).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/guide/refresh', requireAdmin, (req, res) => {
  guide.refreshGuide(guideDeps).catch(() => {});
  res.status(202).json({ ok: true });
});

// One channel's programmes between two times (the page asks for one local day at a time).
router.get('/guide/channel/:channelId', async (req, res, next) => {
  try {
    const cat = await getCatalogue();
    const from = new Date(String(req.query.from || ''));
    const to = new Date(String(req.query.to || ''));
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to - from > 2 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Which day?' });
    }
    const { rows } = await pool.query(
      `SELECT * FROM live_tv_programmes WHERE "channelId" = $1 AND stop > $2 AND start < $3 ORDER BY start LIMIT 200`,
      [cleanId(req.params.channelId), from, to]);
    res.json({ programmes: rows.map((r) => programmeOut(r, cat)) });
  } catch (err) { next(err); }
});

// Programme search: titles, episode names and descriptions from now to the end of the guide, grouped by show.
router.get('/programmes/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json({ shows: [] });
    const cat = await getCatalogue();
    const like = likeText(q);
    const { rows } = await pool.query(
      `SELECT * FROM live_tv_programmes
        WHERE stop > NOW() AND (title ILIKE $1 OR "subTitle" ILIKE $1 OR description ILIKE $1)
        ORDER BY (title ILIKE $1) DESC, start LIMIT 400`, [like]);
    const favs = new Set((await pool.query('SELECT "titleKey" FROM live_tv_shows WHERE "userId" = $1', [req.user.id])).rows.map((r) => r.titleKey));
    const shows = new Map();
    for (const r of rows) {
      const s = shows.get(r.titleKey) || { titleKey: r.titleKey, title: r.title, favourite: favs.has(r.titleKey), titleMatch: false, airings: [] };
      if (r.title.toLowerCase().includes(q.toLowerCase())) s.titleMatch = true;
      if (s.airings.length < 12) s.airings.push(programmeOut(r, cat));
      shows.set(r.titleKey, s);
    }
    const list = [...shows.values()]
      .map((s) => ({ ...s, airings: s.airings.sort((a, b) => new Date(a.start) - new Date(b.start)) }))
      .sort((a, b) => (b.titleMatch - a.titleMatch) || (new Date(a.airings[0].start) - new Date(b.airings[0].start)))
      .slice(0, 40);
    res.json({ shows: list });
  } catch (err) { next(err); }
});

// ---- favourite shows (per person) ----

router.get('/shows', async (req, res, next) => {
  try {
    const cat = await getCatalogue();
    const { rows: shows } = await pool.query(
      'SELECT "titleKey", title, "createdAt" FROM live_tv_shows WHERE "userId" = $1 ORDER BY title', [req.user.id]);
    const keys = shows.map((s) => s.titleKey);
    const { rows } = keys.length ? await pool.query(
      `SELECT * FROM live_tv_programmes WHERE "titleKey" = ANY($1::text[]) AND stop > NOW() ORDER BY start LIMIT 500`, [keys]) : { rows: [] };
    const airings = new Map();
    for (const r of rows) {
      const list = airings.get(r.titleKey) || [];
      if (list.length < 12) list.push(programmeOut(r, cat));
      airings.set(r.titleKey, list);
    }
    res.json({ shows: shows.map((s) => ({ titleKey: s.titleKey, title: s.title, favourite: true, airings: airings.get(s.titleKey) || [] })) });
  } catch (err) { next(err); }
});

router.post('/shows', async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 300);
    const key = guide.titleKey(title);
    if (!key) return res.status(400).json({ error: 'Which programme?' });
    await pool.query(
      `INSERT INTO live_tv_shows ("userId", "titleKey", title) VALUES ($1, $2, $3) ON CONFLICT ("userId", "titleKey") DO NOTHING`,
      [req.user.id, key, title]);
    res.json({ ok: true, titleKey: key });
  } catch (err) { next(err); }
});

// Like a channel star, taking a show off favourites is a toggle, so it does not go to the recycle bin.
router.delete('/shows/:titleKey', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM live_tv_shows WHERE "userId" = $1 AND "titleKey" = $2', [req.user.id, String(req.params.titleKey || '').slice(0, 200)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// The player page reports whether a stream started; kept per person so the list can say what played last time.
router.post('/plays', async (req, res, next) => {
  try {
    const channelId = cleanId(req.body?.channelId);
    const url = String(req.body?.url || '').slice(0, 2000);
    if (!channelId || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Which channel and stream?' });
    const ok = req.body?.ok === true;
    const problem = ok ? null : String(req.body?.problem || '').slice(0, 300) || null;
    await pool.query(
      'INSERT INTO live_tv_plays ("userId", "channelId", url, ok, problem) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, channelId, url, ok, problem]);
    await pool.query(
      `DELETE FROM live_tv_plays WHERE "userId" = $1 AND id NOT IN (
         SELECT id FROM live_tv_plays WHERE "userId" = $1 ORDER BY "playedAt" DESC LIMIT ${KEEP_PLAYS})`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
