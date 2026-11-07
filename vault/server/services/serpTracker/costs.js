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

/** Has this month's spend reached the cap? `over` is true when spent >= cap, so a cap of 0 blocks everything. Nothing is posted while it is true. */
async function capStatus(pool, localDateStr, env = process.env) {
  const cap = monthlyCapUsd(env);
  const spent = await monthSpend(pool, localDateStr, 0);
  return { cap, spent, over: spent >= cap };
}

// What one Live search is expected to cost, so the page can say so BEFORE it is made and the cap can refuse a search that would pass the limit.
// DataForSEO bills "per SERP of up to 10 results" and adds US$0.002 for the AI summary on Live searches (docs, 6 Nov 2026); one real search
// (top 10 with the AI summary) cost US$0.004, which leaves US$0.002 per 10 results. An ESTIMATE from list prices: the real cost is read from the
// answer and logged. If DataForSEO changes its prices, change these two numbers.
const LIVE_PER_TEN_RESULTS_USD = 0.002;
const AI_OVERVIEW_USD = 0.002;
function estimateLiveUsd(depth, aiOverview) {
  return Math.ceil(Number(depth) / 10) * LIVE_PER_TEN_RESULTS_USD + (aiOverview ? AI_OVERVIEW_USD : 0);
}

// Daily tracking uses DataForSEO's standard queue (task_post), billed per page of 10 results at about 30% of the Live price. From the one real queued
// task on 6 Nov 2026: depth 100 cost US$0.006, so US$0.0006 per 10 results (charged for what was asked, not for what came back). An ESTIMATE
// from that one price: the real cost of every post is read from the answer and logged. If DataForSEO changes its prices, change this number.
const QUEUED_PER_TEN_RESULTS_USD = 0.0006;
const TRACK_DEPTH_CAP = 30; // daily tracking reads at most the top 30: positions deeper than that are not actionable, and every extra page is billed
const MAX_TRACK_READS = 3; // a keyword that misses the site is read again, up to 3 reads in all, before it is called "not found"

/** Expected cost of one tracking pass over keywords x devices: `reads` is how many reads each one gets (1 = best case, MAX_TRACK_READS = every miss). */
function estimateTrackingUsd({ keywords, devices, depth, reads = 1 }) {
  const pages = Math.ceil(Math.min(Number(depth) || TRACK_DEPTH_CAP, TRACK_DEPTH_CAP) / 10);
  return Number(keywords) * Number(devices) * pages * QUEUED_PER_TEN_RESULTS_USD * Number(reads);
}

module.exports = { QUEUED_PER_TEN_RESULTS_USD, TRACK_DEPTH_CAP, MAX_TRACK_READS, estimateTrackingUsd, logCost, monthSpend, monthBounds, monthlyCapUsd, capStatus, estimateLiveUsd, LIVE_PER_TEN_RESULTS_USD, AI_OVERVIEW_USD, DEFAULT_CAP_USD };
