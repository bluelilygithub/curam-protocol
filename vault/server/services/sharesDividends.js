'use strict';

// Dividend income summary — "board view" of dividends, built on the
// statement-import feature (docs/shares-statement-import.md). Aggregate +
// per-symbol + monthly, all pre-computed server-side (never left for a
// prompt/UI to sum) from share_cash_ledger type='dividend' rows.

const { pool } = require('../db');

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

// AU financial year: 1 July - 30 June. This app is AUD-denominated
// throughout (CLAUDE.md: "All prices entered in AUD") and the one real
// broker in use (CMC Markets) is AU — AU FY is the meaningful boundary for
// a dividend/withholding summary, not calendar year.
function auFinancialYearStart(todayStr) {
  const [y, m] = todayStr.slice(0, 7).split('-').map(Number);
  const fyStartYear = m >= 7 ? y : y - 1;
  return `${fyStartYear}-07-01`;
}

async function getDividendSummary(userId, todayStr) {
  const { rows } = await pool.query(
    `SELECT "amountAud", "withholdingTaxAud", symbol, "createdAt"
     FROM share_cash_ledger WHERE "userId"=$1 AND type='dividend'
     ORDER BY "createdAt" DESC`,
    [userId]
  );

  const calendarYearStart = `${todayStr.slice(0, 4)}-01-01`;
  const fyStart = auFinancialYearStart(todayStr);
  const last30Cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let last30DaysAud = 0, calendarYtdAud = 0, fyToDateAud = 0, fyWithholdingTaxAud = 0;
  const bySymbolMap = new Map();
  const monthlyMap = new Map(); // 'YYYY-MM' -> total

  for (const r of rows) {
    const amt = Number(r.amountAud) || 0;
    const wh = Number(r.withholdingTaxAud) || 0;
    const dateStr = String(r.createdAt).slice(0, 10);
    const month = dateStr.slice(0, 7);

    if (new Date(r.createdAt).getTime() >= last30Cutoff) last30DaysAud += amt;
    if (dateStr >= calendarYearStart) calendarYtdAud += amt;
    if (dateStr >= fyStart) { fyToDateAud += amt; fyWithholdingTaxAud += wh; }

    const sym = r.symbol || 'Unknown';
    const symEntry = bySymbolMap.get(sym) || { symbol: sym, totalAud: 0, count: 0 };
    symEntry.totalAud += amt;
    symEntry.count += 1;
    bySymbolMap.set(sym, symEntry);

    monthlyMap.set(month, (monthlyMap.get(month) || 0) + amt);
  }

  const bySymbol = [...bySymbolMap.values()]
    .sort((a, b) => b.totalAud - a.totalAud)
    .map((s) => ({ ...s, totalAud: round2(s.totalAud) }));

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, totalAud]) => ({ month, totalAud: round2(totalAud) }));

  return {
    totalCount: rows.length,
    last30DaysAud: round2(last30DaysAud),
    calendarYtdAud: round2(calendarYtdAud),
    fyToDateAud: round2(fyToDateAud),
    fyWithholdingTaxAud: round2(fyWithholdingTaxAud),
    fyStart,
    bySymbol,
    monthly,
    // rows is already ordered DESC by createdAt — cheap to slice, avoids a
    // second query for the Portfolio Note prompt's "recent" list.
    recent: rows.slice(0, 10).map((r) => ({
      amountAud: round2(Number(r.amountAud)), symbol: r.symbol,
      date: String(r.createdAt).slice(0, 10),
    })),
  };
}

module.exports = { getDividendSummary, auFinancialYearStart };
