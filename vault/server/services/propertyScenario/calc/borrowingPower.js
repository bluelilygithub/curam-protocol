'use strict';

const { roundMoney } = require('./tables');
const { paymentAmount, money, formatDuration } = require('./loanMath');

/** APRA-style assessment buffer (percentage points) on the customer rate. */
const DEFAULT_ASSESSMENT_BUFFER_PP = 3.0;
/** Floor assessment rate (% p.a.) when customer rate + buffer is lower. */
const DEFAULT_ASSESSMENT_FLOOR_PCT = 5.05;
/** Fraction of gross income treated as available after tax/HECS sketch (illustrative). */
const DEFAULT_NET_INCOME_FACTOR = 0.70;
/** Minimum monthly surplus buffer kept free (living cushion). */
const DEFAULT_SURPLUS_CUSHION = 0;

/** Lead disclaimer — kept explicit because this result is often quoted out of context. */
const BORROWING_POWER_DISCLAIMER =
  'This is an indicative estimate using a simplified assessment rate and surplus sketch — '
  + 'not a lending decision, not pre-approval, and not a quote from any bank. '
  + 'Actual serviceability varies significantly by lender (assessment buffers, HEM living benchmarks, '
  + 'how existing debts and overtime are treated, LVR caps, credit policy, and other overlays).';

/**
 * Borrowing power estimator — indicative only, not a credit decision.
 *
 * Uses a simplified surplus → PV annuity at an assessment (buffer) rate.
 *
 * @param {object} input
 * @param {number} input.annual_gross_income
 * @param {number} [input.annual_other_income=0]
 * @param {number} input.annual_living_expenses — excludes mortgage being replaced
 * @param {number} [input.monthly_existing_debt_repayments=0] — other loans/cards (monthly)
 * @param {number} [input.annual_rate_pct=6.0] — expected / advertised product rate
 * @param {number} [input.term_years=30]
 * @param {number} [input.term_months]
 * @param {number} [input.assessment_buffer_pp]
 * @param {number} [input.assessment_floor_pct]
 * @param {number} [input.net_income_factor] — 0–1 applied to gross (tax/net sketch)
 * @returns {object}
 */
