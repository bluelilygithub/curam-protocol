'use strict';

// Contract Review — Pipeline stage 9 (Summary). Replaces a plain summary
// TEXT with summaryPoints — each point grounded with its own quote/span/
// verification status, per docs/contract-review-spec.md round 3 item 7.

const { pool } = require('../../db');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { verifyQuote } = require('./grounding');
const { summaryPrompt, PROMPT_VERSION } = require('./prompts/v1');

async function generateSummary(reviewId, extractedText, userId) {
  const { rows: clauses } = await pool.query(`SELECT id, "numberLabel" FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]);
  const validClauseIds = new Set(clauses.map((c) => c.id));

  const { standard } = await getModelsForUser(userId);
  const modelId = standard || 'none';
  let rawPoints = [];

  if (standard) {
    try {
      const prompt = summaryPrompt(extractedText, clauses);
      const text = await callModel(standard, prompt, { maxTokens: 1500 });
      const parsed = parseModelJson(text);
      await recordRawOutput({ reviewId, stage: 'summarizing', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
      if (parsed && Array.isArray(parsed.summaryPoints)) rawPoints = parsed.summaryPoints;
    } catch (err) {
      console.warn(`[contract-review] summary generation failed for review ${reviewId}: ${err.message}`);
      await recordRawOutput({ reviewId, stage: 'summarizing', modelId, promptVersion: PROMPT_VERSION, rawResponse: { error: err.message } });
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
