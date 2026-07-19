'use strict';

/**
 * Buyer qualification check — deterministic AU mortgage pre-qualification.
 *
 * Covers the five most common questions Australian buyers need answered before
 * approaching a lender:
 *   1. Serviceability — how much can I actually borrow?
 *   2. LVR / deposit — do I have enough, and will I pay LMI?
 *   3. Debt-to-income — is the loan size within lender appetite?
 *   4. Genuine savings — does my deposit meet the threshold?
 *   5. First Home Guarantee (FHBG) — am I eligible for 5% no-LMI scheme?
 * Plus: HECS/HELP impact on borrowing capacity.
 *
 * This is NOT a credit decision. Lenders use proprietary systems, actual credit
 * files, and policy overlays that cannot be replicated here. Treat all results
 * as indicative only — not pre-approval, not a guarantee of finance.
 */

const { roundMoney } = require('./tables');
const { calculateStampDutyLmi } = require('./stampDutyLmi');

// ─── APRA serviceability ──────────────────────────────────────────────────────

// APRA requires lenders to stress-test at the higher of (product rate + 3pp) or
// the lender's own floor. Most major lenders use an internal floor of ~8.5-9.5%.
// We use 8.5% as a conservative-but-representative floor.
const APRA_FLOOR_RATE_PCT = 8.5;

// ─── HEM (Household Expenditure Measure) — simplified monthly benchmarks ─────
// Derived from Melbourne Institute HEM data (metro, 2024 approximate).
// Lenders typically use HEM if declared expenses are lower; actual or HEM — whichever higher.
const HEM = {
  single: {
    low:  1400,  // income < $50k p.a.
    mid:  1800,  // income $50k–$100k
    high: 2200,  // income $100k+
  },
  couple: {
    low:  2400,  // combined income < $100k
    mid:  3000,  // combined $100k–$150k
    high: 3600,  // combined $150k+
  },
  family: {
    low:  3000,
    mid:  3800,
    high: 4500,
  },
};

function hemMonthly(householdType, grossAnnualIncome) {
  const t = HEM[householdType] || HEM.single;
  if (grossAnnualIncome < 50000) return t.low;
  if (grossAnnualIncome < 150000) return t.mid;
  return t.high;
}

// ─── HECS/HELP compulsory repayment — ATO 2025-26 marginal method ────────────
//
// Effective 1 July 2025, the system changed from a cliff-bracket rate applied
// to total income to a MARGINAL system: repayment calculated only on income
// ABOVE the minimum repayment threshold of $67,000.
//
// Source: ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds
// 2025-26 thresholds:
//   $0 – $67,000          → NIL
//   $67,001 – $125,000    → 15c for each $1 over $67,000
//   $125,001 – $179,285   → $8,700 + 17c for each $1 over $125,000
//   $179,286+             → 10% of total repayment income
//
// Impact vs old system: lower repayments for most incomes under ~$130k.
// Example: $100k income → OLD cliff $6,000 (6%) → NEW marginal $4,950 (15% of $33k).
const HECS_MIN_THRESHOLD_2526 = 67000;
const HECS_TOTAL_RATE_THRESHOLD_2526 = 179286;

function hecsAnnualRepayment(grossAnnualIncome) {
  if (grossAnnualIncome <= HECS_MIN_THRESHOLD_2526) return 0;
  if (grossAnnualIncome >= HECS_TOTAL_RATE_THRESHOLD_2526) {
    return roundMoney(grossAnnualIncome * 0.10);
  }
  if (grossAnnualIncome > 125000) {
    return roundMoney(8700 + (grossAnnualIncome - 125000) * 0.17);
  }
  return roundMoney((grossAnnualIncome - HECS_MIN_THRESHOLD_2526) * 0.15);
}

// ─── First Home Guarantee property price caps (NHFIC 2024-25) ────────────────
// ─── State First Home Owner Grant (FHOG) data ─────────────────────────────────
// Each entry: { amount, max_value (strictly <), new_homes_only, note, source }
// Only states with confirmed live data included. Others: null (prompt manual check).
// Sources verified July 2026.
const FHOG_BY_STATE = {
  QLD: {
    amount: 30000,
    max_value: 750000,         // strictly < $750,000 (at $750k → not eligible)
    new_homes_only: true,
    note: '$30,000 for new homes (not established); contract signed 20 Nov 2023–30 Jun 2026 (extended going forward). Value must be < $750,000 including land and contract variations.',
    source: 'qro.qld.gov.au/property-concessions-grants/first-home-grant/eligibility',
  },
  VIC: {
    amount: 10000,
    max_value: 750000,
    new_homes_only: true,
    note: '$10,000 for new or substantially renovated homes in regional Victoria; $0 for metro Melbourne new homes (grant ended for metro). Confirm current eligibility with State Revenue Office Victoria.',
    source: 'sro.vic.gov.au',
  },
  SA: {
    amount: 15000,
    max_value: 650000,
    new_homes_only: true,
    note: '$15,000 for new homes (not established). Value cap $650,000.',
    source: 'revenuesa.sa.gov.au',
  },
  WA: {
    amount: 10000,
    max_value: 750000,
    new_homes_only: true,
    note: '$10,000 for new homes (not established). Value cap $750,000.',
    source: 'finance.wa.gov.au/cms/State_Revenue/First_Home_Owner_Grant',
  },
  TAS: {
    amount: 30000,
    max_value: null,            // no property value cap in TAS FHOG as of 2024
    new_homes_only: false,      // TAS FHOG applies to both new and established
    note: '$30,000 for any first home (new or established). Verify current amount and conditions with State Revenue Office Tasmania.',
    source: 'sro.tas.gov.au',
  },
  NSW: null,  // NSW abolished state FHOG for established homes; only stamp duty exemptions remain — no FHOG applicable
  ACT: null,  // ACT uses Home Buyer Concession Scheme (duty concession) — no FHOG
  NT:  {
    amount: 10000,
    max_value: null,
    new_homes_only: false,
    note: '$10,000 Territory Home Owner Grant for NT residents purchasing a new or established home (owner-occupied). Confirm current eligibility at revenue.nt.gov.au.',
    source: 'revenue.nt.gov.au',
  },
};

// ─── Legal/conveyancing estimate for settlement cost summary ──────────────────
// Buyer-side conveyancing in Australia: typically $1,500–$3,000.
// We use $2,000 as a mid-point estimate for the settlement summary.
const LEGAL_ESTIMATE = 2000;

// FHBG property price caps — effective 1 October 2025 (Housing Australia announcement)
// Source: housingaustralia.gov.au/media/unlimited-places-higher-property-price-caps-first-home-buyers-1-october-2025
// Income caps ABOLISHED entirely from 1 October 2025 — no income limit applies.
// Two-tier structure: capital city / regional centre cap and "other areas" cap.
// Regional centres defined by scheme: NSW → Illawarra, Newcastle, Lake Macquarie;
//   VIC → Geelong; QLD → Gold Coast, Sunshine Coast.
// We collect state only — not postcode — so we use the CAPITAL tier as the primary cap
// (covers the majority of Australian buyers) and flag the "other" tier as a lower caveat.
const FHBG_PRICE_CAPS = {
  NSW: { capital: 1500000, other: 800000  },
  VIC: { capital:  950000, other: 650000  },
  QLD: { capital: 1000000, other: 700000  },
  WA:  { capital:  850000, other: 600000  },
  SA:  { capital:  900000, other: 500000  },
  TAS: { capital:  700000, other: 550000  },
  ACT: { capital: 1000000, other: 1000000 }, // single tier
  NT:  { capital:  600000, other: 600000  }, // single tier (Darwin $750k from Jul 2026, conservatively $600k used)
};

// ─── Repayment formula (P&I, monthly rest) ───────────────────────────────────

