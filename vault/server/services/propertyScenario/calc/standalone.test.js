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
const { paymentAmount, amortizeUntilPaid } = require('./loanMath');

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

// GAP: 0% interest rate was entirely untested at the standalone calculator level.
// paymentAmount must fall back to loan_amount / periods instead of NaN/Infinity from
// a zero-denominator amortisation factor.
test('repayment: 0% rate falls back to loan_amount / term (no NaN/Infinity)', () => {
  const r = calculateRepayment({
    loan_amount: 120_000,
    annual_rate_pct: 0,
    term_months: 120,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.repayment, 1000);
  assert.strictEqual(r.total_interest_over_term, 0);
  assert.strictEqual(r.total_repaid_over_term, 120_000);
});

// GAP: a 1-month term was untested — must still return a finite, sane repayment
// (principal + one period's interest) rather than dividing by zero periods.
test('repayment: 1-month term returns principal plus one period of interest', () => {
  const r = calculateRepayment({
    loan_amount: 10_000,
    annual_rate_pct: 6,
    term_months: 1,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.periods_in_term, 1);
  approx(r.repayment, 10_050, 0.5); // 10000 + 10000*0.06/12 = 10050
  assert.ok(r.repayment > 10_000);
});

// GAP (Round 3 focus area #2): the known-good AU worked example ($300k @ 5.5% / 25y monthly)
// was never locked in with an exact assertion. Independently re-derived via the standard
// amortisation formula M = P·r(1+r)^n / ((1+r)^n − 1) with r = 0.055/12, n = 300: the
// mathematically correct payment is $1,842.26/month, NOT $1,836.07 (that figure does not
// match the standard AU monthly-rest P&I formula for these inputs — verified independently
// with an external calculation, not just by re-running this module's own code).
test('repayment: $300k @ 5.5% / 25y monthly is exactly $1,842.26 (independently verified formula)', () => {
  const r = calculateRepayment({
    loan_amount: 300_000,
    annual_rate_pct: 5.5,
    term_years: 25,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.repayment, 1842.26);
  // Confirms rounding is to the nearest cent (Math.round via roundMoney), not truncated —
  // a truncating implementation would return 1842.25 or lower here.
  const rawFactor = (0.055 / 12) * (1 + 0.055 / 12) ** 300 / ((1 + 0.055 / 12) ** 300 - 1);
  const rawPayment = 300_000 * rawFactor;
  assert.ok(rawPayment > 1842.255 && rawPayment < 1842.265, `raw formula sanity check: ${rawPayment}`);
});

// GAP (Round 3 focus area #2): total_interest_over_term uses the formula method
// (repayment × periods) − principal, which is NOT the same as a true period-by-period
// amortisation sum once the repayment is rounded to the nearest cent. Lock in that the
// two methods can legitimately disagree by a small amount (and even a fractional final
// period), and that the caveat now says so explicitly instead of implying an exact schedule.
test('repayment: total_interest_over_term (formula method) differs slightly from true amortisation sum — caveated', () => {
  const r = calculateRepayment({
    loan_amount: 300_000,
    annual_rate_pct: 5.5,
    term_years: 25,
    frequency: 'monthly',
  });
  const trueAmortisation = amortizeUntilPaid({
    principal: 300_000,
    annualRatePct: 5.5,
    payment: r.repayment,
    periodsPerYear: 12,
  });
  // The two methods are close but not identical — confirms this is a real, small,
  // rounding-driven discrepancy rather than a coincidental exact match.
  assert.notStrictEqual(r.total_interest_over_term, trueAmortisation.total_interest);
  approx(r.total_interest_over_term, trueAmortisation.total_interest, 5);
  assert.ok(
    r.caveats.some((c) => /repayment × number of periods|not a period-by-period amortisation/i.test(c)),
    'expected an explicit caveat about the formula-based total_interest methodology'
  );
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

// GAP: extra_per_period massively exceeding the base repayment (and the outstanding
// balance) was untested — amortizeUntilPaid must cap "due" at the remaining balance and
// pay the loan off in a single period, not loop indefinitely or overpay into negative
// balance / negative total_extra.
test('extra repayments: extra far exceeding balance pays off in 1 period, no infinite loop', () => {
  const r = calculateExtraRepayments({
    loan_amount: 10_000,
    annual_rate_pct: 5,
    term_years: 30,
    extra_per_period: 1_000_000,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.with_extra.periods, 1);
  assert.strictEqual(r.with_extra.paid_off, true);
  assert.ok(r.with_extra.total_extra_paid > 0);
  assert.ok(r.with_extra.total_extra_paid < 1_000_000, 'extra paid must be capped at what was actually owed, not the full extra offered');
  assert.ok(r.interest_saved > 0);
  assert.ok(r.months_saved > 300);
});

// GAP: extra_per_period exactly equal to the base repayment (doubling the effective
// payment) was untested — must roughly halve the term without erroring.
test('extra repayments: extra equal to base repayment materially shortens term', () => {
  const zero = calculateExtraRepayments({
    loan_amount: 400_000,
    annual_rate_pct: 6,
    term_years: 30,
    extra_per_period: 0,
    frequency: 'monthly',
  });
  const r = calculateExtraRepayments({
    loan_amount: 400_000,
    annual_rate_pct: 6,
    term_years: 30,
    extra_per_period: zero.base_repayment,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.with_extra.months < r.baseline.months / 2 + 12, `expected roughly-halved term, got ${r.with_extra.months} vs baseline ${r.baseline.months}`);
  assert.ok(r.with_extra.paid_off);
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

// GAP: offset_balance exceeding the loan amount was untested beyond the equal-balance
// case above. Interest-bearing balance must floor at $0 (never negative), the applied
// offset must be capped at the loan amount, and a caveat must explain the cap.
test('offset: offset_balance greater than loan_amount is capped, never produces negative interest', () => {
  const r = calculateOffsetBenefit({
    loan_amount: 150_000,
    annual_rate_pct: 5.5,
    term_years: 20,
    offset_balance: 500_000,
    frequency: 'monthly',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.offset_applied, 150_000);
  assert.strictEqual(r.with_offset.total_interest, 0);
  assert.ok(r.with_offset.total_interest >= 0);
  assert.ok(r.interest_saved > 0);
  assert.ok(r.caveats.some((c) => /exceeds loan amount/i.test(c)));
  // First-period saving must use the capped offset, not the raw (larger) stated balance
  approx(r.first_period_interest_saving, 150_000 * 0.055 / 12, 0.5);
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
