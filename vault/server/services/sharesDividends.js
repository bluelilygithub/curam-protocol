'use strict';

// Dividend income — gross / withholding / net "board view", built on the
// statement-import feature (docs/shares-statement-import.md). Everything is
// pre-computed server-side (never left for a prompt/UI to sum) from
// share_cash_ledger type='dividend' rows.
//
// Column semantics (share_cash_ledger, type='dividend'):
//   amountAud          NET — cash actually received. computeCashFromActivity() adds this
//                      to cash, so it must stay net or cash would be overstated.
//   grossAud           gross dividend before withholding. NULL = unknown.
//   withholdingTaxAud  tax withheld at source (gross - net).
//   withholdingRatePct the rate used/implied (15 = 15%).
//   grossDerived       TRUE when gross was calculated from net (CMC statements show net
//                      only), FALSE when read from a statement or entered by the user.
//   paidOn             payment date. Falls back to createdAt (approval time) when NULL.

const { pool } = require('../db');

const DEFAULT_US_WITHHOLDING_PCT = 15; // US-AU treaty rate with a current W-8BEN
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ']);
const WITHHOLDING_SETTING_KEY = 'shares_us_withholding_pct';

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
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

// gross = net / (1 - rate). Returns null for an impossible rate.
function deriveGross(netAud, ratePct) {
  const net = Number(netAud);
  const rate = Number(ratePct);
  if (!Number.isFinite(net) || !Number.isFinite(rate) || rate < 0 || rate >= 100) return null;
  const grossAud = round2(net / (1 - rate / 100));
  return { grossAud, withholdingTaxAud: round2(grossAud - net) };
}

// Per-user override of the default US rate (e.g. 30 if the W-8BEN turns out not to be in
// place). Stored in the generic settings table; no UI yet — set via POST /api/settings.
async function getUsWithholdingRatePct(userId) {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key=$2`, [userId, WITHHOLDING_SETTING_KEY]);
  const v = rows.length ? numOrNull(String(rows[0].value).replace(/[^0-9.]/g, '')) : null;
  return v != null && v >= 0 && v < 100 ? v : DEFAULT_US_WITHHOLDING_PCT;
}

// Which exchange a dividend symbol trades on, from the user's own trade history.
async function exchangeForSymbol(userId, symbol) {
  if (!symbol) return null;
  const { rows } = await pool.query(
    `SELECT exchange FROM share_trades WHERE "userId"=$1 AND symbol=$2 ORDER BY "tradedAt" DESC LIMIT 1`,
    [userId, symbol]
  );
  return rows[0]?.exchange || null;
}

// Gross-up for a net-only dividend. US-listed => default US rate; ASX => 0% (no US withholding;
// franking is separate). Unknown exchange => null: never guess a tax rate for a symbol we
// can't place.
async function deriveDividendTax(userId, symbol, netAud) {
  const exchange = await exchangeForSymbol(userId, symbol);
  if (!exchange) return null;
  const rate = US_EXCHANGES.has(exchange) ? await getUsWithholdingRatePct(userId) : 0;
  const d = deriveGross(netAud, rate);
  if (!d) return null;
  return { ...d, withholdingRatePct: rate, grossDerived: true };
}

// Fields to write for a dividend coming off a statement line (parsedFields `f`). If the
// statement shows both gross and withholding they're used as-is (not derived); otherwise the
// net is taken and gross derived.
async function resolveImportedDividend(userId, f) {
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : null;
  const gross = numOrNull(f.grossAmountAud);
  const wh = numOrNull(f.withholdingTaxAud);
  if (gross != null && wh != null && gross >= wh && gross > 0) {
    return {
      netAud: round2(gross - wh), grossAud: round2(gross), withholdingTaxAud: round2(wh),
      withholdingRatePct: round2((wh / gross) * 100), grossDerived: false, paidOn,
    };
  }
  const netAud = numOrNull(f.amount);
  const tax = netAud != null ? await deriveDividendTax(userId, f.symbol, netAud) : null;
  return {
    netAud,
    grossAud: tax?.grossAud ?? null,
    withholdingTaxAud: tax?.withholdingTaxAud ?? null,
    withholdingRatePct: tax?.withholdingRatePct ?? null,
    grossDerived: tax ? true : false,
    paidOn,
  };
}

// Manual edit of a dividend's tax figures. `net` is the (possibly just-edited) cash received.
// Entering a gross wins and is NOT flagged derived; entering only a rate derives the gross
// (still flagged derived — it is a calculation, not a reading). Returns null when neither was
// supplied (caller keeps/refreshes existing figures).
function resolveDividendEdit(netAud, { grossAud, withholdingRatePct }) {
  const gross = numOrNull(grossAud);
  const rate = numOrNull(withholdingRatePct);
  if (gross != null) {
    if (gross < netAud - 0.005) throw httpError(`Gross (${gross.toFixed(2)}) can't be less than the net received (${netAud.toFixed(2)})`);
    const wh = round2(gross - netAud);
    return { grossAud: round2(gross), withholdingTaxAud: wh, withholdingRatePct: gross > 0 ? round2((wh / gross) * 100) : 0, grossDerived: false };
  }
  if (rate != null) {
    const d = deriveGross(netAud, rate);
    if (!d) throw httpError('Withholding rate must be 0 or more and under 100');
    return { ...d, withholdingRatePct: rate, grossDerived: true };
  }
  return null;
}

