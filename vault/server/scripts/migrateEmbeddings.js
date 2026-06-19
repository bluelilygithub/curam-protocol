'use strict';

/**
 * One-time migration: chunk and embed all existing files that have extracted text
 * but no corresponding rows in file_chunks.
 *
 * Safe to re-run — skips any file that already has chunks.
 *
 * Usage:
 *   node server/scripts/migrateEmbeddings.js
 *
 * Or via npm:
 *   npm run migrate:embeddings
 */

require('dotenv').config();

const { pool } = require('../db');
const { chunkText } = require('../services/chunker');
const { embedText, embedTextVector } = require('../services/embeddings');
const { resolveEmbeddingConfig } = require('../services/embeddingResolver');

async function run() {
  const config = await resolveEmbeddingConfig(1);
  if (!config.available) {
    console.error(`[migrate] Embeddings unavailable (${config.hint}). Aborting.`);
    process.exit(1);
  }
  console.log(`[migrate] Using ${config.sourceKey}`);

  // Wait for the pool to be ready (db.js runs initSchema on first query)
  await pool.query('SELECT 1');

  // Find files that have extracted text but no chunks yet
  const { rows: files } = await pool.query(`
    SELECT f.id, f.name, f."projectId", f."extractedText"
    FROM files f
    WHERE f."extractedText" IS NOT NULL
      AND f."extractedText" <> ''
      AND NOT EXISTS (
        SELECT 1 FROM file_chunks fc WHERE fc.file_id = f.id
      )
    ORDER BY f.id
  `);

  if (files.length === 0) {
    console.log('[migrate] No files need embedding — all up to date.');
    await pool.end();
    return;
  }

  console.log(`[migrate] Found ${files.length} file(s) to embed.`);
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`[migrate] Processing file ${i + 1}/${files.length}: ${file.name} (id=${file.id})`);

    try {
      const chunks = chunkText(file.extractedText);
      if (chunks.length === 0) {
        console.log(`  ↳ No chunks generated — skipping`);
        continue;
      }

      let chunkCount = 0;
      for (let ci = 0; ci < chunks.length; ci++) {
        const { vector, sourceKey } = await embedText(chunks[ci], { userId: 1 });
        if (vector) {
          await pool.query(
            `INSERT INTO file_chunks (file_id, project_id, chunk_index, chunk_text, embedding, embedding_source)
             VALUES ($1, $2, $3, $4, $5::vector, $6)`,
            [file.id, file.projectId, ci, chunks[ci], `[${vector.join(',')}]`, sourceKey]
          );
          chunkCount++;
        }
      }

      console.log(`  ↳ ${chunkCount}/${chunks.length} chunks embedded`);
      succeeded++;
    } catch (err) {
      console.error(`  ↳ FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n[migrate] Done. ${succeeded} file(s) embedded, ${failed} failed.`);
  await pool.end();
}

run().catch(err => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
