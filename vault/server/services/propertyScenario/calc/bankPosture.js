'use strict';

/**
 * Curated bank credit-posture matrix (indicative knowledge for borrower education).
 *
 * This is NOT live Open Banking data and NOT a credit decision.
 * Policies change; treat as indicative notes for lender selection,
 * alongside CDR product fit (rates/fees/eligibility text).
 *
 * Each bank carries serviceability knobs used by estimateBankCapacity() so
 * the same deterministic engine can produce per-bank indicative capacity
 * (overtime shade, rental shade, HEM stance) — dollars that move by lender.
 *
 * Last reviewed: July 2026.
 */

const {
  hemMonthly,
  hecsAnnualRepayment,
  maxLoanFromMonthlyRepayment,
  monthlyRepayment,
} = require('./buyerQualification');
const { roundMoney } = require('./tables');

const APRA_FLOOR_RATE_PCT = 8.5;

/** Map curated overtimeCrediting + regularity → shade fraction applied to overtime/bonus. */
function overtimeShadeForBank(crediting, regularity) {
  const table = {
    conservative: { irregular: 0, one_year_history: 0.4, two_year_history: 0.7 },
    moderate:     { irregular: 0, one_year_history: 0.5, two_year_history: 0.8 },
    generous:     { irregular: 0.25, one_year_history: 0.7, two_year_history: 1.0 },
  };
  const row = table[crediting] || table.moderate;
  return row[regularity] != null ? row[regularity] : row.irregular;
}

/** HEM multiplier by stance — pragmatic banks slightly lower mid/high-income HEM. */
function hemMultiplierForStance(stance) {
  if (stance === 'pragmatic') return 0.92;
  if (stance === 'conservative') return 1.05;
  return 1.0;
}

const DOCS_BY_EMPLOYMENT = {
  payg_fulltime: ['2–3 recent payslips', 'Employment contract or letter confirming ongoing role', 'Last 2 FY group certificates / income statements', '3 months bank statements'],
  payg_parttime: ['2–3 recent payslips', 'Employer letter confirming hours and ongoing intent', 'Last 2 FY income statements', '3 months bank statements'],
  casual: ['Payslips covering >=6-12 months (lender-dependent)', 'Employer letter confirming ongoing casual engagement', 'Last 2 FY income statements', '3 months bank statements'],
  contract: ['Current contract + remaining term', 'Evidence of prior contract renewals if available', 'Last 2 FY tax returns / income statements', '3 months bank statements'],
  self_employed: ['2 years personal tax returns', '2 years business/company returns or BAS', 'Accountant letter on add-backs (if claimed)', '6–12 months business bank statements'],
};

