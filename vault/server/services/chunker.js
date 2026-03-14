'use strict';

// Approximate token count: 1 token ≈ 4 characters
const CHARS_PER_TOKEN = 4;
const TARGET_CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 50;
const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN; // 2000 chars
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;           // 200 chars

// Split text into sentences using common sentence-ending punctuation.
// Keeps the delimiter attached to the preceding sentence.
function splitIntoSentences(text) {
  const raw = text.match(/[^.!?\n]*(?:[.!?]+|\n+)(?:\s*)/g);
  return raw || [text];
}

/**
 * Split extracted text into overlapping chunks of approximately 500 tokens.
 * Sentence boundaries are respected — chunks never split mid-sentence.
 * Consecutive chunks share a 50-token (200-char) overlap to preserve continuity.
 *
 * @param {string} text  Extracted document text
 * @returns {string[]}   Array of chunk strings
 */
function chunkText(text) {
  if (!text || !text.trim()) return [];

  const sentences = splitIntoSentences(text.trim());
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current + sentence;

    if (candidate.length > TARGET_CHUNK_CHARS && current.length > 0) {
      // Flush current chunk
      chunks.push(current.trim());

      // Begin next chunk with overlap from the tail of the previous chunk
      const overlap = current.length > OVERLAP_CHARS
        ? current.slice(current.length - OVERLAP_CHARS)
        : current;
      current = overlap + sentence;
    } else {
      current = candidate;
    }
  }

  // Flush the final chunk
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter(c => c.length > 0);
}

module.exports = { chunkText };
