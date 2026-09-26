'use strict';

// Contract Review — Pipeline stage 6 (Clause classification). Regex-detected
// cross-references are recorded per clause as "referenced, not assessed" —
// resolved separately from LLM classification, matching the spec's
// distinction between the two.

const { pool } = require('../../db');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { clauseClassificationPrompt, PROMPT_VERSION } = require('./prompts/v1');

const TAXONOMY_VERSION = 'v1';

// Matches "Section 4.1", "Section 9", "Clause 3.1(a)", "Article IV" as a
// cross-reference TO another clause — recorded, never resolved/assessed.
const CROSS_REF_RE = /\b(Section|Clause|Article)\s+([0-9]+(?:\.[0-9]+)?(?:\([a-z0-9ivx]+\))*|[IVXLC]+)\b/gi;

function detectCrossReferences(clauseText, ownNumberLabel) {
  const refs = [];
  const seen = new Set();
  let m;
  const re = new RegExp(CROSS_REF_RE);
  while ((m = re.exec(clauseText))) {
    const label = m[0].trim();
    if (ownNumberLabel && label.includes(ownNumberLabel)) continue; // don't flag a clause referencing its own label
    if (seen.has(label)) continue;
    seen.add(label);
    refs.push({ label, note: 'referenced, not assessed' });
  }
  return refs;
}

async function getClauseTypeIdMap() {
  const { rows } = await pool.query(
    `SELECT id, key FROM contract_clause_types WHERE "taxonomyVersion"=$1 AND active=TRUE`, [TAXONOMY_VERSION]
  );
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function classifyClauses(reviewId, userId) {
  const { rows: clauses } = await pool.query(
    `SELECT id, "numberLabel", text FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]
  );
  if (!clauses.length) return { classified: 0 };

  const typeIdByKey = await getClauseTypeIdMap();
  const { standard } = await getModelsForUser(userId);
  const modelId = standard || 'none';
  let classifications = [];

  if (standard) {
    try {
      const prompt = clauseClassificationPrompt(clauses, [...typeIdByKey.keys()]);
      const text = await callModel(standard, prompt, { maxTokens: 1500 });
      const parsed = parseModelJson(text);
      await recordRawOutput({ reviewId, stage: 'classifying', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
      if (parsed && Array.isArray(parsed.classifications)) classifications = parsed.classifications;
    } catch (err) {
      console.warn(`[contract-review] clause classification failed for review ${reviewId}: ${err.message}`);
      await recordRawOutput({ reviewId, stage: 'classifying', modelId, promptVersion: PROMPT_VERSION, rawResponse: { error: err.message } });
    }
  }

  const typeByClauseId = new Map(
    classifications
      .filter((c) => c && c.clauseId != null)
      .map((c) => [Number(c.clauseId), typeIdByKey.get(c.clauseType) || null])
  );

  let classified = 0;
  for (const clause of clauses) {
    const clauseTypeId = typeByClauseId.get(clause.id) || null;
    if (clauseTypeId) classified += 1;
    const crossReferences = detectCrossReferences(clause.text, clause.numberLabel);
    await pool.query(
      `UPDATE contract_clauses SET "clauseTypeId"=$1, "crossReferences"=$2 WHERE id=$3`,
      [clauseTypeId, JSON.stringify(crossReferences), clause.id]
    );
  }
  return { classified, total: clauses.length };
}

module.exports = { classifyClauses, detectCrossReferences, getClauseTypeIdMap };
