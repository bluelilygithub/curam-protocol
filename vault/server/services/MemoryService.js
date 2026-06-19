'use strict';

/**
 * MemoryService — per-user semantic memory (768-dim; Ollama local, Gemini on Railway).
 */

const crypto = require('crypto');
const { pool } = require('../db');
const { embedText } = require('./embeddings');
const { resolveEmbeddingConfig } = require('./embeddingResolver');

const MAX_CONTENT_CHARS = 30000;

function normalizeContent(text) {
  return String(text || '').trim().slice(0, MAX_CONTENT_CHARS);
}

function contentFingerprint(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseUserId(userId) {
  const parsed = parseInt(userId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Valid user id is required.');
  }
  return parsed;
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value ?? fallback, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function rowToMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    content: row.content,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    userId: row.userId,
    embeddingSource: row.embedding_source ?? null,
  };
}

async function embedForUser(text, userId) {
  const { vector, sourceKey } = await embedText(text, { userId });
  if (!vector) return { vectorStr: null, sourceKey: null };
  return { vectorStr: `[${vector.join(',')}]`, sourceKey };
}

/**
 * Capture or update a memory (deduped by content hash per user).
 */
async function capture({ userId, content, metadata = {} }) {
  const uid = parseUserId(userId);
  const normalized = normalizeContent(content);
  if (!normalized) throw new Error('content is required');

  const fingerprint = contentFingerprint(normalized);
  const { vectorStr, sourceKey } = await embedForUser(normalized, uid);
  const meta = metadata && typeof metadata === 'object' ? metadata : {};

  const { rows } = await pool.query(
    `INSERT INTO memory (content, "userId", content_fingerprint, metadata, embedding, embedding_source)
     VALUES ($1, $2, $3, $4, $5::vector, $6)
     ON CONFLICT ("userId", content_fingerprint)
     DO UPDATE SET
       content = EXCLUDED.content,
       metadata = memory.metadata || EXCLUDED.metadata,
       embedding = COALESCE(EXCLUDED.embedding, memory.embedding),
       embedding_source = COALESCE(EXCLUDED.embedding_source, memory.embedding_source),
       "updatedAt" = NOW()
     RETURNING id, content, metadata, "createdAt", "updatedAt", "userId", embedding_source,
       (xmax = 0) AS inserted`,
    [normalized, uid, fingerprint, JSON.stringify(meta), vectorStr, sourceKey]
  );

  const row = rows[0];
  return {
    ...rowToMemory(row),
    created: Boolean(row.inserted),
  };
}

async function update({ userId, id, content, metadata }) {
  const uid = parseUserId(userId);
  const normalized = normalizeContent(content);
  if (!normalized) throw new Error('content is required');

  const fingerprint = contentFingerprint(normalized);
  const { vectorStr, sourceKey } = await embedForUser(normalized, uid);

  const { rowCount } = await pool.query(
    `UPDATE memory SET
       content = $1,
       content_fingerprint = $2,
       metadata = COALESCE($3::jsonb, metadata),
       embedding = $4::vector,
       embedding_source = $5,
       "updatedAt" = NOW()
     WHERE id = $6 AND "userId" = $7`,
    [
      normalized,
      fingerprint,
      metadata != null ? JSON.stringify(metadata) : null,
      vectorStr,
      sourceKey,
      id,
      uid,
    ]
  );

  if (rowCount === 0) throw new Error('Memory not found.');

  const { rows } = await pool.query(
    `SELECT id, content, metadata, "createdAt", "updatedAt", "userId", embedding_source
     FROM memory WHERE id = $1`,
    [id]
  );
  return rowToMemory(rows[0]);
}

