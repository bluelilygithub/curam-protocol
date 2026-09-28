'use strict';

// Contract Review — Pipeline stage 6 (Clause classification). Regex-detected
// cross-references are recorded per clause as "referenced, not assessed" —
// resolved separately from LLM classification, matching the spec's
// distinction between the two.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { callModelForJson } = require('./callModelForJson');
const { clauseClassificationPrompt, PROMPT_VERSION } = require('./prompts/v1');

const TAXONOMY_VERSION = 'v1';

// Matches "Section 4.1", "Section 9", "Clause 3.1(a)", "Article IV" as a
// cross-reference TO another clause — recorded, never resolved/assessed.
const CROSS_REF_RE = /\b(Section|Clause|Article)\s+([0-9]+(?:\.[0-9]+)?(?:\([a-z0-9ivx]+\))*|[IVXLC]+)\b/gi;

// Own labels come in two shapes depending on which HEADING_PATTERNS entry
// produced them (segmentation.js): "Section 4"/"Article IV" (keyword +
// number) or bare "4.1"/"1." (no keyword). Detected cross-references always
// have the keyword prefix. Comparing the NUMBER portion only, exact (not
// substring), avoids both a false negative on the keyword mismatch and the
// false positive a substring check produces — "Section 14.1".includes("4.1")
// is true, which wrongly dropped a genuine reference to a different clause.
function stripKeywordPrefix(label) {
  return String(label || '').trim().replace(/^(Section|Clause|Article)\s+/i, '').replace(/\.$/, '');
}

function detectCrossReferences(clauseText, ownNumberLabel) {
  const refs = [];
  const seen = new Set();
  let m;
  const re = new RegExp(CROSS_REF_RE);
  const ownNumber = ownNumberLabel ? stripKeywordPrefix(ownNumberLabel) : null;
  while ((m = re.exec(clauseText))) {
    const label = m[0].trim();
    const number = (m[2] || '').trim();
    if (ownNumber && number.toUpperCase() === ownNumber.toUpperCase()) continue; // don't flag a clause referencing its own label
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

async function classifyClauses(reviewId, userId, costTracker) {
  const { rows: allClauses } = await pool.query(
    `SELECT id, "numberLabel", text, "isContextOnly" FROM contract_clauses WHERE "reviewId"=$1 ORDER BY ordinal`, [reviewId]
  );
  // Preamble/recitals/signature-block clauses are context only — no clause
  // type to classify, no cross-references worth resolving as findings.
  const clauses = allClauses.filter((c) => !c.isContextOnly);
  if (!clauses.length) return { classified: 0 };

  const typeIdByKey = await getClauseTypeIdMap();
  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const modelId = resolved || 'none';
  let classifications = [];

  if (resolved) {
    const prompt = clauseClassificationPrompt(clauses, [...typeIdByKey.keys()]);
    // Truncation (a document with 20+ real clauses — a services agreement
    // with dotted subclauses under every bare section heading easily has
    // this many) was independently hit at 1500, then 3000 — callModelForJson
    // now retries with doubled tokens on a shape failure instead of a fixed
    // guess. A parse failure must never be silently treated as "no clause
    // matched any type" — only a missing/malformed "classifications" array
    // is a real pipeline error.
    const parsed = await callModelForJson({
      reviewId, modelId: resolved, prompt, maxTokens: 1500, timeoutMs: LLM_CALL_TIMEOUT_MS,
      stage: 'classifying', promptVersion: PROMPT_VERSION, costTracker,
      isValid: (p) => Array.isArray(p.classifications),
      describeFailure: 'Clause classification',
    });
    classifications = parsed.classifications;
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
