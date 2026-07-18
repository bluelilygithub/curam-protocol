'use strict';

const { roundMoney } = require('./tables');

function monthsBetween(isoStart, isoEnd) {
  const a = new Date(isoStart);
  const b = new Date(isoEnd);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  // Day-of-month matters for the ATO's "held more than 12 months" discount test.
  // e.g. 2020-01-31 → 2021-01-01 is 12 calendar months apart by year/month alone,
  // but ownership was actually just under 12 months — without this adjustment the
  // 50% CGT discount could be wrongly applied a few days early.
  if (b.getDate() < a.getDate()) {
    months -= 1;
  }
  return months;
}

/**
 * CGT estimator for a sell event.
 * Does NOT confidently calculate partial main-residence / 6-year-rule outcomes.
 *
 * @param {object} sellFields — Scenario sell event.fields
 * @param {object} [opts]
 * @param {string} [opts.sale_date] — defaults to settlement_date or today
 * @returns {object}
 */
function calculateCgt(sellFields, opts = {}) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const fields = sellFields || {};

  const salePrice = Number(fields.property_value);
  const costBase = Number(fields.purchase_price);
  const purchaseDate = fields.purchase_date;
  const saleDate = opts.sale_date || fields.settlement_date || null;
  const wasEverIp = fields.was_ever_investment_property;

  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    errors.push('sell.fields.property_value (sale price) must be a positive number');
  }
  if (!Number.isFinite(costBase) || costBase < 0) {
    errors.push('sell.fields.purchase_price (cost base start) must be a non-negative number');
  }
  if (typeof wasEverIp !== 'boolean') {
    errors.push('sell.fields.was_ever_investment_property must be known before CGT can be estimated');
  }

  if (errors.length) {
    return {
      ok: false,
      capital_gain_gross: null,
      cgt_discount_applied: false,
      taxable_capital_gain_estimate: null,
      main_residence_exempt: false,
      held_over_12_months: null,
      partial_exemption_flagged: false,
      is_capital_loss: false,
      capital_loss_amount: 0,
      caveats,
      assumptions,
      errors,
    };
  }

  const grossGain = roundMoney(salePrice - costBase);
  assumptions.push(
    'Cost base uses purchase_price only. Under ATO rules, your actual cost base also includes: stamp duty paid on purchase, conveyancing/legal fees on acquisition, capital improvements, and some borrowing costs — all of which reduce your taxable gain. Providing these figures would lower the CGT estimate shown here.'
  );
  caveats.push(
    'This is not tax advice. Capital gains tax depends on your full cost base, ownership history, and ATO rules — consult a tax agent.'
  );

  // Partial / 6-year rule: if ever investment, we do NOT know occupancy timeline
  let partialExemptionFlagged = false;

  if (wasEverIp === false) {
    assumptions.push('Property flagged as never an investment — applying full main residence exemption.');
    return {
      ok: true,
      capital_gain_gross: grossGain,
      cgt_discount_applied: false,
      taxable_capital_gain_estimate: 0,
      main_residence_exempt: true,
      held_over_12_months: null,
      partial_exemption_flagged: false,
      is_capital_loss: false,
      capital_loss_amount: 0,
      caveats: [
        ...caveats,
        'Main residence exemption assumed in full because was_ever_investment_property is false. If any period was rented or used to produce income, this estimate is wrong.',
      ],
      assumptions,
      errors,
    };
  }

  // was ever investment
  caveats.push(
    'Property was ever an investment: full main residence exemption does not automatically apply.'
  );
  caveats.push(
    '6-year rule / partial main-residence exemption: if you lived in the property and later rented it (or the reverse), exemption can be partial. This module does NOT compute a number for that — get tax advice with occupancy dates.'
  );
  partialExemptionFlagged = true;

  let heldOver12 = null;
  if (purchaseDate && saleDate) {
    const months = monthsBetween(purchaseDate, saleDate);
    if (months != null) {
      heldOver12 = months >= 12;
      assumptions.push(`Holding period estimated at ${months} months from purchase_date to sale/settlement date.`);
    }
  } else {
    caveats.push('Purchase/sale dates incomplete — cannot confirm >12 month holding for CGT discount.');
  }

  let discountApplied = false;
  let taxable = grossGain;
  const isCapitalLoss = grossGain < 0;

  if (isCapitalLoss) {
    assumptions.push(
      `Capital loss of $${Math.abs(grossGain).toLocaleString()} on this simplified cost base (sale price below purchase price).`
    );
    caveats.push(
      'A capital loss cannot be deducted against other (non-capital) income, but can generally be carried '
      + 'forward to offset capital gains in future income years — keep records and confirm treatment with a tax agent.'
    );
    taxable = 0;
  } else if (grossGain === 0) {
    assumptions.push('No capital gain or loss (sale price equals purchase price on this simplified cost base).');
    taxable = 0;
  } else if (heldOver12 === true) {
    discountApplied = true;
    taxable = roundMoney(grossGain * 0.5);
    assumptions.push('Applied 50% CGT discount for assets held more than 12 months (individuals). Companies do not get this discount.');
  } else if (heldOver12 === false) {
    assumptions.push('Held ≤12 months — no 50% CGT discount applied.');
  } else {
    // Unknown holding — show both and prefer no discount for conservative taxable estimate? 
    // Spec: 50% if held >12 months. If unknown, caveat and don't apply discount confidently.
    caveats.push('Holding period unknown — taxable gain shown without 50% discount. If held >12 months, discount may apply.');
    taxable = grossGain;
  }

  return {
    ok: true,
    capital_gain_gross: grossGain,
    cgt_discount_applied: discountApplied,
    taxable_capital_gain_estimate: taxable,
    main_residence_exempt: false,
    held_over_12_months: heldOver12,
    partial_exemption_flagged: partialExemptionFlagged,
    is_capital_loss: isCapitalLoss,
    capital_loss_amount: isCapitalLoss ? Math.abs(grossGain) : 0,
    caveats,
    assumptions,
    errors,
  };
}

module.exports = { calculateCgt, monthsBetween };
