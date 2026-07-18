'use strict';

const { roundMoney } = require('./tables');
const {
  resolveFrequency,
  paymentAmount,
  money,
  formatDuration,
} = require('./loanMath');

/**
 * Standalone repayment calculator.
 *
 * @param {object} input
 * @param {number} input.loan_amount
 * @param {number} input.annual_rate_pct — e.g. 5.89
 * @param {number} input.term_months — or use term_years
 * @param {number} [input.term_years]
 * @param {'monthly'|'fortnightly'|'weekly'} [input.frequency='monthly']
 * @returns {object}
 */
function calculateRepayment(input = {}) {
  const errors = [];
  const caveats = [];

  const amount = Number(input.loan_amount);
  const rate = Number(input.annual_rate_pct);
  let termMonths = input.term_months != null ? Number(input.term_months) : null;
  if (!Number.isFinite(termMonths) && input.term_years != null) {
    termMonths = Number(input.term_years) * 12;
  }
  const frequency = input.frequency || 'monthly';
  const freq = resolveFrequency(frequency);

  if (!Number.isFinite(amount) || amount <= 0) errors.push('loan_amount must be a positive number');
  if (!Number.isFinite(rate) || rate < 0) errors.push('annual_rate_pct must be a non-negative number');
  if (!Number.isFinite(termMonths) || termMonths <= 0) {
    errors.push('term_months (or term_years) must be a positive number');
  }
  if (!freq) errors.push('frequency must be monthly, fortnightly, or weekly');

  if (errors.length) {
    return {
      ok: false,
      errors,
      caveats,
      explanation: 'Could not calculate a repayment — check the inputs listed in errors.',
      repayment: null,
      frequency: freq ? freq.label : frequency,
      term_months: Number.isFinite(termMonths) ? termMonths : null,
      total_repaid_over_term: null,
      total_interest_over_term: null,
    };
  }

  const repayment = paymentAmount(amount, rate, termMonths, frequency);
  const periods = Math.round((termMonths / 12) * freq.periodsPerYear);
  const totalRepaid = roundMoney(repayment * periods);
  const totalInterest = roundMoney(totalRepaid - amount);

  caveats.push(
    'Assumes constant interest rate and level principal-and-interest (P&I) repayments for the full term.'
  );
  caveats.push(
    'Lender fees, honeymoon rates, interest-only periods, and roundings may change the contractual repayment.'
  );
  // GAP (Round 3): total_interest_over_term is derived from (repayment × periods) − principal,
  // not a period-by-period amortisation sum. Because `repayment` itself is rounded to the
  // nearest cent, this formula-based total can differ from a true amortisation schedule by a
  // small amount (and a real schedule's final period may be a few dollars/days different) —
  // caveat this explicitly so the figure isn't read as a precise cent-for-cent schedule total.
  caveats.push(
    'total_interest_over_term is calculated as (repayment × number of periods) − loan amount, '
    + 'not a period-by-period amortisation schedule — it can differ from a real lender schedule '
    + 'by a small amount because the repayment figure is rounded to the nearest cent.'
  );

  const explanation =
    `On a ${money(amount)} loan at ${rate}% p.a. over ${formatDuration(termMonths)}, `
    + `your estimated ${freq.label} P&I repayment is ${money(repayment)}. `
    + `Over the full term that would repay about ${money(totalRepaid)} in total `
    + `(~${money(totalInterest)} interest), if the rate never changed.`;

  return {
    ok: true,
    errors: [],
    caveats,
    explanation,
    loan_amount: amount,
    annual_rate_pct: rate,
    term_months: termMonths,
    frequency: freq.label,
    periods_per_year: freq.periodsPerYear,
    periods_in_term: periods,
    repayment,
    total_repaid_over_term: totalRepaid,
    total_interest_over_term: totalInterest,
  };
}

module.exports = { calculateRepayment };
