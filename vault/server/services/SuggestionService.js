'use strict';

/**
 * SuggestionService — shared emitter for agents, services, and crons.
 * All automated findings should call capture() / captureIf() here (never skip silently).
 * Failures are logged; callers are never blocked.
 */

const crypto = require('crypto');
const { pool } = require('../db');
const { isValidCategory } = require('../constants/suggestionInbox');

function makeFingerprint(source, key) {
  const raw = `${source || 'unknown'}:${key || ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

function normalizePayload(payload) {
  const {
    userId,
    category = 'other',
    title,
    body = '',
    context = null,
    source = null,
    fingerprint = null,
  } = payload ?? {};

  const uid = parseInt(userId, 10);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('Valid userId is required');
  if (!isValidCategory(category)) throw new Error(`Invalid category: ${category}`);
  if (!title || !String(title).trim()) throw new Error('title is required');

  const fp = payload.fingerprint
    || (source ? makeFingerprint(source, payload.fingerprintKey || title) : null);

  return {
    userId: uid,
    category,
    title: String(title).trim().slice(0, 500),
    body: String(body).slice(0, 8000),
    context: context ? String(context).slice(0, 2000) : null,
    source: source ? String(source).slice(0, 120) : null,
    fingerprint: fp,
  };
}

async function getPrimaryAdminUserId() {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * Insert or refresh an open suggestion (deduped by userId + fingerprint).
 * Ignored suggestions do not block a new row with the same fingerprint.
 */
async function capture(payload) {
  try {
    const row = normalizePayload(payload);

    if (row.fingerprint) {
      const { rows: ignored } = await pool.query(
        `SELECT id FROM agent_suggestions
         WHERE "userId" = $1 AND fingerprint = $2 AND status = 'ignore'
         LIMIT 1`,
        [row.userId, row.fingerprint],
      );
      if (ignored.length) return { skipped: true, reason: 'ignored' };

      const { rows: existing } = await pool.query(
        `SELECT id, status FROM agent_suggestions
         WHERE "userId" = $1 AND fingerprint = $2 AND status <> 'ignore'
         LIMIT 1`,
        [row.userId, row.fingerprint],
      );

      if (existing.length) {
        const { rows } = await pool.query(
          `UPDATE agent_suggestions
           SET body = $1, context = COALESCE($2, context), source = COALESCE($3, source),
               "updatedAt" = NOW()
           WHERE id = $4
           RETURNING id, category, status, title, body, context, source, fingerprint, "createdAt", "updatedAt"`,
          [row.body, row.context, row.source, existing[0].id],
        );
        return { updated: true, suggestion: rows[0] };
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO agent_suggestions
         ("userId", category, status, title, body, context, source, fingerprint)
       VALUES ($1, $2, 'new', $3, $4, $5, $6, $7)
       RETURNING id, category, status, title, body, context, source, fingerprint, "createdAt", "updatedAt"`,
      [row.userId, row.category, row.title, row.body, row.context, row.source, row.fingerprint],
    );
    return { created: true, suggestion: rows[0] };
  } catch (err) {
    console.warn('[SuggestionService] capture failed:', err.message);
    return { error: err.message };
  }
}

async function captureIf(condition, payload) {
  if (!condition) return { skipped: true, reason: 'condition_false' };
  return capture(payload);
}

async function captureMany(items) {
  const results = [];
  for (const item of items) {
    results.push(await capture(item));
  }
  return results;
}

