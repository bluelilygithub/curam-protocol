'use strict';

// Contract Review — Pipeline stage 5 (Definitions extraction). Failures
// leave definitions empty rather than block the run — clause scoring still
// proceeds without term injection (spec's stated failure behavior).

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { verifyQuote } = require('./grounding');
const { trackCost, LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { definitionsPrompt, PROMPT_VERSION } = require('./prompts/v1');

// Every failure here now aborts the whole review (status='failed', clear
// errorMessage) rather than silently continuing with empty definitions — a
// deliberate override of this stage's original soft-fail design, decided
// after a review that looked "stuck" for 6+ minutes on a slow model: loud,
// immediate failure is safer than a review that might silently degrade for
// an unbounded time before something else eventually fails it.
async function extractDefinitions(reviewId, extractedText, userId, costTracker) {
  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const modelId = resolved || 'none';
  let rawDefinitions = [];

  if (resolved) {
    try {
      const prompt = definitionsPrompt(extractedText);
      const result = await callModel(resolved, prompt, { maxTokens: 1500, returnUsage: true, timeoutMs: LLM_CALL_TIMEOUT_MS });
      const text = result.text;
      if (costTracker) await trackCost(costTracker, reviewId, modelId, result);
      const parsed = parseModelJson(text);
      await recordRawOutput({ reviewId, stage: 'extracting_definitions', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
      if (parsed && Array.isArray(parsed.definitions)) rawDefinitions = parsed.definitions;
    } catch (err) {
      await recordRawOutput({ reviewId, stage: 'extracting_definitions', modelId, promptVersion: PROMPT_VERSION, rawResponse: { error: err.message } });
      throw err;
    }
  }

  const inserted = [];
  for (const d of rawDefinitions) {
    const term = String(d?.term || '').trim();
    const definition = String(d?.definition || '').trim();
    const quotedText = String(d?.quotedText || '').trim();
    if (!term || !definition || !quotedText) continue;
    const { spanStart, spanEnd, verificationStatus } = verifyQuote(extractedText, quotedText);
    const { rows } = await pool.query(
      `INSERT INTO contract_definitions ("reviewId", term, definition, "quotedText", "spanStart", "spanEnd", "verificationStatus")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [reviewId, term, definition, quotedText, spanStart, spanEnd, verificationStatus]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

module.exports = { extractDefinitions };
