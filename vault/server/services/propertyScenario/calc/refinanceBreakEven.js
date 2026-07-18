'use strict';

const { roundMoney, MORTGAGE_GOVT_FEES, MORTGAGE_GOVT_FEES_DEFAULT } = require('./tables');

/**
 * Default fee assumptions — used only when CDR data or explicit opts don't supply a figure.
 * Sources:
 *   Discharge fee:     ASIC Moneysmart / lender schedules — typical $150–$500; $350 is midpoint
 *   Establishment fee: varies widely ($0 for many online lenders to $1,000+ for some majors);
 *                      $600 is a conservative mid-market estimate — CDR data overrides this
 *   Valuation fee:     $0 (many lenders waive for refinance) to $600; $250 is midpoint
 *   Legal/conveyancing:$300–$800 for refinance; $400 is midpoint
 *   Govt fees:         See MORTGAGE_GOVT_FEES table in tables.js — state-specific land titles fees
 */
const DEFAULT_DISCHARGE_FEE = 350;         // range $150–$500
const DEFAULT_ESTABLISHMENT_FEE = 600;     // range $0–$1,000; CDR data should override
const DEFAULT_VALUATION_FEE = 250;         // range $0–$600; often waived on refinance
const DEFAULT_LEGAL_FEE = 400;             // range $300–$800

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
 * @param {number}  [opts.discharge_fee]      — override discharge fee
 * @param {number}  [opts.establishment_fee]  — override establishment fee (CDR data preferred)
 * @param {number}  [opts.valuation_fee]      — override valuation fee
 * @param {number}  [opts.legal_fee]          — override legal/conveyancing fee
 * @param {boolean} [opts.valuation_waived]   — set true when lender confirms no valuation fee
 * @param {string}  [opts.state]              — AU state code for government fees (NSW, VIC, etc.)
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

  // ── Itemised cost build-up ───────────────────────────────────────────────
  const discharge = opts.discharge_fee != null ? Number(opts.discharge_fee) : DEFAULT_DISCHARGE_FEE;
  const establishment = opts.establishment_fee != null ? Number(opts.establishment_fee) : DEFAULT_ESTABLISHMENT_FEE;

  const valuationWaived = opts.valuation_waived === true;
  const valuation = valuationWaived ? 0
    : (opts.valuation_fee != null ? Number(opts.valuation_fee) : DEFAULT_VALUATION_FEE);

  const legal = opts.legal_fee != null ? Number(opts.legal_fee) : DEFAULT_LEGAL_FEE;

  // Government land titles fees: discharge old mortgage + register new mortgage
  const state = opts.state || null;
  const govtFeeEntry = state ? MORTGAGE_GOVT_FEES[state] : null;
  const govtFees = govtFeeEntry ? govtFeeEntry.total : MORTGAGE_GOVT_FEES_DEFAULT;
  const govtFeeSource = govtFeeEntry
    ? govtFeeEntry.note
    : `National average used — state not supplied (range $240–$440 depending on state)`;

  const upfrontCost = roundMoney(discharge + establishment + valuation + legal + govtFees);

  // ── Source / assumption notes ────────────────────────────────────────────
  if (opts.discharge_fee != null) {
    assumptions.push(`Discharge fee $${discharge} — from CDR/lender data.`);
  } else {
    assumptions.push(`Discharge fee $${discharge} — industry midpoint ($150–$500); confirm with your current lender.`);
  }

  if (opts.establishment_fee != null) {
    assumptions.push(`Establishment fee $${establishment} — from lender CDR data.`);
  } else {
    assumptions.push(`Establishment fee $${establishment} — industry estimate ($0–$1,000); check new lender's fee schedule.`);
  }

  if (valuationWaived) {
    assumptions.push('Valuation fee: $0 — lender confirmed waived.');
  } else if (opts.valuation_fee != null) {
    assumptions.push(`Valuation fee $${valuation} — from lender data.`);
  } else {
    assumptions.push(`Valuation fee $${valuation} — estimate ($0–$600); many lenders waive for refinance — confirm.`);
  }

  assumptions.push(`Legal/conveyancing $${legal} — estimate ($300–$800) for refinance title work.`);

  assumptions.push(`Government fees $${govtFees} — ${govtFeeSource}. Covers mortgage discharge (old lender) + new mortgage registration with state land titles.`);

  caveats.push(
    'Break-even ignores cashback offers, honeymoon rates, offset account differences, and IO vs P&I repayment type changes.'
  );
  caveats.push(
    'If switching from fixed, early-repayment / break costs may apply separately — see early payout module.'
  );
  caveats.push(
    'Some lenders bundle valuation and legal into the establishment fee — confirm itemised costs with each lender before switching.'
  );

  if (errors.length) {
    return {
      ok: false,
      upfront_cost: upfrontCost,
      discharge_fee: discharge,
      establishment_fee: establishment,
      valuation_fee: valuation,
      legal_fee: legal,
      govt_fees: govtFees,
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
    valuation_fee: valuation,
    legal_fee: legal,
    govt_fees: govtFees,
    govt_fees_source: govtFeeSource,
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
  DEFAULT_VALUATION_FEE,
  DEFAULT_LEGAL_FEE,
};
