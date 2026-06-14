'use strict';

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../db');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { generateDigestForUser } = require('../cron/newsDigestCron');
const { callModel } = require('../services/callModel');
const { getModelsForUser } = require('../services/modelResolver');
const { logUsage } = require('../utils/logUsage');

const { DEFAULT_SOURCES } = require('../services/newsAggregationService');

function getGemini() {
  const key = process.env.GEMINI_API_KEY;
  return key ? new GoogleGenerativeAI(key) : null;
}

// ── Topics ────────────────────────────────────────────────────────────────────

// GET /api/news-digest/topics
router.get('/topics', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, keywords, "sortOrder", active, "createdAt"
       FROM news_topics WHERE "userId"=$1 ORDER BY "sortOrder" ASC, id ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load topics' });
  }
});

// POST /api/news-digest/topics
router.post('/topics', async (req, res) => {
  const { title, keywords } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

  try {
    const { rows: maxRow } = await pool.query(
      `SELECT COALESCE(MAX("sortOrder"), -1) + 1 AS next FROM news_topics WHERE "userId"=$1`,
      [req.user.id]
    );
    const sortOrder = maxRow[0].next;

    const { rows } = await pool.query(
      `INSERT INTO news_topics ("userId", title, keywords, "sortOrder")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, title.trim(), (keywords || '').trim(), sortOrder]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create topic' });
  }
});

// PUT /api/news-digest/topics/reorder  (must be before /:id)
router.put('/topics/reorder', async (req, res) => {
  const { ids } = req.body; // ordered array of topic IDs
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });

  try {
    for (let i = 0; i < ids.length; i++) {
      await pool.query(
        `UPDATE news_topics SET "sortOrder"=$1 WHERE id=$2 AND "userId"=$3`,
        [i, ids[i], req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder topics' });
  }
});

// PUT /api/news-digest/topics/:id
router.put('/topics/:id', async (req, res) => {
  const { title, keywords, active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE news_topics
       SET title    = COALESCE($1, title),
           keywords = COALESCE($2, keywords),
           active   = COALESCE($3, active)
       WHERE id=$4 AND "userId"=$5
       RETURNING *`,
      [
        title    !== undefined ? title.trim()          : null,
        keywords !== undefined ? (keywords || '').trim() : null,
        active   !== undefined ? active                : null,
        req.params.id,
        req.user.id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Topic not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update topic' });
  }
});

// DELETE /api/news-digest/topics/:id
router.delete('/topics/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM news_topics WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete topic' });
  }
});

// ── Digests ───────────────────────────────────────────────────────────────────

// GET /api/news-digest?date=YYYY-MM-DD
// Returns the digest for a given date, including per-topic analysis.
router.get('/', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  try {
    const { rows: digestRows } = await pool.query(
      `SELECT id, date, "generatedAt", "totalTokens", "approxCostUsd" FROM news_digests WHERE "userId"=$1 AND date=$2`,
      [req.user.id, date]
    );

    if (!digestRows.length) return res.json({ date, digest: null, topicResults: [] });

    const digestId = digestRows[0].id;

    const { rows: topicResults } = await pool.query(
      `SELECT DISTINCT ON (ndt."topicId")
              ndt.id, ndt."topicId", nt.title, nt.keywords, nt."sortOrder",
              ndt.articles, ndt.analysis, ndt."createdAt"
       FROM news_digest_topics ndt
       JOIN news_topics nt ON nt.id = ndt."topicId"
       WHERE ndt."digestId"=$1
       ORDER BY ndt."topicId", ndt."createdAt" DESC`,
      [digestId]
    );

    // Fetch saved context for each topic on this date
    const topicIds = topicResults.map(r => r.topicId);
    let contextMap = {};
    if (topicIds.length) {
      const { rows: ctxRows } = await pool.query(
        `SELECT "topicId", commentary FROM news_digest_context
         WHERE "userId"=$1 AND date=$2 AND "topicId"=ANY($3)`,
        [req.user.id, date, topicIds]
      );
      ctxRows.forEach(c => { contextMap[c.topicId] = c.commentary; });
    }

    const enriched = topicResults.map(r => ({
      ...r,
      commentary: contextMap[r.topicId] || '',
    }));

    res.json({ date, digest: digestRows[0], topicResults: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load digest' });
  }
});

// GET /api/news-digest/dates — list dates that have a digest
router.get('/dates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT date FROM news_digests WHERE "userId"=$1 ORDER BY date DESC LIMIT 90`,
      [req.user.id]
    );
    res.json(rows.map(r => r.date.toISOString ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load digest dates' });
  }
});

