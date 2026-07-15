'use strict';

const { roundMoney } = require('./tables');

/** @typedef {'monthly'|'fortnightly'|'weekly'} PaymentFrequency */

const FREQUENCY = Object.freeze({
  monthly: { periodsPerYear: 12, label: 'monthly' },
  fortnightly: { periodsPerYear: 26, label: 'fortnightly' },
  weekly: { periodsPerYear: 52, label: 'weekly' },
});

/**
 * @param {string} freq
 * @returns {{ periodsPerYear: number, label: string }|null}
 */
function resolveFrequency(freq) {
  const key = String(freq || 'monthly').toLowerCase();
  return FREQUENCY[key] || null;
}

/**
 * Periodic interest rate from annual % and periods/year.
 * @param {number} annualRatePct
 * @param {number} periodsPerYear
 */
function periodRate(annualRatePct, periodsPerYear) {
  return Number(annualRatePct) / 100 / periodsPerYear;
}

/**
 * Level P&I repayment for a given frequency.
 * @param {number} principal
 * @param {number} annualRatePct
 * @param {number} termMonths — overall loan term in months (converted to periods)
 * @param {PaymentFrequency} [frequency='monthly']
 */
function paymentAmount(principal, annualRatePct, termMonths, frequency = 'monthly') {
  const freq = resolveFrequency(frequency);
  if (!freq) return null;
  const p = Number(principal);
  const months = Number(termMonths);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!Number.isFinite(months) || months <= 0) return null;

  const n = Math.max(1, Math.round((months / 12) * freq.periodsPerYear));
  const r = periodRate(annualRatePct, freq.periodsPerYear);
  if (!Number.isFinite(r) || r < 0) return null;
  if (r === 0) return roundMoney(p / n);
  const factor = (r * (1 + r) ** n) / ((1 + r) ** n - 1);
  return roundMoney(p * factor);
}

/**
 * Amortise a loan period-by-period.
 * @param {object} opts
 * @param {number} opts.principal
 * @param {number} opts.annualRatePct
 * @param {number} opts.payment — contractual P&I per period (before extras)
 * @param {number} [opts.extraPerPeriod=0]
 * @param {number} [opts.offsetBalance=0] — reduces interest-bearing balance
 * @param {number} opts.periodsPerYear
 * @param {number} [opts.maxPeriods] — safety cap (default 100 years of periods)
 * @returns {{
 *   periods: number,
 *   total_interest: number,
 *   total_repaid: number,
 *   total_extra: number,
 *   final_balance: number,
 *   paid_off: boolean,
 * }}
 */
function amortizeUntilPaid(opts) {
  let balance = Number(opts.principal);
  const payment = Number(opts.payment);
  const extra = Number(opts.extraPerPeriod) || 0;
  const offset = Math.max(0, Number(opts.offsetBalance) || 0);
  const ppy = Number(opts.periodsPerYear) || 12;
  const r = periodRate(opts.annualRatePct, ppy);
  const maxPeriods = opts.maxPeriods != null
    ? Number(opts.maxPeriods)
    : Math.round(ppy * 100);

  let periods = 0;
  let totalInterest = 0;
  let totalRepaid = 0;
  let totalExtra = 0;

  if (!Number.isFinite(balance) || balance <= 0) {
    return {
      periods: 0,
      total_interest: 0,
      total_repaid: 0,
      total_extra: 0,
      final_balance: 0,
      paid_off: true,
    };
  }

  while (balance > 0.01 && periods < maxPeriods) {
    const interestBearing = Math.max(0, balance - offset);
    const interest = roundMoney(interestBearing * r);
    totalInterest = roundMoney(totalInterest + interest);
    balance = roundMoney(balance + interest);

    let due = payment + extra;
    if (due > balance) due = balance;
    const contractualShare = Math.min(payment, due);
    const extraShare = Math.max(0, due - contractualShare);

    balance = roundMoney(balance - due);
    totalRepaid = roundMoney(totalRepaid + due);
    totalExtra = roundMoney(totalExtra + extraShare);
    periods += 1;

    if (payment + extra <= 0 && interest >= 0) {
      // Zero/negative payment cannot repay — stop
      break;
    }
  }

  return {
    periods,
    total_interest: totalInterest,
    total_repaid: totalRepaid,
    total_extra: totalExtra,
    final_balance: Math.max(0, balance),
    paid_off: balance <= 0.01,
  };
}

/**
 * Months (approx) from period count at a given frequency.
 * @param {number} periods
 * @param {number} periodsPerYear
 */
function periodsToMonths(periods, periodsPerYear) {
  return roundMoney((Number(periods) / Number(periodsPerYear)) * 12);
}

function formatDuration(monthsApprox) {
  const m = Math.round(Number(monthsApprox) || 0);
  if (m < 1) return 'less than 1 month';
  const years = Math.floor(m / 12);
  const rem = m % 12;
  if (years === 0) return `${rem} month${rem === 1 ? '' : 's'}`;
  if (rem === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years} year${years === 1 ? '' : 's'} ${rem} month${rem === 1 ? '' : 's'}`;
}

function money(n) {
  return `$${roundMoney(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

module.exports = {
  FREQUENCY,
  resolveFrequency,
  periodRate,
  paymentAmount,
  amortizeUntilPaid,
  periodsToMonths,
  formatDuration,
  money,
};
