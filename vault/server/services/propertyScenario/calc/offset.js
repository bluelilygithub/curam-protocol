'use strict';

const { roundMoney } = require('./tables');
const {
  resolveFrequency,
  paymentAmount,
  amortizeUntilPaid,
  periodsToMonths,
  formatDuration,
  money,
} = require('./loanMath');

/**
 * Offset account benefit — interest charged on (loan − offset) while contractual
 * repayment stays the same.
 *
 * @param {object} input
 * @param {number} input.loan_amount
 * @param {number} input.annual_rate_pct
 * @param {number} input.term_months
 * @param {number} [input.term_years]
 * @param {number} input.offset_balance — average / assumed offset balance held for the term
 * @param {'monthly'|'fortnightly'|'weekly'} [input.frequency='monthly']
 * @param {number} [input.base_repayment]
 * @returns {object}
 */
function calculateOffsetBenefit(input = {}) {
  const errors = [];
  const caveats = [];

  const amount = Number(input.loan_amount);
  const rate = Number(input.annual_rate_pct);
  const offset = Number(input.offset_balance);
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
  if (!Number.isFinite(offset) || offset < 0) {
    errors.push('offset_balance must be a non-negative number');
  }
  if (!freq) errors.push('frequency must be monthly, fortnightly, or weekly');

  if (errors.length) {
    return {
      ok: false,
      errors,
      caveats,
      explanation: 'Could not model offset benefit — check the inputs listed in errors.',
      without_offset: null,
      with_offset: null,
      interest_saved: null,
      months_saved: null,
      first_period_interest_saving: null,
    };
  }

  const effectiveOffset = Math.min(offset, amount);
  if (offset > amount) {
    caveats.push(
      `Offset balance (${money(offset)}) exceeds loan amount — interest-bearing balance is floored at $0.`
    );
  }

  const basePayment = input.base_repayment != null
    ? Number(input.base_repayment)
    : paymentAmount(amount, rate, termMonths, frequency);

  const without = amortizeUntilPaid({
    principal: amount,
    annualRatePct: rate,
    payment: basePayment,
    extraPerPeriod: 0,
    offsetBalance: 0,
    periodsPerYear: freq.periodsPerYear,
  });

  const withOff = amortizeUntilPaid({
    principal: amount,
    annualRatePct: rate,
    payment: basePayment,
    extraPerPeriod: 0,
    offsetBalance: effectiveOffset,
    periodsPerYear: freq.periodsPerYear,
  });

  const withoutMonths = periodsToMonths(without.periods, freq.periodsPerYear);
  const withMonths = periodsToMonths(withOff.periods, freq.periodsPerYear);
  const monthsSaved = roundMoney(Math.max(0, withoutMonths - withMonths));
  const interestSaved = roundMoney(Math.max(0, without.total_interest - withOff.total_interest));

  // First-period illustrative saving (steady-state at start)
  const r = rate / 100 / freq.periodsPerYear;
  const firstPeriodSaving = roundMoney(effectiveOffset * r);

  caveats.push(
    'Assumes the offset balance stays roughly constant for the whole remaining term (or until the loan is cleared).'
  );
  caveats.push(
    'Only 100% offset facilities behave this way; partial-offset products and package fees are not modelled.'
  );

  const explanation =
    `Holding about ${money(effectiveOffset)} in a full offset against a ${money(amount)} loan at ${rate}% `
    + `could save roughly ${money(interestSaved)} in interest and shorten the loan by about ${formatDuration(monthsSaved)}, `
    + `if you keep paying the same ${money(basePayment)} ${freq.label} repayment. `
    + `In the first period alone, interest is about ${money(firstPeriodSaving)} lower than with no offset.`;

  return {
    ok: true,
    errors: [],
    caveats,
    explanation,
    frequency: freq.label,
    loan_amount: amount,
    offset_balance: offset,
    offset_applied: effectiveOffset,
    base_repayment: basePayment,
    first_period_interest_saving: firstPeriodSaving,
    without_offset: {
      periods: without.periods,
      months: withoutMonths,
      total_interest: without.total_interest,
      paid_off: without.paid_off,
    },
    with_offset: {
      periods: withOff.periods,
      months: withMonths,
      total_interest: withOff.total_interest,
      paid_off: withOff.paid_off,
    },
    interest_saved: interestSaved,
    months_saved: monthsSaved,
  };
}

module.exports = { calculateOffsetBenefit };