/** Workspace-level checks once per server boot (admin inbox). */
async function runStartupChecks() {
  const adminId = await getPrimaryAdminUserId();
  if (!adminId) return;

  try {
    const { resolveEmbeddingConfig } = require('./embeddingResolver');
    const embedding = await resolveEmbeddingConfig(adminId);
    if (!embedding.available) {
      await capture({
        userId: adminId,
        source: 'startup',
        category: 'alert',
        fingerprint: makeFingerprint('startup', `embedding:${embedding.provider}`),
        title: 'Embeddings unavailable',
        body: embedding.hint,
        context: 'server boot / embeddingResolver',
      });
    }
  } catch (err) {
    console.warn('[SuggestionService] startup embedding check:', err.message);
  }

  try {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_extension WHERE extname = 'vector'
       ) AS has_vector`,
    );
    if (!rows[0]?.has_vector) {
      await capture({
        userId: adminId,
        source: 'startup',
        category: 'alert',
        fingerprint: makeFingerprint('startup', 'pgvector-missing'),
        title: 'pgvector extension not installed',
        body: 'Semantic memory, file RAG, and graph embeddings need pgvector on Postgres. Install the extension on your database (see docs/semantic-memory.md).',
        context: 'PostgreSQL pg_extension',
      });
    }
  } catch (err) {
    console.warn('[SuggestionService] startup pgvector check:', err.message);
  }
}

/** Call after news digest generation for one user. */
async function reportNewsDigestRun(userId, dateStr, meta) {
  const uid = parseInt(userId, 10);
  if (!uid) return;

  const {
    emptyTopics = [],
    failedTopics = [],
    topicsTotal = 0,
    approxCostUsd = 0,
  } = meta ?? {};

  for (const topic of emptyTopics) {
    await capture({
      userId: uid,
      source: 'newsDigestCron',
      category: 'alert',
      fingerprint: makeFingerprint('newsDigestCron', `topic:${topic.id}:no-articles`),
      title: `News Digest: no articles for "${topic.title}"`,
      body: 'No matching articles in the last 72–96 hours. Try broader keywords or check RSS/Google News sources in Settings → News Digest.',
      context: `topicId=${topic.id} date=${dateStr}`,
    });
  }

  for (const item of failedTopics) {
    await capture({
      userId: uid,
      source: 'newsDigestCron',
      category: 'alert',
      fingerprint: makeFingerprint('newsDigestCron', `topic:${item.id}:failed:${dateStr}`),
      title: `News Digest failed: "${item.title}"`,
      body: item.error || 'Unknown error during analysis.',
      context: `topicId=${item.id} date=${dateStr}`,
    });
  }

  if (topicsTotal > 0 && emptyTopics.length === topicsTotal) {
    await capture({
      userId: uid,
      source: 'newsDigestCron',
      category: 'alert',
      fingerprint: makeFingerprint('newsDigestCron', `all-empty:${dateStr}`),
      title: 'News Digest: all topics returned no articles',
      body: `All ${topicsTotal} active topics had zero articles on ${dateStr}. Review topic keywords and news sources.`,
      context: `date=${dateStr}`,
    });
  }

  if (approxCostUsd > 0.5) {
    await capture({
      userId: uid,
      source: 'newsDigestCron',
      category: 'alert',
      fingerprint: makeFingerprint('newsDigestCron', `high-cost:${dateStr}`),
      title: 'News Digest: high token cost',
      body: `Today's digest used approximately $${approxCostUsd.toFixed(2)} in API tokens. Consider fewer topics or a lighter model if this is unexpected.`,
      context: `date=${dateStr}`,
    });
  }
}

async function reportMemoryHealth(userId, stats) {
  const uid = parseInt(userId, 10);
  if (!uid || !stats) return;

  const embedding = stats.embedding;
  if (embedding && !embedding.available && stats.total > 0) {
    await capture({
      userId: uid,
      source: 'MemoryService',
      category: 'alert',
      fingerprint: makeFingerprint('MemoryService', `embed-unavailable:${embedding.provider}`),
      title: 'Memory: semantic search unavailable',
      body: `${embedding.hint}. Chat falls back to recent memories only.`,
      context: '/memory',
    });
  }

  const unembedded = stats.total - (stats.embedded || 0);
  if (stats.total >= 5 && unembedded >= stats.total) {
    await capture({
      userId: uid,
      source: 'MemoryService',
      category: 'alert',
      fingerprint: makeFingerprint('MemoryService', 'all-unembedded'),
      title: 'Memory: no searchable embeddings',
      body: `${stats.total} memories stored but none are embedded. Configure embeddings (Ollama locally or Gemini on Railway) and pgvector.`,
      context: '/memory',
    });
  }
}

async function reportSharesCron(event, detail = {}) {
  const adminId = detail.userId || (await getPrimaryAdminUserId());
  if (!adminId) return;

  const handlers = {
    'asx:no-api-key': {
      category: 'alert',
      title: 'Shares: Alpha Vantage API key missing',
      body: 'ASX quote polls are skipped. Set ALPHA_VANTAGE_API_KEY for ASX holdings.',
      context: 'sharesCron ASX poll',
    },
    'poll-failed': {
      category: 'alert',
      title: `Shares poll failed (${detail.exchanges || 'unknown'})`,
      body: detail.error || 'Snapshot recording failed.',
      context: detail.context || 'sharesCron',
    },
    'briefing-failed': {
      category: 'alert',
      title: 'Shares news briefing failed',
      body: detail.error || 'Daily briefing generation failed.',
      context: `userId=${detail.userId}`,
    },
  };

  const spec = handlers[event];
  if (!spec) return;

  await capture({
    userId: detail.userId || adminId,
    source: 'sharesCron',
    category: spec.category,
    fingerprint: makeFingerprint('sharesCron', `${event}:${detail.userId || 'global'}`),
    title: spec.title,
    body: spec.body,
    context: spec.context,
  });
}

module.exports = {
  capture,
  captureIf,
  captureMany,
  makeFingerprint,
  getPrimaryAdminUserId,
  runStartupChecks,
  reportNewsDigestRun,
  reportMemoryHealth,
  reportSharesCron,
};
