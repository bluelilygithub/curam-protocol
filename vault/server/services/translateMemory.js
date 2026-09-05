'use strict';

/**
 * Exact-match translation memory. No fuzzy matching (kept simple deliberately) — a paragraph
 * that has been translated before, in the same language pair for this user, is reused verbatim
 * instead of being re-sent to the model. Saves LLM cost on repeat boilerplate (T&Cs, standard
 * clauses, repeated product blurbs) and guarantees identical wording across jobs.
 */

const crypto = require('crypto');
const { pool } = require('../db');

function normalize(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function hashOf(text) {
  return crypto.createHash('md5').update(normalize(text)).digest('hex');
}

/** Returns a Map<sourceText, targetText> for every exact match found. */
async function lookupExact({ userId, sourceLang, targetLang, texts }) {
  const hits = new Map();
  const candidates = [...new Set(texts.map(normalize).filter(Boolean))];
  if (!candidates.length) return hits;

  const hashes = candidates.map(hashOf);
  const { rows } = await pool.query(
    `SELECT "sourceHash", "targetText" FROM translate_memory
     WHERE "userId"=$1 AND "sourceLang"=$2 AND "targetLang"=$3 AND "sourceHash" = ANY($4)`,
    [userId, sourceLang, targetLang, hashes]
  );
  if (!rows.length) return hits;

  const byHash = new Map(rows.map((r) => [r.sourceHash, r.targetText]));
  candidates.forEach((c, i) => {
    const hit = byHash.get(hashes[i]);
    if (hit) hits.set(c, hit);
  });
  return hits;
}

/** Upsert every source->target pair from a completed job. Skips very short/placeholder text. */
async function savePairs({ userId, sourceLang, targetLang, domain, pairs }) {
  const cleaned = pairs
    .map((p) => ({ source: normalize(p.source), target: normalize(p.target) }))
    .filter((p) => p.source.length > 1 && p.target.length > 1
      && !/^\[translation (incomplete|error)\]/i.test(p.target));
  if (!cleaned.length) return 0;

  const client = await pool.connect();
  let saved = 0;
  try {
    await client.query('BEGIN');
    for (const { source, target } of cleaned) {
      await client.query(
        `INSERT INTO translate_memory ("userId","sourceLang","targetLang","sourceHash","sourceText","targetText",domain,"hitCount")
         VALUES ($1,$2,$3,$4,$5,$6,$7,0)
         ON CONFLICT ("userId","sourceLang","targetLang","sourceHash")
         DO UPDATE SET "targetText"=EXCLUDED."targetText", domain=EXCLUDED.domain, "updatedAt"=NOW()`,
        [userId, sourceLang, targetLang, hashOf(source), source, target, domain || null]
      );
      saved += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return saved;
}

async function bumpHitCounts({ userId, sourceLang, targetLang, sources }) {
  const hashes = [...new Set(sources.map(normalize).filter(Boolean))].map(hashOf);
  if (!hashes.length) return;
  await pool.query(
    `UPDATE translate_memory SET "hitCount"="hitCount"+1
     WHERE "userId"=$1 AND "sourceLang"=$2 AND "targetLang"=$3 AND "sourceHash" = ANY($4)`,
    [userId, sourceLang, targetLang, hashes]
  ).catch(() => {});
}

async function stats({ userId }) {
  const { rows } = await pool.query(
    `SELECT "sourceLang", "targetLang", COUNT(*)::INT AS "segmentCount", SUM("hitCount")::INT AS "totalReuses"
     FROM translate_memory WHERE "userId"=$1 GROUP BY "sourceLang","targetLang" ORDER BY "segmentCount" DESC`,
    [userId]
  );
  return rows;
}

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Standard TMX 1.4 export so the memory can be imported into another CAT tool. */
async function exportTmx({ userId, sourceLang, targetLang }) {
  const params = [userId];
  let where = `"userId"=$1`;
  if (sourceLang) { params.push(sourceLang); where += ` AND "sourceLang"=$${params.length}`; }
  if (targetLang) { params.push(targetLang); where += ` AND "targetLang"=$${params.length}`; }

  const { rows } = await pool.query(
    `SELECT "sourceLang","targetLang","sourceText","targetText","updatedAt" FROM translate_memory WHERE ${where} ORDER BY "updatedAt" DESC`,
    params
  );

  const units = rows.map((r) => `
  <tu>
    <tuv xml:lang="${escapeXml(r.sourceLang)}"><seg>${escapeXml(r.sourceText)}</seg></tuv>
    <tuv xml:lang="${escapeXml(r.targetLang)}"><seg>${escapeXml(r.targetText)}</seg></tuv>
  </tu>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="CuramVault" creationtoolversion="1.0" segtype="paragraph" o-tmf="CuramVault" adminlang="en" srclang="*all*" datatype="plaintext" />
  <body>${units}
  </body>
</tmx>`;
}

module.exports = { lookupExact, savePairs, bumpHitCounts, stats, exportTmx, normalize };
