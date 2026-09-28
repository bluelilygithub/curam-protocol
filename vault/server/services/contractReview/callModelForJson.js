'use strict';

// Contract Review — shared helper for every pipeline stage that calls a
// model expecting a parseable JSON response of a specific shape. Truncation
// (a real response cut off mid-JSON because maxTokens was too small for
// THIS specific document) turned out to be a genuinely recurring failure
// mode, independently hit by risk scoring, obligations, classification, and
// summary — each "fixed" in turn by guessing a bigger fixed maxTokens for
// that one stage, which only holds until a bigger/denser document needs
// more again (risk scoring alone was raised twice, 500->1200->2500, and
// still not guaranteed to be enough for an arbitrarily large contract).
//
// This replaces guessing with an actual retry: if the response doesn't
// parse into the expected shape, retry the SAME call with maxTokens
// doubled (up to MAX_RETRY_TOKENS), instead of permanently raising a fixed
// budget that will eventually be too small again. Also consolidates the
// repeated recordRawOutput/trackCost/parse boilerplate that was duplicated
// near-identically across all five stage files.

const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { trackCost } = require('./costTracking');

const MAX_RETRY_TOKENS = 8000;

/**
 * @param {object} opts
 * @param {number} opts.reviewId
 * @param {string} opts.modelId - resolved model id (never 'none' — caller
 *   only calls this inside its own `if (resolved)` branch)
 * @param {string} opts.prompt
 * @param {number} opts.maxTokens - starting budget; doubles on a shape
 *   failure up to MAX_RETRY_TOKENS
 * @param {number} opts.timeoutMs
 * @param {string} opts.stage - contract_review_raw_outputs.stage value
 * @param {string} opts.promptVersion
 * @param {object} [opts.costTracker] - trackCost is called once per attempt
 *   (every attempt is a real billable call); a CostCeilingExceededError
 *   from an early attempt propagates immediately, same as any other stage
 * @param {(parsed: any) => boolean} opts.isValid - structural shape check
 *   ONLY (e.g. "has an obligations array") — semantic completeness checks
 *   (e.g. "an 'unclear' verdict needs a reason") do NOT belong here: more
 *   tokens can't fix a model that structurally succeeded but omitted a
 *   field, so retrying for that would just waste calls. Do that check
 *   separately, after this returns.
 * @param {string} opts.describeFailure - used in the final thrown error
 *   message if every retry is exhausted, e.g. "Risk scoring for clause 42"
 * @returns {Promise<any>} the parsed JSON (guaranteed to satisfy isValid)
 */
async function callModelForJson({ reviewId, modelId, prompt, maxTokens, timeoutMs, stage, promptVersion, costTracker, isValid, describeFailure }) {
  let tokens = maxTokens;
  let attempt = 0;
  let lastText = null;

  for (;;) {
    attempt += 1;
    const result = await callModel(modelId, prompt, { maxTokens: tokens, returnUsage: true, timeoutMs });
    const text = result.text;
    lastText = text;
    if (costTracker) await trackCost(costTracker, reviewId, modelId, result); // may throw CostCeilingExceededError — propagates as-is
    const parsed = parseModelJson(text);
    const ok = parsed && isValid(parsed);
    await recordRawOutput({
      reviewId, stage, modelId, promptVersion,
      rawResponse: { prompt: prompt.slice(0, 500), text, parsed, attempt, maxTokensUsed: tokens, ok },
    });
    if (ok) return parsed;
    if (tokens >= MAX_RETRY_TOKENS) {
      throw new Error(`${describeFailure} failed after ${attempt} attempt(s) (up to ${tokens} tokens): model response was not valid JSON with the expected shape`);
    }
    tokens = Math.min(tokens * 2, MAX_RETRY_TOKENS);
  }
}

module.exports = { callModelForJson, MAX_RETRY_TOKENS };
