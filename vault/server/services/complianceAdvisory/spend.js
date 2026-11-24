'use strict';

// A force button is cheap but not free: one model call per run. The monthly cap is checked against the same
// usage_logs the Usage page reads (feature from the app config). See docs/shares-compliance.md and
// docs/finance-compliance.md.

const DEFAULT_CAP_USD = 1;
const DEFAULT_ESTIMATE_USD = 0.05;

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function monthStart(now = new Date()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function createSpend({ feature, envPrefix, appLabel = 'Finance' }) {
  const CAP_ENV = `${envPrefix}_MAX_COST_USD`;
  const ESTIMATE_ENV = `${envPrefix}_ESTIMATED_COST_USD`;

  function monthlyCapUsd(env = process.env) {
    return positiveNumber(env[CAP_ENV], DEFAULT_CAP_USD);
  }

  function estimateUsd(env = process.env) {
    return positiveNumber(env[ESTIMATE_ENV], DEFAULT_ESTIMATE_USD);
  }

  async function spendStatus(userId, { pool, env = process.env, now = new Date } = {}) {
    const db = pool || require('../../db').pool;
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0)::FLOAT AS total
         FROM usage_logs WHERE user_id=$1 AND created_at >= $2 AND feature=$3`,
      [userId, monthStart(now), feature]
    );
    const cap = monthlyCapUsd(env);
    const spent = Number(rows[0]?.total) || 0;
    const estimate = estimateUsd(env);
    return { spent, cap, estimate, remaining: Math.max(0, cap - spent) };
  }

  async function assertWithinCap(userId, options = {}) {
    const { spent, cap, estimate, remaining } = await spendStatus(userId, options);
    if (estimate > remaining) {
      const err = new Error(
        `This check would cost about US$${estimate.toFixed(3)}, but only US$${remaining.toFixed(3)} is left of this month's US$${cap.toFixed(2)} ${appLabel} compliance limit. Old usage ages out at the start of next month.`
      );
      err.status = 402;
      throw err;
    }
    return { spent, cap, estimate, remaining };
  }

  return { FEATURE: feature, monthlyCapUsd, estimateUsd, monthStart, spendStatus, assertWithinCap };
}

module.exports = { createSpend, DEFAULT_CAP_USD, DEFAULT_ESTIMATE_USD, positiveNumber, monthStart };
