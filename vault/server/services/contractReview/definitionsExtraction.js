'use strict';

// Contract Review — Pipeline stage 5 (Definitions extraction). Stale doc
// note removed here: this file's ACTUAL behavior (see the comment right
// above extractDefinitions) has aborted the whole review on any failure
// for some time now — this top comment describing a soft-fail design was
// never updated when that changed.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { verifyQuote } = require('./grounding');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { callModelForJson } = require('./callModelForJson');
const { definitionsPrompt, PROMPT_VERSION } = require('./prompts/v1');

// Every failure here now aborts the whole review (status='failed', clear
// errorMessage) rather than silently continuing with empty definitions — a
// deliberate override of this stage's original soft-fail design, decided
// after a review that looked "stuck" for 6+ minutes on a slow model: loud,
// immediate failure is safer than a review that might silently degrade for
// an unbounded time before something else eventually fails it.
async function extractDefinitions(reviewId, extractedText, userId, costTracker) {
  const { modelId: resolved } = await resolveContractReviewModel(userId);
  let rawDefinitions = [];

  if (resolved) {
    const prompt = definitionsPrompt(extractedText);
    // A parse failure must never be silently treated the same as a genuine
    // "this contract has no defined terms" (the prompt's own valid empty
    // answer is {"definitions": []}, still an array) — only a missing/
    // malformed "definitions" array is a real pipeline error.
    // callModelForJson retries with doubled tokens on a shape failure
    // (truncation) instead of a fixed guess — the same bug class hit
    // riskScoring/obligationsExtraction/clauseClassification/
    // summaryGeneration independently, each initially "fixed" with a bigger
    // fixed number that eventually needed raising again.
    const parsed = await callModelForJson({
      reviewId, modelId: resolved, prompt, maxTokens: 1500, timeoutMs: LLM_CALL_TIMEOUT_MS,
      stage: 'extracting_definitions', promptVersion: PROMPT_VERSION, costTracker,
      isValid: (p) => Array.isArray(p.definitions),
      describeFailure: 'Definitions extraction',
    });
    rawDefinitions = parsed.definitions;
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