const BANK_POSTURES = [
  {
    id: 'commbank',
    name: 'Commonwealth Bank',
    shortName: 'CommBank',
    overall: 'mainstream',
    postureSummary: 'Largest book, standardised policy, strong FHBG participation. Clean PAYG files sail; edge cases go through exception process.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'standard',
    overtimeCrediting: 'conservative',
    rentalShadingPct: 70,
    hemStance: 'standard',
    highDensityAppetite: 'tight',
    fhbgParticipant: true,
    professionPacks: false,
    offsetOnFixed: true,
    typicalTurnaroundDays: 10,
    cashbackAppetite: 'occasional',
    notes: [
      'Typically wants 12 months casual/contract history.',
      'Overtime/bonus often averaged and shaded unless 2 years stable.',
      'Strong digital servicing; exception requests slower than regional banks.',
    ],
    moreForgivingOn: ['Clean PAYG full-time', 'FHBG / first-home packages'],
    stricterOn: ['Short-tenure casual', 'Complex self-employed structures', 'High-rise / small apartments at high LVR'],
  },
  {
    id: 'westpac',
    name: 'Westpac',
    shortName: 'Westpac',
    overall: 'mainstream',
    postureSummary: 'Big-4 policy with group brands (St.George, BoM, BankSA) that can differ slightly. Prefer documented, ongoing income.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'standard',
    overtimeCrediting: 'moderate',
    rentalShadingPct: 70,
    hemStance: 'standard',
    highDensityAppetite: 'tight',
    fhbgParticipant: true,
    professionPacks: false,
    offsetOnFixed: true,
    typicalTurnaroundDays: 12,
    cashbackAppetite: 'occasional',
    notes: [
      'Group brands sometimes more flexible than the Westpac brand itself — brokers shop within the group.',
      'Adverse credit usually needs clear explanation and time-since-event.',
    ],
    moreForgivingOn: ['Documented PAYG', 'In-group brand shopping'],
    stricterOn: ['Recent defaults', 'Thin genuine savings evidence', 'High-density LVR'],
  },
  {
    id: 'anz',
    name: 'ANZ',
    shortName: 'ANZ',
    overall: 'mainstream',
    postureSummary: 'Competitive on clean files via Simplicity PLUS / ANZ Plus. Policy is rules-driven; less appetite for grey areas.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'standard',
    overtimeCrediting: 'conservative',
    rentalShadingPct: 70,
    hemStance: 'conservative',
    highDensityAppetite: 'tight',
    fhbgParticipant: true,
    professionPacks: false,
    offsetOnFixed: false,
    typicalTurnaroundDays: 8,
    cashbackAppetite: 'rare',
    notes: [
      'ANZ Plus path is digital-first and best for straightforward owner-occupier files.',
      'Self-employed usually needs full tax returns — low-doc not a strength.',
    ],
    moreForgivingOn: ['Straightforward PAYG', 'Digital-ready borrowers'],
    stricterOn: ['Complex income', 'High DTI without strong surplus', 'High-rise at high LVR'],
  },
  {
    id: 'nab',
    name: 'NAB',
    shortName: 'NAB',
    overall: 'mainstream_flexible',
    postureSummary: 'Strong broker distribution; MedPlus and some professional packs. Slightly more structured paths for specialist occupations.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'standard',
    overtimeCrediting: 'moderate',
    rentalShadingPct: 75,
    hemStance: 'standard',
    highDensityAppetite: 'moderate',
    fhbgParticipant: true,
    professionPacks: true,
    offsetOnFixed: true,
    typicalTurnaroundDays: 10,
    cashbackAppetite: 'occasional',
    notes: [
      'MedPlus and similar packs can improve assessment for eligible professions.',
      'Broker channel often used for nuanced files.',
    ],
    moreForgivingOn: ['Medical / professional packs', 'Broker-presented files'],
    stricterOn: ['Unverified add-backs', 'Adverse without explanation'],
  },
  {
    id: 'ing',
    name: 'ING',
    shortName: 'ING',
    overall: 'rate_focused',
    postureSummary: 'Rate-competitive online bank. Prefers clean PAYG and existing ING relationship. Less room for complex or borderline serviceability.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'tight',
    overtimeCrediting: 'conservative',
    rentalShadingPct: 70,
    hemStance: 'conservative',
    highDensityAppetite: 'tight',
    fhbgParticipant: false,
    professionPacks: false,
    offsetOnFixed: true,
    typicalTurnaroundDays: 7,
    cashbackAppetite: 'rare',
    notes: [
      'No branches — servicing is digital/phone only.',
      'Best when the file is already strong; not the first call for edge cases.',
    ],
    moreForgivingOn: ['Clean PAYG with ING banking history'],
    stricterOn: ['Casual/contract edge cases', 'High LVR without strong surplus', 'Apartment risk'],
  },
  {
    id: 'macquarie',
    name: 'Macquarie Bank',
    shortName: 'Macquarie',
    overall: 'flexible',
    postureSummary: 'Often more pragmatic on self-employed and investment than Big 4. Primarily broker-distributed.',
    casualTenureMonths: 6,
    selfEmployedYears: 1,
    dtiAppetite: 'generous',
    overtimeCrediting: 'generous',
    rentalShadingPct: 80,
    hemStance: 'pragmatic',
    highDensityAppetite: 'flexible',
    fhbgParticipant: true,
    professionPacks: false,
    offsetOnFixed: true,
    typicalTurnaroundDays: 9,
    cashbackAppetite: 'active',
    notes: [
      'Common broker pick for self-employed with accountant-verified add-backs.',
      'Investment and rental shading often less conservative than majors.',
      'Still requires evidence — flexibility is policy, not a free pass.',
    ],
    moreForgivingOn: ['Self-employed', 'Investors', 'Complex but documented income', 'High-density with strong postcode'],
    stricterOn: ['Undocumented income', 'Fraud / misrepresentation risk'],
  },
  {
    id: 'ubank',
    name: 'UBank',
    shortName: 'UBank',
    overall: 'rate_focused',
    postureSummary: 'Low published rates; best for clean PAYG. Limited appetite for messy credit or short tenure.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'tight',
    overtimeCrediting: 'conservative',
    rentalShadingPct: 70,
    hemStance: 'conservative',
    highDensityAppetite: 'tight',
    fhbgParticipant: false,
    professionPacks: false,
    offsetOnFixed: false,
    typicalTurnaroundDays: 6,
    cashbackAppetite: 'rare',
    notes: [
      'NAB-backed but independently operated digital brand.',
      'If the file needs exception underwriting, look elsewhere first.',
    ],
    moreForgivingOn: ['Clean PAYG full-time'],
    stricterOn: ['Adverse credit', 'Casual under 12 months', 'Self-employed complexity', 'High-rise LVR'],
  },
  {
    id: 'up',
    name: 'Up Bank',
    shortName: 'Up',
    overall: 'niche',
    postureSummary: 'Owner-occupier P&I only. Digitally native. Not an option for investors or IO.',
    casualTenureMonths: 12,
    selfEmployedYears: 2,
    dtiAppetite: 'standard',
    overtimeCrediting: 'moderate',
    rentalShadingPct: null,
    hemStance: 'standard',
    highDensityAppetite: 'moderate',
    fhbgParticipant: false,
    professionPacks: false,
    offsetOnFixed: false,
    typicalTurnaroundDays: 5,
    cashbackAppetite: 'rare',
    notes: [
      'Investment and interest-only are out of scope today.',
      'Excellent for young OO buyers who already bank with Up.',
    ],
    moreForgivingOn: ['Young OO PAYG', 'Existing Up customers'],
    stricterOn: ['Investment purchases', 'Interest-only'],
  },
  {
    id: 'boq',
    name: 'Bank of Queensland',
    shortName: 'BOQ',
    overall: 'flexible',
    postureSummary: 'Manual underwriting culture; often more pragmatic on casual/contract (esp. healthcare, education, hospitality) and QLD buyers. FHBG participant.',
    casualTenureMonths: 6,
    selfEmployedYears: 2,
    dtiAppetite: 'generous',
    overtimeCrediting: 'moderate',
    rentalShadingPct: 75,
    hemStance: 'pragmatic',
    highDensityAppetite: 'flexible',
    fhbgParticipant: true,
    professionPacks: false,
    offsetOnFixed: true,
    typicalTurnaroundDays: 14,
    cashbackAppetite: 'occasional',
    notes: [
      'Regional presence strongest in QLD / northern NSW.',
      'Brokers often approach BOQ when majors decline short-tenure casual.',
      'Still evidence-based — employer letters and payslips matter.',
    ],
    moreForgivingOn: ['Casual/contract with 6+ months', 'QLD buyers', 'FHBG', 'Nuanced property types via broker'],
    stricterOn: ['Files outside footprint without broker support'],
  },
];

