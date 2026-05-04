'use strict';

const { pool } = require('../db');

const EMBEDDING_DIM = 768;

async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/embedding-001:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      }
    );
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      console.error(`[embeddings] embedText failed ${res.status}: ${msg.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data.embedding?.values || null;
  } catch (err) {
    console.error('[embeddings] embedText error:', err.message);
    return null;
  }
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