// POST /api/news-digest/generate — manually trigger digest for a date
router.post('/generate', async (req, res) => {
  const date = req.body.date || new Date().toISOString().slice(0, 10);

  // Start async — respond immediately so client doesn't time out
  res.json({ ok: true, message: 'Digest generation started', date });

  // force=true so existing results are replaced, not skipped
  generateDigestForUser(req.user.id, date, true).catch(err =>
    console.error('[news] Manual generate failed:', err.message)
  );
});

// ── Context (user commentary) ─────────────────────────────────────────────────

// PUT /api/news-digest/context/:topicId
router.put('/context/:topicId', async (req, res) => {
  const { date, commentary } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  try {
    await pool.query(
      `INSERT INTO news_digest_context ("userId", "topicId", date, commentary, "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT ("userId", "topicId", date) DO UPDATE
       SET commentary=$4, "updatedAt"=NOW()`,
      [req.user.id, req.params.topicId, date, commentary || '']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save commentary' });
  }
});

// ── Per-topic chat ────────────────────────────────────────────────────────────

// GET /api/news-digest/topics/:topicId/chat
router.get('/topics/:topicId/chat', async (req, res) => {
  try {
    // Verify ownership
    const { rows: check } = await pool.query(
      `SELECT id FROM news_topics WHERE id=$1 AND "userId"=$2`,
      [req.params.topicId, req.user.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Topic not found' });

    const { rows } = await pool.query(
      `SELECT id, role, content, "createdAt" FROM news_chat
       WHERE "topicId"=$1 AND "userId"=$2 ORDER BY "createdAt" ASC`,
      [req.params.topicId, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load chat' });
  }
});

// POST /api/news-digest/topics/:topicId/chat
router.post('/topics/:topicId/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  try {
    // Verify ownership and get topic title
    const { rows: topicRows } = await pool.query(
      `SELECT id, title FROM news_topics WHERE id=$1 AND "userId"=$2`,
      [req.params.topicId, req.user.id]
    );
    if (!topicRows.length) return res.status(404).json({ error: 'Topic not found' });
    const topic = topicRows[0];

    // Save user message
    await pool.query(
      `INSERT INTO news_chat ("topicId", "userId", role, content) VALUES ($1, $2, 'user', $3)`,
      [topic.id, req.user.id, message.trim()]
    );

    // Fetch last 7 days of summaries + commentary for this topic
    const { rows: history } = await pool.query(
      `SELECT
         nd.date::text                                   AS date,
         ndt.analysis->'left'->>'summary'               AS left_summary,
         ndt.analysis->'right'->>'summary'              AS right_summary,
         ndt.analysis->'unbiased'->>'summary'           AS unbiased_summary,
         ndc.commentary
       FROM news_digest_topics ndt
       JOIN news_digests nd ON nd.id = ndt."digestId"
       LEFT JOIN news_digest_context ndc
         ON ndc."topicId" = ndt."topicId"
         AND ndc."userId" = nd."userId"
         AND ndc.date = nd.date
       WHERE ndt."topicId" = $1
         AND nd."userId"   = $2
         AND nd.date >= CURRENT_DATE - INTERVAL '6 days'
       ORDER BY nd.date DESC`,
      [topic.id, req.user.id]
    );

    // Build system prompt with rolling 7-day context
    let systemPrompt = `You are a balanced news analyst. The user is asking about the topic: "${topic.title}".\n\n`;
    if (history.length > 0) {
      systemPrompt += `Here are the last ${history.length} days of news summaries for this topic:\n\n`;
      history.forEach(h => {
        systemPrompt += `Date: ${h.date}\n`;
        if (h.left_summary)    systemPrompt += `Left perspective: ${h.left_summary}\n`;
        if (h.right_summary)   systemPrompt += `Right perspective: ${h.right_summary}\n`;
        if (h.unbiased_summary)systemPrompt += `Unbiased: ${h.unbiased_summary}\n`;
        if (h.commentary)      systemPrompt += `User's notes: ${h.commentary}\n`;
        systemPrompt += '---\n';
      });
      systemPrompt += '\nAnswer the user\'s question using this context. Be balanced and factual.';
    } else {
      systemPrompt += 'No recent digest history is available for this topic. Answer generally.';
    }

    // Call AI
    let aiText;
    const { gemini: geminiModelId, light: lightModel } = await getModelsForUser(req.user?.id);
    const gemini = getGemini();
    if (gemini) {
      try {
        const model = gemini.getGenerativeModel({ model: geminiModelId });
        const result = await model.generateContent(`${systemPrompt}\n\nUser: ${message.trim()}`);
        aiText = result.response.text();
        logUsage({
          userId: req.user?.id,
          model: geminiModelId,
          inputTokens: result.response.usageMetadata?.promptTokenCount,
          outputTokens: result.response.usageMetadata?.candidatesTokenCount,
          feature: 'news_digest',
        });
      } catch (err) {
        console.warn('[news-chat] Gemini failed, falling back to Claude:', err.message);
      }
    }

    if (!aiText) {
      const result = await callModel(lightModel, message.trim(), { maxTokens: 1024, system: systemPrompt, returnUsage: true });
      logUsage({ userId: req.user?.id, model: lightModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'news_digest' });
      aiText = result.text
        || 'Sorry, I could not generate a response.';
    }

    // Save assistant message and return both
    const { rows: saved } = await pool.query(
      `INSERT INTO news_chat ("topicId", "userId", role, content) VALUES ($1, $2, 'assistant', $3) RETURNING *`,
      [topic.id, req.user.id, aiText]
    );

    res.json({ assistantMessage: saved[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// DELETE /api/news-digest/topics/:topicId/chat — clear chat history
router.delete('/topics/:topicId/chat', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM news_chat WHERE "topicId"=$1 AND "userId"=$2`,
      [req.params.topicId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

// GET /api/news-digest/settings
router.get('/settings', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('news_digest_time', 'news_digest_days', 'news_digest_sources')`
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({
      time:    map.news_digest_time    || '07:00',
      days:    map.news_digest_days    ? JSON.parse(map.news_digest_days)    : [0, 1, 2, 3, 4, 5, 6],
      sources: map.news_digest_sources ? JSON.parse(map.news_digest_sources) : DEFAULT_SOURCES,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load digest settings' });
  }
});

// POST /api/news-digest/settings
router.post('/settings', async (req, res) => {
  const { time, days, sources } = req.body;
  try {
    const updates = [];
    if (time    !== undefined) updates.push(pool.query(`INSERT INTO settings (key,value) VALUES ('news_digest_time',$1)    ON CONFLICT (key) DO UPDATE SET value=$1`, [time]));
    if (days    !== undefined) updates.push(pool.query(`INSERT INTO settings (key,value) VALUES ('news_digest_days',$1)    ON CONFLICT (key) DO UPDATE SET value=$1`, [JSON.stringify(days)]));
    if (sources !== undefined) updates.push(pool.query(`INSERT INTO settings (key,value) VALUES ('news_digest_sources',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [JSON.stringify(sources)]));
    await Promise.all(updates);

    // Reschedule cron to reflect any time/days change
    const { scheduleDigestCron } = require('../cron/newsDigestCron');
    await scheduleDigestCron();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save digest settings' });
  }
});

module.exports = router;