/**
 * Run the same surplus → max-loan math as the strict engine, but with this
 * bank's overtime shade, rental shade, and HEM stance.
 * Returns null capacity when the bank is unsuitable for the purpose.
 */
function estimateBankCapacity(inputs = {}, bank = {}, strictSummary = {}) {
  const isPpor = inputs.isPpor !== false;
  if (!isPpor && bank.id === 'up') {
    return {
      unsuitable: true,
      reason: 'Owner-occupier P&I only — investment out of scope',
      indicative_capacity: null,
      assessable_gross_annual: null,
      overtime_shade_pct: null,
      rental_shade_pct: null,
      net_surplus_monthly: null,
      narrative: null,
    };
  }

  const baseGross = (Number(inputs.grossAnnualIncome) || 0) + (Number(inputs.partnerGrossIncome) || 0);
  const overtime = Number(inputs.overtimeBonusAnnual) || 0;
  const regularity = inputs.overtimeBonusRegularity || 'irregular';
  const shade = overtimeShadeForBank(bank.overtimeCrediting || 'moderate', regularity);
  const overtimeAssessed = roundMoney(overtime * shade);
  const addbacks = inputs.employmentType === 'self_employed'
    ? roundMoney(Number(inputs.selfEmployedAddbacksAnnual) || 0)
    : 0;

  let rentalMonthly = 0;
  const grossRent = Number(inputs.grossRentalIncome) || 0;
  const rentalPct = bank.rentalShadingPct;
  if (!isPpor && grossRent > 0 && rentalPct != null) {
    rentalMonthly = roundMoney((grossRent * (rentalPct / 100)) / 12);
  }

  const assessableGross = roundMoney(baseGross + overtimeAssessed + addbacks);
  const householdType = inputs.householdType || 'single';
  const dependents = Number(inputs.dependents) || 0;
  const hemBase = hemMonthly(householdType, baseGross, dependents);
  const hemUsed = roundMoney(hemBase * hemMultiplierForStance(bank.hemStance || 'standard'));
  const declared = inputs.monthlyExpenses != null && Number.isFinite(Number(inputs.monthlyExpenses))
    ? Number(inputs.monthlyExpenses) : null;
  const expenses = declared != null ? Math.max(declared, hemUsed) : hemUsed;

  let debtMonthly = Number(inputs.monthlyDebtRepayments) || 0;
  if (Array.isArray(inputs.liabilities) && inputs.liabilities.length) {
    const itemised = inputs.liabilities.reduce((s, r) => s + (Number(r.monthlyRepayment) || 0), 0);
    if (itemised > 0) debtMonthly = itemised;
  }
  const cardCommit = roundMoney((Number(inputs.creditCardLimitsTotal) || 0) * 0.038);
  const hecsMonthly = inputs.hasHecs
    ? roundMoney(hecsAnnualRepayment(Number(inputs.grossAnnualIncome) || 0) / 12)
    : 0;

  const surplus = roundMoney((assessableGross / 12) + rentalMonthly - expenses - debtMonthly - cardCommit - hecsMonthly);
  const targetRate = Number(inputs.targetRatePct) || Number(strictSummary.target_rate_pct) || 5.5;
  const assessmentRate = Math.max(targetRate + 3.0, APRA_FLOOR_RATE_PCT);
  const termMonths = Math.round((Number(inputs.loanTermYears) || 30) * 12);
  const capacity = surplus > 0
    ? (maxLoanFromMonthlyRepayment(surplus, assessmentRate, termMonths) || 0)
    : 0;
  const loanRequested = Number(strictSummary.loan_requested)
    || roundMoney((Number(inputs.propertyValue) || 0) - (Number(inputs.depositAmount) || 0));
  const coversLoan = capacity >= loanRequested && loanRequested > 0;

  const shadePct = Math.round(shade * 100);
  const parts = [];
  if (overtime > 0) {
    parts.push(`overtime shaded to ~${shadePct}%`);
  }
  if (rentalMonthly > 0) {
    parts.push(`rent at ${rentalPct}%`);
  }
  if (bank.hemStance === 'pragmatic') parts.push('pragmatic HEM');
  else if (bank.hemStance === 'conservative') parts.push('conservative HEM');
  const knobs = parts.length ? parts.join(', ') : 'standard PAYG assessment';
  const narrative = `${bank.shortName || bank.name}: ${knobs} -> assessable ~$${Math.round(assessableGross).toLocaleString('en-AU')}/yr -> indicative capacity ~$${Math.round(capacity).toLocaleString('en-AU')}`;

  return {
    unsuitable: false,
    reason: null,
    indicative_capacity: Math.round(capacity),
    assessable_gross_annual: Math.round(assessableGross),
    overtime_shade_pct: shadePct,
    overtime_assessed_annual: overtimeAssessed,
    rental_shade_pct: rentalPct,
    rental_monthly_credited: rentalMonthly,
    hem_monthly_used: hemUsed,
    net_surplus_monthly: surplus,
    assessment_rate_pct: assessmentRate,
    covers_requested_loan: coversLoan,
    delta_vs_strict: Math.round(capacity - (Number(strictSummary.max_borrowing_capacity) || 0)),
    narrative,
  };
}

