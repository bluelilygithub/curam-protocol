'use strict';

// Contract Review — Pipeline stage 9 (Summary). Replaces a plain summary
// TEXT with summaryPoints — each point grounded with its own quote/span/
// verification status, per docs/contract-review-spec.md round 3 item 7.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { verifyQuote } = require('./grounding');
const { trackCost, LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { summaryPrompt, PROMPT_VERSION } = require('./prompts/v1');

async function generateSummary(reviewId, extractedText, userId, costTracker) {
  const { rows: clauses } = await pool.query(`SELECT id, "numberLabel" FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]);
  const validClauseIds = new Set(clauses.map((c) => c.id));

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const modelId = resolved || 'none';
  let rawPoints = [];

  if (resolved) {
    try {
      const prompt = summaryPrompt(extractedText, clauses);
      const result = await callModel(resolved, prompt, { maxTokens: 1500, returnUsage: true, timeoutMs: LLM_CALL_TIMEOUT_MS });
      const text = result.text;
      if (costTracker) await trackCost(costTracker, reviewId, modelId, result);
      const parsed = parseModelJson(text);
      await recordRawOutput({ reviewId, stage: 'summarizing', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
      if (parsed && Array.isArray(parsed.summaryPoints)) rawPoints = parsed.summaryPoints;
    } catch (err) {
      // Any failure aborts the whole review now — see definitionsExtraction.js's header comment for why.
      await recordRawOutput({ reviewId, stage: 'summarizing', modelId, promptVersion: PROMPT_VERSION, rawResponse: { error: err.message } });
      throw err;
    }
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