function monthlyRepayment(principal, annualRatePct, termMonths) {
  if (!principal || !annualRatePct || !termMonths) return null;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return roundMoney(principal / termMonths);
  const factor = (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
  return roundMoney(principal * factor);
}

function maxLoanFromMonthlyRepayment(monthlyRepaymentAmt, annualRatePct, termMonths) {
  if (!monthlyRepaymentAmt || !termMonths || annualRatePct == null) return null;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return roundMoney(monthlyRepaymentAmt * termMonths);
  const factor = (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
  return roundMoney(monthlyRepaymentAmt / factor);
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * @param {object} inputs
 * @param {number}  inputs.propertyValue        purchase price ($)
 * @param {number}  inputs.depositAmount         cash deposit ($)
 * @param {string}  inputs.state                 AU state/territory
 * @param {boolean} inputs.isFhb                 first home buyer?
 * @param {boolean} inputs.isPpor                principal place of residence?
 * @param {number}  inputs.grossAnnualIncome      individual gross income ($/yr before tax)
 * @param {number}  [inputs.partnerGrossIncome]   partner's gross income if joint application
 * @param {'single'|'couple'|'family'} inputs.householdType
 * @param {'payg_fulltime'|'payg_parttime'|'casual'|'contract'|'self_employed'} inputs.employmentType
 * @param {boolean} inputs.hasHecs               has outstanding HECS/HELP debt?
 * @param {number}  [inputs.monthlyDebtRepayments] existing monthly debt payments ($)
 * @param {number}  [inputs.monthlyExpenses]      declared monthly living expenses (overrides HEM if higher)
 * @param {number}  inputs.loanTermYears          loan term (years)
 * @param {number}  inputs.targetRatePct          target interest rate (% p.a.)
 * @param {boolean} [inputs.isNewBuild]            is the property a new/off-the-plan build? (affects FHOG + QLD duty)
 */
function assessBuyerQualification(inputs = {}) {
  const caveats = [];
  const assumptions = [];
  const errors = [];

  const {
    propertyValue,
    depositAmount,
    state,
    isFhb = false,
    isPpor = true,
    grossAnnualIncome,
    partnerGrossIncome = 0,
    householdType = 'single',
    employmentType = 'payg_fulltime',
    hasHecs = false,
    monthlyDebtRepayments = 0,
    monthlyExpenses,
    loanTermYears = 30,
    targetRatePct,
    isNewBuild = false,
  } = inputs;

  // Validation
  if (!Number.isFinite(propertyValue) || propertyValue <= 0) errors.push('propertyValue must be a positive number');
  if (!Number.isFinite(depositAmount) || depositAmount < 0) errors.push('depositAmount must be a non-negative number');
  if (!Number.isFinite(grossAnnualIncome) || grossAnnualIncome <= 0) errors.push('grossAnnualIncome must be a positive number');
  if (!Number.isFinite(targetRatePct) || targetRatePct <= 0) errors.push('targetRatePct must be a positive number');

  if (errors.length) {
    return { ok: false, errors, caveats, assumptions, checks: [], summary: null };
  }

  const termMonths = Math.round(loanTermYears * 12);
  const loanRequested = roundMoney(propertyValue - depositAmount);
  const totalGrossAnnual = grossAnnualIncome + (partnerGrossIncome || 0);
  const isJoint = (partnerGrossIncome || 0) > 0;
  const assessmentRatePct = Math.max(targetRatePct + 3.0, APRA_FLOOR_RATE_PCT);

  assumptions.push(`Loan term: ${loanTermYears} years (${termMonths} months).`);
  assumptions.push(`Target product rate: ${targetRatePct}% p.a. APRA assessment rate applied: ${assessmentRatePct}% p.a. (higher of product + 3pp or ${APRA_FLOOR_RATE_PCT}% floor).`);
  if (isJoint) assumptions.push(`Joint application — combined gross income: $${totalGrossAnnual.toLocaleString('en-AU')} p.a.`);
  caveats.push('This is an indicative qualification check — not a credit decision, not pre-approval. Lenders apply their own credit policies, conduct credit history checks, and use proprietary serviceability models. Results here can differ materially from a lender\'s actual assessment.');

  const checks = [];

  // ─── 1. Employment ──────────────────────────────────────────────────────────
  const empLabels = {
    payg_fulltime: 'PAYG full-time',
    payg_parttime: 'PAYG part-time',
    casual: 'Casual',
    contract: 'Contract',
    self_employed: 'Self-employed',
  };
  const empFlags = {
    payg_fulltime:  { status: 'pass', note: 'Standard lender requirements typically apply. Most lenders require you to have passed probation and have at least 3–6 months at your current employer.' },
    payg_parttime:  { status: 'warn', note: 'Part-time PAYG is acceptable to most lenders if employment is stable. The gross income used here is your stated annual figure — lenders will verify this against payslips.' },
    casual:         { status: 'warn', note: 'Casual employment typically requires 12 months continuous history with the same employer before most lenders will accept the income. Some lenders will not lend to casual workers during probation.' },
    contract:       { status: 'warn', note: 'Contract income is generally accepted if the contract has run for 12+ months or you have a history of renewals. Lenders may use the lower of contract rate or the last 2 years average.' },
    self_employed:  { status: 'warn', note: 'Self-employed borrowers typically need 2 full years of tax returns (individual + business). Some lenders offer low-doc options but these usually attract higher rates and stricter LVR caps. The income figure you\'ve entered must be verifiable via tax returns.' },
  };
  const empFlag = empFlags[employmentType] || empFlags.payg_fulltime;
  checks.push({
    id: 'employment',
    label: 'Employment',
    status: empFlag.status,
    headline: empLabels[employmentType] || employmentType,
    detail: empFlag.note,
    data: { employment_type: employmentType },
  });

  // ─── 2. HECS/HELP impact ────────────────────────────────────────────────────
  const hecsRepaymentAnnual = hasHecs ? hecsAnnualRepayment(grossAnnualIncome) : 0;
  const hecsRepaymentMonthly = roundMoney(hecsRepaymentAnnual / 12);
  if (hasHecs) {
    assumptions.push(`HECS/HELP annual compulsory repayment estimated at $${hecsRepaymentAnnual.toLocaleString('en-AU')} based on income $${grossAnnualIncome.toLocaleString('en-AU')} (ATO 2024-25 schedule).`);
  }

  // ─── 3. Serviceability ──────────────────────────────────────────────────────
  const hem = hemMonthly(householdType, totalGrossAnnual);
  const declaredExpenses = monthlyExpenses && Number.isFinite(monthlyExpenses) ? Number(monthlyExpenses) : null;
  const effectiveExpenses = declaredExpenses != null ? Math.max(declaredExpenses, hem) : hem;
  const existingDebts = Number(monthlyDebtRepayments) || 0;
  const grossMonthly = totalGrossAnnual / 12;

  // Net surplus available to service the new loan
  const netSurplus = roundMoney(grossMonthly - effectiveExpenses - existingDebts - hecsRepaymentMonthly);

  assumptions.push(
    `HEM benchmark for ${householdType}: $${hem.toLocaleString('en-AU')}/mo. ` +
    (declaredExpenses != null
      ? `Declared expenses $${declaredExpenses.toLocaleString('en-AU')}/mo — using ${effectiveExpenses === hem ? 'HEM (higher)' : 'declared (higher)'}.`
      : `No declared expenses — using HEM benchmark.`)
  );
  if (existingDebts > 0) assumptions.push(`Existing debt repayments: $${existingDebts.toLocaleString('en-AU')}/mo (reduces available surplus).`);
  if (hecsRepaymentMonthly > 0) assumptions.push(`HECS compulsory repayment included in surplus: −$${hecsRepaymentMonthly.toLocaleString('en-AU')}/mo.`);

  const maxBorrowing = netSurplus > 0
    ? maxLoanFromMonthlyRepayment(netSurplus, assessmentRatePct, termMonths)
    : 0;

  const repaymentAtProductRate = monthlyRepayment(loanRequested, targetRatePct, termMonths);
  const repaymentAtAssessmentRate = monthlyRepayment(loanRequested, assessmentRatePct, termMonths);

  let serviceStatus;
  let serviceHeadline;
  let serviceDetail;

  if (maxBorrowing == null || maxBorrowing <= 0) {
    serviceStatus = 'fail';
    serviceHeadline = 'Monthly surplus is zero or negative — loan not serviceable at current inputs';
    serviceDetail = `After living expenses ($${effectiveExpenses.toLocaleString('en-AU')}/mo), existing debts ($${existingDebts.toLocaleString('en-AU')}/mo)${hecsRepaymentMonthly > 0 ? `, and HECS ($${hecsRepaymentMonthly.toLocaleString('en-AU')}/mo)` : ''}, the net monthly surplus is $${netSurplus.toLocaleString('en-AU')}. There is nothing left to service a new loan at the APRA assessment rate of ${assessmentRatePct}%.`;
  } else if (maxBorrowing >= loanRequested) {
    serviceStatus = 'pass';
    serviceHeadline = `Income supports up to $${maxBorrowing.toLocaleString('en-AU', { maximumFractionDigits: 0 })} — loan fits`;
    serviceDetail = `Net monthly surplus available to service a new loan: $${netSurplus.toLocaleString('en-AU')}. At the APRA assessment rate of ${assessmentRatePct}% over ${loanTermYears} years, that supports a maximum loan of $${maxBorrowing.toLocaleString('en-AU', { maximumFractionDigits: 0 })}. Your requested loan of $${loanRequested.toLocaleString('en-AU')} fits within this capacity. Estimated monthly repayment at your target rate of ${targetRatePct}%: $${repaymentAtProductRate?.toLocaleString('en-AU') ?? '—'}.`;
  } else {
    serviceStatus = 'warn';
    const shortfall = roundMoney(loanRequested - maxBorrowing);
    serviceHeadline = `Income supports up to $${maxBorrowing.toLocaleString('en-AU', { maximumFractionDigits: 0 })} — shortfall of $${shortfall.toLocaleString('en-AU')}`;
    serviceDetail = `Net monthly surplus: $${netSurplus.toLocaleString('en-AU')}. At ${assessmentRatePct}% assessment rate that gives a maximum indicative loan of $${maxBorrowing.toLocaleString('en-AU', { maximumFractionDigits: 0 })}. You need $${loanRequested.toLocaleString('en-AU')} — a shortfall of $${shortfall.toLocaleString('en-AU')}. Options: increase income, reduce existing debts, increase deposit (reduces loan needed), or buy at a lower price.`;
  }

  checks.push({
    id: 'serviceability',
    label: 'Serviceability (APRA)',
    status: serviceStatus,
    headline: serviceHeadline,
    detail: serviceDetail,
    data: {
      gross_monthly_income: roundMoney(grossMonthly),
      monthly_expenses_used: effectiveExpenses,
      hecs_monthly: hecsRepaymentMonthly,
      existing_debts_monthly: existingDebts,
      net_surplus_monthly: netSurplus,
      assessment_rate_pct: assessmentRatePct,
      max_borrowing_capacity: maxBorrowing,
      loan_requested: loanRequested,
      monthly_repayment_at_product_rate: repaymentAtProductRate,
      monthly_repayment_at_assessment_rate: repaymentAtAssessmentRate,
    },
  });

  // ─── 4. LVR / deposit ───────────────────────────────────────────────────────
  const lvr = loanRequested > 0 ? Math.round((loanRequested / propertyValue) * 10000) / 100 : 0;
  const depositPct = Math.round((depositAmount / propertyValue) * 10000) / 100;
  let lvrStatus, lvrHeadline, lvrDetail;

  if (depositPct < 5) {
    lvrStatus = 'fail';
    lvrHeadline = `Deposit ${depositPct.toFixed(1)}% — below minimum for most lenders`;
    lvrDetail = 'Most mainstream lenders require a minimum 5% deposit (genuine savings). Some options exist at lower deposits: family guarantee (parental security), government HomeBuilder grants, or specialist lenders — but these are limited and typically at less favourable terms. Increasing the deposit to at least 5% of the purchase price is strongly recommended.';
  } else if (lvr > 80) {
    lvrStatus = 'warn';
    lvrHeadline = `Deposit ${depositPct.toFixed(1)}% — LMI will apply (LVR ${lvr.toFixed(1)}%)`;
    lvrDetail = `LVR above 80% means Lenders Mortgage Insurance (LMI) is required. LMI protects the lender (not you) and adds a one-off cost of typically 0.5%–3.5% of the loan amount, depending on LVR. It is often capitalised into the loan. A deposit of $${Math.ceil(propertyValue * 0.2).toLocaleString('en-AU')} (20%) would avoid LMI entirely.`;
  } else {
    lvrStatus = 'pass';
    lvrHeadline = `Deposit ${depositPct.toFixed(1)}% — LMI not required (LVR ${lvr.toFixed(1)}%)`;
    lvrDetail = `Deposit is at or above 20% — no Lenders Mortgage Insurance required. This also gives access to the full lender market and typically the most competitive rates.`;
  }

  checks.push({
    id: 'lvr',
    label: 'Deposit & LVR',
    status: lvrStatus,
    headline: lvrHeadline,
    detail: lvrDetail,
    data: { deposit_amount: depositAmount, deposit_pct: depositPct, lvr_pct: lvr, lmi_required: lvr > 80 },
  });

  // ─── 5. Debt-to-income ratio ─────────────────────────────────────────────────
  const dti = totalGrossAnnual > 0 ? Math.round((loanRequested / totalGrossAnnual) * 100) / 100 : null;
  let dtiStatus, dtiHeadline, dtiDetail;

  if (dti == null) {
    dtiStatus = 'warn';
    dtiHeadline = 'DTI cannot be calculated — income not provided';
    dtiDetail = '';
  } else if (dti > 6) {
    dtiStatus = 'fail';
    dtiHeadline = `DTI ${dti.toFixed(1)}× — above most lenders' cap of 6×`;
    dtiDetail = `Your loan of $${loanRequested.toLocaleString('en-AU')} is ${dti.toFixed(1)} times your gross annual income of $${totalGrossAnnual.toLocaleString('en-AU')}. APRA has asked lenders to limit loans above 6× DTI — many major banks will decline or significantly restrict lending at this ratio. Reducing the loan amount or increasing income would be required to bring this within standard appetite.`;
  } else if (dti > 5) {
    dtiStatus = 'warn';
    dtiHeadline = `DTI ${dti.toFixed(1)}× — approaching lenders' cap (6×)`;
    dtiDetail = `DTI of ${dti.toFixed(1)}× is within most lenders' hard caps but at the higher end of appetite. Some lenders apply stricter internal caps of 5× or 5.5×. A lower loan amount or higher income would improve this.`;
  } else {
    dtiStatus = 'pass';
    dtiHeadline = `DTI ${dti.toFixed(1)}× — within normal lender appetite`;
    dtiDetail = `Loan of $${loanRequested.toLocaleString('en-AU')} is ${dti.toFixed(1)} times gross annual income — well within the 6× threshold that triggers scrutiny from most lenders.`;
  }

  checks.push({
    id: 'dti',
    label: 'Debt-to-income ratio',
    status: dtiStatus,
    headline: dtiHeadline,
    detail: dtiDetail,
    data: { loan_requested: loanRequested, gross_annual_income: totalGrossAnnual, dti_ratio: dti },
  });

  // ─── 6. Genuine savings ──────────────────────────────────────────────────────
  const minGenuineSavings = roundMoney(propertyValue * 0.05);
  let genuineStatus, genuineHeadline, genuineDetail;

  if (depositAmount >= propertyValue * 0.20) {
    genuineStatus = 'pass';
    genuineHeadline = 'Deposit ≥ 20% — genuine savings check generally not required';
    genuineDetail = 'At 20%+ deposit, most lenders do not require formal proof of genuine savings. The deposit must still be verified (bank statements, evidence of funds), but the genuine-savings holding period requirement typically does not apply.';
  } else if (depositAmount >= minGenuineSavings) {
    genuineStatus = 'warn';
    genuineHeadline = `Deposit covers 5% threshold ($${minGenuineSavings.toLocaleString('en-AU')}) — but must be genuine savings`;
    genuineDetail = `Most lenders require that at least 5% of the purchase price comes from genuine savings — funds held in your name for at least 3 months (bank statements required). Gifted funds from parents do not count as genuine savings unless supplemented by a genuine savings component. Rental history can substitute for genuine savings with some lenders.`;
  } else {
    genuineStatus = 'fail';
    genuineHeadline = `Deposit ($${depositAmount.toLocaleString('en-AU')}) is below the 5% genuine savings threshold ($${minGenuineSavings.toLocaleString('en-AU')})`;
    genuineDetail = `A deposit below 5% of purchase price ($${minGenuineSavings.toLocaleString('en-AU')}) will be rejected by most lenders on genuine savings grounds alone, regardless of serviceability. You would need to save an additional $${(minGenuineSavings - depositAmount).toLocaleString('en-AU')} and hold it for at least 3 months, OR explore a family guarantee arrangement.`;
  }

  checks.push({
    id: 'genuine_savings',
    label: 'Genuine savings',
    status: genuineStatus,
    headline: genuineHeadline,
    detail: genuineDetail,
    data: { deposit: depositAmount, min_genuine_savings: minGenuineSavings, deposit_pct: depositPct },
  });

  // ─── 7. First Home Guarantee (FHBG) ─────────────────────────────────────────
  // Rules effective 1 October 2025:
  //   • No income cap (removed entirely)
  //   • No place limit (unlimited guarantees available)
  //   • Two-tier property price caps by state (capital/regional centre vs other areas)
  //   • PPOR purchase only; citizenship/prior ownership not checked here
  if (isFhb) {
    const capTiers = FHBG_PRICE_CAPS[state] || null;
    // Use capital-city tier as primary check since we don't have suburb/postcode.
    // A property above the CAPITAL cap is definitively blocked (even the most generous tier fails).
    // A property above OTHER but below CAPITAL gets a warn — location determines eligibility.
    const capitalCap = capTiers?.capital ?? null;
    const otherCap   = capTiers?.other   ?? null;
    const ppOrOk = isPpor;

    // Whether price fits the capital tier (which covers most of Australia's population)
    const aboveCapital = capitalCap != null ? propertyValue > capitalCap : false;
    const aboveOther   = otherCap   != null ? propertyValue > otherCap   : false;

    let fhbgStatus, fhbgHeadline, fhbgDetail;

    if (!ppOrOk) {
      fhbgStatus = 'fail';
      fhbgHeadline = 'FHBG — not eligible (investment property)';
      fhbgDetail = 'The First Home Guarantee requires the property to be purchased as a principal place of residence. Investment properties are excluded.';
    } else if (capTiers == null) {
      // Unknown state
      fhbgStatus = 'warn';
      fhbgHeadline = 'FHBG — state price cap unavailable; verify manually';
      fhbgDetail = `No income cap applies (removed 1 Oct 2025) and PPOR condition appears met. Verify the property price cap for your state and postcode at housingaustralia.gov.au.`;
    } else if (aboveCapital) {
      // Above even the most generous tier — definitively blocked on price
      fhbgStatus = 'fail';
      fhbgHeadline = `FHBG — purchase price above ${state} cap ($${capitalCap.toLocaleString('en-AU')} capital / $${otherCap.toLocaleString('en-AU')} regional)`;
      fhbgDetail = `The property price of $${propertyValue.toLocaleString('en-AU')} exceeds the FHBG property price cap for ${state} in all areas (capital city / regional centre: $${capitalCap.toLocaleString('en-AU')}; other areas: $${otherCap.toLocaleString('en-AU')}). The guarantee is not available for this purchase. Note: income caps were removed from 1 October 2025 — income is not a limiting factor.`;
    } else if (aboveOther && !aboveCapital) {
      // Fits capital/regional-centre tier but not the "other areas" lower tier — location-dependent
      fhbgStatus = 'warn';
      fhbgHeadline = `FHBG — eligible if buying in ${state} capital/regional centre; blocked for other areas`;
      fhbgDetail = `At $${propertyValue.toLocaleString('en-AU')}, you are within the ${state} capital city / regional centre cap ($${capitalCap.toLocaleString('en-AU')}) but above the "other areas" cap ($${otherCap.toLocaleString('en-AU')}). If purchasing in ${state === 'QLD' ? 'Brisbane, Gold Coast, or Sunshine Coast' : state === 'NSW' ? 'Sydney, Illawarra, Newcastle, or Lake Macquarie' : state === 'VIC' ? 'Melbourne or Geelong' : 'the capital city or listed regional centre'}, you are ELIGIBLE. If purchasing in a rural or regional area outside those centres, you are BLOCKED. Verify your specific postcode at housingaustralia.gov.au. No income cap applies (removed 1 Oct 2025).`;
    } else {
      // Below both caps — eligible on price
      fhbgStatus = 'pass';
      fhbgHeadline = 'FHBG — appears eligible (5% deposit, no LMI, no income cap)';
      fhbgDetail = `Property price ($${propertyValue.toLocaleString('en-AU')}) is within the ${state} cap ($${capitalCap.toLocaleString('en-AU')} capital / $${otherCap.toLocaleString('en-AU')} other) and PPOR requirement appears met. No income cap applies from 1 October 2025. If eligible, the government guarantees the difference between your deposit and 20% — you can buy with as little as 5% without paying LMI. Applications must be through participating lenders. This check does not verify citizenship, prior property ownership history, or contract date — confirm all criteria at housingaustralia.gov.au before relying on eligibility.`;
    }

    caveats.push('FHBG eligibility check uses property price caps effective 1 October 2025 (Housing Australia). Income caps were abolished 1 October 2025. Caps are split by capital city / regional centre vs other areas — this check uses the capital-city tier as the primary threshold since exact suburb/postcode is not provided. Verify your specific postcode at housingaustralia.gov.au before applying.');

    checks.push({
      id: 'fhbg',
      label: 'First Home Guarantee',
      status: fhbgStatus,
      headline: fhbgHeadline,
      detail: fhbgDetail,
      data: { capital_cap: capitalCap, other_cap: otherCap, price_ok: !aboveCapital, ppor_ok: ppOrOk, income_cap_abolished: true },
    });
  }

  // ─── 8. HECS/HELP summary ────────────────────────────────────────────────────
  if (hasHecs) {
    const hecsImpact = maxBorrowing != null
      ? roundMoney(maxLoanFromMonthlyRepayment(hecsRepaymentMonthly, assessmentRatePct, termMonths))
      : null;

    checks.push({
      id: 'hecs',
      label: 'HECS / HELP debt',
      status: 'info',
      headline: hecsImpact
        ? `HECS reduces borrowing capacity by ~$${hecsImpact.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
        : `HECS compulsory repayment: $${hecsRepaymentAnnual.toLocaleString('en-AU')} p.a.`,
      detail: `Annual compulsory HECS repayment: $${hecsRepaymentAnnual.toLocaleString('en-AU')} ($${hecsRepaymentMonthly.toLocaleString('en-AU')}/mo) at income $${grossAnnualIncome.toLocaleString('en-AU')} (ATO 2025-26 marginal method — effective 1 July 2025${grossAnnualIncome >= 179286 ? '; at this income the 10% total-income cap applies, which is lower than the marginal band calculation' : '; repayment calculated only on the portion of income above $67,000'}). This is treated as a committed expense in serviceability assessment by most lenders, reducing the surplus available to repay a new loan. ${hecsImpact ? `At the APRA assessment rate, this equates to approximately $${hecsImpact.toLocaleString('en-AU', { maximumFractionDigits: 0 })} less borrowing capacity compared to the same borrower with no HECS.` : ''} Note: HECS debts are not visible in credit reports but lenders specifically ask about them on loan applications.`,
      data: {
        hecs_annual_repayment: hecsRepaymentAnnual,
        hecs_monthly_repayment: hecsRepaymentMonthly,
        borrowing_capacity_reduction: hecsImpact,
      },
    });
  }

  // ─── 9. Stamp duty + LMI (real dollar figures) ───────────────────────────────
  // Wire existing calculateStampDutyLmi to produce concrete dollar amounts.
  // This replaces the vague "0.5%–3.5% range" with a specific estimate.
  const sdLmiResult = state ? calculateStampDutyLmi(
    {
      state,
      property_value: propertyValue,
      is_first_home_buyer: isFhb,
      deposit_amount: depositAmount,
      loan: { balance: loanRequested },
    },
    { loan_amount: loanRequested }
  ) : null;

  const stampDutyPayable = sdLmiResult?.stamp_duty_payable ?? null;
  const lmiEstimate      = sdLmiResult?.lmi_estimate       ?? null;
  const lmiRequired      = sdLmiResult?.lmi_required       ?? false;
  const fhbDutyApplied   = sdLmiResult?.fhb_concession_applied ?? false;
  const fhbDutySaved     = sdLmiResult?.fhb_concession_amount  ?? 0;

  if (sdLmiResult) {
    if (sdLmiResult.errors?.length) {
      (sdLmiResult.errors || []).forEach((e) => caveats.push(`Stamp duty calculation: ${e}`));
    }
    (sdLmiResult.caveats || []).forEach((c) => {
      if (!caveats.includes(c)) caveats.push(c);
    });

    const sdStatus = stampDutyPayable != null && stampDutyPayable > 0 ? 'info' : 'pass';
    const fhbNote = fhbDutyApplied && fhbDutySaved > 0
      ? ` FHB concession applied — $${fhbDutySaved.toLocaleString('en-AU')} saved (standard duty: $${sdLmiResult.stamp_duty_standard?.toLocaleString('en-AU')}).`
      : '';
    const newBuildNote = isNewBuild && state === 'QLD' && isFhb
      ? ' QLD announced a new-home transfer duty exemption for FHBs — verify at qro.qld.gov.au as this may reduce duty to $0 for new builds regardless of purchase price.'
      : '';

    checks.push({
      id: 'stamp_duty',
      label: 'Transfer duty (stamp duty)',
      status: sdStatus,
      headline: stampDutyPayable != null
        ? stampDutyPayable === 0
          ? `Transfer duty: $0 (FHB exemption applied in ${state})`
          : `Transfer duty estimate: $${stampDutyPayable.toLocaleString('en-AU')}`
        : 'Transfer duty: could not estimate (state required)',
      detail: stampDutyPayable != null
        ? `Estimated ${state} transfer duty on $${propertyValue.toLocaleString('en-AU')} purchase: $${stampDutyPayable.toLocaleString('en-AU')}.${fhbNote}${newBuildNote} This is a significant upfront cost paid at settlement — not included in the loan amount. Confirm with your conveyancer or state revenue office before committing.`
        : 'Transfer duty could not be calculated — state is required. This is typically the second-largest upfront cost after the deposit.',
      data: {
        stamp_duty_standard: sdLmiResult.stamp_duty_standard,
        stamp_duty_payable: stampDutyPayable,
        fhb_concession_applied: fhbDutyApplied,
        fhb_concession_amount: fhbDutySaved,
      },
    });
  }

  if (lmiRequired || (sdLmiResult && !lmiRequired)) {
    const lmiStatus = lmiRequired ? 'warn' : 'pass';
    checks.push({
      id: 'lmi_cost',
      label: 'Lenders Mortgage Insurance (LMI)',
      status: lmiStatus,
      headline: lmiRequired
        ? lmiEstimate != null
          ? `LMI required — estimated $${lmiEstimate.toLocaleString('en-AU')} (LVR ${((loanRequested / propertyValue) * 100).toFixed(1)}%)`
          : 'LMI required — could not estimate (check loan/deposit inputs)'
        : 'LMI not required (LVR ≤ 80%)',
      detail: lmiRequired
        ? `At ${((loanRequested / propertyValue) * 100).toFixed(1)}% LVR, Lenders Mortgage Insurance is required. ${lmiEstimate != null ? `Estimated LMI premium: $${lmiEstimate.toLocaleString('en-AU')} (indicative rate applied to $${loanRequested.toLocaleString('en-AU')} loan).` : ''} LMI is typically capitalised into the loan (added to the balance) rather than paid as cash on settlement day, but it increases the effective loan cost and total interest paid. LMI protects the lender — not you. Saving to 80% LVR (deposit of $${roundMoney(propertyValue * 0.20).toLocaleString('en-AU')}) eliminates LMI entirely.`
        : `Your LVR of ${((loanRequested / propertyValue) * 100).toFixed(1)}% is at or below 80% — no LMI required.`,
      data: {
        lvr: sdLmiResult?.lvr,
        lmi_required: lmiRequired,
        lmi_estimate: lmiEstimate,
      },
    });
  }

  // ─── 10. FHOG (State First Home Owner Grant) ─────────────────────────────────
  if (isFhb && state) {
    const fhogData = FHOG_BY_STATE[state];
    let fhogStatus, fhogHeadline, fhogDetail;

    if (fhogData === null) {
      // State explicitly has no FHOG (NSW, ACT)
      fhogStatus = 'info';
      fhogHeadline = `No state First Home Owner Grant in ${state}`;
      fhogDetail = state === 'NSW'
        ? 'NSW abolished the FHOG for established homes in 2014. No state grant applies. First-home buyer transfer duty exemptions and concessions are available separately.'
        : `${state} does not offer a First Home Owner Grant. First-home buyer concessions apply via transfer duty only.`;
    } else if (!fhogData) {
      // State not in table — unknown
      fhogStatus = 'warn';
      fhogHeadline = `First Home Owner Grant — verify for ${state}`;
      fhogDetail = `FHOG data not available for ${state} in this tool. Check with your state revenue office before settlement.`;
    } else {
      const priceEligible = fhogData.max_value == null || propertyValue < fhogData.max_value;
      const newBuildEligible = !fhogData.new_homes_only || isNewBuild;

      if (!priceEligible) {
        fhogStatus = 'fail';
        fhogHeadline = `FHOG — not available (price $${propertyValue.toLocaleString('en-AU')} ≥ $${fhogData.max_value?.toLocaleString('en-AU')} ${state} cap)`;
        fhogDetail = `The ${state} First Home Owner Grant ($${fhogData.amount.toLocaleString('en-AU')}) is not available — the property value of $${propertyValue.toLocaleString('en-AU')} meets or exceeds the cap of $${fhogData.max_value?.toLocaleString('en-AU')}. ${fhogData.note}`;
      } else if (!newBuildEligible) {
        fhogStatus = 'warn';
        fhogHeadline = `FHOG — $${fhogData.amount.toLocaleString('en-AU')} available for NEW homes only`;
        fhogDetail = `The ${state} First Home Owner Grant ($${fhogData.amount.toLocaleString('en-AU')}) applies only to new or substantially renovated homes — not established/existing properties. If this is an established home, the grant does not apply. If it is a new build, you may be eligible. ${fhogData.note} Source: ${fhogData.source}`;
      } else {
        fhogStatus = 'pass';
        fhogHeadline = `FHOG — $${fhogData.amount.toLocaleString('en-AU')} likely available${isNewBuild ? ' (new build confirmed)' : ''}`;
        fhogDetail = `The ${state} First Home Owner Grant of $${fhogData.amount.toLocaleString('en-AU')} appears available based on property value and first-home status. ${fhogData.note} Apply through your participating lender or conveyancer. Source: ${fhogData.source}`;
      }
    }

    checks.push({
      id: 'fhog',
      label: 'First Home Owner Grant (state)',
      status: fhogStatus,
      headline: fhogHeadline,
      detail: fhogDetail,
      data: {
        fhog_amount: FHOG_BY_STATE[state]?.amount ?? null,
        new_build: isNewBuild,
      },
    });
  }

  // ─── 11. Age at loan maturity ─────────────────────────────────────────────────
  // Most Australian lenders require the loan to be fully repaid by age 70–75.
  // If the loan would still be running past 70, lenders may shorten the term
  // (increasing monthly repayments) or require a documented repayment strategy.
  // We flag at > 70 as a warn and > 75 as a fail.
  if (Number.isFinite(inputs.applicantAge) && inputs.applicantAge > 0) {
    const ageAtMaturity = inputs.applicantAge + loanTermYears;
    let ageStatus, ageHeadline, ageDetail;
    if (ageAtMaturity > 75) {
      ageStatus = 'fail';
      ageHeadline = `Loan matures at age ${ageAtMaturity} — above most lenders' maximum (age 75)`;
      ageDetail = `At age ${inputs.applicantAge} with a ${loanTermYears}-year loan, the loan would mature at age ${ageAtMaturity}. Most Australian lenders require full repayment by age 70–75. You would either need to shorten the loan term (increasing monthly repayments significantly), demonstrate a credible exit strategy (e.g. planned property sale, super access), or accept that lender choice narrows considerably. A ${Math.max(0, 70 - inputs.applicantAge)}-year term would mature at age 70 — this gives monthly repayments of approximately $${monthlyRepayment(loanRequested, targetRatePct, Math.max(1, (70 - inputs.applicantAge) * 12))?.toLocaleString('en-AU') ?? '—'}/mo (at product rate, not assessment rate).`;
    } else if (ageAtMaturity > 70) {
      ageStatus = 'warn';
      ageHeadline = `Loan matures at age ${ageAtMaturity} — some lenders cap at 70`;
      ageDetail = `At age ${inputs.applicantAge} with a ${loanTermYears}-year loan, the loan would mature at age ${ageAtMaturity}. Most major lenders allow maturity to age 75, but some cap at 70. Lenders in the 70–75 range may require documentary evidence of a repayment strategy — for example, planned super drawdown or sale of another asset. A broker can identify which lenders are comfortable with this profile.`;
    } else {
      ageStatus = 'pass';
      ageHeadline = `Loan matures at age ${ageAtMaturity} — within standard lender policy`;
      ageDetail = `At age ${inputs.applicantAge}, this ${loanTermYears}-year loan matures at age ${ageAtMaturity}, comfortably within the age 70–75 range most lenders accept.`;
    }
    checks.push({
      id: 'age_maturity',
      label: 'Age at loan maturity',
      status: ageStatus,
      headline: ageHeadline,
      detail: ageDetail,
      data: { applicant_age: inputs.applicantAge, loan_term_years: loanTermYears, age_at_maturity: ageAtMaturity },
    });
  }

  // ─── 12. Property type restrictions ──────────────────────────────────────────
  // Certain property types attract lower LVR caps or restricted lender choice
  // regardless of borrower quality. These are policy-level, not creditworthiness.
  //
  // Types and typical LVR restrictions (approximate, lender-specific):
  //   studio_small:   studio or apartment under 50m² → max 70–80% LVR with many lenders
  //   highrise:       high-rise apartment (6+ floors or 50+ units) → max 70–80% LVR
  //   rural_acreage:  rural / acreage / hobby farm → max 70–80% LVR; some lenders 60%
  //   house_town:     standard house or townhouse → no additional restriction (baseline)
  //   off_plan:       off-the-plan → generally fine but completion risk caveat
  const PROPERTY_TYPE_RULES = {
    studio_small:  { restrict: true, typical_max_lvr: 80, note: 'Studios and apartments under ~50m² often attract a maximum LVR of 70–80% at major lenders (some as low as 60%), regardless of borrower quality. At 88% LVR you would need to save to 80% or find a specialist lender.' },
    highrise:      { restrict: true, typical_max_lvr: 80, note: 'High-rise apartments (typically 6+ storeys or developments with 50+ units) attract tighter LVR caps — usually 70–80% — due to perceived resale liquidity risk. Confirm with a broker which lenders are currently lending above 80% for this type in your area.' },
    rural_acreage: { restrict: true, typical_max_lvr: 70, note: 'Rural, acreage, and hobby farm properties typically attract a maximum LVR of 60–70% at most lenders. Some specialist lenders go to 80%. Serviceability checks that pass for a metro property may still be blocked at this LVR by the deposit requirement alone.' },
    off_plan:      { restrict: false, note: 'Off-the-plan purchases are generally acceptable but carry a completion risk caveat: the lender re-values the property at settlement (not at contract date). If the market falls, your LVR at settlement may be higher than contracted, requiring a larger deposit. Some lenders apply a 10–20% valuation haircut upfront.' },
    house_town:    { restrict: false, note: null },
  };

  if (inputs.propertyType && inputs.propertyType !== 'house_town') {
    const rule = PROPERTY_TYPE_RULES[inputs.propertyType];
    if (rule) {
      const currentLvr = loanRequested / propertyValue;
      const exceedsTypicalCap = rule.restrict && currentLvr > (rule.typical_max_lvr / 100);
      const propTypeStatus = exceedsTypicalCap ? 'fail' : rule.restrict ? 'warn' : 'info';
      checks.push({
        id: 'property_type',
        label: 'Property type restrictions',
        status: propTypeStatus,
        headline: exceedsTypicalCap
          ? `Property type may block this LVR — typical max ${rule.typical_max_lvr}% for this type`
          : rule.restrict
            ? `Property type may restrict lender choice — check LVR policy`
            : `Property type noted — see caveat`,
        detail: rule.note || 'No additional restriction for this property type.',
        data: { property_type: inputs.propertyType, typical_max_lvr: rule.typical_max_lvr ?? null, current_lvr_pct: Math.round(currentLvr * 10000) / 100 },
      });
    }
  }

  // ─── 13. Credit file self-check prompt ───────────────────────────────────────
  // Not a calculation — a process reminder. Errors on a credit file take 30–60
  // days to correct and can delay or block an application. Most buyers don't
  // know they can check for free before a lender does a hard enquiry.
  checks.push({
    id: 'credit_file',
    label: 'Credit file — check before applying',
    status: 'info',
    headline: 'Check your credit file before a lender does',
    detail: `Every lender runs a hard credit enquiry when you apply. Multiple hard enquiries in a short window (rate-shopping) reduce your credit score. Before approaching any lender: (1) Get a free copy of your credit report at mycreditfile.com.au (Equifax) or creditsavvy.com.au — free once per year, does not affect your score. (2) Check for errors, old defaults, or accounts you don't recognise — dispute anything incorrect before you apply (30–60 day correction process). (3) If you have existing credit cards, reduce limits rather than closing them — lenders assess 3.8% of the total limit as a monthly commitment regardless of balance. Any errors or unexpected entries in your file can delay or block an application — the time to find them is now, not on settlement day.`,
    data: { free_check_url: 'mycreditfile.com.au' },
  });

  // ─── 14. Rental income (investment property) ─────────────────────────────────
  // If the buyer is purchasing an investment property (isPpor = false) and
  // declares rental income, most lenders shade it to 70–80% of gross and add
  // it to serviceability surplus. This can meaningfully increase borrowing capacity.
  if (!isPpor && Number.isFinite(inputs.grossRentalIncome) && inputs.grossRentalIncome > 0) {
    const shadingPct = 0.75; // Conservative 75% shading (most lenders 70–80%)
    const shadedMonthlyRental = roundMoney((inputs.grossRentalIncome * shadingPct) / 12);
    const rentalBorrowingBoost = maxLoanFromMonthlyRepayment(shadedMonthlyRental, assessmentRatePct, termMonths);
    assumptions.push(`Rental income $${inputs.grossRentalIncome.toLocaleString('en-AU')} p.a. gross, shaded to 75% = $${roundMoney(inputs.grossRentalIncome * shadingPct).toLocaleString('en-AU')} p.a. ($${shadedMonthlyRental.toLocaleString('en-AU')}/mo) for serviceability.`);
    checks.push({
      id: 'rental_income',
      label: 'Rental income (investment purchase)',
      status: 'info',
      headline: `Rental income adds ~$${rentalBorrowingBoost?.toLocaleString('en-AU', { maximumFractionDigits: 0 }) ?? '—'} to indicative borrowing capacity`,
      detail: `Gross rental income of $${inputs.grossRentalIncome.toLocaleString('en-AU')} p.a. (${(inputs.grossRentalIncome / 52).toLocaleString('en-AU', { maximumFractionDigits: 0 })}/wk) shaded to 75% = $${roundMoney(inputs.grossRentalIncome * shadingPct).toLocaleString('en-AU')} p.a. ($${shadedMonthlyRental.toLocaleString('en-AU')}/mo) for serviceability purposes. Most lenders shade rental income to 70–80% of gross to account for vacancy, property management fees, and maintenance. At the APRA assessment rate, this rental surplus supports approximately $${rentalBorrowingBoost?.toLocaleString('en-AU', { maximumFractionDigits: 0 }) ?? '—'} of additional loan. Note: negative gearing (rental income < loan repayment) reduces this benefit — in that case the net rental loss is treated as an additional expense in serviceability, not a credit.`,
      data: { gross_rental_income: inputs.grossRentalIncome, shading_pct: shadingPct, shaded_monthly: shadedMonthlyRental, borrowing_boost: rentalBorrowingBoost },
    });
  } else if (!isPpor && !inputs.grossRentalIncome) {
    checks.push({
      id: 'rental_income',
      label: 'Rental income (investment purchase)',
      status: 'info',
      headline: 'Investment purchase — no rental income declared',
      detail: 'If this property will generate rental income, declare it — lenders shade gross rent to 70–80% and add it to your serviceability surplus, which can materially increase borrowing capacity. Run this check again with an expected weekly rent to see the impact.',
      data: {},
    });
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  const failCount  = checks.filter((c) => c.status === 'fail').length;
  const warnCount  = checks.filter((c) => c.status === 'warn').length;
  const overallStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';
  const loanFeasible = overallStatus !== 'fail';

  caveats.push(
    'Lenders will also assess credit history (Equifax, Experian, illion), conduct employment verification, request bank statements, and apply lender-specific policies that cannot be modelled here.'
  );

  // ─── Settlement cost total ────────────────────────────────────────────────────
  // Deposit + stamp duty + LMI (if not capitalised into loan) + legal estimate.
  // LMI is commonly capitalised (added to loan balance), so we separate it.
  const fhogOffset = (() => {
    if (!isFhb || !state) return 0;
    const fg = FHOG_BY_STATE[state];
    if (!fg) return 0;
    const priceOk = fg.max_value == null || propertyValue < fg.max_value;
    const newBuildOk = !fg.new_homes_only || isNewBuild;
    return (priceOk && newBuildOk) ? (fg.amount || 0) : 0;
  })();

  const cashToSettle = roundMoney(
    depositAmount
    + (stampDutyPayable ?? 0)
    + LEGAL_ESTIMATE
  );
  const cashToSettleWithLmi = lmiRequired
    ? roundMoney(cashToSettle + (lmiEstimate ?? 0))
    : cashToSettle;
  const netCashToSettle = roundMoney(cashToSettle - fhogOffset);

  // ─── Rate stress test ─────────────────────────────────────────────────────────
  // Show max borrowing at +1% and +2% rate stress to give a "buffer margin" view.
  // Also show income haircut at 85% (lender may shade self-employed income).
  const stressRate1 = targetRatePct + 1.0;
  const stressRate2 = targetRatePct + 2.0;
  const assessStress1 = Math.max(stressRate1 + 3.0, APRA_FLOOR_RATE_PCT);
  const assessStress2 = Math.max(stressRate2 + 3.0, APRA_FLOOR_RATE_PCT);

  const maxBorrowStress1 = netSurplus > 0
    ? maxLoanFromMonthlyRepayment(netSurplus, assessStress1, termMonths) : 0;
  const maxBorrowStress2 = netSurplus > 0
    ? maxLoanFromMonthlyRepayment(netSurplus, assessStress2, termMonths) : 0;

  // Income haircut for self-employed: lenders often use 80-85% of gross
  const incomeHaircutPct = employmentType === 'self_employed' ? 0.80 : 0.95;
  const haircutIncome = roundMoney(totalGrossAnnual * incomeHaircutPct);
  const haircutExpenses = Math.max(hemMonthly(householdType, haircutIncome), effectiveExpenses);
  const haircutHecsMonthly = hasHecs ? roundMoney(hecsAnnualRepayment(haircutIncome) / 12) : 0;
  const haircutSurplus = roundMoney(haircutIncome / 12 - haircutExpenses - existingDebts - haircutHecsMonthly);
  const maxBorrowHaircut = haircutSurplus > 0
    ? maxLoanFromMonthlyRepayment(haircutSurplus, assessmentRatePct, termMonths) : 0;

  const stress = {
    rate_plus_1: {
      rate_pct: stressRate1,
      assessment_rate_pct: assessStress1,
      max_borrowing: maxBorrowStress1,
      still_qualifies: maxBorrowStress1 >= loanRequested,
    },
    rate_plus_2: {
      rate_pct: stressRate2,
      assessment_rate_pct: assessStress2,
      max_borrowing: maxBorrowStress2,
      still_qualifies: maxBorrowStress2 >= loanRequested,
    },
    income_haircut: {
      haircut_pct: Math.round((1 - incomeHaircutPct) * 100),
      assessed_income: haircutIncome,
      max_borrowing: maxBorrowHaircut,
      still_qualifies: maxBorrowHaircut >= loanRequested,
      note: employmentType === 'self_employed'
        ? 'Lenders typically shade self-employed income to 80–85% of gross for serviceability — this tests 80%.'
        : 'Lenders may not use full overtime/bonus/commission — this tests at 95% of stated gross.',
    },
  };

  const summary = {
    overall_status: overallStatus,
    fail_count: failCount,
    warn_count: warnCount,
    loan_feasible: loanFeasible,
    property_value: propertyValue,
    deposit_amount: depositAmount,
    loan_requested: loanRequested,
    lvr_pct: lvr,
    max_borrowing_capacity: maxBorrowing,
    assessment_rate_pct: assessmentRatePct,
    target_rate_pct: targetRatePct,
    monthly_repayment_estimate: repaymentAtProductRate,
    hecs_annual_repayment: hecsRepaymentAnnual,
    dti_ratio: dti,
    employment_type: employmentType,
    // Settlement cost summary
    stamp_duty_estimate: stampDutyPayable,
    lmi_estimate: lmiEstimate,
    lmi_required: lmiRequired,
    legal_estimate: LEGAL_ESTIMATE,
    cash_to_settle: cashToSettle,
    cash_to_settle_with_lmi: cashToSettleWithLmi,
    fhog_offset: fhogOffset,
    net_cash_to_settle: netCashToSettle,
    // Stress test
    stress,
  };

  const lender_guidance = buildLenderGuidance(checks, summary, inputs);

  return {
    ok: true,
    checks,
    summary,
    lender_guidance,
    caveats,
    assumptions,
    errors,
  };
}

// ─── Lender guidance ─────────────────────────────────────────────────────────
//
// Static lookup: maps each failure/warn pattern to lenders known to be more
// flexible on that specific dimension. Based on publicly documented lender
// policies as of 2024-25. Policies change — always verify with a broker.
//
// Lender categories:
//   'big4'          — CBA, Westpac, ANZ, NAB
//   'major'         — Macquarie, ING (significant but not Big 4)
//   'regional'      — BOQ, Bendigo, Suncorp, Heritage
//   'non-bank'      — Pepper Money, Liberty, La Trobe, Bluestone, Firstmac
//   'government'    — FHBG, Family Home Guarantee, state schemes
//   'digital'       — ME Bank, UBank, Athena

function buildLenderGuidance(checks, summary, inputs) {
  const guidance = [];

  const byId = {};
  (checks || []).forEach((c) => { byId[c.id] = c; });
  const svc  = byId.serviceability;
  const dti  = byId.dti;
  const lvr  = byId.lvr;
  const emp  = byId.employment;
  const gen  = byId.genuine_savings;
  const fhbg = byId.fhbg;
  const employmentType = inputs?.employmentType || '';
  const lvrPct = summary?.lvr_pct || 0;

  // ── 1. Serviceability shortfall ──────────────────────────────────────────
  if (svc?.status === 'fail' || (svc?.status === 'warn')) {
    guidance.push({
      barrier: 'Serviceability / income shortfall',
      intro: 'The APRA +3% buffer applies to every lender — you cannot avoid it. But living expense benchmarks (HEM) vary by lender, and some are more pragmatic about complex or growing income structures.',
      lenders: [
        {
          name: 'Macquarie Bank',
          category: 'Major (digital)',
          flexible_on: 'More sophisticated income assessment; tends to use more realistic HEM for higher-income borrowers',
          rate_premium: 'Competitive — similar to Big 4',
          contact: 'macquarie.com.au/mortgages',
        },
        {
          name: 'Pepper Money',
          category: 'Non-bank specialist',
          flexible_on: 'Purpose-built for borrowers outside standard policy; most flexible on income shortfall',
          rate_premium: 'Typically +0.5%–1.5% above major banks',
          contact: 'peppermoney.com.au',
        },
        {
          name: 'Liberty Financial',
          category: 'Non-bank specialist',
          flexible_on: '"Prime" to "near-prime" product range; can accommodate borderline surplus',
          rate_premium: 'Typically +0.3%–1.2% above major banks',
          contact: 'liberty.com.au',
        },
        {
          name: 'Firstmac',
          category: 'Non-bank',
          flexible_on: 'Sometimes more generous net income surplus calculations for straightforward PAYG profiles',
          rate_premium: 'Typically competitive — often close to major banks',
          contact: 'firstmac.com.au',
        },
      ],
      broker_note: 'A mortgage broker is strongly recommended here. They have live intelligence on which lenders are currently approving profiles like yours, and can submit to one lender at a time rather than triggering multiple credit enquiries across the market.',
    });
  }

  // ── 2. High DTI (> 6×) ───────────────────────────────────────────────────
  if (dti?.status === 'fail') {
    guidance.push({
      barrier: 'High debt-to-income ratio (> 6×)',
      intro: 'APRA has asked lenders to limit high-DTI lending, but implementation varies. Some lenders have more sophisticated DTI modelling and approve above 6× for strong income or asset profiles.',
      lenders: [
        {
          name: 'Macquarie Bank',
          category: 'Major (digital)',
          flexible_on: 'Known to approve higher DTI for borrowers with strong income trajectory (e.g. professionals early in career) and good asset positions',
          rate_premium: 'Competitive',
          contact: 'macquarie.com.au/mortgages',
        },
        {
          name: 'ING',
          category: 'Online bank',
          flexible_on: 'Sometimes more flexible DTI for borrowers with strong repayment track record and low living expenses',
          rate_premium: 'Competitive — often market-leading',
          contact: 'ing.com.au',
        },
        {
          name: 'Pepper Money',
          category: 'Non-bank specialist',
          flexible_on: 'Has specific "near-prime" products where DTI above 6× is considered with mitigating factors',
          rate_premium: '+0.5%–1.5% above major banks',
          contact: 'peppermoney.com.au',
        },
      ],
      broker_note: 'DTI appetite shifts with each lender\'s credit book position. A broker who specialises in "complex lending" will know current appetite better than the lender\'s published policy.',
    });
  }

  // ── 3. Self-employed income ──────────────────────────────────────────────
  if (emp?.status === 'warn' && employmentType === 'self_employed') {
    guidance.push({
      barrier: 'Self-employed — less than 2 years returns or complex income',
      intro: 'Full-doc requires 2 years of ATO tax returns. Low-doc and alt-doc products allow an accountant\'s letter, BAS statements, or 12 months bank statements instead — offered mainly by specialist non-bank lenders.',
      lenders: [
        {
          name: 'Pepper Money',
          category: 'Non-bank specialist',
          flexible_on: 'Australia\'s largest non-bank lender with a dedicated self-employed product range (low-doc and alt-doc). Accepts 12 months BAS.',
          rate_premium: '+0.5%–1.5%',
          contact: 'peppermoney.com.au',
        },
        {
          name: 'Liberty Financial',
          category: 'Non-bank specialist',
          flexible_on: '"Express" applications using BAS instead of 2 years of returns. Strong track record with self-employed borrowers.',
          rate_premium: '+0.3%–1.2%',
          contact: 'liberty.com.au',
        },
        {
          name: 'La Trobe Financial',
          category: 'Non-bank',
          flexible_on: 'Specialist in complex income including irregular self-employed earnings and less than 2 years in business',
          rate_premium: '+0.5%–2.0%',
          contact: 'latrobefinancial.com',
        },
        {
          name: 'Bluestone Mortgages',
          category: 'Non-bank',
          flexible_on: 'Alt-doc products for self-employed with less than 2 full years of returns or as a company/trust structure',
          rate_premium: '+0.5%–1.5%',
          contact: 'bluestone.com.au',
        },
        {
          name: 'Macquarie Bank',
          category: 'Major (digital)',
          flexible_on: 'Best of the major banks for assessing complex self-employed income; full-doc only but more sophisticated analysis',
          rate_premium: 'Competitive',
          contact: 'macquarie.com.au/mortgages',
        },
      ],
      broker_note: 'A self-employed specialist broker is essential. The alt-doc market is not accessible directly in most cases — lenders work through accredited brokers. After 2 full years of returns, refinancing to a standard product brings rates back to market.',
    });
  }

  // ── 4. Casual / contract employment ─────────────────────────────────────
  if (emp?.status === 'warn' && (employmentType === 'casual' || employmentType === 'contract')) {
    guidance.push({
      barrier: `${employmentType === 'casual' ? 'Casual' : 'Contract'} employment`,
      intro: 'Most Big 4 require 12+ months continuous history. Regional banks and non-banks often assess employment history more holistically, particularly for stable casual workers or long-running contracts.',
      lenders: [
        {
          name: 'Bank of Queensland (BOQ)',
          category: 'Regional bank',
          flexible_on: 'More manual underwriting; stable casual workers in healthcare, education, and hospitality often approved where Big 4 decline',
          rate_premium: 'Generally competitive with Big 4',
          contact: 'boq.com.au',
        },
        {
          name: 'Bendigo Bank',
          category: 'Regional bank',
          flexible_on: 'Community focus; more willing to consider employment history holistically rather than strictly by contract type',
          rate_premium: 'Competitive',
          contact: 'bendigobank.com.au',
        },
        {
          name: 'Pepper Money',
          category: 'Non-bank specialist',
          flexible_on: 'Has products specifically for casual and contract workers — assesses average income over 12 months not current pay rate',
          rate_premium: '+0.5%–1.5%',
          contact: 'peppermoney.com.au',
        },
        {
          name: 'ME Bank',
          category: 'Digital bank',
          flexible_on: 'Sometimes more flexible for contract workers in IT, engineering, and healthcare with demonstrable renewal history',
          rate_premium: 'Often competitive',
          contact: 'mebank.com.au',
        },
      ],
      broker_note: employmentType === 'contract'
        ? 'If your contract has a renewal history (2+ renewals, same client), this significantly improves options. Document the renewal history before approaching lenders.'
        : 'If you are approaching 12 months in the same role, waiting to hit that milestone considerably expands lender choice. A broker can confirm which lenders will accept your specific tenure.',
    });
  }

  // ── 5. High LVR (85–95%) ─────────────────────────────────────────────────
  if (lvr?.status === 'warn' && lvrPct > 85) {
    const fhbgEligible = fhbg?.status === 'pass';
    guidance.push({
      barrier: `High LVR (${lvrPct.toFixed(1)}%) — limited lender choice${fhbgEligible ? ', but FHBG likely available' : ''}`,
      intro: fhbgEligible
        ? 'You appear eligible for the First Home Guarantee (FHBG) — buy with 5% deposit with no LMI through a participating lender. This is strongly preferable to standard LMI above 85% LVR.'
        : 'Above 85% LVR, lender choice narrows and LMI costs increase. Most major lenders will lend to 95% with LMI, but some are more competitive on LMI premiums and approval speed.',
      lenders: fhbgEligible ? [
        { name: 'Commonwealth Bank', category: 'Big 4', flexible_on: 'Participating FHBG lender; largest volume of FHBG approvals in Australia', rate_premium: 'Standard rates', contact: 'commbank.com.au/home-loans/first-home-guarantee' },
        { name: 'NAB', category: 'Big 4', flexible_on: 'Participating FHBG lender; competitive turnaround on FHBG applications', rate_premium: 'Standard rates', contact: 'nab.com.au/personal/home-loans/first-home-guarantee' },
        { name: 'Macquarie Bank', category: 'Major (digital)', flexible_on: 'Participating FHBG lender; fully digital process, fast conditional approval', rate_premium: 'Competitive', contact: 'macquarie.com.au/mortgages' },
        { name: 'ANZ', category: 'Big 4', flexible_on: 'Participating FHBG lender', rate_premium: 'Standard rates', contact: 'anz.com.au' },
        { name: 'Bendigo Bank', category: 'Regional bank', flexible_on: 'Participating FHBG lender; good for regional areas where Big 4 presence is limited', rate_premium: 'Competitive', contact: 'bendigobank.com.au' },
      ] : [
        { name: 'Commonwealth Bank', category: 'Big 4', flexible_on: 'LMI offered through QBE LMI; large volumes mean competitive LMI rates; strong 90–95% approval track record', rate_premium: 'Standard', contact: 'commbank.com.au' },
        { name: 'NAB', category: 'Big 4', flexible_on: 'Strong at 90–95% LVR via Helia (formerly Genworth) LMI; fast approvals', rate_premium: 'Standard', contact: 'nab.com.au' },
        { name: 'Macquarie Bank', category: 'Major (digital)', flexible_on: 'Competitive at high LVR with streamlined approval; LMI capitalised into loan', rate_premium: 'Competitive', contact: 'macquarie.com.au/mortgages' },
        { name: 'Pepper Money', category: 'Non-bank', flexible_on: 'Can approve 95% LVR for borderline profiles that major banks decline', rate_premium: '+0.5%–1.5%', contact: 'peppermoney.com.au' },
      ],
      broker_note: fhbgEligible
        ? 'FHBG places are limited each financial year — confirm availability at housingaustralia.gov.au and apply through a participating lender promptly. A broker can pre-check FHBG place availability before you submit a full application.'
        : 'LMI premiums vary between lenders (different LMI insurer arrangements). A broker can compare the total LMI cost across lenders — the cheapest rate is not always the cheapest overall cost.',
    });
  }

  // ── 6. Deposit below 5% ──────────────────────────────────────────────────
  if (lvr?.status === 'fail') {
    guidance.push({
      barrier: 'Deposit below 5% — below mainstream minimum',
      intro: 'Mainstream lenders will not proceed below 5% deposit without a government scheme or family guarantee. Three structured options exist.',
      lenders: [
        {
          name: 'Family Home Guarantee (Government)',
          category: 'Government scheme',
          flexible_on: 'Single parents only — 2% deposit, government guarantees the rest, no LMI. Income cap $125k.',
          rate_premium: 'Standard rates through participating lenders',
          contact: 'housingaustralia.gov.au',
        },
        {
          name: 'Guarantor loan (family pledge)',
          category: 'Family guarantee — all Big 4 and most major banks',
          flexible_on: 'Parent uses equity in their property as additional security — allows 0% deposit in some cases',
          rate_premium: 'Standard rates',
          contact: 'Speak to any major bank or broker',
        },
        {
          name: 'Victorian Homebuyer Fund / NSW Shared Equity',
          category: 'State government',
          flexible_on: 'Some states co-purchase with you, reducing your required deposit. Eligibility and property caps apply.',
          rate_premium: 'Standard — government takes an equity share instead',
          contact: 'Check your state revenue office',
        },
      ],
      broker_note: 'A guarantor arrangement requires your parent to put their own property at risk. All parties must receive independent legal and financial advice before proceeding. This is the highest-risk path — ensure it is genuinely understood, not just signed.',
    });
  }

  if (guidance.length === 0) return null;
  return guidance;
}

module.exports = { assessBuyerQualification, hecsAnnualRepayment, hemMonthly, monthlyRepayment, buildLenderGuidance };