function documentsForBank(bank, employmentType) {
  const base = DOCS_BY_EMPLOYMENT[employmentType] || DOCS_BY_EMPLOYMENT.payg_fulltime;
  const extra = [];
  if (bank.professionPacks) extra.push('Evidence of eligible profession (for MedPlus / professional packs, if applicable)');
  if (employmentType === 'self_employed' && bank.selfEmployedYears <= 1) {
    extra.push('1-year tax return pack may be accepted here — confirm with broker');
  }
  return [...base, ...extra];
}

const FIT_TIER_FLOORS = { strong: 70, fair: 45, weak: 25, unsuitable: 0 };
const FIT_NEXT_DOWN = { strong: 'fair', fair: 'weak', weak: 'unsuitable' };

/**
 * Margin to the next tier down + concrete loan-headroom cues (indicative only).
 */
function describeFitSensitivity({
  fit,
  score,
  loanRequested,
  strictCapacity,
  bankCap,
  strictUtil,
}) {
  const floor = FIT_TIER_FLOORS[fit] ?? 0;
  const margin = Math.max(0, Math.round(Number(score) || 0) - floor);
  const next = FIT_NEXT_DOWN[fit] || null;
  const parts = [];

  if (next) {
    parts.push(
      `${String(fit).toUpperCase()} by ${margin} pts (score ${Math.round(score)}). `
      + `Drops to ${next.toUpperCase()} if the score falls below ${floor}.`,
    );
  } else {
    parts.push(`Score ${Math.round(score)} at the lowest curated tier.`);
  }

  if (bankCap != null && loanRequested > 0 && fit === 'strong') {
    const loanAt60 = Math.round(bankCap * 0.6);
    const loanAt90 = Math.round(bankCap * 0.9);
    if (loanRequested < loanAt60) {
      parts.push(
        `Bank-capacity utilisation bonuses thin once the loan approaches ~$${loanAt60.toLocaleString('en-AU')} `
        + `(~60% of this bank's capacity); near ~$${loanAt90.toLocaleString('en-AU')} the buffer looks thin.`,
      );
    } else if (loanRequested < loanAt90) {
      parts.push(
        `Approaching a thin buffer near ~$${loanAt90.toLocaleString('en-AU')} (~90% of this bank's capacity).`,
      );
    }
  }

  if (strictCapacity > 0 && loanRequested > 0 && strictUtil != null && strictUtil <= 0.5 && fit === 'strong') {
    const loanAt50 = Math.round(strictCapacity * 0.5);
    const loanAt70 = Math.round(strictCapacity * 0.7);
    parts.push(
      `Strict headroom bonus shrinks if the loan rises past ~$${loanAt50.toLocaleString('en-AU')} `
      + `(50% of strict capacity) and further past ~$${loanAt70.toLocaleString('en-AU')}.`,
    );
  }

  parts.push('LVR above 80%, DTI above 4x, adverse credit, short tenure, or density flags also cut the score.');

  return {
    margin_pts: margin,
    tier_floor: floor,
    next_tier_down: next,
    note: parts.join(' '),
  };
}

/**
 * Score how a bank's curated posture fits this applicant file.
 * Attaches per-bank indicative capacity from estimateBankCapacity().
 */
