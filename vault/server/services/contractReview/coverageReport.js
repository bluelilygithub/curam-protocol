'use strict';

// Contract Review — Pipeline stage 11 (Coverage report). "Not found"
// (genuinely absent) and "could not assess" (segmentation/OCR failure) are
// visibly distinct — this is what "missing protections" flags are built
// from.

const { pool } = require('../../db');
const { getExpectedClauseTypes } = require('./coverageExpectations');

async function buildCoverageReport(reviewId, contractType) {
  const expectedTypes = getExpectedClauseTypes(contractType);
  if (!expectedTypes.length) {
    await pool.query(`UPDATE contract_reviews SET "coverageReport"=$1 WHERE id=$2`, [JSON.stringify([]), reviewId]);
    return [];
  }

  const { rows: [review] } = await pool.query(`SELECT "segmentationMethod" FROM contract_reviews WHERE id=$1`, [reviewId]);
  const { rows: clauses } = await pool.query(
    `SELECT cl.id, ct.key AS "clauseTypeKey"
     FROM contract_clauses cl
     LEFT JOIN contract_clause_types ct ON ct.id = cl."clauseTypeId"
     WHERE cl."reviewId"=$1`,
    [reviewId]
  );
  const foundKeys = new Set(clauses.map((c) => c.clauseTypeKey).filter(Boolean));
  // A document with essentially no recognized structure (LLM boundary
  // fallback with zero clauses classified) can't distinguish "genuinely
  // absent" from "we couldn't assess it" — segmentation/classification
  // itself may have failed to surface the relevant text at all.
  const couldNotAssess = clauses.length === 0 || (review?.segmentationMethod === 'llm' && foundKeys.size === 0);

  const report = expectedTypes.map((clauseType) => {
    if (foundKeys.has(clauseType)) {
      return { clauseType, status: 'found', reason: null };
    }
    if (couldNotAssess) {
      return { clauseType, status: 'could_not_assess', reason: 'Segmentation/classification could not reliably identify clauses in this document.' };
    }
    return { clauseType, status: 'not_found', reason: `No ${clauseType.replace(/_/g, ' ')} clause was identified in this document.` };
  });

  await pool.query(`UPDATE contract_reviews SET "coverageReport"=$1 WHERE id=$2`, [JSON.stringify(report), reviewId]);
  return report;
}

module.exports = { buildCoverageReport };
