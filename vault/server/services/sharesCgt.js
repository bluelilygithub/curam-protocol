'use strict';

// Capital gains by parcel — pure calculation (no DB, no network) so it can be unit tested.
//
// Assumptions (all shown on the CGT tab; confirm with an accountant):
//  - Parcels are matched FIFO: a sale uses the oldest unsold purchase first (the ATO default
//    when parcels aren't specifically identified). The Portfolio tab's "Realised P&L" uses
//    average cost instead, so the two will differ.
//  - Dates are TRADE dates (tradedAt), never settlement dates, read as the calendar day in the
//    workspace timezone (the form stores the exact instant, so the AU day is what was traded).
//  - Prices are the AUD figures stored on each trade (CMC's AUD settlement figures), used as-is.
//    No exchange-rate conversion happens here.
//  - Cost = qty x price + brokerage on the buy; proceeds = qty x price - brokerage on the sell.
//  - 12-month discount test: neither the day of acquisition nor the day of sale counts. Bought
//    1 Jan 2025 -> the first eligible sale date is 2 Jan 2026 (see discountEligibleFrom).
//  - The discount is 50% (an individual). Prior-year capital losses are not included.

const DISCOUNT_RATE = 0.5;
const QTY_EPS = 1e-8;

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => Math.round(c) / 100;

// ── dates (all 'YYYY-MM-DD' strings) ────────────────────────────────────────────────────
function tradeDate(tradedAt, tz) {
  const d = tradedAt instanceof Date ? tradedAt : new Date(tradedAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// Same calendar day one year on. A 29 Feb acquisition has no such day next year, so it clamps
// to 28 Feb (end-of-month convention) — a leap-day edge worth confirming with an accountant.
function addOneYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = (m === 2 && d === 29) ? 28 : d;
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// First sale date that qualifies for the discount: the day AFTER the first anniversary, because
// the acquisition day and the sale day are both excluded from the 12 months.
//   acquired 2025-01-01 -> anniversary 2026-01-01 -> first eligible sale 2026-01-02
function discountEligibleFrom(acquiredOn) {
  return addDays(addOneYear(acquiredOn), 1);
}

function isDiscountEligible(acquiredOn, soldOn) {
  return soldOn >= discountEligibleFrom(acquiredOn);
}

// Australian financial year (1 Jul - 30 Jun) as '2025-26'.
function fyLabel(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ── FIFO matching ───────────────────────────────────────────────────────────────────────
function buildCgt(trades, tz, { today } = {}) {
  const warnings = [];
  const disposals = [];
  const parcelsByKey = new Map(); // 'SYMBOL:EXCHANGE' -> FIFO queue of open parcels

  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradedAt) - new Date(b.tradedAt) || Number(a.id) - Number(b.id)
  );

  let usdCount = 0;

  for (const t of sorted) {
    const date = tradeDate(t.tradedAt, tz);
    if (!date) { warnings.push(`Trade #${t.id} (${t.symbol}) has an unreadable date and was skipped.`); continue; }
    if (t.currency === 'USD') usdCount += 1;

    const key = `${t.symbol}:${t.exchange}`;
    const qty = Number(t.quantity) || 0;
    const price = Number(t.pricePerShare) || 0;
    const fees = Number(t.feesAud) || 0;
    if (qty <= 0) continue;

    if (t.side === 'buy') {
      const totalCostCents = toCents(qty * price) + toCents(fees);
      if (!parcelsByKey.has(key)) parcelsByKey.set(key, []);
      parcelsByKey.get(key).push({
        tradeId: t.id, symbol: t.symbol, exchange: t.exchange, acquiredOn: date,
        qtyOriginal: qty, qtyRemaining: qty, totalCostCents, costRemainingCents: totalCostCents,
      });
      continue;
    }

    // sell: consume the oldest parcels first
    const queue = parcelsByKey.get(key) || [];
    const netCents = toCents(qty * price) - toCents(fees);
    let sellRemaining = qty;
    let allocatedCents = 0;

    while (sellRemaining > QTY_EPS && queue.length) {
      const parcel = queue[0];
      const take = Math.min(parcel.qtyRemaining, sellRemaining);
      const parcelDone = take >= parcel.qtyRemaining - QTY_EPS;
      const saleDone = take >= sellRemaining - QTY_EPS;

      const costCents = parcelDone
        ? parcel.costRemainingCents
        : Math.min(parcel.costRemainingCents, Math.round((parcel.totalCostCents * take) / parcel.qtyOriginal));
      // The portion that finishes a fully matched sale takes the remainder, so the rows for one
      // sale always add up to exactly its net proceeds (no lost cents).
      const proceedsCents = saleDone
        ? netCents - allocatedCents
        : Math.round((netCents * take) / qty);

      const gainCents = proceedsCents - costCents;
      const eligible = isDiscountEligible(parcel.acquiredOn, date);
      disposals.push({
        key: `${t.id}-${parcel.tradeId}`,
        symbol: t.symbol, exchange: t.exchange,
        sellTradeId: t.id, parcelTradeId: parcel.tradeId,
        acquiredOn: parcel.acquiredOn, soldOn: date,
        quantity: Math.round(take * 1e6) / 1e6,
        costAud: fromCents(costCents), proceedsAud: fromCents(proceedsCents), gainAud: fromCents(gainCents),
        daysHeld: diffDays(parcel.acquiredOn, date),
        discountEligible: eligible,
        eligibleFrom: discountEligibleFrom(parcel.acquiredOn),
        discountedGainAud: eligible && gainCents > 0 ? fromCents(gainCents - Math.round(gainCents * DISCOUNT_RATE)) : fromCents(gainCents),
        fy: fyLabel(date),
      });

      allocatedCents += proceedsCents;
      parcel.qtyRemaining -= take;
      parcel.costRemainingCents -= costCents;
      sellRemaining -= take;
      if (parcel.qtyRemaining <= QTY_EPS) queue.shift();
    }

    if (sellRemaining > QTY_EPS) {
      warnings.push(
        `Sold ${Math.round(sellRemaining * 1e6) / 1e6} more ${t.symbol} (${t.exchange}) on ${date} than the purchases on record — ` +
        'that quantity has no cost base here. A buy is probably missing or dated after the sale.'
      );
    }
  }

  if (usdCount) {
    warnings.push(`${usdCount} trade(s) are marked USD; their stored prices were used as AUD like the rest of the app. Check them.`);
  }

  // Parcels still held: when do they qualify for the discount?
  const openParcels = [];
  for (const queue of parcelsByKey.values()) {
    for (const p of queue) {
      if (p.qtyRemaining <= QTY_EPS) continue;
      const eligibleFrom = discountEligibleFrom(p.acquiredOn);
      openParcels.push({
        symbol: p.symbol, exchange: p.exchange, parcelTradeId: p.tradeId, acquiredOn: p.acquiredOn,
        quantity: Math.round(p.qtyRemaining * 1e6) / 1e6,
        costAud: fromCents(p.costRemainingCents),
        eligibleFrom,
        discountEligibleNow: today ? today >= eligibleFrom : null,
        daysUntilEligible: today ? Math.max(0, diffDays(today, eligibleFrom)) : null,
      });
    }
  }
  openParcels.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.acquiredOn.localeCompare(b.acquiredOn) || a.parcelTradeId - b.parcelTradeId);

  disposals.sort((a, b) => b.soldOn.localeCompare(a.soldOn) || a.symbol.localeCompare(b.symbol) || a.acquiredOn.localeCompare(b.acquiredOn));

  return { disposals, openParcels, warnings };
}

