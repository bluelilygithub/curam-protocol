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
 * GET  /quota                — today's YouTube quota use and roughly how many searches are left
 * GET  /insights/:videoId    — the saved AI notes for a video (summary, key points, chapters, to-dos, quotes)
 * POST /insights             — write them (once; refresh to redo)
 * POST /ask                  — answer a question about a video from its captions, with timestamps
 * POST /note-draft           — the Notes text for a video (the page saves it through /api/notes)
 *
 * Requires env: YOUTUBE_API_KEY
 */

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getModelsForUser } = require('../services/modelResolver');
const { callModel } = require('../services/callModel');
const { logUsage } = require('../utils/logUsage');
const { fetchYoutubeTranscript, fetchYoutubeCaptionLanguages } = require('../services/youtubeTranscript');
const youtubeApi = require('../services/youtubeApi');
const { getKey, quotaStatus } = youtubeApi;
const follows = require('../services/youtubeFollows');
const { createAiTranscripts } = require('../services/youtubeAiJobs');
const { watchVideo } = require('../services/geminiVideo');
const insightsLib = require('../services/youtubeInsights');
const mainPointsLib = require('../services/youtubeMainPoints');
const labelsLib = require('../services/youtubeLabels');
const { aiLimiter } = require('../middleware/aiRateLimit');

const router = express.Router();
router.use(requireAuth);

// AI-written transcripts for videos with no captions (Gemini watches the video), their saved copies and the background job.
const aiTranscripts = createAiTranscripts({ pool, ytGet: (p) => youtubeApi.ytGet(pool, p), getKey, getModelsForUser, logUsage, watchVideo });

// Every Data API call goes through the cache and the daily quota count (services/youtubeApi.js).
const ytGet = (path) => youtubeApi.ytGet(pool, path);

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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Why a video could not be read, in plain words. `err.code === 'UNPLAYABLE'` comes from the caption fetch (private, removed, age-restricted or
// a robot check); a video that is fine but has no captions is a different message. Returns true when it answered.
function captionProblem(err, res) {
  if (err && err.code === 'UNPLAYABLE') {
    const bot = /bot|sign in/i.test(err.reason || '');
    res.status(404).json({
      error: bot
        ? "YouTube is asking Vault's server to prove it is not a robot, so the captions cannot be read right now. Try again later, or have AI write a transcript."
        : `YouTube would not let Vault read this video (${String(err.reason).slice(0, 120)}).`,
      reason: err.reason,
      canGenerate: bot, // Gemini reads the video from Google's side, so a robot check on our server does not stop it; a private video does
    });
    return true;
  }
  if (/no captions available/i.test((err && err.message) || '')) {
    res.status(404).json({ error: 'This video has no captions, so there is nothing to read.', canGenerate: true });
    return true;
  }
  return false;
}

// ── Transcript / summary ────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You summarize YouTube video transcripts. Write a concise summary in a few sentences covering what the video is about and its key points. Do not re-transcribe the video or list timestamps — just the gist, in plain prose.`;

router.get('/transcript-languages/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });

  try {
    if (await aiTranscripts.stored(req.user.id, videoId)) return res.json({ languages: [], source: 'ai' });
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const languages = await fetchYoutubeCaptionLanguages(url);
    res.json({ languages });
  } catch (err) {
    console.error('[youtube/transcript-languages]', err.message);
    if (captionProblem(err, res)) return;
    res.status(500).json({ error: 'Could not fetch caption languages for this video.' });
  }
});

