'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const TZ = 'Australia/Sydney';

/**
 * Build a WHERE clause fragment + params for a given period.
 * Returns { clause, params } where clause is like "AND created_at >= $N"
 * and params are appended to the existing param list.
 */
function periodClause(period, from, to, baseParamIndex) {
  let i = baseParamIndex;
  switch (period) {
    case 'today':
      return {
        clause: `AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`,
        params: [],
      };
    case 'week':
      return {
        clause: `AND created_at >= DATE_TRUNC('week', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`,
        params: [],
      };
    case 'month':
      return {
        clause: `AND created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`,
        params: [],
      };
    case 'quarter':
      return {
        clause: `AND created_at >= DATE_TRUNC('quarter', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`,
        params: [],
      };
    case 'year':
      return {
        clause: `AND created_at >= DATE_TRUNC('year', NOW() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`,
        params: [],
      };
    case 'custom':
      if (from && to) {
        return {
          clause: `AND created_at >= $${i}::timestamptz AND created_at < ($${i + 1}::timestamptz + INTERVAL '1 day')`,
          params: [from, to],
        };
      }
      return { clause: '', params: [] };
    case 'all':
    default:
      return { clause: '', params: [] };
  }
}

// GET /api/usage/summary?period=today|week|month|quarter|year|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'month';
    const { from, to } = req.query;

    const { clause, params } = periodClause(period, from, to, 2);
    const allParams = [userId, ...params];

    // Period totals
    const { rows } = await pool.query(`
      SELECT
        SUM(estimated_cost_usd)::FLOAT AS cost,
        SUM(input_tokens)::INT AS input_tokens,
        SUM(output_tokens)::INT AS output_tokens,
        SUM(input_tokens + output_tokens)::INT AS total_tokens,
        COUNT(*)::INT AS calls
      FROM usage_logs
      WHERE user_id = $1 ${clause}
    `, allParams);

    // Per-model breakdown for the period
    const { rows: modelRows } = await pool.query(`
      SELECT
        model_id,
        SUM(input_tokens)::INT AS input_tokens,
        SUM(output_tokens)::INT AS output_tokens,
        SUM(input_tokens + output_tokens)::INT AS total_tokens,
        SUM(estimated_cost_usd)::FLOAT AS cost,
        COUNT(*)::INT AS calls
      FROM usage_logs
      WHERE user_id = $1 ${clause}
      GROUP BY model_id
      ORDER BY cost DESC
      LIMIT 10
    `, allParams);

    // Daily breakdown for the period (for a bar chart)
    // Limit daily rows: for long periods group by week or month
    let dailyTrunc = 'day';
    if (period === 'year') dailyTrunc = 'week';
    if (period === 'all')  dailyTrunc = 'month';

    const { rows: dailyRows } = await pool.query(`
      SELECT
        DATE_TRUNC('${dailyTrunc}', created_at AT TIME ZONE '${TZ}')::DATE AS bucket,
        SUM(estimated_cost_usd)::FLOAT AS cost,
        SUM(input_tokens + output_tokens)::INT AS tokens,
        COUNT(*)::INT AS calls
      FROM usage_logs
      WHERE user_id = $1 ${clause}
      GROUP BY 1
      ORDER BY 1 ASC
    `, allParams);

    const summary = rows[0] || {};
    res.json({
      period,
      cost:         summary.cost         || 0,
      inputTokens:  summary.input_tokens  || 0,
      outputTokens: summary.output_tokens || 0,
      totalTokens:  summary.total_tokens  || 0,
      calls:        summary.calls         || 0,
      byModel: modelRows,
      daily:   dailyRows,
    });
  } catch (err) {
    console.error('[usage] summary error:', err);
    res.status(500).json({ error: 'Failed to fetch usage summary' });
  }
});

// GET /api/usage/log?period=...&from=&to=&page=1&limit=50
router.get('/log', async (req, res) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'all';
    const { from, to } = req.query;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const { clause, params } = periodClause(period, from, to, 2);
    const allParams = [userId, ...params];

    const { rows } = await pool.query(`
      SELECT id, session_id, model_id, input_tokens, output_tokens,
             estimated_cost_usd::FLOAT AS estimated_cost_usd, feature, created_at
      FROM usage_logs
      WHERE user_id = $1 ${clause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, allParams);

    const { rows: countRows } = await pool.query(`
      SELECT COUNT(*)::INT AS total FROM usage_logs WHERE user_id = $1 ${clause}
    `, allParams);

    res.json({ logs: rows, total: countRows[0]?.total || 0, page, limit });
  } catch (err) {
    console.error('[usage] log error:', err);
    res.status(500).json({ error: 'Failed to fetch usage log' });
  }
});

module.exports = router;