function buildBankPostureFit(inputs = {}, strictSummary = {}, strictChecks = []) {
  const employmentType = inputs.employmentType || 'payg_fulltime';
  const monthsInRole = Number.isFinite(inputs.monthsInCurrentRole) ? Number(inputs.monthsInCurrentRole) : null;
  const isPpor = inputs.isPpor !== false;
  const isSelfEmployed = employmentType === 'self_employed';
  const isCasualLike = ['casual', 'contract', 'payg_parttime'].includes(employmentType);
  const hasAdverse = !!inputs.hasAdverseCredit;
  const isFhb = !!inputs.isFhb;
  const dti = Number(strictSummary.dti_ratio) || 0;
  const lvr = Number(strictSummary.lvr_pct) || 0;
  const overtime = Number(inputs.overtimeBonusAnnual) || 0;
  const addbacks = Number(inputs.selfEmployedAddbacksAnnual) || 0;
  const cardLimits = Number(inputs.creditCardLimitsTotal) || 0;
  const propertyType = inputs.propertyType || inputs.property_type_class || null;
  const overallPass = strictSummary.overall_status === 'pass';
  const byId = {};
  (strictChecks || []).forEach((c) => { byId[c.id] = c; });
  const propCheck = byId.property_type;
  const densityTypes = new Set(['highrise', 'studio_small']);
  const isDensity = densityTypes.has(propertyType) || (propCheck && densityTypes.has(propCheck.data?.property_type));
  const ruralLike = propertyType === 'rural_acreage' || propCheck?.data?.property_type === 'rural_acreage';
  const cleanPayg = overallPass && employmentType === 'payg_fulltime' && !hasAdverse && !isDensity && !ruralLike;
  const loanRequested = Number(strictSummary.loan_requested) || 0;
  const strictCapacity = Number(strictSummary.max_borrowing_capacity) || 0;
  const strictUtil = strictCapacity > 0 && loanRequested > 0 ? loanRequested / strictCapacity : null;

  const rows = BANK_POSTURES.map((bank) => {
    const reasons = [];
    const breakdown = []; // { factor, delta } — each scoring contribution, for display
    let score = 50;
    const capacity = estimateBankCapacity(inputs, bank, strictSummary);
    const bankCap = capacity?.indicative_capacity != null && !capacity.unsuitable
      ? Number(capacity.indicative_capacity)
      : null;

    if (!isPpor && bank.id === 'up') {
      return {
        id: bank.id,
        name: bank.name,
        shortName: bank.shortName,
        overall: bank.overall,
        postureSummary: bank.postureSummary,
        fit: 'unsuitable',
        score: 0,
        fit_sensitivity: describeFitSensitivity({
          fit: 'unsuitable',
          score: 0,
          loanRequested,
          strictCapacity,
          bankCap: capacity?.indicative_capacity != null ? Number(capacity.indicative_capacity) : null,
          strictUtil,
        }),
        reasons: ['Up currently offers owner-occupier P&I only — investment is out of scope.'],
        capacity,
        documents: documentsForBank(bank, employmentType),
        fhbgParticipant: bank.fhbgParticipant,
        offsetOnFixed: bank.offsetOnFixed,
        typicalTurnaroundDays: bank.typicalTurnaroundDays,
        moreForgivingOn: bank.moreForgivingOn,
        stricterOn: bank.stricterOn,
        notes: bank.notes,
        disclaimer: 'Indicative posture and capacity — not a credit decision.',
      };
    }

    if (isCasualLike && monthsInRole != null) {
      if (monthsInRole >= bank.casualTenureMonths) {
        score += 15; breakdown.push({ factor: 'Employment tenure', delta: +15 });
        reasons.push(`Tenure ${monthsInRole} mo meets this bank's typical ~${bank.casualTenureMonths} mo casual/contract window.`);
      } else if (monthsInRole >= 6 && bank.casualTenureMonths <= 6) {
        score += 10; breakdown.push({ factor: 'Employment tenure', delta: +10 });
        reasons.push(`At ${monthsInRole} mo, this bank's ~${bank.casualTenureMonths} mo threshold may still be approachable with an employer letter.`);
      } else {
        score -= 20; breakdown.push({ factor: 'Employment tenure', delta: -20 });
        reasons.push(`Tenure ${monthsInRole} mo is below this bank's typical ~${bank.casualTenureMonths} mo casual/contract preference.`);
      }
    }

    if (isSelfEmployed) {
      if (bank.overall === 'flexible' || bank.overall === 'mainstream_flexible') {
        score += 18; breakdown.push({ factor: 'Self-employed policy', delta: +18 });
        reasons.push('More pragmatic self-employed assessment than typical Big-4 standardised policy.');
      } else if (bank.overall === 'rate_focused') {
        score -= 12; breakdown.push({ factor: 'Self-employed policy', delta: -12 });
        reasons.push('Rate-focused digital lenders usually prefer clean PAYG over complex business income.');
      }
      if (addbacks > 0 && bank.overall === 'flexible') {
        score += 5; breakdown.push({ factor: 'Add-backs accepted', delta: +5 });
        reasons.push('Accountant-verified add-backs are more commonly accepted here than at majors.');
      }
    }

    if (overtime > 0) {
      if (bank.overtimeCrediting === 'generous') {
        score += 8; breakdown.push({ factor: 'Overtime crediting', delta: +8 });
        reasons.push(`Overtime/bonus crediting tends to be less conservative (~${capacity.overtime_shade_pct}% on your history).`);
      } else if (bank.overtimeCrediting === 'conservative') {
        score -= 5; breakdown.push({ factor: 'Overtime crediting', delta: -5 });
        reasons.push(`Expect conservative overtime/bonus shading (~${capacity.overtime_shade_pct}% on your history).`);
      }
    }

    if (dti > 6) {
      if (bank.dtiAppetite === 'generous') { score += 5; breakdown.push({ factor: 'DTI appetite', delta: +5 }); }
      else if (bank.dtiAppetite === 'tight') {
        score -= 15; breakdown.push({ factor: 'DTI appetite', delta: -15 });
        reasons.push('DTI above 6× sits poorly with tighter appetite lenders.');
      } else {
        score -= 8; breakdown.push({ factor: 'DTI appetite', delta: -8 });
        reasons.push('DTI above 6× typically triggers extra scrutiny.');
      }
    } else if (dti > 5) {
      if (bank.dtiAppetite === 'tight') {
        score -= 6; breakdown.push({ factor: 'DTI appetite', delta: -6 });
        reasons.push('DTI above 5× is near the edge for tighter-appetite lenders.');
      }
    }

    if (lvr > 90) {
      score -= 8; breakdown.push({ factor: 'LVR', delta: -8 });
      reasons.push('High LVR (>90%) narrows the field at most lenders.');
    } else if (lvr > 85) {
      score -= 4; breakdown.push({ factor: 'LVR', delta: -4 });
      reasons.push('LVR above 85% typically means LMI and a narrower lender panel.');
    }

    if (isDensity) {
      const label = (propertyType || propCheck?.data?.property_type || 'high-density').replace(/_/g, ' ');
      if (bank.highDensityAppetite === 'flexible') {
        score += 12; breakdown.push({ factor: 'Property type', delta: +12 });
        reasons.push(`More pragmatic on ${label} LVR — brokers often find a path above conservative 70–80% caps in supported postcodes.`);
      } else if (bank.highDensityAppetite === 'moderate') {
        score += 2; breakdown.push({ factor: 'Property type', delta: +2 });
        reasons.push(`${label} is workable here in many postcodes, but expect LVR scrutiny around 80%.`);
      } else {
        score -= 14; breakdown.push({ factor: 'Property type', delta: -14 });
        reasons.push(`Tighter typical LVR caps on ${label} (often 70–80%) — less appetite without a strong postcode / development story.`);
      }
    }

    if (ruralLike) {
      if (bank.overall === 'flexible' || bank.id === 'boq') {
        score += 8; breakdown.push({ factor: 'Rural / regional', delta: +8 });
        reasons.push('Regional / rural lending is more commonly accommodated here than at pure digital majors.');
      } else if (bank.overall === 'rate_focused') {
        score -= 10; breakdown.push({ factor: 'Rural / regional', delta: -10 });
        reasons.push('Acreage / rural files are usually outside rate-focused digital lender appetite.');
      } else {
        score -= 6; breakdown.push({ factor: 'Rural / regional', delta: -6 });
        reasons.push('Rural / acreage typically attracts lower max LVR at mainstream lenders.');
      }
    }

    if (cardLimits >= 10000) {
      if (bank.overall === 'rate_focused') {
        score -= 4; breakdown.push({ factor: 'Card limits', delta: -4 });
        reasons.push(`$${cardLimits.toLocaleString('en-AU')} in card limits is a material serviceability drag — digital lenders are less flexible on residual commitments.`);
      }
    }

    if (hasAdverse) {
      if (bank.overall === 'flexible') {
        score -= 5; breakdown.push({ factor: 'Credit history', delta: -5 });
        reasons.push('Adverse credit still hurts — flexible lenders may listen with a clear explanation and time-since-event.');
      } else {
        score -= 15; breakdown.push({ factor: 'Credit history', delta: -15 });
        reasons.push('Adverse credit is a material headwind under standardised policy.');
      }
    }

    if (!isPpor && bank.rentalShadingPct != null && bank.rentalShadingPct >= 80) {
      score += 6; breakdown.push({ factor: 'Rental income shading', delta: +6 });
      reasons.push(`Investment rental shading often around ${bank.rentalShadingPct}% (less conservative).`);
    }

    // File strength from strict checks (capacity headroom, LVR, DTI).
    if (overallPass) {
      score += 10; breakdown.push({ factor: 'File strength (strict)', delta: +10 });
    } else {
      score -= 8; breakdown.push({ factor: 'File strength (strict)', delta: -8 });
    }

    if (strictUtil != null) {
      if (strictUtil <= 0.5) {
        score += 16; breakdown.push({ factor: 'Capacity headroom', delta: +16 });
        reasons.push(`Requested loan uses ~${Math.round(strictUtil * 100)}% of strict capacity — wide headroom.`);
      } else if (strictUtil <= 0.7) {
        score += 10; breakdown.push({ factor: 'Capacity headroom', delta: +10 });
        reasons.push(`Requested loan uses ~${Math.round(strictUtil * 100)}% of strict capacity — solid headroom.`);
      } else if (strictUtil <= 0.85) {
        score += 4; breakdown.push({ factor: 'Capacity headroom', delta: +4 });
      } else if (strictUtil > 1) {
        score -= 18; breakdown.push({ factor: 'Capacity headroom', delta: -18 });
        reasons.push('Requested loan exceeds strict capacity — most lenders will struggle without levers.');
      }
    }

    if (dti > 0 && dti <= 4) {
      score += 8; breakdown.push({ factor: 'DTI ratio', delta: +8 });
      reasons.push(`DTI of ${dti.toFixed(1)}x is well inside typical lender comfort (under 4x).`);
    } else if (dti > 0 && dti <= 5) {
      score += 3; breakdown.push({ factor: 'DTI ratio', delta: +3 });
    }

    if (lvr > 0 && lvr <= 80) {
      score += 6; breakdown.push({ factor: 'LVR', delta: +6 });
      reasons.push(`LVR of ${lvr.toFixed(1)}% is at or below 80% — no-LMI path at most lenders.`);
    } else if (lvr > 0 && lvr <= 85) {
      score += 2; breakdown.push({ factor: 'LVR', delta: +2 });
    }

    // Per-bank capacity vs requested — spreads Fit when knobs move dollars
    if (bankCap != null && loanRequested > 0) {
      const bankUtil = loanRequested / bankCap;
      if (bankCap < loanRequested) {
        score -= 25; breakdown.push({ factor: 'Bank capacity vs loan', delta: -25 });
        reasons.push(`This bank's indicative capacity (~$${Math.round(bankCap).toLocaleString('en-AU')}) sits below the requested loan.`);
      } else if (bankUtil <= 0.45) {
        score += 6; breakdown.push({ factor: 'Bank capacity vs loan', delta: +6 });
        reasons.push(`Comfortable vs this bank's capacity (~${Math.round(bankUtil * 100)}% utilised).`);
      } else if (bankUtil <= 0.6) {
        score += 3; breakdown.push({ factor: 'Bank capacity vs loan', delta: +3 });
      } else if (bankUtil > 0.9) {
        score -= 4; breakdown.push({ factor: 'Bank capacity vs loan', delta: -4 });
        reasons.push("Requested loan sits near this bank's modelled capacity — thinner buffer.");
      }
    }

    // Clean PAYG differentiators — otherwise every major looks the same
    if (cleanPayg) {
      if (isFhb && bank.fhbgParticipant) {
        score += 8; breakdown.push({ factor: 'FHBG participation', delta: +8 });
        reasons.push('Participates in First Home Guarantee — relevant if you are using (or considering) a 5% no-LMI scheme.');
      } else if (isFhb && bank.fhbgParticipant === false) {
        score -= 4; breakdown.push({ factor: 'FHBG participation', delta: -4 });
        reasons.push('Not typically an FHBG participant — scheme path would need another lender.');
      }
      if (bank.professionPacks) {
        score += 4; breakdown.push({ factor: 'Profession packs', delta: +4 });
        reasons.push('Offers profession packs (e.g. MedPlus) that can improve assessment for eligible occupations.');
      }
      if (bank.offsetOnFixed) {
        score += 3; breakdown.push({ factor: 'Product features', delta: +3 });
        reasons.push('Typically offers offset on fixed-rate products — useful if you want rate certainty and offset.');
      } else if (bank.overall === 'rate_focused') {
        score += 2; breakdown.push({ factor: 'Product features', delta: +2 });
        reasons.push('Rate-focused digital path suits a clean PAYG file if you prioritise headline rate over flexibility.');
      }
      if (bank.cashbackAppetite === 'active') {
        score += 3; breakdown.push({ factor: 'Cashback appetite', delta: +3 });
        reasons.push('Often active on refinance cashbacks — worth pricing into a switch comparison.');
      }
      if (bank.typicalTurnaroundDays != null && bank.typicalTurnaroundDays <= 7) {
        score += 2; breakdown.push({ factor: 'Turnaround speed', delta: +2 });
        reasons.push(`Typically faster digital turnaround (~${bank.typicalTurnaroundDays} days) on clean files.`);
      }
    }

    // Capacity narrative as a primary reason when dollars diverge
    if (capacity?.narrative && !capacity.unsuitable) {
      if (Math.abs(capacity.delta_vs_strict || 0) >= 15000 || overtime > 0 || (!isPpor && (Number(inputs.grossRentalIncome) || 0) > 0)) {
        reasons.unshift(capacity.narrative);
      }
    }

    let fit = 'fair';
    if (score >= 70) fit = 'strong';
    else if (score >= 45) fit = 'fair';
    else if (score >= 25) fit = 'weak';
    else fit = 'unsuitable';

    if (reasons.length === 0) {
      reasons.push(capacity?.narrative || 'No strong positive or negative posture flags — treat as a mainstream shop.');
    }

    const fitSensitivity = describeFitSensitivity({
      fit,
      score,
      loanRequested,
      strictCapacity,
      bankCap,
      strictUtil,
    });

    return {
      id: bank.id,
      name: bank.name,
      shortName: bank.shortName,
      overall: bank.overall,
      postureSummary: bank.postureSummary,
      fit,
      score,
      score_breakdown: breakdown,
      fit_sensitivity: fitSensitivity,
      reasons,
      capacity,
      documents: documentsForBank(bank, employmentType),
      fhbgParticipant: bank.fhbgParticipant,
      offsetOnFixed: bank.offsetOnFixed,
      typicalTurnaroundDays: bank.typicalTurnaroundDays,
      cashbackAppetite: bank.cashbackAppetite,
      moreForgivingOn: bank.moreForgivingOn,
      stricterOn: bank.stricterOn,
      notes: bank.notes,
      disclaimer: 'Indicative posture and capacity modelled from curated policy knobs — not a credit decision and not sourced from CDR.',
    };
  });

  rows.sort((a, b) => {
    const capA = a.capacity?.indicative_capacity ?? -1;
    const capB = b.capacity?.indicative_capacity ?? -1;
    if (b.score !== a.score) return b.score - a.score;
    return capB - capA;
  });

  const capacityRange = rows
    .filter((r) => r.capacity?.indicative_capacity != null)
    .map((r) => r.capacity.indicative_capacity);
  const minCap = capacityRange.length ? Math.min(...capacityRange) : null;
  const maxCap = capacityRange.length ? Math.max(...capacityRange) : null;

  return {
    banks: rows,
    basis: 'curated_broker_posture',
    fit_legend: [
      { tier: 'strong', score_min: 70, meaning: 'Strong alignment: file clears checks with comfortable headroom and/or this bank\'s posture knobs suit the file well.' },
      { tier: 'fair', score_min: 45, meaning: 'Workable mainstream match: no major red flags, but headroom is thinner or policy knobs are a weaker fit than top-tier options.' },
      { tier: 'weak', score_min: 25, meaning: 'Material friction expected (tenure, density, DTI, adverse credit, or capacity near the edge).' },
      { tier: 'unsuitable', score_min: 0, meaning: 'Out of appetite for this product/purpose under curated notes (e.g. investment at an OO-only lender).' },
    ],
    fit_vs_overall_note:
      'Overall PASS/FAIL is the strict lending-check verdict (serviceability, LVR, DTI, employment, etc.). '
      + 'Fit is a separate relative score of how each bank\'s curated posture and indicative capacity align with this file. '
      + 'A PASS file can still show Fair Fit when headroom is thin or a bank is a weaker policy match; Strong Fit is not an approval. '
      + 'Each bank shows its numeric score so you can see distance to the next tier (e.g. 98 vs 71).',
    overtime_shade_note:
      'OT shade = the % of declared overtime/bonus/commission credited into assessable income for that bank\'s indicative capacity. '
      + '0% means none declared, or treated as irregular/not credited under that bank\'s curated stance; higher % (e.g. a generous bank on evidenced history) counts more of your OT. '
      + 'Driven by each bank\'s overtimeCrediting knob through the same surplus engine — not a published lender quote.',
    capacity_note: minCap != null && maxCap != null && maxCap !== minCap
      ? `Indicative capacity across this panel ranges from ~$${minCap.toLocaleString('en-AU')} to ~$${maxCap.toLocaleString('en-AU')} depending on each bank's overtime, rental, and expense stance — same engine, different knobs. Not a quote or approval.`
      : 'Indicative capacity uses each bank\'s curated overtime/rental/HEM stance through the same surplus engine. Not a quote or approval.',
    note: 'Bank-by-bank rows combine curated appetite notes with indicative capacity (overtime shade, rental shade, HEM stance). They are not live Open Banking fields and do not predict approval. Live rates (when available) come from CDR product publication.',
    reviewed: '2026-07',
  };
}

