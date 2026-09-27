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

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { trackCost, LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { getPlaybook, PLAYBOOK_VERSION, PLAYBOOK_HASH } = require('./playbooks');
const { riskScoringPrompt, PROMPT_VERSION } = require('./prompts/v1');

const RISK_LEVELS = new Set(['standard', 'risky', 'unclear']);

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
  let scored = 0;

  for (const clause of clauses) {
    const relevantDefinitions = definitions.filter((d) => clause.text.includes(d.term));
    let riskLevel = 'unclear';
    let whyItMatters = null;
    let playbookPositionKey = null;
    let suggestedRedline = null;

    if (resolved) {
      let parsed;
      try {
        const prompt = riskScoringPrompt(clause, positions, relevantDefinitions, extractedText, role);
        // 500 was tight enough to truncate a real response mid-JSON on a
        // risky clause needing a genuine suggestedRedline (the column allows
        // up to 4000 chars for that field alone) — especially on a smaller/
        // faster model, surfacing as "model response was not valid JSON"
        // once that stopped being silently swallowed as a bare 'unclear'.
        const result = await callModel(resolved, prompt, { maxTokens: 1200, returnUsage: true, timeoutMs: LLM_CALL_TIMEOUT_MS });
        const text = result.text;
        if (costTracker) await trackCost(costTracker, reviewId, modelId, result);
        parsed = parseModelJson(text);
        await recordRawOutput({ reviewId, stage: 'scoring', modelId, promptVersion: PROMPT_VERSION, rawResponse: { clauseId: clause.id, prompt: prompt.slice(0, 500), text, parsed } });
      } catch (err) {
        // Any failure aborts the whole review now — see definitionsExtraction.js's header comment for why.
        await recordRawOutput({ reviewId, stage: 'scoring', modelId, promptVersion: PROMPT_VERSION, rawResponse: { clauseId: clause.id, error: err.message } });
        throw err;
      }

      // A parse failure or a malformed response must never silently become
      // riskLevel='unclear' — that's indistinguishable from the model
      // genuinely weighing the clause and being unable to decide, which is a
      // real, useful signal to a reviewer. An unparseable response is a
      // pipeline error and must surface as one (review status='failed'),
      // same policy as the exception path just above.
      if (!parsed || typeof parsed !== 'object' || !RISK_LEVELS.has(parsed.riskLevel)) {
        const reason = !parsed || typeof parsed !== 'object'
          ? 'model response was not valid JSON'
          : `model returned an invalid riskLevel: ${JSON.stringify(parsed.riskLevel)}`;
        throw new Error(`Risk scoring failed for clause ${clause.id}: ${reason}`);
      }
      // A genuine "unclear" verdict must always say what couldn't be
      // determined (e.g. "depends on the Schedule, which isn't included") —
      // enforced here, not left to the prompt alone, since only the prompt
      // asking nicely doesn't guarantee the model complies every time.
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
    scored += 1;
  }
  return { scored, total: clauses.length };
}

module.exports = { scoreClauses };
