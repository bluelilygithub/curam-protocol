'use strict';

const { pool } = require('../db');

const EMBEDDING_DIM = 768;

// Track consecutive failures to avoid hammering a broken endpoint
let _consecutiveFailures = 0;
const FAILURE_THRESHOLD = 5;

async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // Circuit breaker — skip after repeated failures to avoid log spam
  if (_consecutiveFailures >= FAILURE_THRESHOLD) return null;

  // Try models in order until one works
  const candidates = [
    'text-embedding-004',
    'embedding-001',
  ];

  for (const model of candidates) {
    for (const version of ['v1', 'v1beta']) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/${version}/models/${model}:embedContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: { parts: [{ text }] },
            }),
          }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const values = data.embedding?.values;
        if (values?.length) {
          _consecutiveFailures = 0;
          return values;
        }
      } catch { continue; }
    }
  }

  _consecutiveFailures++;
  if (_consecutiveFailures === FAILURE_THRESHOLD) {
    console.warn('[embeddings] repeated failures — suppressing further attempts until restart');
  } else {
    console.error('[embeddings] embedText: no working embedding model found for this API key');
  }
  return null;
}

async function retrieveRelevantChunks(queryText, projectId, topK = 5) {
  if (!process.env.GEMINI_API_KEY || !queryText || !projectId) return [];

  try {
    const embedding = await embedText(queryText);
    if (!embedding) return [];

    const vectorLiteral = `[${embedding.join(',')}]`;

    const { rows } = await pool.query(
      `SELECT chunk_text
       FROM file_chunks
       WHERE project_id = $1
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [projectId, vectorLiteral, topK]
    );

    return rows.map(r => r.chunk_text);
  } catch (err) {
    console.error('[embeddings] retrieveRelevantChunks error:', err.message);
    return [];
  }
}

module.exports = { embedText, retrieveRelevantChunks, EMBEDDING_DIM };