// Indicative net capital gain for a set of disposals (one FY): current-year losses are applied
// to gains that DON'T qualify for the discount first (the better order for the taxpayer), then
// to discount-eligible gains, and the discount is applied to what's left. Not tax advice.
function summariseDisposals(disposals) {
  let discountable = 0, other = 0, losses = 0, proceeds = 0, cost = 0;
  for (const d of disposals) {
    const g = toCents(d.gainAud);
    proceeds += toCents(d.proceedsAud); cost += toCents(d.costAud);
    if (g < 0) losses += -g;
    else if (d.discountEligible) discountable += g;
    else other += g;
  }
  const lossAfterOther = Math.max(0, losses - other);
  const otherRemaining = Math.max(0, other - losses);
  const discountableRemaining = Math.max(0, discountable - lossAfterOther);
  const unappliedLoss = Math.max(0, lossAfterOther - discountable);
  const discountAmount = Math.round(discountableRemaining * DISCOUNT_RATE);
  const netCapitalGain = otherRemaining + discountableRemaining - discountAmount;
  return {
    disposalCount: disposals.length,
    proceedsAud: fromCents(proceeds),
    costAud: fromCents(cost),
    gainsDiscountableAud: fromCents(discountable),
    gainsOtherAud: fromCents(other),
    lossesAud: fromCents(losses),
    discountAmountAud: fromCents(discountAmount),
    netCapitalGainAud: fromCents(netCapitalGain),
    lossCarriedForwardAud: fromCents(unappliedLoss),
  };
}

module.exports = {
  buildCgt, summariseDisposals,
  tradeDate, addOneYear, discountEligibleFrom, isDiscountEligible, fyLabel, diffDays, addDays,
  DISCOUNT_RATE,
};
