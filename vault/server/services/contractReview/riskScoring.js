'use strict';

// Contract Review — Pipeline stage 7 (Risk scoring). Runs per clause (not
// only classified ones — a clause with no matching taxonomy type can still
// be scored using general judgment; playbookPositionKey is null in that
// case). Model may answer "unclear" rather than being forced to a verdict —
// stored as riskLevel='unclear', never silently defaulted to 'standard'.

const { pool } = require('../../db');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { getPlaybook, PLAYBOOK_VERSION, PLAYBOOK_HASH } = require('./playbooks');
const { riskScoringPrompt, PROMPT_VERSION } = require('./prompts/v1');

const RISK_LEVELS = new Set(['standard', 'risky', 'unclear']);

async function scoreClauses(reviewId, { contractType, role, userId, extractedText }) {
  const { rows: clauses } = await pool.query(
    `SELECT id, text FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]
  );
  const { rows: definitions } = await pool.query(
    `SELECT term, definition FROM contract_definitions WHERE "reviewId"=$1`, [reviewId]
  );
  const { key: playbookKey, positions } = getPlaybook(contractType, role);

  await pool.query(
    `UPDATE contract_reviews SET "playbookKey"=$1, "playbookVersion"=$2, "playbookHash"=$3 WHERE id=$4`,
    [playbookKey, PLAYBOOK_VERSION, PLAYBOOK_HASH, reviewId]
  );

  if (!clauses.length) return { scored: 0 };
  const { standard } = await getModelsForUser(userId);
  const modelId = standard || 'none';
  let scored = 0;

  for (const clause of clauses) {
    const relevantDefinitions = definitions.filter((d) => clause.text.includes(d.term));
    let riskLevel = 'unclear';
    let whyItMatters = null;
    let playbookPositionKey = null;
    let suggestedRedline = null;

    if (standard) {
      try {
        const prompt = riskScoringPrompt(clause, positions, relevantDefinitions, extractedText);
        const text = await callModel(standard, prompt, { maxTokens: 500 });
        const parsed = parseModelJson(text);
        await recordRawOutput({ reviewId, stage: 'scoring', modelId, promptVersion: PROMPT_VERSION, rawResponse: { clauseId: clause.id, prompt: prompt.slice(0, 500), text, parsed } });
        if (parsed && typeof parsed === 'object') {
          if (RISK_LEVELS.has(parsed.riskLevel)) riskLevel = parsed.riskLevel;
          whyItMatters = parsed.whyItMatters ? String(parsed.whyItMatters).slice(0, 2000) : null;
          playbookPositionKey = parsed.playbookPositionKey && positions[parsed.playbookPositionKey] ? parsed.playbookPositionKey : null;
          suggestedRedline = parsed.suggestedRedline ? String(parsed.suggestedRedline).slice(0, 4000) : null;
        }
      } catch (err) {
        console.warn(`[contract-review] risk scoring failed for clause ${clause.id}: ${err.message}`);
        await recordRawOutput({ reviewId, stage: 'scoring', modelId, promptVersion: PROMPT_VERSION, rawResponse: { clauseId: clause.id, error: err.message } });
      }
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