router.post('/transcript', async (req, res) => {
  const { videoId, summarize, languageCode } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const mine = await aiTranscripts.stored(req.user.id, videoId);
    const { title, content, segments } = mine
      ? {
        title: mine.title || 'YouTube video',
        content: `[YouTube Transcript: ${mine.title || 'YouTube video'}]\n\n${(mine.segments || []).map((x) => x.text).join(' ')}`.substring(0, 50000),
        segments: mine.segments || [],
      }
      : await fetchYoutubeTranscript(url, languageCode);
    const source = mine ? 'ai' : 'captions';
    if (!mine) keepCaptions(req.user.id, videoId, { segments, languageCode: languageCode || '' }).catch(() => {});
    // `segments` = the same captions with their start time in seconds, so the page can show and jump to a moment
    const timed = (segments || []).map((x) => ({ start: Math.floor(x.start), text: x.text }));

    if (!summarize) {
      return res.json({ title, transcript: content, segments: timed, source });
    }

    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const result = await callModel(lightModel, content, {
      maxTokens: 400,
      system: SUMMARY_SYSTEM,
      returnUsage: true,
    });
    logUsage({ userId: req.user?.id, model: lightModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'youtube' });

    res.json({ title, transcript: content, segments: timed, summary: result.text, source });
  } catch (err) {
    console.error('[youtube/transcript]', err.message);
    if (captionProblem(err, res)) return;
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Favourites ────────────────────────────────────────────────────────────────

router.get('/favourites', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt", "createdAt", category, tags,
              (EXISTS (SELECT 1 FROM youtube_caption_segments c WHERE c."userId" = f."userId" AND c."videoId" = f."videoId")
               OR EXISTS (SELECT 1 FROM youtube_transcripts t WHERE t."userId" = f."userId" AND t."videoId" = f."videoId")) AS "hasTranscript"
       FROM youtube_favourites f
       WHERE "userId" = $1
       ORDER BY "createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/favourites', async (req, res) => {
  const { videoId, title, channel, thumbnail, duration, viewCount, publishedAt } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required.' });
  const labels = labelsLib.readLabels(req.body);
  if (!labels) return res.status(400).json({ error: 'category must be text and tags a list.' });
  try {
    await pool.query(
      `INSERT INTO youtube_favourites ("userId", "videoId", title, channel, thumbnail, duration, "viewCount", "publishedAt", category, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT ("userId", "videoId") DO NOTHING`,
      [req.user.id, videoId, title, channel || null, thumbnail || null, duration || null, viewCount || null, publishedAt || null, labels.category || '', labels.tags || []]
    );
    // read and keep its captions in the background so the favourites search can look inside them (fails quietly, e.g. a robot check)
    if (VIDEO_ID.test(String(videoId))) getCaptions(videoId, '', req.user.id).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Change a saved video's category and/or tags (only the fields sent). null or '' clears the category.
router.patch('/favourites/:videoId', async (req, res) => {
  if (!VIDEO_ID.test(req.params.videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  const labels = labelsLib.readLabels(req.body);
  if (!labels) return res.status(400).json({ error: 'category must be text and tags a list.' });
  try {
    const { rows } = await pool.query(
      `UPDATE youtube_favourites SET category = COALESCE($3, category), tags = COALESCE($4::text[], tags)
       WHERE "userId" = $1 AND "videoId" = $2 RETURNING category, tags`,
      [req.user.id, req.params.videoId, labels.category === undefined ? null : labels.category, labels.tags === undefined ? null : labels.tags]
    );
    if (!rows[0]) return res.status(404).json({ error: 'That video is not in your favourites.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[youtube/favourites patch]', err.message);
    res.status(500).json({ error: 'Could not save the labels.' });
  }
});

// Which saved videos mention what was typed in their kept transcripts (captions kept for saved videos, and AI-written transcripts).
// Every word has to appear somewhere in the video's transcript. Returns the first matching line of each so the card can show it.
router.get('/favourites/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  const patterns = labelsLib.searchPatterns(q);
  if (!patterns.length) return res.json({ hits: [] });
  try {
    const { rows } = await pool.query(
      `SELECT "videoId", segments FROM (
         SELECT "videoId", segments, (SELECT string_agg(e->>'text', ' ') FROM jsonb_array_elements(segments) e) AS full
         FROM (
           SELECT "videoId", segments FROM youtube_caption_segments WHERE "userId" = $1
           UNION ALL
           SELECT "videoId", segments FROM youtube_transcripts WHERE "userId" = $1
         ) u
       ) x
       WHERE "videoId" IN (SELECT "videoId" FROM youtube_favourites WHERE "userId" = $1)
         AND full ILIKE ALL ($2::text[])
       LIMIT 200`,
      [req.user.id, patterns]
    );
    const seen = new Set();
    const hits = [];
    for (const r of rows) {
      if (seen.has(r.videoId)) continue;
      seen.add(r.videoId);
      hits.push({ videoId: r.videoId, ...(labelsLib.snippetFor(r.segments, q) || {}) });
    }
    res.json({ hits });
  } catch (err) {
    console.error('[youtube/favourites search]', err.message);
    res.status(500).json({ error: 'Could not search the transcripts.' });
  }
});

// The text of a new note about a video (no AI is asked): link, details, its category and tags if it is a saved favourite, the Main points and
// Insights summary if already written, and the transcript (kept, AI-written, or read now if YouTube allows). The page saves it through
// /api/notes and puts the category and tags on the note as tags.
router.post('/video-note', async (req, res) => {
  const b = req.body || {};
  const videoId = String(b.videoId || '');
  if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  const userId = req.user.id;
  try {
    const fav = (await pool.query('SELECT * FROM youtube_favourites WHERE "userId"=$1 AND "videoId"=$2', [userId, videoId])).rows[0] || null;
    const pts = (await pool.query('SELECT points FROM youtube_main_points WHERE "userId"=$1 AND "videoId"=$2', [userId, videoId])).rows[0];
    const ins = await savedInsights(userId, videoId, '');

    let segments = null;
    const ai = await aiTranscripts.stored(userId, videoId);
    if (ai) segments = ai.segments || [];
    if (!segments) {
      const kept = (await pool.query('SELECT segments FROM youtube_caption_segments WHERE "userId"=$1 AND "videoId"=$2', [userId, videoId])).rows[0];
      if (kept) segments = kept.segments;
    }
    if (!segments) {
      try { segments = (await getCaptions(videoId, '', userId)).segments || []; } catch (_) { segments = null; } // a robot check or no captions: the note says so
    }
    const paragraphs = labelsLib.transcriptParagraphs(segments || []);

    const title = String((fav && fav.title) || b.title || 'YouTube video');
    const labels = fav ? { category: fav.category, tags: fav.tags } : { category: '', tags: [] };
    const body = labelsLib.buildVideoNote({
      videoId, title, channel: (fav && fav.channel) || b.channel, duration: (fav && fav.duration) || b.duration, publishedAt: (fav && fav.publishedAt) || b.publishedAt,
      category: labels.category, tags: labels.tags, points: pts && pts.points, overview: ins && ins.insights && ins.insights.overview,
      paragraphs, transcriptMissing: !paragraphs.length,
    });
    res.json({ title: title.slice(0, 200), body: body.slice(0, 400000), tags: labelsLib.noteTagsFor(labels), hasTranscript: paragraphs.length > 0 });
  } catch (err) {
    console.error('[youtube/video-note]', err.message);
    res.status(500).json({ error: 'Could not prepare the note.' });
  }
});

router.delete('/favourites/:videoId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM youtube_favourites WHERE "userId" = $1 AND "videoId" = $2',
      [req.user.id, req.params.videoId]
    );
    await pool.query('DELETE FROM youtube_caption_segments WHERE "userId" = $1 AND "videoId" = $2', [req.user.id, req.params.videoId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/watch-history/all', async (req, res) => {
  try {
    await pool.query('DELETE FROM youtube_watch_history WHERE "userId" = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Quota ─────────────────────────────────────────────────────────────────────

router.get('/quota', async (_req, res) => {
  try { res.json(await quotaStatus(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Video insights, ask this video, note ──────────────────────────────────────

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// A small in-memory cache of fetched captions so asking several questions about one video fetches them once (30 minutes, 20 videos).
const captionCache = new Map();
const CAPTION_TTL_MS = 30 * 60 * 1000;
// Keep the caption text of a SAVED video so the Favourites search can look inside it. Best effort: never breaks the request that triggered it.
async function keepCaptions(userId, videoId, t) {
  const fav = await pool.query('SELECT 1 FROM youtube_favourites WHERE "userId"=$1 AND "videoId"=$2', [userId, videoId]);
  if (!fav.rows.length) return;
  const segments = (t.segments || []).map((x) => ({ start: Math.floor(Number(x.start) || 0), text: String(x.text || '') })).filter((x) => x.text);
  if (!segments.length) return;
  await pool.query(
    `INSERT INTO youtube_caption_segments ("userId","videoId",language,segments) VALUES ($1,$2,$3,$4)
     ON CONFLICT ("userId","videoId") DO UPDATE SET language=EXCLUDED.language, segments=EXCLUDED.segments, "createdAt"=NOW()`,
    [userId, videoId, t.languageCode || '', JSON.stringify(segments)]
  );
}

async function getCaptions(videoId, languageCode, userId) {
  const t = await getCaptionsRaw(videoId, languageCode, userId);
  if (userId && t.source !== 'ai') keepCaptions(userId, videoId, t).catch(() => {});
  return t;
}

async function getCaptionsRaw(videoId, languageCode, userId) {
  if (userId) {
    const mine = await aiTranscripts.stored(userId, videoId);
    if (mine) return { title: mine.title || 'YouTube video', segments: mine.segments || [], languageCode: mine.language || '', source: 'ai' };
  }
  const key = `${videoId}:${languageCode || ''}`;
  const hit = captionCache.get(key);
  if (hit && Date.now() - hit.at < CAPTION_TTL_MS) return hit.value;
  const t = await fetchYoutubeTranscript(`https://www.youtube.com/watch?v=${videoId}`, languageCode || undefined);
  const value = { title: t.title, segments: t.segments || [], languageCode: t.languageCode || languageCode || '' };
  captionCache.set(key, { at: Date.now(), value });
  if (captionCache.size > 20) captionCache.delete(captionCache.keys().next().value);
  return value;
}

const noCaptions = captionProblem;

async function savedInsights(userId, videoId, languageCode) {
  const { rows } = languageCode
    ? await pool.query('SELECT * FROM youtube_video_insights WHERE "userId"=$1 AND "videoId"=$2 AND "languageCode"=$3', [userId, videoId, languageCode])
    : await pool.query('SELECT * FROM youtube_video_insights WHERE "userId"=$1 AND "videoId"=$2 ORDER BY "createdAt" DESC LIMIT 1', [userId, videoId]);
  return rows[0] || null;
}

const insightsPayload = (row) => ({
  insights: row.insights, title: row.title, languageCode: row.languageCode, truncated: row.truncated, coveredSec: row.coveredSec, createdAt: row.createdAt,
});

async function writeInsights(userId, videoId, languageCode) {
  const t = await getCaptions(videoId, languageCode, userId);
  const view = insightsLib.formatForModel(t.segments);
  if (!view.text) throw new Error('The captions are empty.');
  const durationSec = insightsLib.coveredSeconds(t.segments);
  const { light } = await getModelsForUser(userId);
  const result = await callModel(light, view.text, { maxTokens: 1800, system: insightsLib.INSIGHTS_SYSTEM, returnUsage: true });
  logUsage({ userId, model: light, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'youtube' });
  const insights = insightsLib.normalizeInsights(result.text, { durationSec });
  if (!insights) throw new Error('The AI did not return usable notes. Try again.');
  const lang = t.languageCode || '';
  await pool.query(
    `INSERT INTO youtube_video_insights ("userId","videoId","languageCode",title,insights,model,truncated,"coveredSec")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ("userId","videoId","languageCode")
     DO UPDATE SET title=EXCLUDED.title, insights=EXCLUDED.insights, model=EXCLUDED.model, truncated=EXCLUDED.truncated, "coveredSec"=EXCLUDED."coveredSec", "createdAt"=NOW()`,
    [userId, videoId, lang, t.title, JSON.stringify(insights), light, view.truncated, view.coveredSec]
  );
  return savedInsights(userId, videoId, lang);
}

const userFacing = (err, fallback) => (err.message && /AI did not|captions are empty/.test(err.message) ? err.message : fallback);

router.get('/insights/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    const row = await savedInsights(req.user.id, videoId, String(req.query.languageCode || ''));
    res.json(row ? insightsPayload(row) : { insights: null });
  } catch (err) {
    console.error('[youtube/insights get]', err.message);
    res.status(500).json({ error: 'Could not read the saved notes.' });
  }
});

router.post('/insights', aiLimiter, async (req, res) => {
  const { videoId, languageCode = '', refresh = false } = req.body || {};
  if (!VIDEO_ID.test(String(videoId || ''))) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    if (!refresh) {
      const have = await savedInsights(req.user.id, videoId, String(languageCode));
      if (have) return res.json({ ...insightsPayload(have), cached: true });
    }
    const row = await writeInsights(req.user.id, videoId, String(languageCode));
    res.json({ ...insightsPayload(row), cached: false });
  } catch (err) {
    console.error('[youtube/insights]', err.message);
    if (noCaptions(err, res)) return;
    res.status(500).json({ error: userFacing(err, 'Could not write notes for this video.') });
  }
});

// ── Main points: a bullet list from Gemini, saved with the transcript ──────────

const pointsPayload = (row) => ({ points: row.points, title: row.title, truncated: row.truncated, createdAt: row.createdAt });

router.get('/main-points/:videoId', async (req, res) => {
  if (!VIDEO_ID.test(req.params.videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    const { rows } = await pool.query('SELECT * FROM youtube_main_points WHERE "userId"=$1 AND "videoId"=$2', [req.user.id, req.params.videoId]);
    res.json(rows[0] ? pointsPayload(rows[0]) : { points: null });
  } catch (err) { console.error('[youtube/main-points get]', err.message); res.status(500).json({ error: 'Could not read the saved main points.' }); }
});

router.post('/main-points', aiLimiter, async (req, res) => {
  const { videoId, languageCode = '', refresh = false } = req.body || {};
  if (!VIDEO_ID.test(String(videoId || ''))) return res.status(400).json({ error: 'A valid videoId is required.' });
  const userId = req.user.id;
  try {
    if (!refresh) {
      const have = await pool.query('SELECT * FROM youtube_main_points WHERE "userId"=$1 AND "videoId"=$2', [userId, videoId]);
      if (have.rows[0]) return res.json({ ...pointsPayload(have.rows[0]), cached: true });
    }
    const t = await getCaptions(videoId, String(languageCode), userId);
    const view = mainPointsLib.transcriptForModel(t.segments);
    if (!view.text) throw new Error('The captions are empty.');
    const models = await getModelsForUser(userId);
    const model = models.gemini || models.light;
    if (!model) return res.status(400).json({ error: 'No Gemini model is set up in Settings.' });
    const result = await callModel(model, mainPointsLib.buildPrompt(t.title, view.text), { maxTokens: 2500, system: mainPointsLib.MAIN_POINTS_SYSTEM, returnUsage: true });
    logUsage({ userId, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'youtube' });
    const points = mainPointsLib.normalizePoints(result.text);
    if (!points) throw new Error('The AI did not return usable points. Try again.');
    await pool.query(
      `INSERT INTO youtube_main_points ("userId","videoId",title,points,model,truncated)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("userId","videoId")
       DO UPDATE SET title=EXCLUDED.title, points=EXCLUDED.points, model=EXCLUDED.model, truncated=EXCLUDED.truncated, "createdAt"=NOW()`,
      [userId, videoId, t.title, JSON.stringify(points), model, view.truncated]
    );
    const { rows } = await pool.query('SELECT * FROM youtube_main_points WHERE "userId"=$1 AND "videoId"=$2', [userId, videoId]);
    res.json({ ...pointsPayload(rows[0]), cached: false });
  } catch (err) {
    console.error('[youtube/main-points]', err.message);
    if (noCaptions(err, res)) return;
    res.status(500).json({ error: userFacing(err, 'Could not write the main points for this video.') });
  }
});

router.delete('/main-points/:videoId', async (req, res) => {
  if (!VIDEO_ID.test(req.params.videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    await pool.query('DELETE FROM youtube_main_points WHERE "userId"=$1 AND "videoId"=$2', [req.user.id, req.params.videoId]);
    res.json({ ok: true });
  } catch (err) { console.error('[youtube/main-points delete]', err.message); res.status(500).json({ error: 'Could not delete them.' }); }
});

router.post('/ask', aiLimiter, async (req, res) => {
  const { videoId, languageCode = '', question, history = [] } = req.body || {};
  if (!VIDEO_ID.test(String(videoId || ''))) return res.status(400).json({ error: 'A valid videoId is required.' });
  const q = String(question || '').trim().slice(0, 500);
  if (!q) return res.status(400).json({ error: 'Type a question first.' });
  try {
    const t = await getCaptions(videoId, String(languageCode), req.user.id);
    const durationSec = insightsLib.coveredSeconds(t.segments);
    const picked = insightsLib.pickPassages(t.segments, q);
    if (!picked.text) return res.status(404).json({ error: 'The captions are empty, so there is nothing to read.' });
    const earlier = (Array.isArray(history) ? history : []).slice(-4)
      .map((h) => `Q: ${String((h && h.question) || '').slice(0, 300)}\nA: ${String((h && h.answer) || '').slice(0, 600)}`).join('\n\n');
    const prompt = `TRANSCRIPT${picked.partial ? ' (only the parts most likely to matter for the question)' : ''}:\n${picked.text}\n\n${earlier ? `EARLIER QUESTIONS:\n${earlier}\n\n` : ''}QUESTION: ${q}`;
    const { standard } = await getModelsForUser(req.user.id);
    const result = await callModel(standard, prompt, { maxTokens: 700, system: insightsLib.ASK_SYSTEM, returnUsage: true });
    logUsage({ userId: req.user.id, model: standard, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'youtube' });
    const out = insightsLib.normalizeAnswer(result.text, { durationSec });
    if (!out) return res.status(502).json({ error: 'The AI did not give an answer. Try asking again.' });
    res.json({ ...out, partial: picked.partial });
  } catch (err) {
    console.error('[youtube/ask]', err.message);
    if (noCaptions(err, res)) return;
    res.status(500).json({ error: 'Could not answer that just now.' });
  }
});

router.post('/note-draft', aiLimiter, async (req, res) => {
  const { videoId, languageCode = '', channel = '' } = req.body || {};
  if (!VIDEO_ID.test(String(videoId || ''))) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    const row = (await savedInsights(req.user.id, videoId, String(languageCode))) || (await writeInsights(req.user.id, videoId, String(languageCode)));
    const title = row.title || 'YouTube video';
    const body = insightsLib.buildNoteMarkdown({ videoId, title, channel: String(channel).slice(0, 120), insights: row.insights });
    res.json({ title: title.slice(0, 200), body });
  } catch (err) {
    console.error('[youtube/note-draft]', err.message);
    if (noCaptions(err, res)) return;
    res.status(500).json({ error: userFacing(err, 'Could not prepare the note.') });
  }
});

// ── Follow channels and searches ──────────────────────────────────────────────

router.get('/follows', async (req, res) => {
  try { res.json({ follows: await follows.listFollows(pool, req.user.id), limits: follows.LIMITS }); }
  catch (err) { console.error('[youtube/follows]', err.message); res.status(500).json({ error: 'Could not read what you follow.' }); }
});

router.get('/follows/new', async (req, res) => {
  try { res.json({ videos: await follows.listNew(pool, req.user.id) }); }
  catch (err) { console.error('[youtube/follows/new]', err.message); res.status(500).json({ error: 'Could not read the new videos.' }); }
});

router.post('/follows/seen', async (req, res) => {
  try {
    const n = await follows.markSeen(pool, req.user.id, { videoIds: req.body && req.body.videoIds, all: !!(req.body && req.body.all) });
    res.json({ marked: n });
  } catch (err) { console.error('[youtube/follows/seen]', err.message); res.status(500).json({ error: 'Could not mark them as seen.' }); }
});

// "Check now": looks at the channels you follow that have not been looked at in the last 5 minutes. Searches are left to the daily check (100 units each).
router.post('/follows/check', async (req, res) => {
  try {
    const out = await follows.runChecks(pool, ytGet, { userId: req.user.id, channelsOnly: true, minGapMs: 5 * 60 * 1000 });
    res.json({ ...out, videos: await follows.listNew(pool, req.user.id) });
  } catch (err) { console.error('[youtube/follows/check]', err.message); res.status(err.status || 500).json({ error: err.status === 429 ? err.message : 'Could not check just now.' }); }
});

router.post('/follows', async (req, res) => {
  try {
    const r = await follows.addFollow(pool, ytGet, req.user.id, req.body);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.status(201).json({ follow: r.follow });
  } catch (err) { console.error('[youtube/follows add]', err.message); res.status(500).json({ error: 'Could not follow that just now.' }); }
});

router.delete('/follows/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
  try {
    const ok = await follows.removeFollow(pool, req.user.id, id);
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'Not found.' });
  } catch (err) { console.error('[youtube/follows delete]', err.message); res.status(500).json({ error: 'Could not unfollow.' }); }
});

// ── AI-written transcripts (for videos with no captions) ──────────────────────

router.get('/ai-transcripts', async (req, res) => {
  try { res.json({ videoIds: await aiTranscripts.savedIds(req.user.id) }); }
  catch (err) { console.error('[youtube/ai-transcripts]', err.message); res.status(500).json({ error: 'Could not read your saved transcripts.' }); }
});

// What pressing "Generate" would do and cost, for the confirmation window. Starts nothing.
router.get('/ai-transcript/:videoId/plan', async (req, res) => {
  if (!VIDEO_ID.test(req.params.videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try { res.json(await aiTranscripts.plan(req.user.id, req.params.videoId)); }
  catch (err) { console.error('[youtube/ai-transcript plan]', err.message); res.status(err.status || 500).json({ error: err.status === 429 ? err.message : 'Could not work out the cost just now.' }); }
});

router.get('/ai-transcript/:videoId', async (req, res) => {
  if (!VIDEO_ID.test(req.params.videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try { res.json(await aiTranscripts.status(req.user.id, req.params.videoId)); }
  catch (err) { console.error('[youtube/ai-transcript status]', err.message); res.status(500).json({ error: 'Could not read the transcript status.' }); }
});

router.post('/ai-transcript', aiLimiter, async (req, res) => {
  const videoId = String((req.body && req.body.videoId) || '');
  if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    const r = await aiTranscripts.start(req.user.id, videoId);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.status(202).json({ started: true });
  } catch (err) {
    console.error('[youtube/ai-transcript start]', err.message);
    res.status(err.status || 500).json({ error: err.status === 429 ? err.message : 'Could not start the transcript.' });
  }
});

router.delete('/ai-transcript/:videoId', async (req, res) => {
  if (!VIDEO_ID.test(req.params.videoId)) return res.status(400).json({ error: 'A valid videoId is required.' });
  try {
    const ok = await aiTranscripts.remove(req.user.id, req.params.videoId);
    await pool.query('DELETE FROM youtube_main_points WHERE "userId"=$1 AND "videoId"=$2', [req.user.id, req.params.videoId]); // they were written from that transcript
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'No saved transcript.' });
  } catch (err) { console.error('[youtube/ai-transcript delete]', err.message); res.status(500).json({ error: 'Could not delete it.' }); }
});

module.exports = router;
