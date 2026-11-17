'use strict';

// Live TV (docs/live-tv.md): browse the free channels listed by the public iptv-org project, keep favourites, and remember which streams
// played. Mounted at /api/live-tv behind requireFeature('liveTv'). Vault never fetches or relays video: the browser plays a stream itself,
// inside the separate player page (routes/liveTvPlayer.js). The only things stored are each person's own favourites and play results.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { getCatalogue, filterChannels } = require('../services/liveTv/catalogue');

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

router.get('/meta', async (req, res, next) => {
  try {
    const cat = await getCatalogue();
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
    if (view === 'favourites') ids = favs;
    if (view === 'recent') ids = await recentIds(req.user.id);
    const { total, channels } = filterChannels(cat, {
      ids,
      country: view === 'all' ? String(req.query.country || '').toUpperCase().slice(0, 3) : '',
      category: String(req.query.category || '').slice(0, 40),
      q: String(req.query.q || '').slice(0, 100),
      browserOnly: req.query.browserOnly === '1',
      offset: req.query.offset,
      limit: req.query.limit,
    });
    const plays = await lastPlays(req.user.id, channels.map((c) => c.id));
    const favSet = new Set(favs);
    res.json({
      total,
      fetchedAt: cat.fetchedAt,
      channels: channels.map((c) => {
        const played = plays.get(c.id) || {};
        const country = cat.countryNames.get(c.country);
        return {
          id: c.id, name: c.name, network: c.network, country: c.country, countryName: country?.name || c.country, flag: country?.flag || '',
          categories: c.categories, website: c.website, browserOk: c.browserOk, favourite: favSet.has(c.id),
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
