'use strict';

// Contract Review — Pipeline stage 9 (Summary). Replaces a plain summary
// TEXT with summaryPoints — each point grounded with its own quote/span/
// verification status, per docs/contract-review-spec.md round 3 item 7.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { verifyQuote } = require('./grounding');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { callModelForJson } = require('./callModelForJson');
const { summaryPrompt, PROMPT_VERSION } = require('./prompts/v1');

async function generateSummary(reviewId, extractedText, userId, costTracker) {
  const { rows: clauses } = await pool.query(`SELECT id, "numberLabel" FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]);
  const validClauseIds = new Set(clauses.map((c) => c.id));

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  let rawPoints = [];

  if (resolved) {
    const prompt = summaryPrompt(extractedText, clauses);
    // Each summary point needs a real verbatim quotedText sentence (for
    // grounding) on top of the plain-English text and clauseIds, and 4-8
    // points of that shape can add up on a genuinely dense contract —
    // callModelForJson retries with doubled tokens on a shape failure
    // instead of a fixed guess. A parse failure must never be silently
    // treated as "no summary points" — only a missing/malformed
    // "summaryPoints" array is a real pipeline error.
    const parsed = await callModelForJson({
      reviewId, modelId: resolved, prompt, maxTokens: 1500, timeoutMs: LLM_CALL_TIMEOUT_MS,
      stage: 'summarizing', promptVersion: PROMPT_VERSION, costTracker,
      isValid: (p) => Array.isArray(p.summaryPoints),
      describeFailure: 'Summary generation',
    });
    rawPoints = parsed.summaryPoints;
  }

  const summaryPoints = [];
  for (const p of rawPoints) {
    const pText = String(p?.text || '').trim();
    if (!pText) continue;
    const clauseIds = Array.isArray(p?.clauseIds) ? p.clauseIds.map(Number).filter((id) => validClauseIds.has(id)) : [];
    const quotedText = p?.quotedText ? String(p.quotedText).trim() : '';
    let spanStart = null, spanEnd = null, verificationStatus = 'failed';
    if (quotedText) {
      ({ spanStart, spanEnd, verificationStatus } = verifyQuote(extractedText, quotedText));
    }
    summaryPoints.push({ text: pText, clauseIds, quotedText: quotedText || null, spanStart, spanEnd, verificationStatus });
  }

  await pool.query(`UPDATE contract_reviews SET "summaryPoints"=$1 WHERE id=$2`, [JSON.stringify(summaryPoints), reviewId]);
  return summaryPoints;
}

module.exports = { generateSummary };
