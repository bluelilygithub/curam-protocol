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
const { logUsage } = require('../utils/logUsage');
const { fetchYoutubeTranscript, fetchYoutubeCaptionLanguages } = require('../services/youtubeTranscript');

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
    const result = await callModel(lightModel, input.trim(), {
      maxTokens: 200,
      system: PARSE_SYSTEM,
      returnUsage: true,
    });
    logUsage({ userId: req.user?.id, model: lightModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'youtube' });
    const raw = result.text;

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

// ── Shared video mapping/enrichment ────────────────────────────────────────────

// Extract the video id from either a search.list item (id.videoId) or a
// playlistItems.list item (snippet.resourceId.videoId).
function itemVideoId(item) {
  return item.id?.videoId || item.snippet?.resourceId?.videoId || null;
}

// Given YouTube search.list (or playlistItems.list) items, fetch contentDetails/statistics
// and map into this app's video shape. Reused by /search, /channel/:channelId, /playlist/:playlistId.
async function enrichAndMapItems(items, key) {
  if (!items.length) return [];

  const videoIds = items.map(itemVideoId).filter(Boolean).join(',');
  const detailsData = await ytGet(`/youtube/v3/videos?part=contentDetails,statistics&id=${encodeURIComponent(videoIds)}&key=${encodeURIComponent(key)}`);

  const detailsMap = {};
  for (const v of (detailsData.items ?? [])) {
    detailsMap[v.id] = {
      duration:  v.contentDetails?.duration,
      viewCount: v.statistics?.viewCount,
    };
  }

  return items
    .filter((i) => itemVideoId(i))
    .map((item) => {
      const id = itemVideoId(item);
      const s  = item.snippet;
      return {
        id,
        title:       s.title,
        description: s.description,
        channel:     s.channelTitle,
        channelId:   s.channelId,
        publishedAt: s.publishedAt,
        thumbnail:   s.thumbnails?.medium?.url || s.thumbnails?.default?.url,
        duration:    detailsMap[id]?.duration,
        viewCount:   detailsMap[id]?.viewCount,
      };
    });
}

// Extract a playlist id from a full YouTube playlist URL, mirroring the video-id
// extraction pattern in youtubeTranscript.js. Also accepts a bare playlist id.
function extractPlaylistId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const list = parsed.searchParams.get('list');
    if (list) return list;
  } catch { /* not a URL — fall through */ }
  // Bare id (YouTube playlist ids start with PL/UU/LL/FL/RD etc.)
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) return raw;
  return null;
}

