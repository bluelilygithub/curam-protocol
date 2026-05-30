'use strict';

/**
 * YouTube search, history, and favourites.
 *
 * POST /parse-query          — NLP parse of natural language input → structured search params
 * GET  /search              — search YouTube videos (saves to history)
 * GET  /history             — user's recent searches (last 30)
 * DELETE /history/:id       — remove a history entry
 * GET  /favourites          — user's saved videos
 * POST /favourites          — save a video
 * DELETE /favourites/:videoId — remove a saved video
 *
 * Requires env: YOUTUBE_API_KEY
 */

const https   = require('https');
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getModelsForUser } = require('../services/modelResolver');
const { callModel } = require('../services/callModel');

const router = express.Router();
router.use(requireAuth);

function getKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY not configured');
  return k;
}

function ytGet(path) {
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
            if (res.statusCode >= 400) {
              reject(new Error(json.error?.message || `YouTube API error HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
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

// ── NLP parse ────────────────────────────────────────────────────────────────

const PARSE_SYSTEM = `You parse natural language YouTube search requests into structured search parameters.

Return ONLY valid JSON — no markdown, no explanation:
{
  "q":           "the clean search query string",
  "order":       "relevance" | "date" | "viewCount" | "rating",
  "duration":    "any" | "short" | "medium" | "long",
  "publishedKey": "" | "hour" | "today" | "week" | "month" | "year",
  "reasoning":   "one short sentence explaining what you extracted"
}

Rules:
- "short" = under 4 minutes, "medium" = 4-20 min, "long" = over 20 min
- publishedKey: "" = any time, "hour" = past hour, "today" = past day, "week" = past 7 days, "month" = past 30 days, "year" = past year
- Strip duration/time/sort intent words from q — q should be just the topic
- If no filter intent, return defaults: order=relevance, duration=any, publishedKey=""
- q must not be empty`;

router.post('/parse-query', async (req, res) => {
  const { input } = req.body;
  if (!input?.trim()) return res.status(400).json({ error: 'input required' });

  try {
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const raw = await callModel(lightModel, input.trim(), {
      maxTokens: 200,
      system: PARSE_SYSTEM,
    });

    const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonStr);

    const valid = {
      q:            String(parsed.q || input.trim()),
      order:        ['relevance', 'date', 'viewCount', 'rating'].includes(parsed.order) ? parsed.order : 'relevance',
      duration:     ['any', 'short', 'medium', 'long'].includes(parsed.duration) ? parsed.duration : 'any',
      publishedKey: ['', 'hour', 'today', 'week', 'month', 'year'].includes(parsed.publishedKey) ? parsed.publishedKey : '',
      reasoning:    String(parsed.reasoning || ''),
    };

    res.json(valid);
  } catch (err) {
    console.error('[youtube/parse-query]', err.message);
    // Graceful fallback — return raw input as q, no filters
    res.json({ q: input.trim(), order: 'relevance', duration: 'any', publishedKey: '', reasoning: '' });
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  const { q, order = 'relevance', duration = 'any', publishedAfter } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'Query is required.' });

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      q: q.trim(),
      type: 'video',
      order,
      maxResults: '20',
      safeSearch: 'moderate',
      videoEmbeddable: 'true',
      key,
    });
    if (duration && duration !== 'any') searchParams.set('videoDuration', duration);
    if (publishedAfter) searchParams.set('publishedAfter', publishedAfter);

    const searchData = await ytGet(`/youtube/v3/search?${searchParams}`);
    const items = searchData.items ?? [];

    if (!items.length) {
      await pool.query(
        `INSERT INTO youtube_search_history ("userId", query, filters, "resultCount") VALUES ($1,$2,$3,$4)`,
        [req.user.id, q.trim(), JSON.stringify({ order, duration, publishedAfter: publishedAfter || null }), 0]
      );
      return res.json({ videos: [], totalResults: 0 });
    }

    const videoIds = items.map((i) => i.id.videoId).filter(Boolean).join(',');
    const detailsData = await ytGet(`/youtube/v3/videos?part=contentDetails,statistics&id=${encodeURIComponent(videoIds)}&key=${encodeURIComponent(key)}`);

    const detailsMap = {};
    for (const v of (detailsData.items ?? [])) {
      detailsMap[v.id] = {
        duration:  v.contentDetails?.duration,
        viewCount: v.statistics?.viewCount,
      };
    }

    const videos = items
      .filter((i) => i.id?.videoId)
      .map((item) => {
        const id = item.id.videoId;
        const s  = item.snippet;
        return {
          id,
          title:       s.title,
          description: s.description,
          channel:     s.channelTitle,
          publishedAt: s.publishedAt,
          thumbnail:   s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
          duration:    detailsMap[id]?.duration,
          viewCount:   detailsMap[id]?.viewCount,
        };
      });

    await pool.query(
      `INSERT INTO youtube_search_history ("userId", query, filters, "resultCount") VALUES ($1,$2,$3,$4)`,
      [req.user.id, q.trim(), JSON.stringify({ order, duration, publishedAfter: publishedAfter || null }), videos.length]
    );

    res.json({ videos, totalResults: searchData.pageInfo?.totalResults ?? videos.length });
  } catch (err) {
    console.error('[youtube/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── History ───────────────────────────────────────────────────────────────────

router.get('/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, query, filters, "resultCount", "createdAt"
       FROM youtube_search_history
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[youtube/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/history/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_search_history WHERE id = $1 AND "userId" = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Favourites ────────────────────────────────────────────────────────────────

router.get('/favourites', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt", "createdAt"
       FROM youtube_favourites
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/favourites', async (req, res) => {
  const { videoId, title, channel, thumbnail, duration, viewCount, publishedAt } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });
  try {
    await pool.query(
      `INSERT INTO youtube_favourites ("userId", "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("userId", "videoId") DO NOTHING`,
      [req.user.id, videoId, title, channel || null, thumbnail || null, duration || null, viewCount || null, publishedAt || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/favourites/:videoId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_favourites WHERE "userId" = $1 AND "videoId" = $2',
      [req.user.id, req.params.videoId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
