'use strict';

const VARIANCE_KEY = 'product_scout_price_variance_pct';
const DEFAULT_VARIANCE_PCT = 10;

/** @param {import('pg').Pool} pool */
async function getPriceVariancePct(pool) {
  const { rows } = await pool.query(
    'SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1',
    [VARIANCE_KEY]
  );
  const n = Number(rows[0]?.value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VARIANCE_PCT;
  return Math.min(100, n);
}

/** @param {import('pg').Pool} pool */
async function setPriceVariancePct(pool, pct) {
  const n = Math.min(100, Math.max(0, Number(pct) || 0));
  await pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [VARIANCE_KEY, String(n)]
  );
  return n;
}

/**
 * @param {{ price?: number|null, price_display?: string|null }} candidate
 * @returns {number|null}
 */
function parseNumericPrice(candidate) {
  if (typeof candidate?.price === 'number' && Number.isFinite(candidate.price)) {
    return candidate.price;
  }
  const raw = candidate?.price_display || '';
  const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Split candidates into in-budget (primary) and stretch (above budget, within variance ceiling).
 * @param {object[]} candidates
 * @param {number|null|undefined} maxPrice
 * @param {number} variancePct
 */
function applyBudgetFilter(candidates, maxPrice, variancePct) {
  const max = Number(maxPrice);
  if (!Number.isFinite(max) || max <= 0) {
    return { primary: [...candidates], stretch: [], budget: null };
  }

  const pct = Number.isFinite(variancePct) ? variancePct : DEFAULT_VARIANCE_PCT;
  const ceiling = Math.round(max * (1 + pct / 100) * 100) / 100;
  const primary = [];
  const stretch = [];

  for (const c of candidates) {
    const p = parseNumericPrice(c);
    const base = { ...c, price_numeric: p };
    if (p == null) {
      primary.push(base);
      continue;
    }
    if (p <= max) {
      primary.push(base);
    } else if (p <= ceiling) {
      stretch.push({
        ...base,
        over_budget_amount: Math.round((p - max) * 100) / 100,
        over_budget_pct: Math.round(((p - max) / max) * 1000) / 10,
      });
    }
  }

  return {
    primary,
    stretch,
    budget: { maxPrice: max, variancePct: pct, ceiling },
  };
}

module.exports = {
  VARIANCE_KEY,
  DEFAULT_VARIANCE_PCT,
  getPriceVariancePct,
  setPriceVariancePct,
  parseNumericPrice,
  applyBudgetFilter,
};