// ── Search ────────────────────────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  const { q, order = 'relevance', duration = 'any', publishedAfter, eventType } = req.query;
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
    // eventType=live is only valid alongside type=video, which is already hardcoded above.
    if (eventType === 'live') searchParams.set('eventType', 'live');

    const searchData = await ytGet(`/youtube/v3/search?${searchParams}`);
    const items = searchData.items ?? [];

    if (!items.length) {
      await pool.query(
        `INSERT INTO youtube_search_history ("userId", query, filters, "resultCount") VALUES ($1,$2,$3,$4)`,
        [req.user.id, q.trim(), JSON.stringify({ order, duration, publishedAfter: publishedAfter || null, eventType: eventType || null }), 0]
      );
      return res.json({ videos: [], totalResults: 0 });
    }

    const videos = await enrichAndMapItems(items, key);

    await pool.query(
      `INSERT INTO youtube_search_history ("userId", query, filters, "resultCount") VALUES ($1,$2,$3,$4)`,
      [req.user.id, q.trim(), JSON.stringify({ order, duration, publishedAfter: publishedAfter || null, eventType: eventType || null }), videos.length]
    );

    res.json({ videos, totalResults: searchData.pageInfo?.totalResults ?? videos.length });
  } catch (err) {
    console.error('[youtube/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Playlist ──────────────────────────────────────────────────────────────────

router.get('/playlist/:playlistId', async (req, res) => {
  const playlistId = extractPlaylistId(req.params.playlistId);
  if (!playlistId) return res.status(400).json({ error: 'A valid playlist URL or id is required.' });

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      playlistId,
      maxResults: '50',
      key,
    });
    const listData = await ytGet(`/youtube/v3/playlistItems?${searchParams}`);
    const items = listData.items ?? [];
    const videos = await enrichAndMapItems(items, key);

    res.json({ videos, totalResults: listData.pageInfo?.totalResults ?? videos.length });
  } catch (err) {
    console.error('[youtube/playlist]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Trending ──────────────────────────────────────────────────────────────────

router.get('/trending', async (req, res) => {
  const { regionCode = 'US', categoryId } = req.query;

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      regionCode,
      maxResults: '20',
      key,
    });
    if (categoryId) searchParams.set('videoCategoryId', categoryId);

    const data = await ytGet(`/youtube/v3/videos?${searchParams}`);
    const items = data.items ?? [];

    // videos.list(chart=mostPopular) already returns duration/viewCount in one call — no enrichment call needed.
    const videos = items.map((v) => ({
      id:          v.id,
      title:       v.snippet?.title,
      description: v.snippet?.description,
      channel:     v.snippet?.channelTitle,
      channelId:   v.snippet?.channelId,
      publishedAt: v.snippet?.publishedAt,
      thumbnail:   v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
      duration:    v.contentDetails?.duration,
      viewCount:   v.statistics?.viewCount,
    }));

    res.json({ videos, totalResults: data.pageInfo?.totalResults ?? videos.length });
  } catch (err) {
    console.error('[youtube/trending]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  const { regionCode = 'US' } = req.query;

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({ part: 'snippet', regionCode, key });
    const data = await ytGet(`/youtube/v3/videoCategories?${searchParams}`);
    const categories = (data.items ?? [])
      .filter((c) => c.snippet?.assignable)
      .map((c) => ({ id: c.id, title: c.snippet?.title }));

    res.json({ categories });
  } catch (err) {
    console.error('[youtube/categories]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Channel ───────────────────────────────────────────────────────────────────

router.get('/channel/:channelId', async (req, res) => {
  const { channelId } = req.params;
  if (!channelId?.trim()) return res.status(400).json({ error: 'channelId is required.' });

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      channelId: channelId.trim(),
      type: 'video',
      order: 'date',
      maxResults: '20',
      safeSearch: 'moderate',
      videoEmbeddable: 'true',
      key,
    });

    const searchData = await ytGet(`/youtube/v3/search?${searchParams}`);
    const items = searchData.items ?? [];
    const videos = await enrichAndMapItems(items, key);

    res.json({ videos, totalResults: searchData.pageInfo?.totalResults ?? videos.length });
  } catch (err) {
    console.error('[youtube/channel]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Transcript / summary ────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You summarize YouTube video transcripts. Write a concise summary in a few sentences covering what the video is about and its key points. Do not re-transcribe the video or list timestamps — just the gist, in plain prose.`;

router.get('/transcript-languages/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const languages = await fetchYoutubeCaptionLanguages(url);
    res.json({ languages });
  } catch (err) {
    console.error('[youtube/transcript-languages]', err.message);
    if (/no captions available/i.test(err.message || '')) {
      return res.status(404).json({ error: 'No captions are available for this video.' });
    }
    res.status(500).json({ error: 'Could not fetch caption languages for this video.' });
  }
});

router.post('/transcript', async (req, res) => {
  const { videoId, summarize, languageCode } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const { title, content } = await fetchYoutubeTranscript(url, languageCode);

    if (!summarize) {
      return res.json({ title, transcript: content });
    }

    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const result = await callModel(lightModel, content, {
      maxTokens: 400,
      system: SUMMARY_SYSTEM,
      returnUsage: true,
    });
    logUsage({ userId: req.user?.id, model: lightModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'youtube' });

    res.json({ title, transcript: content, summary: result.text });
  } catch (err) {
    console.error('[youtube/transcript]', err.message);
    if (/no captions available/i.test(err.message || '')) {
      return res.status(404).json({ error: 'No captions are available for this video.' });
    }
    res.status(500).json({ error: 'Could not fetch a transcript for this video.' });
  }
});

// ── Comments (read-only) ─────────────────────────────────────────────────────

router.get('/comments/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { pageToken } = req.query;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });

  let key;
  try { key = getKey(); } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: '20',
      textFormat: 'plainText',
      key,
    });
    if (pageToken) searchParams.set('pageToken', pageToken);

    const data = await ytGet(`/youtube/v3/commentThreads?${searchParams}`);
    const comments = (data.items ?? []).map((item) => {
      const s = item.snippet?.topLevelComment?.snippet;
      return {
        id:          item.id,
        author:      s?.authorDisplayName,
        authorImage: s?.authorProfileImageUrl,
        text:        s?.textDisplay,
        likeCount:   s?.likeCount,
        publishedAt: s?.publishedAt,
      };
    });

    res.json({ comments, nextPageToken: data.nextPageToken || null });
  } catch (err) {
    console.error('[youtube/comments]', err.message);
    // YouTube returns a 403 with reason "commentsDisabled" when a video's owner has turned off comments —
    // the surfaced error message text reads like "...has disabled comments for this video."
    if (/commentsDisabled|disabled comments/i.test(err.message || '')) {
      return res.status(404).json({ error: 'Comments are disabled for this video.' });
    }
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

// ── Watch history ─────────────────────────────────────────────────────────────

router.get('/watch-history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt", "watchedAt"
       FROM youtube_watch_history
       WHERE "userId" = $1
       ORDER BY "watchedAt" DESC
       LIMIT 30`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/watch-history', async (req, res) => {
  const { videoId, title, channel, thumbnail, duration, viewCount, publishedAt } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });
  try {
    await pool.query(
      `INSERT INTO youtube_watch_history ("userId", "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt", "watchedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT ("userId", "videoId") DO UPDATE SET "watchedAt" = NOW()`,
      [req.user.id, videoId, title || 'YouTube video', channel || null, thumbnail || null, duration || null, viewCount || null, publishedAt || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/watch-history/all', async (req, res) => {
  try {
    await pool.query('DELETE FROM youtube_watch_history WHERE "userId" = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/watch-history/:videoId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_watch_history WHERE "userId" = $1 AND "videoId" = $2',
      [req.user.id, req.params.videoId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Saved lists ───────────────────────────────────────────────────────────────

router.get('/lists', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l."createdAt", COUNT(i.id)::int AS "itemCount"
       FROM youtube_saved_lists l
       LEFT JOIN youtube_saved_list_items i ON i."listId" = l.id
       WHERE l."userId" = $1
       GROUP BY l.id
       ORDER BY l."createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lists', async (req, res) => {
  const { title, videos } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required.' });
  if (!Array.isArray(videos) || videos.length === 0) return res.status(400).json({ error: 'videos array required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO youtube_saved_lists ("userId", title) VALUES ($1,$2) RETURNING id, title, "createdAt"`,
      [req.user.id, title.trim()]
    );
    const list = rows[0];

    let position = 0;
    for (const v of videos) {
      if (!v?.id && !v?.videoId) continue;
      await client.query(
        `INSERT INTO youtube_saved_list_items ("listId", "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt", position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [list.id, v.id || v.videoId, v.title, v.channel || null, v.thumbnail || null, v.duration || null, v.viewCount || null, v.publishedAt || null, position++]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, id: list.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/lists/:id', async (req, res) => {
  try {
    const { rows: listRows } = await pool.query(
      `SELECT id, title, "createdAt" FROM youtube_saved_lists WHERE id = $1 AND "userId" = $2`,
      [req.params.id, req.user.id]
    );
    if (!listRows.length) return res.status(404).json({ error: 'List not found.' });

    const { rows: items } = await pool.query(
      `SELECT "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt"
       FROM youtube_saved_list_items
       WHERE "listId" = $1
       ORDER BY position ASC`,
      [req.params.id]
    );

    res.json({ ...listRows[0], videos: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lists/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_saved_lists WHERE id = $1 AND "userId" = $2',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lists/:id/items/:videoId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM youtube_saved_list_items
       WHERE "videoId" = $1 AND "listId" IN (SELECT id FROM youtube_saved_lists WHERE id = $2 AND "userId" = $3)`,
      [req.params.videoId, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
