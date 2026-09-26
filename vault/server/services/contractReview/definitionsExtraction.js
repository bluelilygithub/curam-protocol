'use strict';

// Contract Review — Pipeline stage 5 (Definitions extraction). Failures
// leave definitions empty rather than block the run — clause scoring still
// proceeds without term injection (spec's stated failure behavior).

const { pool } = require('../../db');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { verifyQuote } = require('./grounding');
const { definitionsPrompt, PROMPT_VERSION } = require('./prompts/v1');

async function extractDefinitions(reviewId, extractedText, userId) {
  const { standard } = await getModelsForUser(userId);
  const modelId = standard || 'none';
  let rawDefinitions = [];

  if (standard) {
    try {
      const prompt = definitionsPrompt(extractedText);
      const text = await callModel(standard, prompt, { maxTokens: 1500 });
      const parsed = parseModelJson(text);
      await recordRawOutput({ reviewId, stage: 'extracting_definitions', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
      if (parsed && Array.isArray(parsed.definitions)) rawDefinitions = parsed.definitions;
    } catch (err) {
      console.warn(`[contract-review] definitions extraction failed for review ${reviewId}: ${err.message}`);
      await recordRawOutput({ reviewId, stage: 'extracting_definitions', modelId, promptVersion: PROMPT_VERSION, rawResponse: { error: err.message } });
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
