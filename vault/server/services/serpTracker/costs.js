'use strict';

// SERP Tracker: the cost log and the monthly spending cap. Every paid (or free-but-metered) DataForSEO call writes one row to
// serp_api_costs. The cap protects the DataForSEO ACCOUNT, which is shared by the whole workspace, so spend is summed over every
// person's rows, not just the caller's. Months are calendar months of the Brisbane date (costDate), matching the reports.

const DEFAULT_CAP_USD = 5;

/** "2026-11-06" -> { start: "2026-11-01", next: "2026-12-01" } (pure string maths, no time zones involved). */
function monthBounds(localDateStr, monthsBack = 0) {
  const [y, m] = String(localDateStr).split('-').map(Number);
  const idx = y * 12 + (m - 1) - monthsBack;
  const fmt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
  return { start: fmt(idx), next: fmt(idx + 1) };
}

/** The monthly cap in US dollars from MAX_MONTHLY_SPEND_USD (default 5). A bad value falls back to the default, never to "no cap". */
function monthlyCapUsd(env = process.env) {
  const raw = env.MAX_MONTHLY_SPEND_USD;
  if (raw == null || String(raw).trim() === '') return DEFAULT_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP_USD;
}

async function logCost(pool, { userId, siteId = null, runId = null, costDate, endpoint, costUsd }) {
  await pool.query(
    'INSERT INTO serp_api_costs ("userId", "siteId", "runId", "costDate", endpoint, "costUsd") VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, siteId, runId, costDate, String(endpoint).slice(0, 200), Number(costUsd) || 0],
  );
}

/** Spend over the whole workspace in the calendar month containing `localDateStr` (monthsBack 1 = the month before). */
async function monthSpend(pool, localDateStr, monthsBack = 0) {
  const { start, next } = monthBounds(localDateStr, monthsBack);
  const { rows } = await pool.query('SELECT COALESCE(SUM("costUsd"), 0) AS spent FROM serp_api_costs WHERE "costDate" >= $1 AND "costDate" < $2', [start, next]);
  return Number(rows[0].spent);
}

module.exports = { logCost, monthSpend, monthBounds, monthlyCapUsd, DEFAULT_CAP_USD };
