'use strict';

const { roundMoney } = require('./tables');

/**
 * Resolve months left on the *fixed-rate period* only — never the full loan term.
 * Precedence: opts → event.fields → loan.fixed_period_remaining_months
 * Deliberately does NOT fall back to loan.term_remaining_months (that caused 3–5× overstates).
 *
 * @param {object} fields
 * @param {object} loan
 * @param {object} opts
 * @returns {{ months: number|null, source: string|null }}
 */
function resolveFixedPeriodRemainingMonths(fields, loan, opts = {}) {
  if (opts.remaining_fixed_months != null && Number.isFinite(Number(opts.remaining_fixed_months))) {
    return { months: Number(opts.remaining_fixed_months), source: 'opts.remaining_fixed_months' };
  }
  if (opts.fixed_period_remaining_months != null && Number.isFinite(Number(opts.fixed_period_remaining_months))) {
    return { months: Number(opts.fixed_period_remaining_months), source: 'opts.fixed_period_remaining_months' };
  }
  if (fields.fixed_period_remaining_months != null && Number.isFinite(Number(fields.fixed_period_remaining_months))) {
    return { months: Number(fields.fixed_period_remaining_months), source: 'fields.fixed_period_remaining_months' };
  }
  if (loan.fixed_period_remaining_months != null && Number.isFinite(Number(loan.fixed_period_remaining_months))) {
    return { months: Number(loan.fixed_period_remaining_months), source: 'current_loan.fixed_period_remaining_months' };
  }
  return { months: null, source: null };
}

/**
 * Fixed-rate early payout — interest-rate-differential style estimate.
 *
 * break_cost ≈ balance × (contract_rate − comparison_rate) / 100 × (remaining_fixed_months / 12)
 *
 * remaining_fixed_months = months left on the fixed-rate *period* (typically ≤ 60 in AU),
 * NOT months left on the overall loan amortisation term.
 *
 * @param {object} fields — early_payout event.fields
 * @param {object} [opts]
 * @param {number} [opts.comparison_rate] — market / lender comparison rate (%). Required for IRD estimate.
 * @param {number} [opts.remaining_fixed_months] — alias for fixed_period_remaining_months
 * @param {number} [opts.fixed_period_remaining_months]
 * @param {boolean} [opts.was_ever_investment_property]
 * @returns {object}
 */
