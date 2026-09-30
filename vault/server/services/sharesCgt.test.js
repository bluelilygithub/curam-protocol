#!/usr/bin/env node
/**
 * CGT-by-parcel tests: the 12-month discount boundary (neither the purchase day nor the sale
 * day counts), trade-date (not settlement-date) handling, FIFO matching, cost/proceeds cent
 * accuracy and the indicative net-gain summary.
 *
 * Run: node server/services/sharesCgt.test.js
 */
'use strict';

const assert = require('assert');
const {
  buildCgt, summariseDisposals, tradeDate, discountEligibleFrom, isDiscountEligible, fyLabel,
} = require('./sharesCgt');

const TZ = 'Australia/Sydney';
let n = 0;
function test(name, fn) {
  try { fn(); n += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

let id = 0;
// A trade at 12:00 UTC = 22:00 (AEST) / 23:00 (AEDT) Sydney time — always the same calendar day in Sydney.
const at = (day) => `${day}T12:00:00Z`;
const buy = (day, qty, price, fees = 0, symbol = 'TSM', exchange = 'NYSE') =>
  ({ id: ++id, symbol, exchange, side: 'buy', quantity: qty, pricePerShare: price, feesAud: fees, currency: 'AUD', tradedAt: at(day) });
const sell = (day, qty, price, fees = 0, symbol = 'TSM', exchange = 'NYSE') =>
  ({ id: ++id, symbol, exchange, side: 'sell', quantity: qty, pricePerShare: price, feesAud: fees, currency: 'AUD', tradedAt: at(day) });

// ── the 12-month boundary ───────────────────────────────────────────────────────────────
test('bought 1 Jan 2025 -> first eligible sale is 2 Jan 2026', () => {
  assert.strictEqual(discountEligibleFrom('2025-01-01'), '2026-01-02');
});

test('boundary: 31 Dec 2025 and 1 Jan 2026 are NOT eligible, 2 Jan 2026 IS', () => {
  assert.strictEqual(isDiscountEligible('2025-01-01', '2025-12-31'), false);
  assert.strictEqual(isDiscountEligible('2025-01-01', '2026-01-01'), false); // the anniversary itself
  assert.strictEqual(isDiscountEligible('2025-01-01', '2026-01-02'), true);
});

test('boundary through the full pipeline (real trades, one day either side)', () => {
  for (const [soldDay, expected] of [['2025-12-31', false], ['2026-01-01', false], ['2026-01-02', true], ['2026-01-03', true]]) {
    const { disposals } = buildCgt([buy('2025-01-01', 10, 100), sell(soldDay, 10, 150)], TZ, { today: '2026-06-01' });
    assert.strictEqual(disposals.length, 1);
    assert.strictEqual(disposals[0].discountEligible, expected, `sold ${soldDay}`);
    assert.strictEqual(disposals[0].eligibleFrom, '2026-01-02');
  }
});

test('leap-day acquisition: 29 Feb 2024 -> anniversary clamps to 28 Feb 2025 -> eligible from 1 Mar 2025', () => {
  assert.strictEqual(discountEligibleFrom('2024-02-29'), '2025-03-01');
  assert.strictEqual(isDiscountEligible('2024-02-29', '2025-02-28'), false);
  assert.strictEqual(isDiscountEligible('2024-02-29', '2025-03-01'), true);
});

// ── trade date, not settlement date; calendar day in the AU timezone ───────────────────
test('a settlement date on the trade is ignored — only tradedAt counts', () => {
  const b = buy('2025-01-01', 10, 100);
  const s = { ...sell('2026-01-01', 10, 150), settledAt: '2026-01-05T10:00:00+11:00', settlementDate: '2026-01-05' };
  const { disposals } = buildCgt([b, s], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals[0].soldOn, '2026-01-01');
  assert.strictEqual(disposals[0].discountEligible, false); // settling on 5 Jan must not rescue it
});

test('calendar day is the AU day: 23:59 Sydney stays on that day, 00:00 Sydney is the next', () => {
  assert.strictEqual(tradeDate('2025-12-31T12:59:00Z', TZ), '2025-12-31'); // 23:59 AEDT
  assert.strictEqual(tradeDate('2025-12-31T13:00:00Z', TZ), '2026-01-01'); // 00:00 AEDT
  // a sale at 00:30 AEDT on 1 Jan 2026 is a 1 Jan sale (not eligible), even though it is 31 Dec in UTC
  const b = { ...buy('2025-01-01', 10, 100) };
  const s = { ...sell('2026-01-01', 10, 150), tradedAt: '2025-12-31T13:30:00Z' };
  const { disposals } = buildCgt([b, s], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals[0].soldOn, '2026-01-01');
  assert.strictEqual(disposals[0].discountEligible, false);
});

test('a buy at 00:30 AEDT on 1 Jan 2025 is a 1 Jan 2025 acquisition (31 Dec in UTC)', () => {
  const b = { ...buy('2025-01-01', 10, 100), tradedAt: '2024-12-31T13:30:00Z' };
  const s = sell('2026-01-02', 10, 150);
  const { disposals } = buildCgt([b, s], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals[0].acquiredOn, '2025-01-01');
  assert.strictEqual(disposals[0].discountEligible, true);
});

// ── FIFO ────────────────────────────────────────────────────────────────────────────────
test('FIFO: a sale uses the oldest parcel first, then the next', () => {
  const { disposals, openParcels } = buildCgt([
    buy('2024-01-02', 100, 10), buy('2025-06-02', 100, 20), sell('2026-01-06', 150, 30),
  ], TZ, { today: '2026-01-06' });
  assert.strictEqual(disposals.length, 2);
  const a = disposals.find((d) => d.acquiredOn === '2024-01-02');
  const b = disposals.find((d) => d.acquiredOn === '2025-06-02');
  assert.strictEqual(a.quantity, 100); assert.strictEqual(a.costAud, 1000); assert.strictEqual(a.proceedsAud, 3000); assert.strictEqual(a.gainAud, 2000);
  assert.strictEqual(a.discountEligible, true); assert.strictEqual(a.discountedGainAud, 1000);
  assert.strictEqual(b.quantity, 50); assert.strictEqual(b.costAud, 1000); assert.strictEqual(b.proceedsAud, 1500); assert.strictEqual(b.gainAud, 500);
  assert.strictEqual(b.discountEligible, false); assert.strictEqual(b.discountedGainAud, 500);
  assert.strictEqual(openParcels.length, 1);
  assert.strictEqual(openParcels[0].quantity, 50); assert.strictEqual(openParcels[0].costAud, 1000);
});

test('same symbol on different exchanges never mixes parcels', () => {
  const { disposals, warnings } = buildCgt([buy('2025-01-01', 10, 100, 0, 'X', 'ASX'), sell('2026-02-01', 10, 120, 0, 'X', 'NYSE')], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals.length, 0);
  assert.strictEqual(warnings.length, 1);
});

// ── fees and cents ──────────────────────────────────────────────────────────────────────
test('buy brokerage raises cost; sell brokerage lowers proceeds', () => {
  const { disposals } = buildCgt([buy('2025-01-01', 10, 100, 10), sell('2026-03-01', 10, 150, 15)], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals[0].costAud, 1010);
  assert.strictEqual(disposals[0].proceedsAud, 1485);
  assert.strictEqual(disposals[0].gainAud, 475);
});

test('rows for one sale add up to exactly its net proceeds (no lost cents)', () => {
  const { disposals } = buildCgt([
    buy('2024-01-02', 1, 10.01), buy('2024-02-02', 1, 10.02), buy('2024-03-02', 1, 10.03), sell('2026-04-06', 3, 33.33, 10),
  ], TZ, { today: '2026-06-01' });
  const proceeds = Math.round(disposals.reduce((s, d) => s + d.proceedsAud * 100, 0));
  assert.strictEqual(proceeds, Math.round((3 * 33.33 - 10) * 100)); // 8999 cents
});

test('a partly used parcel keeps the right remaining cost', () => {
  const { disposals, openParcels } = buildCgt([buy('2024-01-02', 3, 10, 1), sell('2026-01-06', 1, 15)], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals[0].costAud + openParcels[0].costAud, 31); // 3 x 10 + 1 fee, nothing lost
  assert.strictEqual(openParcels[0].quantity, 2);
});

test('fractional shares are matched without rounding drift', () => {
  const { disposals, openParcels } = buildCgt([buy('2024-01-02', 0.5, 200), buy('2024-02-02', 0.25, 200), sell('2026-01-06', 0.75, 300)], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals.length, 2);
  assert.strictEqual(openParcels.length, 0);
  assert.strictEqual(disposals.reduce((s, d) => s + d.quantity, 0), 0.75);
});

// ── data problems are flagged, never hidden ─────────────────────────────────────────────
test('selling more than was bought is flagged and only the matched quantity is taxed', () => {
  const { disposals, warnings } = buildCgt([buy('2025-01-01', 5, 100), sell('2026-03-01', 10, 150)], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals.length, 1);
  assert.strictEqual(disposals[0].quantity, 5);
  assert.strictEqual(disposals[0].proceedsAud, 750); // half of the 1500 sale
  assert.ok(warnings.some((w) => /more TSM/.test(w)));
});

test('a sale dated before any purchase is flagged', () => {
  const { disposals, warnings } = buildCgt([sell('2025-03-01', 5, 150), buy('2025-06-01', 5, 100)], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals.length, 0);
  assert.strictEqual(warnings.length, 1);
});

test('same-day buy and sell: 0 days held, not eligible', () => {
  const { disposals } = buildCgt([buy('2025-05-05', 10, 100), sell('2025-05-05', 10, 101)], TZ, { today: '2026-06-01' });
  assert.strictEqual(disposals[0].daysHeld, 0);
  assert.strictEqual(disposals[0].discountEligible, false);
});

// ── open parcels ────────────────────────────────────────────────────────────────────────
test('open parcel shows when it becomes eligible and whether it already is', () => {
  const { openParcels } = buildCgt([buy('2025-01-01', 10, 100), buy('2025-09-01', 10, 100)], TZ, { today: '2026-01-02' });
  const first = openParcels.find((p) => p.acquiredOn === '2025-01-01');
  const second = openParcels.find((p) => p.acquiredOn === '2025-09-01');
  assert.strictEqual(first.discountEligibleNow, true);
  assert.strictEqual(first.daysUntilEligible, 0);
  assert.strictEqual(second.discountEligibleNow, false);
  assert.strictEqual(second.eligibleFrom, '2026-09-02');
  assert.strictEqual(buildCgt([buy('2025-01-01', 10, 100)], TZ, { today: '2026-01-01' }).openParcels[0].discountEligibleNow, false); // the anniversary itself
});

// ── financial year + summary ────────────────────────────────────────────────────────────
test('financial year boundaries', () => {
  assert.strictEqual(fyLabel('2026-06-30'), '2025-26');
  assert.strictEqual(fyLabel('2026-07-01'), '2026-27');
  assert.strictEqual(fyLabel('2026-01-15'), '2025-26');
});

test('summary: losses offset non-discount gains first, then the discount applies to the rest', () => {
  // discount-eligible gain 2000, other gain 500, loss 800
  const disposals = [
    { gainAud: 2000, proceedsAud: 3000, costAud: 1000, discountEligible: true },
    { gainAud: 500, proceedsAud: 1500, costAud: 1000, discountEligible: false },
    { gainAud: -800, proceedsAud: 200, costAud: 1000, discountEligible: false },
  ];
  const s = summariseDisposals(disposals);
  assert.strictEqual(s.gainsDiscountableAud, 2000);
  assert.strictEqual(s.gainsOtherAud, 500);
  assert.strictEqual(s.lossesAud, 800);
  // 800 loss: 500 wipes the other gain, 300 comes off the discountable gain -> 1700, discount 850
  assert.strictEqual(s.discountAmountAud, 850);
  assert.strictEqual(s.netCapitalGainAud, 850);
  assert.strictEqual(s.lossCarriedForwardAud, 0);
});

test('summary: losses larger than all gains are carried forward, net gain is zero', () => {
  const s = summariseDisposals([
    { gainAud: 100, proceedsAud: 200, costAud: 100, discountEligible: true },
    { gainAud: -400, proceedsAud: 100, costAud: 500, discountEligible: false },
  ]);
  assert.strictEqual(s.netCapitalGainAud, 0);
  assert.strictEqual(s.lossCarriedForwardAud, 300);
});

test('summary totals equal the sum of the displayed rows', () => {
  const { disposals } = buildCgt([buy('2024-01-02', 7, 13.37, 9.5), buy('2025-06-01', 3, 21.11, 9.5), sell('2026-01-06', 8, 40.19, 12.25)], TZ, { today: '2026-06-01' });
  const s = summariseDisposals(disposals);
  const gain = Math.round(disposals.reduce((a, d) => a + d.gainAud * 100, 0));
  assert.strictEqual(Math.round((s.proceedsAud - s.costAud) * 100), gain);
});

console.log(`\n${n} tests passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
