'use strict';

const { STAMP_DUTY_TABLES, LMI_TABLE, AS_OF, dutyFromBrackets, roundMoney } = require('./tables');

/**
 * Stamp duty + LMI for a buy event slice.
 *
 * @param {object} buyFields — Scenario buy event.fields
 * @param {object} [opts]
 * @param {number} [opts.loan_amount] — override; else buyFields.loan.balance
 * @returns {{
 *   ok: boolean,
 *   property_value: number|null,
 *   state: string|null,
 *   stamp_duty_standard: number|null,
 *   stamp_duty_payable: number|null,
 *   fhb_concession_applied: boolean,
 *   fhb_concession_amount: number,
 *   ppor_concession_applied: boolean,
 *   ppor_concession_amount: number,
 *   deposit_amount: number|null,
 *   loan_amount: number|null,
 *   lvr: number|null,
 *   lmi_required: boolean,
 *   lmi_estimate: number|null,
 *   total_upfront_govt_and_lmi: number|null,
 *   caveats: string[],
 *   assumptions: string[],
 *   errors: string[],
 * }}
 */
function calculateStampDutyLmi(buyFields, opts = {}) {
  const caveats = [];
  const assumptions = [];
  const errors = [];

  const fields = buyFields || {};
  const state = fields.state || null;
  const propertyValue = Number(fields.property_value);
  const isFhb = fields.is_first_home_buyer === true || fields.is_first_home_buyer === 'true' || fields.is_first_home_buyer === 'yes';
  // Tolerate common truthy encodings — missing/undefined must NOT default to PPOR
  // (investors would incorrectly receive the home concession).
  const isPpor = fields.is_ppor === true || fields.is_ppor === 'true' || fields.is_ppor === 'yes';
  const deposit = fields.deposit_amount != null ? Number(fields.deposit_amount) : null;
  const loanAmount = opts.loan_amount != null
    ? Number(opts.loan_amount)
    : (fields.loan?.balance != null ? Number(fields.loan.balance) : null);

  caveats.push(
    `Stamp duty brackets are an estimator as of ${AS_OF} — confirm with the state revenue office before committing.`
  );

  if (!state || !STAMP_DUTY_TABLES[state]) {
    errors.push('buy.fields.state is required and must be a supported AU state/territory');
  }
  if (!Number.isFinite(propertyValue) || propertyValue <= 0) {
    errors.push('buy.fields.property_value must be a positive number');
  }

  if (errors.length) {
    return {
      ok: false,
      property_value: Number.isFinite(propertyValue) ? propertyValue : null,
      state,
      stamp_duty_standard: null,
      stamp_duty_payable: null,
      fhb_concession_applied: false,
      fhb_concession_amount: 0,
      ppor_concession_applied: false,
      ppor_concession_amount: 0,
      deposit_amount: deposit,
      loan_amount: loanAmount,
      lvr: null,
      lmi_required: false,
      lmi_estimate: null,
      total_upfront_govt_and_lmi: null,
      caveats,
      assumptions,
      errors,
    };
  }

  const table = STAMP_DUTY_TABLES[state];
  const stampDutyStandard = dutyFromBrackets(propertyValue, table.brackets);
  let stampDutyPayable = stampDutyStandard;
  let fhbApplied = false;
  let fhbConcessionAmount = 0;
  let pporConcessionApplied = false;
  let pporConcessionAmount = 0;

  // ── Concession hierarchy (take the lowest applicable duty) ───────────────────
  // 1. General / investor rate (default)
  // 2. PPOR home concession — ANY owner-occupier (incl. FHBs above first-home
  //    thresholds). QLD saves up to $7,175 vs general for properties ≥ $350k.
  // 3. First-home concession — often more generous (full exemption / taper).
  //
  // IMPORTANT: failing the first-home thresholds must NOT fall through to the
  // general rate when the buyer is still a PPOR — home concession still applies.

  if (isPpor && table.home_concession_brackets) {
    const homeDuty = dutyFromBrackets(propertyValue, table.home_concession_brackets);
    if (homeDuty < stampDutyPayable) {
      pporConcessionAmount = roundMoney(stampDutyPayable - homeDuty);
      stampDutyPayable = homeDuty;
      pporConcessionApplied = true;
      assumptions.push(
        `Owner-occupier (PPOR) home concession applied for ${state}: duty reduced by $${pporConcessionAmount.toLocaleString('en-AU')} ` +
        `(from $${Math.round(stampDutyStandard).toLocaleString('en-AU')} to $${Math.round(homeDuty).toLocaleString('en-AU')}).`
      );
    }
  }

  if (isFhb) {
    assumptions.push('First-home-buyer concession applied using simplified eligibility — genuine FHB / PPR tests not verified.');
    caveats.push(table.fhb.note);
    const { full_exemption_max: fullMax, concessional_max: concMax } = table.fhb;
    if (fullMax != null && propertyValue <= fullMax) {
      fhbConcessionAmount = roundMoney(stampDutyStandard);
      stampDutyPayable = 0;
      fhbApplied = true;
      // FHB full exemption supersedes home concession for the payable amount.
      pporConcessionApplied = false;
      pporConcessionAmount = 0;
      assumptions.push(`Assumed full FHB duty exemption in ${state} at purchase ≤ $${fullMax.toLocaleString()}.`);
    } else if (concMax != null && propertyValue <= concMax && fullMax != null) {
      // Linear taper between fullMax and concMax (illustrative), then take the
      // better of tapered FHB vs any already-applied home concession.
      const span = concMax - fullMax;
      const t = span > 0 ? (propertyValue - fullMax) / span : 1;
      const fhbDuty = roundMoney(stampDutyStandard * Math.min(1, Math.max(0, t)));
      if (fhbDuty < stampDutyPayable) {
        fhbConcessionAmount = roundMoney(stampDutyStandard - fhbDuty);
        stampDutyPayable = fhbDuty;
        fhbApplied = true;
        pporConcessionApplied = false;
        pporConcessionAmount = 0;
        assumptions.push(
          `Assumed tapered FHB concession in ${state} between $${fullMax.toLocaleString()} and $${concMax.toLocaleString()}.`
        );
      } else {
        assumptions.push(
          `FHB tapered concession in ${state} calculated at $${fhbDuty.toLocaleString('en-AU')} — ` +
          `PPOR home concession ($${stampDutyPayable.toLocaleString('en-AU')}) is more favourable and was retained.`
        );
      }
    } else if (fullMax == null && concMax == null) {
      caveats.push(`No automatic FHB exemption modelled for ${state}; ${pporConcessionApplied ? 'PPOR home concession retained' : 'standard duty applied'}.`);
    } else {
      caveats.push(
        `Purchase price above modelled FHB thresholds for ${state}; ` +
        `${pporConcessionApplied ? 'PPOR home concession retained (first-home exemption not available at this price)' : 'standard duty applied'} ` +
        `(confirm with revenue office).`
      );
    }
  } else if (fields.is_first_home_buyer === false) {
    assumptions.push('Treated as non–first-home-buyer (no FHB concession).');
  } else {
    caveats.push('is_first_home_buyer not set — FHB concessions not applied.');
  }

  let lvr = null;
  let lmiRequired = false;
  let lmiEstimate = null;

  // BUG FIX: LVR must be compared against the 0.80 threshold using its *raw* ratio.
  // roundMoney() rounds to 2dp (cent precision), which for a 0–1 ratio means whole
  // percentage points — any LVR from 80.001%–80.499% previously rounded down to
  // exactly 0.80 and silently skipped LMI even though it was genuinely over 80%.
  // We now round only for display (4dp ≈ basis-point precision) and always branch
  // on the unrounded ratio.
  if (Number.isFinite(loanAmount) && loanAmount > 0 && propertyValue > 0) {
    const rawLvr = loanAmount / propertyValue;
    lvr = Math.round(rawLvr * 10000) / 10000;
    if (rawLvr > 0.80) {
      lmiRequired = true;
      const band = LMI_TABLE.find((b) => rawLvr <= b.lvrMax) || LMI_TABLE[LMI_TABLE.length - 1];
      lmiEstimate = roundMoney(loanAmount * band.rate);
      assumptions.push(
        `LMI estimate uses indicative premium ${roundMoney(band.rate * 100)}% of loan at LVR ${(rawLvr * 100).toFixed(2)}% — not a lender quote.`
      );
      caveats.push(
        'Lenders and insurers price LMI differently (loan amount, credit, postcode, occupancy). Treat this as order-of-magnitude only.'
      );
    } else {
      assumptions.push('LVR ≤ 80% — assumed no Lenders Mortgage Insurance.');
    }
  } else if (deposit != null && Number.isFinite(deposit) && propertyValue > 0) {
    const impliedLoan = Math.max(0, propertyValue - deposit);
    const rawLvr = impliedLoan / propertyValue;
    lvr = Math.round(rawLvr * 10000) / 10000;
    if (rawLvr > 0.80) {
      lmiRequired = true;
      const band = LMI_TABLE.find((b) => rawLvr <= b.lvrMax) || LMI_TABLE[LMI_TABLE.length - 1];
      lmiEstimate = roundMoney(impliedLoan * band.rate);
      assumptions.push('Loan amount inferred as property_value − deposit_amount.');
      assumptions.push(
        `LMI estimate uses indicative premium ${roundMoney(band.rate * 100)}% of inferred loan at LVR ${(rawLvr * 100).toFixed(2)}%.`
      );
    }
  } else {
    caveats.push('Insufficient deposit/loan data to estimate LMI.');
  }

  const total = roundMoney(
    stampDutyPayable + (lmiEstimate != null ? lmiEstimate : 0)
  );

  return {
    ok: true,
    property_value: propertyValue,
    state,
    stamp_duty_standard: stampDutyStandard,
    stamp_duty_payable: stampDutyPayable,
    fhb_concession_applied: fhbApplied,
    fhb_concession_amount: fhbConcessionAmount,
    ppor_concession_applied: pporConcessionApplied,
    ppor_concession_amount: pporConcessionAmount,
    deposit_amount: deposit,
    loan_amount: loanAmount,
    lvr,
    lmi_required: lmiRequired,
    lmi_estimate: lmiEstimate,
    total_upfront_govt_and_lmi: total,
    caveats,
    assumptions,
    errors,
  };
}

module.exports = { calculateStampDutyLmi };
