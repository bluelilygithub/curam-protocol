'use strict';

// The "what will this cost?" note shown before a paid Graphics tool runs. Pure: the route works out the
// price of one run and what has been spent, and this puts them together. A job of several runs (a batch,
// later a recipe) uses the same function with runs > 1, so the total and the daily-limit check cover the
// whole job and are known before the first run starts.

/**
 * @param {object} p
 * @param {number|null} p.perRunUsd  price of one run; 0 = free (runs on this machine); null = no price known
 * @param {number} [p.runs=1]
 * @param {number} p.spentUsd        spent on paid graphics tools in the last 24 hours
 * @param {number} p.capUsd          daily limit; 0 = no limit
 * @param {boolean} [p.estimate]     the price is a best guess, not a fixed rate
 */
function buildCostPreview({ perRunUsd, runs = 1, spentUsd, capUsd, estimate = false }) {
  const count = Math.max(1, Math.floor(Number(runs) || 1));
  const free = perRunUsd === 0;
  const unknown = perRunUsd == null;
  const totalUsd = unknown ? null : Number((perRunUsd * count).toFixed(4));
  const hasCap = capUsd > 0;
  const spent = Number(Number(spentUsd || 0).toFixed(4));
  const remainingUsd = hasCap ? Number(Math.max(0, capUsd - spent).toFixed(4)) : null;
  return {
    free,
    unknown,
    estimate: Boolean(estimate) && !free,
    runs: count,
    perRunUsd: unknown ? null : perRunUsd,
    totalUsd,
    spentUsd: spent,
    capUsd: hasCap ? capUsd : null,
    remainingUsd,
    // Over the limit already: the next job is refused.
    blocked: hasCap && !free && spent >= capUsd,
    // Allowed to start, but this job would take the day's spending past the limit.
    overLimit: hasCap && totalUsd != null && !free && spent < capUsd && spent + totalUsd > capUsd,
  };
}

module.exports = { buildCostPreview };
