'use strict';

const { pool } = require('../db');
const { calculateCost } = require('../services/costCalculator');

async function logUsage({ userId, sessionId = null, model, inputTokens = 0, outputTokens = 0, feature }) {
  const inTokens = Number(inputTokens) || 0;
  const outTokens = Number(outputTokens) || 0;
  if (!userId || !model || (!inTokens && !outTokens)) return;

  const cost = calculateCost(model, inTokens, outTokens);
  pool.query(
    `INSERT INTO usage_logs (user_id, session_id, model_id, input_tokens, output_tokens, estimated_cost_usd, feature)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, sessionId, model, inTokens, outTokens, cost, feature || 'unknown']
  ).catch((err) => console.error('[usage] log error:', err.message));
}

module.exports = { logUsage };
