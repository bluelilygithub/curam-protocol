#!/usr/bin/env node
/**
 * Stage 5 — standalone calculator tests (no Scenario / orchestrator).
 * Run: node server/services/propertyScenario/calc/standalone.test.js
 */
'use strict';

const assert = require('assert');
const { calculateRepayment } = require('./repayment');
const { calculateExtraRepayments } = require('./extraRepayments');
const { calculateOffsetBenefit } = require('./offset');
const { calculateBorrowingPower } = require('./borrowingPower');
const { paymentAmount } = require('./loanMath');

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
    console.log(`  ${err.stack || err.message}`);
  }
}

function approx(a, b, tol = 1) {
  assert.ok(
    Math.abs(Number(a) - Number(b)) <= tol,
    `expected ${a} ≈ ${b} (tol ${tol})`
  );
}

// ─── Repayment ───────────────────────────────────────────────────────────────

test('repayment: $500k @ 6% / 30y monthly ≈ $2,997.75', () => {
  const r = calculateRepayment({
    loan_amount: 500_000,
    annual_rate_pct: 6,
    term_years: 30,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  approx(r.repayment, 2997.75, 0.05);
  assert.ok(r.explanation.includes('2,997') || r.explanation.includes('2997'));
  assert.ok(r.total_interest_over_term > 500_000);
  assert.ok(r.caveats.length >= 1);
});

test('repayment: fortnightly smaller than monthly for same loan', () => {
  const monthly = calculateRepayment({
    loan_amount: 600_000,
    annual_rate_pct: 5.89,
    term_months: 300,
    frequency: 'monthly',
  });
  const fortnightly = calculateRepayment({
    loan_amount: 600_000,
    annual_rate_pct: 5.89,
    term_months: 300,
    frequency: 'fortnightly',
  });
  assert.ok(fortnightly.repayment < monthly.repayment);
  // Rough check: fortnightly ≈ monthly * 12/26
  approx(fortnightly.repayment, monthly.repayment * (12 / 26), 5);
});

test('repayment: rejects missing / invalid inputs with explanation', () => {
  const r = calculateRepayment({ loan_amount: -1, annual_rate_pct: 5 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length >= 1);
  assert.ok(r.explanation.length > 10);
});

// ─── Extra repayments ────────────────────────────────────────────────────────

test('extra repayments: $200/mo saves time and interest on $450k @ 5.5% / 25y', () => {
  const r = calculateExtraRepayments({
    loan_amount: 450_000,
    annual_rate_pct: 5.5,
    term_years: 25,
    extra_per_period: 200,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.months_saved > 12, `expected >12 months saved, got ${r.months_saved}`);
  assert.ok(r.interest_saved > 20_000, `expected meaningful interest save, got ${r.interest_saved}`);
  assert.ok(r.with_extra.months < r.baseline.months);
  assert.ok(r.explanation.toLowerCase().includes('sooner') || r.explanation.includes('save'));
});

test('extra repayments: zero extra → no savings', () => {
  const r = calculateExtraRepayments({
    loan_amount: 300_000,
    annual_rate_pct: 5,
    term_years: 20,
    extra_per_period: 0,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.months_saved, 0);
  assert.strictEqual(r.interest_saved, 0);
});

// ─── Offset ──────────────────────────────────────────────────────────────────

test('offset: $80k offset on $520k @ 6.1% / 15y reduces interest and term', () => {
  const r = calculateOffsetBenefit({
    loan_amount: 520_000,
    annual_rate_pct: 6.1,
    term_years: 15,
    offset_balance: 80_000,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.interest_saved > 50_000, `interest_saved=${r.interest_saved}`);
  assert.ok(r.months_saved > 6, `months_saved=${r.months_saved}`);
  // First month interest saving ≈ 80000 * 0.061/12
  approx(r.first_period_interest_saving, 80_000 * 0.061 / 12, 0.5);
  assert.ok(r.explanation.includes('offset') || r.explanation.includes('Offset') || r.explanation.includes('80'));
});

test('offset: full offset (balance = loan) → no interest / rapid payoff via repayment', () => {
  const r = calculateOffsetBenefit({
    loan_amount: 200_000,
    annual_rate_pct: 5,
    term_years: 20,
    offset_balance: 200_000,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.with_offset.total_interest, 0);
  assert.ok(r.interest_saved > 0);
});

// ─── Borrowing power ─────────────────────────────────────────────────────────

test('borrowing power: dual-income household gets positive indicative max loan', () => {
  const r = calculateBorrowingPower({
    annual_gross_income: 140_000,
    annual_other_income: 60_000,
    annual_living_expenses: 48_000,
    monthly_existing_debt_repayments: 400,
    annual_rate_pct: 5.8,
    term_years: 30,
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.max_loan_indicative > 400_000, `max=${r.max_loan_indicative}`);
  assert.ok(r.monthly_surplus > 0);
  assert.ok(r.assessment_rate_pct >= r.product_rate_pct + 2.5);
  assert.ok(/indicative|not a lending decision/i.test(r.explanation + r.caveats.join(' ')));
});

test('borrowing power: disclaimer is explicit (not a generic “estimate only”)', () => {
  const { BORROWING_POWER_DISCLAIMER } = require('./borrowingPower');
  const r = calculateBorrowingPower({
    annual_gross_income: 120_000,
    annual_living_expenses: 36_000,
    monthly_existing_debt_repayments: 0,
    annual_rate_pct: 6,
    term_years: 30,
  });
  assert.ok(r.caveats[0] === BORROWING_POWER_DISCLAIMER);
  assert.ok(r.explanation.includes(BORROWING_POWER_DISCLAIMER));
  assert.ok(/simplified assessment rate/i.test(r.caveats[0]));
  assert.ok(/not a lending decision/i.test(r.caveats[0]));
  assert.ok(/varies significantly by lender/i.test(r.caveats[0]));
  assert.ok(/HEM|assessment buffers/i.test(r.caveats[0]));
});

test('borrowing power: expenses dominate → $0 indicative', () => {
  const r = calculateBorrowingPower({
    annual_gross_income: 50_000,
    annual_living_expenses: 60_000,
    monthly_existing_debt_repayments: 800,
    annual_rate_pct: 6,
    term_years: 30,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.max_loan_indicative, 0);
  assert.ok(r.monthly_surplus <= 0);
  assert.ok(/no positive monthly surplus|\$0/i.test(r.explanation));
});

test('borrowing power: validates bad inputs', () => {
  const r = calculateBorrowingPower({ annual_gross_income: 'nope' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length >= 1);
});

// Cross-check shared payment helper vs repayment module
test('loanMath.paymentAmount matches calculateRepayment', () => {
  const viaMath = paymentAmount(400_000, 5.4, 300, 'monthly');
  const viaMod = calculateRepayment({
    loan_amount: 400_000,
    annual_rate_pct: 5.4,
    term_months: 300,
  });
  assert.strictEqual(viaMod.repayment, viaMath);
});

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