async function search({ userId, query, limit = 8 }) {
  const uid = parseUserId(userId);
  const q = normalizeContent(query);
  if (!q) throw new Error('query is required');

  const cappedLimit = clampInt(limit, 8, 1, 20);
  const config = await resolveEmbeddingConfig(uid);
  const { vectorStr } = await embedForUser(q, uid);

  if (!vectorStr) {
    return list({ userId: uid, limit: cappedLimit });
  }

  const { rows } = await pool.query(
    `SELECT id, content, metadata, "createdAt", "updatedAt", "userId", embedding_source,
       1 - (embedding <=> $2::vector) AS similarity
     FROM memory
     WHERE "userId" = $1
       AND embedding IS NOT NULL
       AND (embedding_source = $4 OR embedding_source IS NULL)
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [uid, vectorStr, cappedLimit, config.sourceKey]
  );

  return rows.map((r) => ({
    ...rowToMemory(r),
    similarity: parseFloat(r.similarity).toFixed(4),
  }));
}

async function list({ userId, limit = 50, offset = 0 }) {
  const uid = parseUserId(userId);
  const cappedLimit = clampInt(limit, 50, 1, 100);
  const cappedOffset = clampInt(offset, 0, 0, 10_000);

  const { rows } = await pool.query(
    `SELECT id, content, metadata, "createdAt", "updatedAt", "userId", embedding_source
     FROM memory
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT $2 OFFSET $3`,
    [uid, cappedLimit, cappedOffset]
  );

  return rows.map(rowToMemory);
}

async function stats({ userId }) {
  const uid = parseUserId(userId);
  const embedding = await resolveEmbeddingConfig(uid);

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
       MIN("createdAt") AS oldest,
       MAX("createdAt") AS newest
     FROM memory
     WHERE "userId" = $1`,
    [uid]
  );

  const result = {
    ...(rows[0] ?? { total: 0, embedded: 0, oldest: null, newest: null }),
    embedding,
  };

  const { reportMemoryHealth } = require('./SuggestionService');
  reportMemoryHealth(uid, result).catch(() => {});

  return result;
}

async function remove({ userId, id }) {
  const uid = parseUserId(userId);
  const { rowCount } = await pool.query(
    'DELETE FROM memory WHERE id = $1 AND "userId" = $2',
    [id, uid]
  );
  if (rowCount === 0) throw new Error('Memory not found.');
  return { ok: true, id };
}

async function backfillEmbeddings(userId, limit = 25) {
  const uid = parseUserId(userId);
  const capped = clampInt(limit, 25, 1, 100);
  const config = await resolveEmbeddingConfig(uid);
  if (!config.available) return { updated: 0, remaining: 0 };

  const { rows } = await pool.query(
    `SELECT id, content FROM memory
     WHERE "userId" = $1
       AND (
         embedding IS NULL
         OR content_fingerprint IS NULL
         OR embedding_source IS DISTINCT FROM $2
       )
     ORDER BY "createdAt" DESC
     LIMIT $3`,
    [uid, config.sourceKey, capped]
  );

  let updated = 0;
  for (const row of rows) {
    const normalized = normalizeContent(row.content);
    if (!normalized) continue;
    const fingerprint = contentFingerprint(normalized);
    const { vectorStr, sourceKey } = await embedForUser(normalized, uid);
    await pool.query(
      `UPDATE memory SET
         content_fingerprint = $1,
         embedding = $2::vector,
         embedding_source = $3,
         "updatedAt" = NOW()
       WHERE id = $4 AND "userId" = $5`,
      [fingerprint, vectorStr, sourceKey, row.id, uid]
    );
    updated += 1;
  }

  return { updated, remaining: Math.max(0, rows.length - updated) };
}

async function getForPrompt({ userId, userMessage, limit = 8 }) {
  const uid = parseUserId(userId);
  const capped = clampInt(limit, 8, 1, 12);
  const query = normalizeContent(userMessage);
  const config = await resolveEmbeddingConfig(uid);

  if (query && config.available) {
    try {
      const { vectorStr } = await embedForUser(query, uid);
      if (vectorStr) {
        const { rows } = await pool.query(
          `SELECT content FROM memory
           WHERE "userId" = $1
             AND embedding IS NOT NULL
             AND (embedding_source = $4 OR embedding_source IS NULL)
           ORDER BY embedding <=> $2::vector
           LIMIT $3`,
          [uid, vectorStr, capped, config.sourceKey]
        );
        if (rows.length > 0) return rows.map((r) => r.content);
      }
    } catch (err) {
      console.warn('[MemoryService] semantic prompt recall failed:', err.message);
    }
  }

  const { rows } = await pool.query(
    `SELECT content FROM memory
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [uid, capped]
  );
  return rows.map((r) => r.content);
}

module.exports = {
  capture,
  update,
  search,
  list,
  stats,
  remove,
  backfillEmbeddings,
  getForPrompt,
};
