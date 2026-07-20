'use strict';

const { paymentAmount } = require('./loanMath');
const { selectRepresentativeProducts } = require('../cdr/normalize');

/**
 * Build a ranked list of eligible live CDR mortgage products for a buyer
 * who has already passed/warned on lending checks.
 *
 * @param {object[]} allNormalized — CDR-normalized product rows
 * @param {{
 *   loanAmount: number,
 *   termMonths: number,
 *   isPpor?: boolean,
 *   maxPerBank?: number,
 * }} opts
 * @returns {{ products: object[], purpose: string, note: string }}
 */
function buildEligibleLenderProducts(allNormalized, opts = {}) {
  const loanAmount = Number(opts.loanAmount) || 0;
  const termMonths = Number(opts.termMonths) || 360;
  const isPpor = opts.isPpor !== false;
  const maxPerBank = opts.maxPerBank != null ? opts.maxPerBank : 2;
  const purpose = isPpor ? 'OWNER_OCCUPIED' : 'INVESTMENT';

  const pool = Array.isArray(allNormalized) ? allNormalized : [];
  const purposeMatched = pool.filter((r) => {
    if (!r || r.special_eligibility) return false;
    if (r.loan_purpose == null) return true; // some banks omit purpose — keep
    return r.loan_purpose === purpose;
  });

  // Prefer purpose-matched pool; if empty, fall back to all non-special products
  // so the UI still shows something (labelled as unfiltered).
  const usedFallback = purposeMatched.length === 0 && pool.length > 0;
  const source = usedFallback
    ? pool.filter((r) => !r.special_eligibility)
    : purposeMatched;

  const picks = selectRepresentativeProducts(source, maxPerBank, {
    preferredPurpose: purpose,
  });

  const products = picks
    .map((l) => {
      const monthly = loanAmount > 0
        ? paymentAmount(loanAmount, l.rate, termMonths, 'monthly')
        : null;
      return {
        id: l.id,
        bank_id: l.bank_id || null,
        lender: l.lender,
        product: l.product || l.name,
        name: l.name,
        rate: l.rate,
        comparison_rate: l.comparison_rate,
        fixed_or_variable: l.fixed_or_variable,
        fixed_period_months: l.fixed_period_months || null,
        loan_purpose: l.loan_purpose || purpose,
        repayment_type: l.repayment_type || null,
        offset: Boolean(l.offset),
        redraw: Boolean(l.redraw),
        upfront_fees: l.upfront_fees ?? null,
        ongoing_annual_fees: l.ongoing_annual_fees ?? null,
        fees_estimated: l.fees_estimated !== false,
        monthly_repayment: monthly,
        loan_amount: loanAmount || null,
        term_months: termMonths,
        application_uri: l.links?.application || null,
        overview_uri: l.links?.overview || null,
        eligibility: Array.isArray(l.eligibility) ? l.eligibility : [],
        special_eligibility: Boolean(l.special_eligibility),
        special_eligibility_label: l.special_eligibility_label || null,
        provenance: 'cdr_prd',
      };
    })
    .sort((a, b) => (a.rate || 99) - (b.rate || 99));

  const purposeLabel = isPpor ? 'owner-occupied' : 'investment';
  const note = usedFallback
    ? `Live CDR products — no ${purposeLabel}-labelled rates found; showing best available rates (verify purpose with the lender).`
    : `Live CDR products filtered for ${purposeLabel} principal & interest where available. Not a credit decision — product eligibility is confirmed by the lender/broker.`;

  return {
    products,
    purpose,
    purpose_label: purposeLabel,
    used_fallback: usedFallback,
    note,
    count: products.length,
    banks: [...new Set(products.map((p) => p.lender))],
  };
}

module.exports = {
  buildEligibleLenderProducts,
};
