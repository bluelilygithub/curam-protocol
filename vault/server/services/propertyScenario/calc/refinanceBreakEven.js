'use strict';

const { roundMoney } = require('./tables');

/** Default fee assumptions when Scenario does not supply them. */
const DEFAULT_DISCHARGE_FEE = 350;
const DEFAULT_ESTABLISHMENT_FEE = 600;
const DEFAULT_OTHER_COSTS = 400; // valuation / legal sketch

/**
 * Approximate monthly repayment (P&I) for break-even maths.
 * @param {number} balance
 * @param {number} annualRatePct
 * @param {number} termMonths
 */
function monthlyRepayment(balance, annualRatePct, termMonths) {
  const n = Math.max(1, Number(termMonths) || 1);
  const r = Number(annualRatePct) / 100 / 12;
  const p = Number(balance);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(r) || r === 0) return roundMoney(p / n);
  const factor = (r * (1 + r) ** n) / ((1 + r) ** n - 1);
  return roundMoney(p * factor);
}

/**
 * Refinance / switch_lender break-even.
 *
 * @param {object} fields — refinance or switch_lender event.fields
 * @param {object} [opts]
 * @param {number} [opts.discharge_fee]
 * @param {number} [opts.establishment_fee]
 * @param {number} [opts.other_costs]
 * @returns {object}
 */
function calculateRefinanceBreakEven(fields, opts = {}) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const f = fields || {};
  const current = f.current_loan || {};
  const target = f.target_loan || {};

  const curBal = Number(current.balance);
  const tgtBal = Number(target.balance != null ? target.balance : current.balance);
  const curRate = Number(current.rate);
  const tgtRate = Number(target.rate);
  const curTerm = Number(current.term_remaining_months);
  const tgtTerm = Number(target.term_remaining_months != null ? target.term_remaining_months : current.term_remaining_months);

  if (!Number.isFinite(curBal) || curBal < 0) errors.push('current_loan.balance required');
  if (!Number.isFinite(curRate) || curRate < 0) errors.push('current_loan.rate required');
  if (!Number.isFinite(tgtRate) || tgtRate < 0) errors.push('target_loan.rate required');
  if (!Number.isFinite(curTerm) || curTerm <= 0) errors.push('current_loan.term_remaining_months required');

  const discharge = opts.discharge_fee != null ? Number(opts.discharge_fee) : DEFAULT_DISCHARGE_FEE;
  const establishment = opts.establishment_fee != null ? Number(opts.establishment_fee) : DEFAULT_ESTABLISHMENT_FEE;
  const other = opts.other_costs != null ? Number(opts.other_costs) : DEFAULT_OTHER_COSTS;
  const upfrontCost = roundMoney(discharge + establishment + other);

  assumptions.push(
    `Upfront refinance costs assumed: discharge $${discharge}, establishment $${establishment}, other $${other} (override via opts).`
  );
  caveats.push(
    'Break-even ignores cashback, honeymoon rates, offset accounts, and repayment type changes (IO vs P&I).'
  );
  caveats.push(
    'If switching from fixed, early-repayment / break costs may apply separately — see early payout module.'
  );

  if (errors.length) {
    return {
      ok: false,
      upfront_cost: upfrontCost,
      monthly_repayment_current: null,
      monthly_repayment_target: null,
      monthly_saving: null,
      break_even_months: null,
      rate_differential_pp: null,
      caveats,
      assumptions,
      errors,
    };
  }

  const termForTarget = Number.isFinite(tgtTerm) && tgtTerm > 0 ? tgtTerm : curTerm;
  const balForTarget = Number.isFinite(tgtBal) ? tgtBal : curBal;

  const payCurrent = monthlyRepayment(curBal, curRate, curTerm);
  const payTarget = monthlyRepayment(balForTarget, tgtRate, termForTarget);
  const monthlySaving = roundMoney(payCurrent - payTarget);
  const rateDiff = roundMoney(curRate - tgtRate);

  let breakEvenMonths = null;
  if (monthlySaving > 0) {
    breakEvenMonths = Math.ceil(upfrontCost / monthlySaving);
    assumptions.push(
      `Break-even months = ceil(upfront $${upfrontCost} / monthly saving $${monthlySaving}).`
    );
  } else if (monthlySaving === 0) {
    caveats.push('No modelled monthly saving — break-even not defined (costs never recovered via repayment difference).');
  } else {
    caveats.push(
      'Target repayment is higher than current — refinance does not break even on repayment maths alone (may still be rational for features/flexibility).'
    );
    breakEvenMonths = null;
  }

  if (current.fixed_or_variable === 'fixed') {
    caveats.push(
      'Current loan is fixed — include any break cost (using fixed_period_remaining_months, not overall loan term) before relying on this break-even.'
    );
  }

  return {
    ok: true,
    upfront_cost: upfrontCost,
    discharge_fee: discharge,
    establishment_fee: establishment,
    other_costs: other,
    monthly_repayment_current: payCurrent,
    monthly_repayment_target: payTarget,
    monthly_saving: monthlySaving,
    break_even_months: breakEvenMonths,
    rate_differential_pp: rateDiff,
    caveats,
    assumptions,
    errors,
  };
}

module.exports = {
  calculateRefinanceBreakEven,
  monthlyRepayment,
  DEFAULT_DISCHARGE_FEE,
  DEFAULT_ESTABLISHMENT_FEE,
  DEFAULT_OTHER_COSTS,
};
