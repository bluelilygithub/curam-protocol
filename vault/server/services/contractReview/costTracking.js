'use strict';

// Contract Review — per-review cost tracking + ceiling (spec: "a per-review
// cost ceiling aborts the run and marks status='failed' with errorMessage if
// exceeded"). Reuses server/services/costCalculator.js — the sanctioned
// hardcoded-pricing exception (CLAUDE.md: "cost display, not which model
// ran"), not a new pricing table. The running total is persisted onto
// contract_reviews.costUsd after every single LLM call, not just at the end,
// so a review that aborts partway (cost ceiling, or any other failure) still
// shows real partial cost rather than null.

const { pool } = require('../../db');
const { calculateCost } = require('../costCalculator');

const MAX_REVIEW_COST_USD = Number(process.env.CONTRACT_REVIEW_MAX_COST_USD) || 2.0;

// Every callModel() call in the pipeline passes this — found live: a review
// on a slow/reasoning-heavy configured model (deepseek-v4-flash) took 6+
// minutes end to end with zero per-call timeout, looking indistinguishable
// from "stuck" to the person testing it. A genuinely hanging provider call
// had no bound at all before this — could have left a review in progress
// forever. 90s is generous enough for a real (if slow) response while still
// guaranteeing every stage eventually surfaces a clear failure instead of
// hanging indefinitely.
const LLM_CALL_TIMEOUT_MS = Number(process.env.CONTRACT_REVIEW_LLM_TIMEOUT_MS) || 90_000;

class CostCeilingExceededError extends Error {
  constructor(totalCost) {
    super(`Review exceeded the per-review cost ceiling ($${totalCost.toFixed(4)} > $${MAX_REVIEW_COST_USD.toFixed(2)})`);
    this.name = 'CostCeilingExceededError';
    this.totalCost = totalCost;
  }
}

/** startingTotal lets resumeAfterRoleConfirmation pick up from the cost
 * already accrued by stages 3-4 before the awaiting_role_confirmation pause
 * — the pause can span an arbitrary real-world gap (a user confirming their
 * role hours later), so cost tracking can't rely on an in-memory object
 * surviving across it; it re-derives the running total from the review's
 * own already-persisted costUsd instead. */
function createCostTracker(startingTotal = 0) {
  return { total: Number(startingTotal) || 0 };
}

/** Adds one call's cost to the tracker, persists the new running total, and
 * throws CostCeilingExceededError if the per-review ceiling is now exceeded.
 * A no-op if usage/modelId is missing (e.g. no model configured for this
 * user — the calling stage already handles that by skipping the call). */
async function trackCost(tracker, reviewId, modelId, usage) {
  if (!usage || !modelId || modelId === 'none') return;
  const cost = calculateCost(modelId, usage.inputTokens || 0, usage.outputTokens || 0);
  tracker.total += cost;
  await pool.query(`UPDATE contract_reviews SET "costUsd"=$1 WHERE id=$2`, [tracker.total, reviewId]);
  if (tracker.total > MAX_REVIEW_COST_USD) {
    throw new CostCeilingExceededError(tracker.total);
  }
}

module.exports = { createCostTracker, trackCost, CostCeilingExceededError, MAX_REVIEW_COST_USD, LLM_CALL_TIMEOUT_MS };
