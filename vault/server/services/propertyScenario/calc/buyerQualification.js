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

// ─── HECS/HELP compulsory repayment rates (ATO 2024-25) ──────────────────────
const HECS_BRACKETS = [
  { min: 151201, rate: 0.10 },
  { min: 142643, rate: 0.095 },
  { min: 134569, rate: 0.09 },
  { min: 126951, rate: 0.085 },
  { min: 119765, rate: 0.08 },
  { min: 112986, rate: 0.075 },
  { min: 106591, rate: 0.07 },
  { min: 100558, rate: 0.065 },
  { min: 94866,  rate: 0.06 },
  { min: 89495,  rate: 0.055 },
  { min: 84430,  rate: 0.05 },
  { min: 79650,  rate: 0.045 },
  { min: 75141,  rate: 0.04 },
  { min: 70889,  rate: 0.035 },
  { min: 66876,  rate: 0.03 },
  { min: 63090,  rate: 0.025 },
  { min: 59519,  rate: 0.02 },
  { min: 51551,  rate: 0.01 },
  { min: 0,      rate: 0 },
];

function hecsAnnualRepayment(grossAnnualIncome) {
  const bracket = HECS_BRACKETS.find((b) => grossAnnualIncome >= b.min);
  return bracket ? roundMoney(grossAnnualIncome * bracket.rate) : 0;
}

// ─── First Home Guarantee property price caps (NHFIC 2024-25) ────────────────
const FHBG_PRICE_CAPS = {
  NSW: 900000,
  ACT: 750000,
  VIC: 800000,
  QLD: 700000,
  WA:  600000,
  SA:  600000,
  TAS: 600000,
  NT:  600000,
};
const FHBG_INCOME_CAP_SINGLE = 125000;
const FHBG_INCOME_CAP_JOINT  = 200000;

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
  if (isFhb) {
    const priceCap = FHBG_PRICE_CAPS[state] || null;
    const incomeCap = isJoint ? FHBG_INCOME_CAP_JOINT : FHBG_INCOME_CAP_SINGLE;
    const incomeOk = totalGrossAnnual <= incomeCap;
    const priceOk = priceCap != null ? propertyValue <= priceCap : null;
    const ppOrOk = isPpor;

    let fhbgStatus, fhbgHeadline, fhbgDetail;

    if (!ppOrOk) {
      fhbgStatus = 'fail';
      fhbgHeadline = 'FHBG — not eligible (investment property)';
      fhbgDetail = 'The First Home Guarantee requires the property to be purchased as a principal place of residence. Investment properties are excluded.';
    } else if (!incomeOk) {
      fhbgStatus = 'fail';
      fhbgHeadline = `FHBG — income above cap ($${incomeCap.toLocaleString('en-AU')} ${isJoint ? 'combined' : 'individual'})`;
      fhbgDetail = `Your gross income of $${totalGrossAnnual.toLocaleString('en-AU')} p.a. exceeds the FHBG income cap of $${incomeCap.toLocaleString('en-AU')} for ${isJoint ? 'joint applicants' : 'individual applicants'}. You are not eligible for the guarantee.`;
    } else if (priceOk === false) {
      fhbgStatus = 'fail';
      fhbgHeadline = `FHBG — purchase price above ${state} cap ($${priceCap?.toLocaleString('en-AU')})`;
      fhbgDetail = `The property price of $${propertyValue.toLocaleString('en-AU')} exceeds the FHBG property price cap for ${state} of $${priceCap?.toLocaleString('en-AU')}. The guarantee is not available for this purchase.`;
    } else if (priceOk === null) {
      fhbgStatus = 'warn';
      fhbgHeadline = `FHBG — potentially eligible (state price cap unavailable for ${state})`;
      fhbgDetail = `Income and PPOR conditions appear met. Verify the current property price cap for ${state} with the NHFIC (Housing Australia) before relying on eligibility.`;
    } else {
      fhbgStatus = 'pass';
      fhbgHeadline = 'FHBG — appears eligible (5% deposit, no LMI)';
      fhbgDetail = `Income ($${totalGrossAnnual.toLocaleString('en-AU')} ≤ $${incomeCap.toLocaleString('en-AU')} cap), property price ($${propertyValue.toLocaleString('en-AU')} ≤ $${priceCap?.toLocaleString('en-AU')} ${state} cap), and PPOR requirement all appear met. If eligible, the government guarantees the difference between your deposit and 20%, meaning you can buy with as little as 5% without paying LMI. Applications are processed through participating lenders only — not all lenders offer FHBG. Confirm directly with Housing Australia (housingaustralia.gov.au). This check does not verify all FHBG eligibility criteria (citizenship, prior ownership history, contract date).`;
    }

    caveats.push('FHBG eligibility check uses published 2024-25 income and property price caps — confirm current caps at housingaustralia.gov.au before applying.');

    checks.push({
      id: 'fhbg',
      label: 'First Home Guarantee',
      status: fhbgStatus,
      headline: fhbgHeadline,
      detail: fhbgDetail,
      data: { income_cap: incomeCap, price_cap: priceCap, income_ok: incomeOk, price_ok: priceOk, ppor_ok: ppOrOk },
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
      detail: `Annual compulsory HECS repayment: $${hecsRepaymentAnnual.toLocaleString('en-AU')} ($${hecsRepaymentMonthly.toLocaleString('en-AU')}/mo) at income $${grossAnnualIncome.toLocaleString('en-AU')} (ATO 2024-25 schedule). This is treated as a committed expense in serviceability assessment by most lenders, reducing the surplus available to repay a new loan. ${hecsImpact ? `At the APRA assessment rate, this equates to approximately $${hecsImpact.toLocaleString('en-AU', { maximumFractionDigits: 0 })} less borrowing capacity compared to the same borrower with no HECS.` : ''} Note: HECS debts are not visible in credit reports but lenders specifically ask about them on loan applications.`,
      data: {
        hecs_annual_repayment: hecsRepaymentAnnual,
        hecs_monthly_repayment: hecsRepaymentMonthly,
        borrowing_capacity_reduction: hecsImpact,
      },
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

  return {
    ok: true,
    checks,
    summary: {
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
    },
    caveats,
    assumptions,
    errors,
  };
}

module.exports = { assessBuyerQualification, hecsAnnualRepayment, hemMonthly, monthlyRepayment };
