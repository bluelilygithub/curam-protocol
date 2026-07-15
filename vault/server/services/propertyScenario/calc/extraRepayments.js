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
 * Extra repayments — time and interest saved vs contractual P&I only.
 *
 * @param {object} input
 * @param {number} input.loan_amount
 * @param {number} input.annual_rate_pct
 * @param {number} input.term_months
 * @param {number} [input.term_years]
 * @param {number} input.extra_per_period — extra each period (same frequency)
 * @param {'monthly'|'fortnightly'|'weekly'} [input.frequency='monthly']
 * @param {number} [input.base_repayment] — override contractual repayment; else computed P&I
 * @returns {object}
 */
function calculateExtraRepayments(input = {}) {
  const errors = [];
  const caveats = [];

  const amount = Number(input.loan_amount);
  const rate = Number(input.annual_rate_pct);
  let termMonths = input.term_months != null ? Number(input.term_months) : null;
  if (!Number.isFinite(termMonths) && input.term_years != null) {
    termMonths = Number(input.term_years) * 12;
  }
  const extra = Number(input.extra_per_period);
  const frequency = input.frequency || 'monthly';
  const freq = resolveFrequency(frequency);

  if (!Number.isFinite(amount) || amount <= 0) errors.push('loan_amount must be a positive number');
  if (!Number.isFinite(rate) || rate < 0) errors.push('annual_rate_pct must be a non-negative number');
  if (!Number.isFinite(termMonths) || termMonths <= 0) {
    errors.push('term_months (or term_years) must be a positive number');
  }
  if (!Number.isFinite(extra) || extra < 0) {
    errors.push('extra_per_period must be a non-negative number');
  }
  if (!freq) errors.push('frequency must be monthly, fortnightly, or weekly');

  if (errors.length) {
    return {
      ok: false,
      errors,
      caveats,
      explanation: 'Could not model extra repayments — check the inputs listed in errors.',
      baseline: null,
      with_extra: null,
      months_saved: null,
      interest_saved: null,
    };
  }

  const basePayment = input.base_repayment != null
    ? Number(input.base_repayment)
    : paymentAmount(amount, rate, termMonths, frequency);

  if (!Number.isFinite(basePayment) || basePayment <= 0) {
    return {
      ok: false,
      errors: ['Could not derive a positive base repayment'],
      caveats,
      explanation: 'Could not model extra repayments — base repayment is invalid.',
      baseline: null,
      with_extra: null,
      months_saved: null,
      interest_saved: null,
    };
  }

  const baseline = amortizeUntilPaid({
    principal: amount,
    annualRatePct: rate,
    payment: basePayment,
    extraPerPeriod: 0,
    offsetBalance: 0,
    periodsPerYear: freq.periodsPerYear,
  });

  const withExtra = amortizeUntilPaid({
    principal: amount,
    annualRatePct: rate,
    payment: basePayment,
    extraPerPeriod: extra,
    offsetBalance: 0,
    periodsPerYear: freq.periodsPerYear,
  });

  const baselineMonths = periodsToMonths(baseline.periods, freq.periodsPerYear);
  const extraMonths = periodsToMonths(withExtra.periods, freq.periodsPerYear);
  const monthsSaved = roundMoney(Math.max(0, baselineMonths - extraMonths));
  const interestSaved = roundMoney(Math.max(0, baseline.total_interest - withExtra.total_interest));

  caveats.push(
    'Simulation assumes a fixed rate, no redraws of extra repayments, and that extras are applied every period.'
  );
  caveats.push(
    'Some loans cap extra repayments during a fixed period or charge break costs — check your contract.'
  );

  let explanation;
  if (extra === 0) {
    explanation =
      `With no extra repayments, the loan is paid out in about ${formatDuration(baselineMonths)} `
      + `with roughly ${money(baseline.total_interest)} interest.`;
  } else {
    explanation =
      `Paying an extra ${money(extra)} ${freq.label} on top of the ${money(basePayment)} P&I repayment `
      + `could clear the loan about ${formatDuration(monthsSaved)} sooner `
      + `and save roughly ${money(interestSaved)} in interest `
      + `(${formatDuration(extraMonths)} vs ${formatDuration(baselineMonths)}).`;
  }

  return {
    ok: true,
    errors: [],
    caveats,
    explanation,
    frequency: freq.label,
    base_repayment: basePayment,
    extra_per_period: extra,
    baseline: {
      periods: baseline.periods,
      months: baselineMonths,
      total_interest: baseline.total_interest,
      total_repaid: baseline.total_repaid,
      paid_off: baseline.paid_off,
    },
    with_extra: {
      periods: withExtra.periods,
      months: extraMonths,
      total_interest: withExtra.total_interest,
      total_repaid: withExtra.total_repaid,
      total_extra_paid: withExtra.total_extra,
      paid_off: withExtra.paid_off,
    },
    months_saved: monthsSaved,
    interest_saved: interestSaved,
  };
}

module.exports = { calculateExtraRepayments };