/**
 * Merge curated posture rows with live CDR products into one panel per bank.
 */
function buildMergedBankPanel(bankPosture, lenderFit) {
  const banks = bankPosture?.banks || [];
  const products = lenderFit?.products || [];

  function matchProducts(bank) {
    const names = [bank.name, bank.shortName, bank.id].filter(Boolean).map((n) => String(n).toLowerCase());
    return products.filter((p) => {
      const lender = String(p.lender || p.bank || p.name || '').toLowerCase();
      return names.some((n) => lender.includes(n) || n.includes(lender.split(/\s+/)[0]));
    });
  }

  return {
    banks: banks.map((b) => {
      const matched = matchProducts(b);
      const best = matched.slice().sort((a, c) => (Number(a.rate) || 99) - (Number(c.rate) || 99))[0] || null;
      return {
        ...b,
        live_rate: best ? Number(best.rate) : null,
        live_product: best ? (best.product || best.name || null) : null,
        live_fit: best ? best.fit : null,
        live_fit_note: best ? best.fit_note : null,
        live_products: matched.slice(0, 2).map((p) => ({
          id: p.id,
          product: p.product || p.name,
          rate: Number(p.rate),
          fit: p.fit,
        })),
      };
    }),
    fit_legend: bankPosture?.fit_legend || null,
    fit_vs_overall_note: bankPosture?.fit_vs_overall_note || null,
    overtime_shade_note: bankPosture?.overtime_shade_note || null,
    capacity_note: bankPosture?.capacity_note || null,
    note: bankPosture?.note || null,
    has_live_rates: products.length > 0,
  };
}

module.exports = {
  BANK_POSTURES,
  buildBankPostureFit,
  estimateBankCapacity,
  buildMergedBankPanel,
  overtimeShadeForBank,
  describeFitSensitivity,
  FIT_TIER_FLOORS,
};
