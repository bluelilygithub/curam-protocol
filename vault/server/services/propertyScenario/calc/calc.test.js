#!/usr/bin/env node
/**
 * Stage 3 calculation modules — unit tests (no API).
 * Run: node server/services/propertyScenario/calc/calc.test.js
 */
'use strict';

const assert = require('assert');
const { dutyFromBrackets, STAMP_DUTY_TABLES, roundMoney } = require('./tables');
const { calculateStampDutyLmi } = require('./stampDutyLmi');
const { calculateCgt } = require('./cgt');
const { calculateRefinanceBreakEven, monthlyRepayment } = require('./refinanceBreakEven');
const { calculateEarlyPayoutBreakCost } = require('./earlyPayout');

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const X = '\x1b[0m';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

function approx(a, b, tol = 0.02) {
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`);
}

// ─── Stamp duty / LMI ────────────────────────────────────────────────────────

test('NSW stamp duty hand-worked @ $800,000', () => {
  // Bracket: over 364k @ 4.5% + base 10897 → 10897 + (800000-364000)*0.045
  const expected = roundMoney(10_897 + (800_000 - 364_000) * 0.045);
  const got = dutyFromBrackets(800_000, STAMP_DUTY_TABLES.NSW.brackets);
  assert.strictEqual(got, expected);
  assert.strictEqual(got, 30_517);
});

test('VIC stamp duty hand-worked @ $700,000', () => {
  // 130k–960k: base 2870 + 6% over 130k → 2870 + 570000*0.06 = 2870 + 34200 = 37070
  const expected = roundMoney(2_870 + (700_000 - 130_000) * 0.06);
  assert.strictEqual(dutyFromBrackets(700_000, STAMP_DUTY_TABLES.VIC.brackets), expected);
  assert.strictEqual(expected, 37_070);
});

test('Buy NSW non-FHB returns duty + no LMI at 20% deposit', () => {
  const r = calculateStampDutyLmi({
    property_value: 800_000,
    state: 'NSW',
    is_first_home_buyer: false,
    deposit_amount: 160_000,
    loan: { balance: 640_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stamp_duty_payable, 30_517);
  assert.strictEqual(r.lmi_required, false);
  assert.strictEqual(r.lmi_estimate, null);
  assert.ok(r.caveats.some((c) => /confirm with the state revenue/i.test(c)));
});

test('Buy NSW FHB under full exemption threshold → $0 duty', () => {
  const r = calculateStampDutyLmi({
    property_value: 750_000,
    state: 'NSW',
    is_first_home_buyer: true,
    loan: { balance: 600_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fhb_concession_applied, true);
  assert.strictEqual(r.stamp_duty_payable, 0);
  assert.ok(r.assumptions.some((a) => /full FHB/i.test(a)));
});

test('LMI required when LVR 90%', () => {
  const r = calculateStampDutyLmi({
    property_value: 1_000_000,
    state: 'QLD',
    is_first_home_buyer: false,
    loan: { balance: 900_000 },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lmi_required, true);
  assert.strictEqual(r.lvr, 0.9);
  // 1.75% of 900k
  assert.strictEqual(r.lmi_estimate, 15_750);
  assert.ok(r.caveats.some((c) => /order-of-magnitude/i.test(c)));
});

test('Stamp duty errors when state missing', () => {
  const r = calculateStampDutyLmi({ property_value: 500_000, is_first_home_buyer: false });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length > 0);
});

// ─── CGT ─────────────────────────────────────────────────────────────────────

test('CGT full MRE when never investment', () => {
  const r = calculateCgt({
    property_value: 1_450_000,
    purchase_price: 820_000,
    purchase_date: '2016-04-12',
    settlement_date: '2026-09-15',
    was_ever_investment_property: false,
    state: 'NSW',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.main_residence_exempt, true);
  assert.strictEqual(r.taxable_capital_gain_estimate, 0);
  assert.strictEqual(r.capital_gain_gross, 630_000);
  assert.strictEqual(r.partial_exemption_flagged, false);
});

test('CGT 50% discount when held >12 months and was investment', () => {
  const r = calculateCgt({
    property_value: 900_000,
    purchase_price: 500_000,
    purchase_date: '2018-01-01',
    settlement_date: '2026-01-01',
    was_ever_investment_property: true,
    state: 'QLD',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.capital_gain_gross, 400_000);
  assert.strictEqual(r.cgt_discount_applied, true);
  assert.strictEqual(r.taxable_capital_gain_estimate, 200_000);
  assert.strictEqual(r.partial_exemption_flagged, true);
  assert.ok(r.caveats.some((c) => /6-year rule/i.test(c)));
  assert.ok(r.caveats.some((c) => /does NOT compute a number/i.test(c)));
});

test('CGT no discount when held <12 months (investment)', () => {
  const r = calculateCgt({
    property_value: 600_000,
    purchase_price: 500_000,
    purchase_date: '2025-06-01',
    settlement_date: '2026-01-01',
    was_ever_investment_property: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.held_over_12_months, false);
  assert.strictEqual(r.cgt_discount_applied, false);
  assert.strictEqual(r.taxable_capital_gain_estimate, 100_000);
  assert.strictEqual(r.partial_exemption_flagged, true);
});

test('CGT refuses when PPOR/investment unknown', () => {
  const r = calculateCgt({
    property_value: 600_000,
    purchase_price: 500_000,
  });
  assert.strictEqual(r.ok, false);
});

// ─── Refinance break-even ────────────────────────────────────────────────────

test('Monthly repayment hand-check', () => {
  // $500k @ 6% over 300 months
  const m = monthlyRepayment(500_000, 6, 300);
  approx(m, 3221.51, 1); // allow $1 rounding
});

test('Refinance break-even months from rate cut', () => {
  const r = calculateRefinanceBreakEven({
    property_id: 'prop_1',
    current_loan: {
      balance: 500_000,
      rate: 6.1,
      fixed_or_variable: 'variable',
      term_remaining_months: 300,
    },
    target_loan: {
      balance: 500_000,
      rate: 5.4,
      fixed_or_variable: 'variable',
      term_remaining_months: 300,
    },
  // Use explicit opts so test isn't coupled to default fee values.
  // Upfront: discharge(350) + establishment(600) + valuation(250) + legal(400) + govt(340) = 1940
  }, { discharge_fee: 350, establishment_fee: 600, valuation_fee: 250, legal_fee: 400 });
  // state not supplied → national average govt fee (340)
  const expectedUpfront = 350 + 600 + 250 + 400 + 340; // 1940

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.upfront_cost, expectedUpfront);
  assert.ok(r.monthly_saving > 0);
  assert.ok(r.break_even_months >= 1);
  // Hand: break-even = ceil(upfront / saving)
  const expectedMonths = Math.ceil(expectedUpfront / r.monthly_saving);
  assert.strictEqual(r.break_even_months, expectedMonths);
  assert.ok(r.caveats.length >= 1);
});

test('Refinance with higher target rate → no break-even', () => {
  const r = calculateRefinanceBreakEven({
    current_loan: { balance: 400_000, rate: 5.0, fixed_or_variable: 'variable', term_remaining_months: 240 },
    target_loan: { balance: 400_000, rate: 5.5, fixed_or_variable: 'variable', term_remaining_months: 240 },
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.monthly_saving < 0);
  assert.strictEqual(r.break_even_months, null);
});

// ─── Early payout ────────────────────────────────────────────────────────────

test('Fixed-rate IRD uses fixed period months — not loan term', () => {
  // $520k @ 6.1% vs 5.4%, 24 months left on fixed period, 180 months left on loan
  // 520000 * 0.007 * 2 = 7280  (NOT 54600 which wrongly used 15y loan term)
  const r = calculateEarlyPayoutBreakCost({
    property_id: 'prop_ppor',
    current_loan: {
      balance: 520_000,
      rate: 6.1,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      fixed_period_remaining_months: 24,
      lender: 'CityBank',
    },
    payout_date: '2026-09-01',
  }, { comparison_rate: 5.4 });

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 7_280);
  assert.strictEqual(r.remaining_fixed_months, 24);
  assert.strictEqual(r.loan_term_remaining_months, 180);
  assert.strictEqual(r.interest_rate_differential_pp, 0.7);
  assert.ok(r.assumptions.some((a) => /not used in the IRD formula/i.test(a)));
});

test('Fixed-rate IRD refuses when only loan term is present (no fixed period)', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 520_000,
      rate: 6.1,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
      // deliberately no fixed_period_remaining_months
    },
  }, { comparison_rate: 5.4 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /fixed_period_remaining_months/i.test(e)));
  assert.strictEqual(r.break_cost_estimate, null);
});

test('Variable early payout → $0 IRD break cost', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 180_000,
      rate: 5.8,
      fixed_or_variable: 'variable',
      term_remaining_months: 120,
    },
  }, { comparison_rate: 5.0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.break_cost_estimate, 0);
  assert.strictEqual(r.method, 'variable_no_ird');
});

test('Investment property flags tax deductibility question', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 300_000,
      rate: 5.9,
      fixed_or_variable: 'fixed',
      term_remaining_months: 300,
      fixed_period_remaining_months: 24,
    },
  }, { comparison_rate: 5.2, was_ever_investment_property: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tax_deductibility_flagged, true);
  assert.ok(r.caveats.some((c) => /tax professional/i.test(c)));
  // 300000 * 0.007 * 2 = 4200
  assert.strictEqual(r.break_cost_estimate, 4_200);
});

test('Early payout errors without comparison_rate on fixed', () => {
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 100_000,
      rate: 6,
      fixed_or_variable: 'fixed',
      term_remaining_months: 120,
      fixed_period_remaining_months: 12,
    },
  });
  assert.strictEqual(r.ok, false);
});

test('Does not silently use term_remaining_months via opts confusion', () => {
  // Passing only term on the loan must fail — even if someone might hope opts fall back
  const r = calculateEarlyPayoutBreakCost({
    current_loan: {
      balance: 520_000,
      rate: 6.1,
      fixed_or_variable: 'fixed',
      term_remaining_months: 180,
    },
  }, { comparison_rate: 5.4 });
  assert.strictEqual(r.ok, false);
  assert.notStrictEqual(r.break_cost_estimate, 54_600);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