function calculateBorrowingPower(input = {}) {
  const errors = [];
  const caveats = [BORROWING_POWER_DISCLAIMER];

  const gross = Number(input.annual_gross_income);
  const other = input.annual_other_income != null ? Number(input.annual_other_income) : 0;
  const expenses = Number(input.annual_living_expenses);
  const existingMonthly = input.monthly_existing_debt_repayments != null
    ? Number(input.monthly_existing_debt_repayments)
    : 0;
  const productRate = input.annual_rate_pct != null ? Number(input.annual_rate_pct) : 6.0;
  let termMonths = input.term_months != null ? Number(input.term_months) : null;
  if (!Number.isFinite(termMonths)) {
    const years = input.term_years != null ? Number(input.term_years) : 30;
    termMonths = years * 12;
  }
  const bufferPp = input.assessment_buffer_pp != null
    ? Number(input.assessment_buffer_pp)
    : DEFAULT_ASSESSMENT_BUFFER_PP;
  const floorPct = input.assessment_floor_pct != null
    ? Number(input.assessment_floor_pct)
    : DEFAULT_ASSESSMENT_FLOOR_PCT;
  const netFactor = input.net_income_factor != null
    ? Number(input.net_income_factor)
    : DEFAULT_NET_INCOME_FACTOR;
  const cushion = input.surplus_cushion_monthly != null
    ? Number(input.surplus_cushion_monthly)
    : DEFAULT_SURPLUS_CUSHION;

  if (!Number.isFinite(gross) || gross < 0) errors.push('annual_gross_income must be a non-negative number');
  if (!Number.isFinite(other) || other < 0) errors.push('annual_other_income must be a non-negative number');
  if (!Number.isFinite(expenses) || expenses < 0) {
    errors.push('annual_living_expenses must be a non-negative number');
  }
  if (!Number.isFinite(existingMonthly) || existingMonthly < 0) {
    errors.push('monthly_existing_debt_repayments must be a non-negative number');
  }
  if (!Number.isFinite(productRate) || productRate < 0) {
    errors.push('annual_rate_pct must be a non-negative number');
  }
  if (!Number.isFinite(termMonths) || termMonths <= 0) {
    errors.push('term_months / term_years must be positive');
  }
  if (!Number.isFinite(netFactor) || netFactor <= 0 || netFactor > 1) {
    errors.push('net_income_factor must be between 0 and 1');
  }

  if (errors.length) {
    return {
      ok: false,
      errors,
      caveats,
      explanation:
        'Could not estimate borrowing power — check the inputs listed in errors. '
        + BORROWING_POWER_DISCLAIMER,
      max_loan_indicative: null,
      assessment_rate_pct: null,
      monthly_surplus: null,
    };
  }

  const assessmentRate = Math.max(productRate + bufferPp, floorPct);
  const monthlyNetIncome = roundMoney(((gross + other) * netFactor) / 12);
  const monthlyExpenses = roundMoney(expenses / 12);
  const monthlySurplus = roundMoney(
    monthlyNetIncome - monthlyExpenses - existingMonthly - cushion
  );

  caveats.push(
    `This estimate used a simplified assessment rate of ${assessmentRate.toFixed(2)}% p.a. `
    + `(max of product ${productRate}% + ${bufferPp}pp buffer, or floor ${floorPct}%) — `
    + 'not your chosen lender’s actual assessment rate.'
  );
  caveats.push(
    `Net income sketched as ${(netFactor * 100).toFixed(0)}% of gross (simple tax/HECS placeholder — not personalised).`
  );
  caveats.push(
    'Does not apply HEM living-cost benchmarks, verify deposit/stamp duty/LMI, or run credit checks — only a repayment-capacity sketch.'
  );

  if (monthlySurplus <= 0) {
    return {
      ok: true,
      errors: [],
      caveats,
      explanation:
        `On these figures there is no positive monthly surplus after living costs and existing debts `
        + `(surplus ${money(monthlySurplus)}). Indicative borrowing power is $0 under this simplified model. `
        + BORROWING_POWER_DISCLAIMER,
      annual_gross_income: gross,
      annual_other_income: other,
      annual_living_expenses: expenses,
      monthly_existing_debt_repayments: existingMonthly,
      product_rate_pct: productRate,
      assessment_rate_pct: assessmentRate,
      assessment_buffer_pp: bufferPp,
      net_income_factor: netFactor,
      monthly_net_income_sketch: monthlyNetIncome,
      monthly_living_expenses: monthlyExpenses,
      monthly_surplus: monthlySurplus,
      term_months: termMonths,
      max_loan_indicative: 0,
      indicative_monthly_repayment_at_product_rate: 0,
    };
  }

  // Max loan = PV of annuity of monthly_surplus at monthly assessment rate
  const r = assessmentRate / 100 / 12;
  const n = Math.round(termMonths);
  let maxLoan;
  if (r === 0) {
    maxLoan = roundMoney(monthlySurplus * n);
  } else {
    maxLoan = roundMoney(monthlySurplus * ((1 - (1 + r) ** -n) / r));
  }

  const repaymentAtProduct = paymentAmount(maxLoan, productRate, termMonths, 'monthly');

  const explanation =
    `Based on a simplified surplus of ${money(monthlySurplus)} per month and a simplified assessment rate of `
    + `${assessmentRate.toFixed(2)}% over ${formatDuration(termMonths)}, `
    + `an indicative maximum loan is about ${money(maxLoan)}. `
    + `At the product rate of ${productRate}%, that loan’s estimated monthly P&I repayment is `
    + `${money(repaymentAtProduct)}. `
    + BORROWING_POWER_DISCLAIMER;

  return {
    ok: true,
    errors: [],
    caveats,
    explanation,
    annual_gross_income: gross,
    annual_other_income: other,
    annual_living_expenses: expenses,
    monthly_existing_debt_repayments: existingMonthly,
    product_rate_pct: productRate,
    assessment_rate_pct: assessmentRate,
    assessment_buffer_pp: bufferPp,
    assessment_floor_pct: floorPct,
    net_income_factor: netFactor,
    monthly_net_income_sketch: monthlyNetIncome,
    monthly_living_expenses: monthlyExpenses,
    monthly_surplus: monthlySurplus,
    term_months: termMonths,
    max_loan_indicative: maxLoan,
    indicative_monthly_repayment_at_product_rate: repaymentAtProduct,
  };
}

module.exports = {
  calculateBorrowingPower,
  BORROWING_POWER_DISCLAIMER,
  DEFAULT_ASSESSMENT_BUFFER_PP,
  DEFAULT_ASSESSMENT_FLOOR_PCT,
  DEFAULT_NET_INCOME_FACTOR,
};
