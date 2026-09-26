'use strict';

// Contract Review — orchestrates pipeline stages 3-11 (analysis pipeline +
// obligations + summary + grounding + coverage), running after stage 2
// (segmentation) has already produced contract_clauses. Stage 4 (parties/
// key terms) can pause the whole chain at status='awaiting_role_confirmation'
// — runAnalysis returns at that point; resumeAfterRoleConfirmation continues
// from stage 5 onward once ContractService.confirmParty has run (or was
// already satisfied by a prior review's confirmed party — see
// partiesKeyTerms.js's reconciliation note).
//
// Stage 1 (ingest) and stage 2 (segmentation) are NOT run here — the caller
// (ContractService.startReview) runs those first via ingest.js/segmentation.js,
// exactly as milestone2.test.js already does directly.

const { pool, CONTRACT_TYPE_KEYS } = require('../../db');
const { detectContractType } = require('./typeDetection');
const { extractPartiesAndKeyTerms } = require('./partiesKeyTerms');
const { extractDefinitions } = require('./definitionsExtraction');
const { classifyClauses } = require('./clauseClassification');
const { scoreClauses } = require('./riskScoring');
const { extractObligations } = require('./obligationsExtraction');
const { generateSummary } = require('./summaryGeneration');
const { buildCoverageReport } = require('./coverageReport');
const { PROMPT_VERSION } = require('./prompts/v1');

async function setStatus(reviewId, status, extra = {}) {
  const sets = [`status=$1`, `"stageProgress"=$2`];
  const params = [status, JSON.stringify({ stage: status })];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`"${col}"=$${i}`);
    params.push(val);
    i += 1;
  }
  params.push(reviewId);
  await pool.query(`UPDATE contract_reviews SET ${sets.join(', ')} WHERE id=$${i}`, params);
}

async function loadReviewContext(reviewId) {
  const { rows: [row] } = await pool.query(
    `SELECT r.*, d.id AS "documentId", d."contractId", d."extractedText", d."pageMap"
     FROM contract_reviews r
     JOIN contract_documents d ON d.id = r."documentId"
     WHERE r.id=$1`,
    [reviewId]
  );
  if (!row) throw new Error(`Review ${reviewId} not found`);
  return row;
}

/** Runs stages 3-4 (type detection, parties+key terms). Pauses at
 * awaiting_role_confirmation unless a party is already confirmed. Caller
 * (ContractService.startReview) invokes this right after segmentation. */
async function runAnalysis(reviewId, { userId } = {}) {
  const ctx = await loadReviewContext(reviewId);
  await pool.query(`UPDATE contract_reviews SET "promptVersion"=$1 WHERE id=$2`, [PROMPT_VERSION, reviewId]);

  await setStatus(reviewId, 'detecting_type');
  await detectContractType(reviewId, ctx.extractedText, userId);

  await setStatus(reviewId, 'awaiting_role_confirmation');
  const { needsRoleConfirmation } = await extractPartiesAndKeyTerms(reviewId, ctx.contractId, ctx.extractedText, userId);

  if (needsRoleConfirmation) {
    return { status: 'awaiting_role_confirmation', reviewId };
  }
  return resumeAfterRoleConfirmation(reviewId, { userId });
}

/** Runs stages 5-11 (definitions through coverage report). Called once a
 * user party is confirmed (or was already confirmed on a prior review of
 * this contract). Idempotent to call again on the same review only in the
 * sense that it re-runs each stage's own INSERTs, matching every other
 * stage's design (a review's rows are immutable only once status='complete'
 * — see the guardrail — this function is the one place that completes it). */
async function resumeAfterRoleConfirmation(reviewId, { userId } = {}) {
  const ctx = await loadReviewContext(reviewId);
  if (ctx.status === 'complete') {
    // Guardrail: contract_clauses/contract_definitions/contract_obligations
    // are immutable once a review completes — never re-run stages 5-11 (which
    // INSERT, not upsert) against an already-complete review. A caller that
    // wants a fresh analysis must start a new review, not resume this one.
    return { status: 'complete', reviewId };
  }
  const { contractId, documentId, extractedText } = ctx;

  const { rows: [userParty] } = await pool.query(
    `SELECT * FROM contract_parties WHERE "contractId"=$1 AND "isUser"=TRUE AND "confirmedByUser"=TRUE ORDER BY "createdAt" ASC LIMIT 1`,
    [contractId]
  );
  await pool.query(`UPDATE contract_reviews SET "userPartyId"=$1 WHERE id=$2`, [userParty ? userParty.id : null, reviewId]);

  const contractType = CONTRACT_TYPE_KEYS.includes(ctx.detectedContractType) ? ctx.detectedContractType : 'other';
  const role = userParty ? userParty.role : 'other';

  try {
    await setStatus(reviewId, 'extracting_definitions');
    await extractDefinitions(reviewId, extractedText, userId);

    await setStatus(reviewId, 'classifying');
    await classifyClauses(reviewId, userId);

    await setStatus(reviewId, 'scoring');
    await scoreClauses(reviewId, { contractType, role, userId, extractedText });

    await setStatus(reviewId, 'extracting_obligations');
    await extractObligations(reviewId, { contractId, documentId, extractedText, userId });

    await setStatus(reviewId, 'summarizing');
    await generateSummary(reviewId, extractedText, userId);

    await setStatus(reviewId, 'verifying');
    await buildCoverageReport(reviewId, contractType);

    await pool.query(`UPDATE contract_reviews SET status='complete', "completedAt"=NOW() WHERE id=$1`, [reviewId]);
    return { status: 'complete', reviewId };
  } catch (err) {
    await pool.query(
      `UPDATE contract_reviews SET status='failed', "errorMessage"=$1, "completedAt"=NOW() WHERE id=$2`,
      [err.message, reviewId]
    );
    throw err;
  }
}

module.exports = { runAnalysis, resumeAfterRoleConfirmation, loadReviewContext };
