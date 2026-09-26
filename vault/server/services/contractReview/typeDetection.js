'use strict';

// Contract Review — Pipeline stage 3 (Contract type detection).

const { pool, CONTRACT_TYPE_KEYS } = require('../../db');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { typeDetectionPrompt, PROMPT_VERSION } = require('./prompts/v1');

/**
 * Detects the contract type and writes detectedContractType/
 * detectedContractTypeRaw onto the review (never onto contracts directly —
 * that's ContractService.promoteReviewToContract's job, only from an
 * executed document's current review). Low-confidence/no-match -> 'other'.
 */
async function detectContractType(reviewId, extractedText, userId) {
  const { standard } = await getModelsForUser(userId);
  const modelId = standard || 'none';
  let detectedContractType = 'other';
  let detectedContractTypeRaw = null;

  if (standard) {
    const prompt = typeDetectionPrompt(extractedText, CONTRACT_TYPE_KEYS);
    const text = await callModel(standard, prompt, { maxTokens: 300 });
    const parsed = parseModelJson(text);
    await recordRawOutput({ reviewId, stage: 'detecting_type', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
    if (parsed && typeof parsed === 'object') {
      const candidate = String(parsed.contractType || '').trim();
      if (CONTRACT_TYPE_KEYS.includes(candidate)) detectedContractType = candidate;
      detectedContractTypeRaw = parsed.contractTypeRaw ? String(parsed.contractTypeRaw).slice(0, 500) : null;
    }
  } else {
    await recordRawOutput({ reviewId, stage: 'detecting_type', modelId, promptVersion: PROMPT_VERSION, rawResponse: { skipped: 'no model configured' } });
  }

  await pool.query(
    `UPDATE contract_reviews SET "detectedContractType"=$1, "detectedContractTypeRaw"=$2, "modelId"=$3 WHERE id=$4`,
    [detectedContractType, detectedContractTypeRaw, modelId, reviewId]
  );
  return { detectedContractType, detectedContractTypeRaw };
}

module.exports = { detectContractType };
