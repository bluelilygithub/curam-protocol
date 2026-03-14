'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool } = require('../db');

// text-embedding-004 produces 768-dimensional embeddings
const EMBEDDING_DIM = 768;

/**
 * Embed a single string using Google's text-embedding-004 model.
 * Returns a float array, or null if GEMINI_API_KEY is absent or the call fails.
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.error('[embeddings] embedText error:', err.message);
    return null;
  }
}

/**
 * Embed the user's query and return the top-K most relevant chunks for a project.
 * Falls back to an empty array if GEMINI_API_KEY is absent, pgvector is unavailable,
 * or any error occurs — the caller falls back to full-text injection.
 *
 * @param {string} queryText
 * @param {number|string} projectId
 * @param {number} topK
 * @returns {Promise<string[]>}
 */
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