function calculateEarlyPayoutBreakCost(fields, opts = {}) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const f = fields || {};
  const loan = f.current_loan || {};

  const balance = Number(loan.balance);
  const contractRate = Number(loan.rate);
  const comparisonRate = opts.comparison_rate != null ? Number(opts.comparison_rate) : null;
  const rateType = loan.fixed_or_variable;
  const wasIp = opts.was_ever_investment_property;
  const loanTermRemaining = Number(loan.term_remaining_months);
  const { months: remainingFixed, source: fixedSource } = resolveFixedPeriodRemainingMonths(f, loan, opts);

  if (!Number.isFinite(balance) || balance < 0) errors.push('current_loan.balance required');
  if (!Number.isFinite(contractRate) || contractRate < 0) errors.push('current_loan.rate required');

  caveats.push(
    'Break-cost formulas are lender-specific (often more complex than a simple IRD). This is an estimate only — request a formal payout quote.'
  );

  if (rateType === 'variable') {
    assumptions.push('Loan flagged variable — modelled break cost is $0 (variable loans typically have no IRD break cost; exit fees may still apply).');
    return {
      ok: errors.length === 0,
      break_cost_estimate: 0,
      method: 'variable_no_ird',
      interest_rate_differential_pp: null,
      remaining_fixed_months: null,
      loan_term_remaining_months: Number.isFinite(loanTermRemaining) ? loanTermRemaining : null,
      fixed_period_source: null,
      tax_deductibility_flagged: false,
      caveats: [
        ...caveats,
        'Confirm any discharge/admin fees with the lender even on variable rates.',
      ],
      assumptions,
      errors,
    };
  }

  if (rateType !== 'fixed') {
    errors.push('current_loan.fixed_or_variable should be "fixed" or "variable" for break-cost modelling');
  }

  // remainingFixed === 0 means the fixed-rate period has already ended — distinct from
  // "not provided" (null). With zero months left there is no differential period to
  // break, so the IRD cost is $0 regardless of comparison_rate. Previously this was
  // lumped into the "remainingFixed <= 0" branch below and treated as a missing-input
  // error, refusing to compute anything instead of returning the correct $0 result.
  if (rateType === 'fixed' && Number.isFinite(remainingFixed) && remainingFixed === 0) {
    return {
      ok: true,
      break_cost_estimate: 0,
      method: 'fixed_period_ended',
      interest_rate_differential_pp: null,
      remaining_fixed_months: 0,
      loan_term_remaining_months: Number.isFinite(loanTermRemaining) ? loanTermRemaining : null,
      fixed_period_source: fixedSource,
      tax_deductibility_flagged: false,
      caveats: [
        ...caveats,
        'Fixed-rate period has already ended (0 months remaining) — no interest-rate-differential break cost applies. Confirm with the lender whether the loan has rolled to variable or a new fixed term.',
      ],
      assumptions,
      errors: [],
    };
  }

  if (!Number.isFinite(comparisonRate)) {
    errors.push('comparison_rate (% p.a.) is required to estimate fixed-rate break cost');
  }
  if (!Number.isFinite(remainingFixed) || remainingFixed < 0) {
    errors.push(
      'fixed_period_remaining_months is required for fixed-rate break cost (months left on the fixed-rate period — typically 1–5 years in Australia). Do not use loan term_remaining_months here.'
    );
  }

  // Guard: refuse to silently treat a loan-term-sized figure as the fixed period
  if (Number.isFinite(remainingFixed) && remainingFixed > 60) {
    caveats.push(
      `fixed_period_remaining_months is ${remainingFixed} (> 60). Australian fixed-rate periods are usually 1–5 years — confirm this is the fixed period left, not the overall loan term.`
    );
  }
  if (
    Number.isFinite(remainingFixed)
    && Number.isFinite(loanTermRemaining)
    && remainingFixed > loanTermRemaining
  ) {
    errors.push(
      `fixed_period_remaining_months (${remainingFixed}) cannot exceed loan term_remaining_months (${loanTermRemaining})`
    );
  }

  if (errors.length) {
    return {
      ok: false,
      break_cost_estimate: null,
      method: 'ird',
      interest_rate_differential_pp: null,
      remaining_fixed_months: remainingFixed,
      loan_term_remaining_months: Number.isFinite(loanTermRemaining) ? loanTermRemaining : null,
      fixed_period_source: fixedSource,
      tax_deductibility_flagged: false,
      caveats,
      assumptions,
      errors,
    };
  }

  const ird = roundMoney(contractRate - comparisonRate);
  let breakCost = 0;
  if (ird > 0) {
    breakCost = roundMoney(balance * (ird / 100) * (remainingFixed / 12));
    assumptions.push(
      `IRD method: balance × ${ird.toFixed(2)}pp × ${(remainingFixed / 12).toFixed(2)} years left on the fixed-rate period (source: ${fixedSource}).`
    );
    assumptions.push(
      `Loan amortisation term remaining is ${Number.isFinite(loanTermRemaining) ? `${loanTermRemaining} months` : 'unknown'} — not used in the IRD formula.`
    );
  } else {
    assumptions.push(
      'Comparison rate ≥ contract rate — IRD economic cost estimated at $0 (lender may still charge admin/discharge fees).'
    );
    caveats.push('Some lenders still charge a minimum break/administrative fee when IRD is nil or negative.');
  }

  let taxFlag = false;
  if (wasIp === true) {
    taxFlag = true;
    caveats.push(
      'Investment property: break costs / refinance costs may be deductible or added to cost base in some cases — do not treat as automatically deductible. Flag for a registered tax professional.'
    );
  } else if (wasIp === false) {
    assumptions.push('Treated as non-investment (PPOR) for deductibility — no investment tax flag raised.');
  } else {
    caveats.push(
      'Unknown whether this loan secures an investment property — if it does, break-cost tax treatment should be reviewed by a tax professional.'
    );
    taxFlag = true;
  }

  return {
    ok: true,
    break_cost_estimate: breakCost,
    method: 'ird',
    interest_rate_differential_pp: ird,
    remaining_fixed_months: remainingFixed,
    loan_term_remaining_months: Number.isFinite(loanTermRemaining) ? loanTermRemaining : null,
    fixed_period_source: fixedSource,
    contract_rate: contractRate,
    comparison_rate: comparisonRate,
    tax_deductibility_flagged: taxFlag,
    caveats,
    assumptions,
    errors,
  };
}

module.exports = {
  calculateEarlyPayoutBreakCost,
  resolveFixedPeriodRemainingMonths,
};