async function getDividendSummary(userId, todayStr) {
  const { rows } = await pool.query(
    `SELECT id, "amountAud", "grossAud", "withholdingTaxAud", "grossDerived", symbol,
            COALESCE("paidOn", "createdAt"::date)::text AS "paidOn"
     FROM share_cash_ledger WHERE "userId"=$1 AND type='dividend'
     ORDER BY COALESCE("paidOn", "createdAt"::date) DESC, id DESC`,
    [userId]
  );

  const calendarYearStart = `${todayStr.slice(0, 4)}-01-01`;
  const fyStart = auFinancialYearStart(todayStr);
  const last30Cutoff = new Date(`${todayStr}T00:00:00Z`);
  last30Cutoff.setUTCDate(last30Cutoff.getUTCDate() - 30);
  const last30Start = last30Cutoff.toISOString().slice(0, 10);

  const zero = () => ({ gross: 0, net: 0, wh: 0 });
  const last30 = zero(), calYtd = zero(), fy = zero();
  const bySymbolMap = new Map();
  const monthlyMap = new Map(); // 'YYYY-MM' -> { gross, net, wh }
  let derivedCount = 0, missingGrossCount = 0;

  const add = (t, x) => { t.gross += x.gross; t.net += x.net; t.wh += x.wh; };

  const items = rows.map((r) => {
    const net = Number(r.amountAud) || 0;
    const hasGross = r.grossAud != null;
    const gross = hasGross ? Number(r.grossAud) : net; // unknown gross => count net, never invent tax
    const wh = r.withholdingTaxAud != null ? Number(r.withholdingTaxAud) : (hasGross ? gross - net : 0);
    if (r.grossDerived) derivedCount += 1;
    if (!hasGross) missingGrossCount += 1;
    return { r, x: { gross, net, wh }, date: r.paidOn };
  });

  for (const { r, x, date } of items) {
    if (date >= last30Start) add(last30, x);
    if (date >= calendarYearStart) add(calYtd, x);
    if (date >= fyStart) add(fy, x);

    const sym = r.symbol || 'Unknown';
    const s = bySymbolMap.get(sym) || { symbol: sym, ...zero(), count: 0 };
    add(s, x); s.count += 1;
    bySymbolMap.set(sym, s);

    const month = date.slice(0, 7);
    const m = monthlyMap.get(month) || zero();
    add(m, x);
    monthlyMap.set(month, m);
  }

  const bySymbol = [...bySymbolMap.values()]
    .sort((a, b) => b.gross - a.gross)
    .map((s) => ({ symbol: s.symbol, count: s.count, totalAud: round2(s.gross), netAud: round2(s.net), withholdingAud: round2(s.wh) }));

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({ month, totalAud: round2(m.gross), netAud: round2(m.net), withholdingAud: round2(m.wh) }));

  return {
    totalCount: rows.length,
    // *Aud totals are GROSS (before withholding); *NetAud is cash received.
    last30DaysAud: round2(last30.gross),
    last30DaysNetAud: round2(last30.net),
    calendarYtdAud: round2(calYtd.gross),
    calendarYtdNetAud: round2(calYtd.net),
    calendarYtdWithholdingAud: round2(calYtd.wh),
    fyToDateAud: round2(fy.gross),
    fyNetAud: round2(fy.net),
    fyWithholdingTaxAud: round2(fy.wh),
    fyStart,
    derivedCount,        // dividends whose gross was calculated from net
    missingGrossCount,   // dividends with no gross at all (counted at net)
    bySymbol,
    monthly,
    // items already ordered newest first — cheap to slice, avoids a second query for the
    // Portfolio Note prompt's "recent" list. amountAud kept (net) for the prompt's old shape.
    recent: items.slice(0, 10).map(({ r, x, date }) => ({
      amountAud: round2(x.net), netAud: round2(x.net), grossAud: round2(x.gross), withholdingTaxAud: round2(x.wh),
      derived: !!r.grossDerived, symbol: r.symbol, date,
    })),
  };
}

module.exports = {
  getDividendSummary, auFinancialYearStart,
  deriveGross, deriveDividendTax, resolveImportedDividend, resolveDividendEdit, getUsWithholdingRatePct,
  DEFAULT_US_WITHHOLDING_PCT, WITHHOLDING_SETTING_KEY,
};
