'use strict';

// Contract Review — one insert helper for contract_review_raw_outputs, used
// by every LLM-calling pipeline stage (3, 4, 5, 6, 7, 8, 9) so the raw
// response is always recorded regardless of stage outcome, per the spec's
// pipeline table note ("Every LLM call's raw response is stored... regardless
// of stage outcome").

const { pool } = require('../../db');

async function recordRawOutput({ reviewId, stage, modelId, promptVersion, rawResponse }) {
  await pool.query(
    `INSERT INTO contract_review_raw_outputs ("reviewId", stage, "modelId", "promptVersion", "rawResponse")
     VALUES ($1,$2,$3,$4,$5)`,
    [reviewId, stage, modelId || 'none', promptVersion || 'v1', JSON.stringify(rawResponse === undefined ? null : rawResponse)]
  );
}

module.exports = { recordRawOutput };
