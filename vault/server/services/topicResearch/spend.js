'use strict';

// Topic Research: what this person has spent this month, and whether the monthly limit has been reached. One place for the month boundary
// and for the "0 means no limit" rule, used by the page's banner, by the search (paid sources pause) and by brief writing (refused).
//
// Spend = the cost of search runs started this month (what the paid search sources charged: `topic_research_runs."apiCostEstimate"`, which
// is search sources only) + the cost of briefs made this month (`topic_research_briefs."costUsd"`) + the cost of drafts made this month
// (`topic_research_drafts."costUsd"`) + the cost of the small checks (relevance checks and trade-term suggestions, from the usage log). A brief's or
// draft's cost is NOT also added to its search or brief, or it would be counted twice. The month is the calendar month in UTC. Every number is an ESTIMATE: search prices are 0 until real
// per-query prices are set (BRAVE_PRICE_PER_QUERY_USD, SERP_PRICE_PER_QUERY_USD), so until then only briefs add to it.
// See docs/topic-research.md.

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** The first moment of this month, UTC. */
function monthStartUtc(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * @param limitUsd the person's limit (Settings -> monthlyBudgetUsd); 0 or less means no limit
 * @returns {{ monthStart, searchUsd, briefUsd, spentUsd, limitUsd, over, pricesSet }}
 */
async function monthSpend(pool, userId, limitUsd, { now = Date.now, env = process.env } = {}) {
  const start = monthStartUtc(now());
  const [{ rows: [s] }, { rows: [b] }, { rows: [d] }, { rows: [c] }] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM("apiCostEstimate"), 0) AS total FROM topic_research_runs WHERE "userId" = $1 AND "startedAt" >= $2`, [userId, start]),
    pool.query(`SELECT COALESCE(SUM("costUsd"), 0) AS total FROM topic_research_briefs WHERE "userId" = $1 AND "createdAt" >= $2`, [userId, start]),
    pool.query(`SELECT COALESCE(SUM("costUsd"), 0) AS total FROM topic_research_drafts WHERE "userId" = $1 AND "createdAt" >= $2`, [userId, start]),
    // the small model calls (is this article on topic, suggest trade words) have no table of their own: their cost is in the usage log
    pool.query(`SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM usage_logs WHERE user_id = $1 AND created_at >= $2 AND feature IN ('topic_research_relevance', 'topic_research_suggest')`, [userId, start]),
  ]);
  const searchUsd = round4(s?.total);
  const briefUsd = round4(b?.total);
  const draftUsd = round4(d?.total);
  const checkUsd = round4(c?.total);
  const spentUsd = round4(searchUsd + briefUsd + draftUsd + checkUsd);
  const limit = Number(limitUsd) > 0 ? Number(limitUsd) : 0;
  return {
    monthStart: start.toISOString(), searchUsd, briefUsd, draftUsd, checkUsd, spentUsd, limitUsd: limit,
    over: limit > 0 && spentUsd >= limit,
    pricesSet: Number(env.BRAVE_PRICE_PER_QUERY_USD) > 0 || Number(env.SERP_PRICE_PER_QUERY_USD) > 0,
  };
}

/** The sentence shown when the limit has been reached. */
function overBudgetMessage(spend) {
  return `This month's estimated spend ($${spend.spentUsd.toFixed(2)}) has reached your limit of $${spend.limitUsd.toFixed(2)}. Paid searches, new briefs and new drafts are paused. Raise the limit in Settings -> Topic Research, or wait until next month.`;
}

module.exports = { monthSpend, monthStartUtc, overBudgetMessage };
