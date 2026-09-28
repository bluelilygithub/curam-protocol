'use strict';

// Contract Review — Pipeline stage 7 (Risk scoring). Runs per clause (not
// only classified ones — a clause with no matching taxonomy type can still
// be scored using general judgment; playbookPositionKey is null in that
// case). Model may answer "unclear" rather than being forced to a verdict —
// stored as riskLevel='unclear', never silently defaulted to 'standard'.
// Two guarantees enforced below, not just asked for in the prompt: (1) a
// parse failure or malformed response is never stored as 'unclear' — it
// throws, aborting the review with a real error, the same as any other
// pipeline failure; (2) a genuine 'unclear' verdict always carries a
// non-empty whyItMatters reason — a bare 'unclear' with nothing else is
// treated as a malformed response too.
//
// Runs SCORING_CONCURRENCY clauses at once (a simple worker-pool pull loop,
// not a fixed chunk-of-5-then-wait) rather than one after another — this is
// by far the slowest stage on any document with more than a handful of
// clauses, since every clause is its own model round-trip. `aborted` is
// checked at the top of each worker's loop so a failure stops OTHER workers
// from picking up NEW clauses (an in-flight call can't be cancelled anyway,
// so a couple of already-started calls may still land after the abort —
// acceptable, matches every other stage's "can't truly cancel a live LLM
// call" reality). Progress (current/total/etaSeconds) is written to
// contract_reviews.stageProgress after every completed clause so the client
// can show "Scoring clause X of Y" with an estimate, not just a fixed
// "scoring" stage label.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { callModelForJson } = require('./callModelForJson');
const { getPlaybook, PLAYBOOK_VERSION, PLAYBOOK_HASH } = require('./playbooks');
const { riskScoringPrompt, PROMPT_VERSION } = require('./prompts/v1');

const RISK_LEVELS = new Set(['standard', 'risky', 'unclear']);
const SCORING_CONCURRENCY = Number(process.env.CONTRACT_REVIEW_SCORING_CONCURRENCY) || 5;

async function scoreOneClause(clause, { reviewId, positions, relevantDefinitions, extractedText, role, resolved, modelId, costTracker }) {
  let riskLevel = 'unclear';
  let whyItMatters = null;
  let playbookPositionKey = null;
  let suggestedRedline = null;

  if (resolved) {
    const prompt = riskScoringPrompt(clause, positions, relevantDefinitions, extractedText, role);
    // Truncation (maxTokens too small for a risky clause's genuine
    // suggestedRedline — the column allows up to 4000 chars for that field
    // alone) was independently hit at 500, then 1200, then 2500 as bigger
    // documents kept needing more — callModelForJson now retries with
    // doubled tokens on a shape failure instead of a fixed guess that's
    // only ever right until the next bigger document.
    const parsed = await callModelForJson({
      reviewId, modelId: resolved, prompt, maxTokens: 1200, timeoutMs: LLM_CALL_TIMEOUT_MS,
      stage: 'scoring', promptVersion: PROMPT_VERSION, costTracker,
      isValid: (p) => p && typeof p === 'object' && RISK_LEVELS.has(p.riskLevel),
      describeFailure: `Risk scoring for clause ${clause.id}`,
    });

    // A genuine "unclear" verdict must always say what couldn't be
    // determined (e.g. "depends on the Schedule, which isn't included") —
    // enforced here, not left to the prompt alone, since only the prompt
    // asking nicely doesn't guarantee the model complies every time. This
    // is a SEMANTIC completeness check, not a shape/truncation one — more
    // tokens can't fix a model that structurally succeeded but omitted the
    // reason, so it's checked here (immediate throw), not inside
    // callModelForJson's retry loop (which would just waste calls).
    const rawReason = parsed.whyItMatters ? String(parsed.whyItMatters).trim() : '';
    if (parsed.riskLevel === 'unclear' && !rawReason) {
      throw new Error(`Risk scoring failed for clause ${clause.id}: model rated 'unclear' with no reason given`);
    }

    riskLevel = parsed.riskLevel;
    whyItMatters = rawReason ? rawReason.slice(0, 2000) : null;
    playbookPositionKey = parsed.playbookPositionKey && positions[parsed.playbookPositionKey] ? parsed.playbookPositionKey : null;
    suggestedRedline = parsed.suggestedRedline ? String(parsed.suggestedRedline).slice(0, 4000) : null;
  }

  await pool.query(
    `UPDATE contract_clauses SET "riskLevel"=$1, "whyItMatters"=$2, "playbookPositionKey"=$3, "suggestedRedline"=$4 WHERE id=$5`,
    [riskLevel, whyItMatters, playbookPositionKey, suggestedRedline, clause.id]
  );
}

async function scoreClauses(reviewId, { contractType, role, userId, extractedText, costTracker }) {
  const { rows: allClauses } = await pool.query(
    `SELECT id, text, "isContextOnly" FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]
  );
  // Preamble/recitals/signature-block clauses have nothing to assess —
  // scoring them always landed on riskLevel='unclear' (no playbook position
  // ever matches a title block), which read as a real flag to a reviewer.
  // Left at their column defaults (riskLevel NULL) so the UI can render them
  // as "context only" rather than an assessed-but-inconclusive clause.
  const clauses = allClauses.filter((c) => !c.isContextOnly);
  const { rows: definitions } = await pool.query(
    `SELECT term, definition FROM contract_definitions WHERE "reviewId"=$1`, [reviewId]
  );
  const { key: playbookKey, positions } = getPlaybook(contractType, role);

  await pool.query(
    `UPDATE contract_reviews SET "playbookKey"=$1, "playbookVersion"=$2, "playbookHash"=$3 WHERE id=$4`,
    [playbookKey, PLAYBOOK_VERSION, PLAYBOOK_HASH, reviewId]
  );

  if (!clauses.length) return { scored: 0 };
  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const modelId = resolved || 'none';

  const total = clauses.length;
  let completed = 0;
  const startedAt = Date.now();

  async function updateProgress() {
    const elapsedMs = Date.now() - startedAt;
    const avgMs = completed > 0 ? elapsedMs / completed : null;
    const etaSeconds = avgMs != null ? Math.round((avgMs * (total - completed)) / 1000) : null;
    await pool.query(
      `UPDATE contract_reviews SET "stageProgress"=$1 WHERE id=$2`,
      [JSON.stringify({ stage: 'scoring', current: completed, total, etaSeconds }), reviewId]
    );
  }
  await updateProgress(); // "0 of N" visible immediately, before the first clause completes

  let nextIndex = 0;
  let aborted = false;
  let firstError = null;

  async function worker() {
    while (!aborted) {
      const myIndex = nextIndex;
      if (myIndex >= clauses.length) return;
      nextIndex += 1;
      const clause = clauses[myIndex];
      const relevantDefinitions = definitions.filter((d) => clause.text.includes(d.term));
      try {
        await scoreOneClause(clause, { reviewId, positions, relevantDefinitions, extractedText, role, resolved, modelId, costTracker });
        completed += 1;
        await updateProgress();
      } catch (err) {
        aborted = true;
        if (!firstError) firstError = err;
        return;
      }
    }
  }

  const workerCount = Math.min(SCORING_CONCURRENCY, clauses.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) throw firstError;

  return { scored: completed, total };
}

module.exports = { scoreClauses };
