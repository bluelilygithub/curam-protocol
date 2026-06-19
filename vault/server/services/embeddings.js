'use strict';

const { runtimeConfig } = require('../config/runtime');
const { pool } = require('../db');
const { resolveEmbeddingConfig, EMBEDDING_DIM } = require('./embeddingResolver');
const { ollamaBaseUrl } = require('./ollamaClient');

const MAX_CHARS = 30000;

const GEMINI_ENDPOINTS = [
  (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
  (model) => `https://generativelanguage.googleapis.com/v1/models/${model}:embedContent`,
];

async function embedWithGemini(text, model) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const input = String(text).slice(0, MAX_CHARS);
  let lastStatus = 0;
  let lastMsg = '';

  for (const buildUrl of GEMINI_ENDPOINTS) {
    const res = await fetch(`${buildUrl(model)}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: input }] } }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.embedding?.values || null;
    }

    if (res.status !== 404) {
      const msg = await res.text().catch(() => '');
      console.error(`[embeddings] Gemini embed failed ${res.status}: ${msg.slice(0, 200)}`);
      return null;
    }

    lastStatus = res.status;
    lastMsg = await res.text().catch(() => '');
  }

  console.error(`[embeddings] Gemini embed failed ${lastStatus || 404}: ${lastMsg.slice(0, 200)}`);
  return null;
}

async function embedWithOllama(text, model) {
  if (!runtimeConfig.isLocal) {
    console.warn('[embeddings] Ollama embeddings skipped — not APP_ENV=local');
    return null;
  }

  const input = String(text).slice(0, MAX_CHARS);
  const base = ollamaBaseUrl();

  const attempts = [
    { path: '/api/embed', body: { model, input } },
    { path: '/api/embeddings', body: { model, prompt: input } },
  ];

  for (const { path, body } of attempts) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const vector = data.embeddings?.[0] || data.embedding;
      if (Array.isArray(vector) && vector.length > 0) return vector;
    } catch (err) {
      console.warn(`[embeddings] Ollama ${path} failed:`, err.message);
    }
  }

  console.error(`[embeddings] Ollama embed failed for model ${model}`);
  return null;
}

/**
 * Embed text using the resolved provider for this user + runtime.
 * @returns {Promise<{ vector: number[]|null, sourceKey: string|null, config: object }>}
 */
async function embedText(text, { userId = null } = {}) {
  const config = await resolveEmbeddingConfig(userId);
  if (!config.available) {
    return { vector: null, sourceKey: null, config };
  }

  let vector = null;
  if (config.provider === 'ollama') {
    vector = await embedWithOllama(text, config.model);
  } else {
    vector = await embedWithGemini(text, config.model);
  }

  if (vector && vector.length !== config.dimensions) {
    console.warn(
      `[embeddings] Dimension mismatch for ${config.sourceKey}: got ${vector.length}, expected ${config.dimensions}`
    );
    return { vector: null, sourceKey: config.sourceKey, config };
  }

  return {
    vector,
    sourceKey: vector ? config.sourceKey : null,
    config,
  };
}

/** Convenience — returns vector array only (legacy call sites). */
async function embedTextVector(text, options = {}) {
  const { vector } = await embedText(text, options);
  return vector;
}

async function retrieveRelevantChunks(queryText, projectId, topK = 5, { userId = null, embeddingSource = null } = {}) {
  if (!queryText || !projectId) return [];

  try {
    const { vector, sourceKey } = await embedText(queryText, { userId });
    if (!vector) return [];

    const vectorLiteral = `[${vector.join(',')}]`;
    const source = embeddingSource || sourceKey;

    const params = [projectId, vectorLiteral, topK];
    let sql = `
      SELECT chunk_text
      FROM file_chunks
      WHERE project_id = $1
        AND embedding IS NOT NULL
    `;
    if (source) {
      sql += ` AND (embedding_source = $4 OR embedding_source IS NULL)`;
      params.push(source);
    }
    sql += ` ORDER BY embedding <=> $2::vector LIMIT $3`;

    const { rows } = await pool.query(sql, params);
    return rows.map((r) => r.chunk_text);
  } catch (err) {
    console.error('[embeddings] retrieveRelevantChunks error:', err.message);
    return [];
  }
}

module.exports = {
  embedText,
  embedTextVector,
  retrieveRelevantChunks,
  EMBEDDING_DIM,
};
