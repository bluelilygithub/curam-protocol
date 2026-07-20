'use strict';

/**
 * Curated bank credit-posture matrix (broker knowledge).
 *
 * This is NOT live Open Banking data and NOT a credit decision.
 * Policies change; treat as indicative broker notes for lender selection,
 * alongside CDR product fit (rates/fees/eligibility text).
 *
 * Last reviewed: July 2026.
 */

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
    highDensityAppetite: 'tight',
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
    highDensityAppetite: 'tight',
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
    highDensityAppetite: 'tight',
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
    highDensityAppetite: 'moderate',
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
    highDensityAppetite: 'tight',
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
    highDensityAppetite: 'flexible',
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
    highDensityAppetite: 'tight',
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
    highDensityAppetite: 'moderate',
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
    highDensityAppetite: 'flexible',
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
 * Score how a bank's curated posture fits this applicant file.
 * Uses both raw inputs and strict-check flags so posture diverges when the
 * file has real differentiating risk (property type, DTI, LVR, employment).
 * Returns ranked rows with fit: strong | fair | weak | unsuitable.
 */
function buildBankPostureFit(inputs = {}, strictSummary = {}, strictChecks = []) {
  const employmentType = inputs.employmentType || 'payg_fulltime';
  const monthsInRole = Number.isFinite(inputs.monthsInCurrentRole) ? Number(inputs.monthsInCurrentRole) : null;
  const isPpor = inputs.isPpor !== false;
  const isSelfEmployed = employmentType === 'self_employed';
  const isCasualLike = ['casual', 'contract', 'payg_parttime'].includes(employmentType);
  const hasAdverse = !!inputs.hasAdverseCredit;
  const dti = Number(strictSummary.dti_ratio) || 0;
  const lvr = Number(strictSummary.lvr_pct) || 0;
  const overtime = Number(inputs.overtimeBonusAnnual) || 0;
  const addbacks = Number(inputs.selfEmployedAddbacksAnnual) || 0;
  const cardLimits = Number(inputs.creditCardLimitsTotal) || 0;
  const propertyType = inputs.propertyType || inputs.property_type_class || null;
  const byId = {};
  (strictChecks || []).forEach((c) => { byId[c.id] = c; });
  const propCheck = byId.property_type;
  const densityTypes = new Set(['highrise', 'studio_small']);
  const isDensity = densityTypes.has(propertyType) || (propCheck && densityTypes.has(propCheck.data?.property_type));
  const ruralLike = propertyType === 'rural_acreage' || propCheck?.data?.property_type === 'rural_acreage';

  const rows = BANK_POSTURES.map((bank) => {
    const reasons = [];
    let score = 50;

    if (!isPpor && bank.id === 'up') {
      return {
        ...bank,
        fit: 'unsuitable',
        score: 0,
        reasons: ['Up currently offers owner-occupier P&I only — investment is out of scope.'],
        disclaimer: 'Indicative broker posture — not a credit decision.',
      };
    }

    if (isCasualLike && monthsInRole != null) {
      if (monthsInRole >= bank.casualTenureMonths) {
        score += 15;
        reasons.push(`Tenure ${monthsInRole} mo meets this bank's typical ~${bank.casualTenureMonths} mo casual/contract window.`);
      } else if (monthsInRole >= 6 && bank.casualTenureMonths <= 6) {
        score += 10;
        reasons.push(`At ${monthsInRole} mo, this bank's ~${bank.casualTenureMonths} mo threshold may still be approachable with an employer letter.`);
      } else {
        score -= 20;
        reasons.push(`Tenure ${monthsInRole} mo is below this bank's typical ~${bank.casualTenureMonths} mo casual/contract preference.`);
      }
    }

    if (isSelfEmployed) {
      if (bank.overall === 'flexible' || bank.overall === 'mainstream_flexible') {
        score += 18;
        reasons.push('More pragmatic self-employed assessment than typical Big-4 standardised policy.');
      } else if (bank.overall === 'rate_focused') {
        score -= 12;
        reasons.push('Rate-focused digital lenders usually prefer clean PAYG over complex business income.');
      }
      if (addbacks > 0 && bank.overall === 'flexible') {
        score += 5;
        reasons.push('Accountant-verified add-backs are more commonly accepted here than at majors.');
      }
    }

    if (overtime > 0) {
      if (bank.overtimeCrediting === 'generous') {
        score += 8;
        reasons.push('Overtime/bonus crediting tends to be less conservative.');
      } else if (bank.overtimeCrediting === 'conservative') {
        score -= 5;
        reasons.push('Expect conservative overtime/bonus shading unless 2-year history is clear.');
      }
    }

    if (dti > 6) {
      if (bank.dtiAppetite === 'generous') score += 5;
      else if (bank.dtiAppetite === 'tight') {
        score -= 15;
        reasons.push('DTI above 6× sits poorly with tighter appetite lenders.');
      } else {
        score -= 8;
        reasons.push('DTI above 6× typically triggers extra scrutiny.');
      }
    } else if (dti > 5) {
      if (bank.dtiAppetite === 'tight') {
        score -= 6;
        reasons.push('DTI above 5× is near the edge for tighter-appetite lenders.');
      }
    }

    if (lvr > 90) {
      score -= 8;
      reasons.push('High LVR (>90%) narrows the field at most lenders.');
    } else if (lvr > 85) {
      score -= 4;
      reasons.push('LVR above 85% typically means LMI and a narrower lender panel.');
    }

    // Property-type flags from the strict checks — the main differentiator for
    // otherwise-vanilla PAYG files (e.g. high-rise at 80% LVR).
    if (isDensity) {
      const label = (propertyType || propCheck?.data?.property_type || 'high-density').replace(/_/g, ' ');
      if (bank.highDensityAppetite === 'flexible') {
        score += 12;
        reasons.push(`More pragmatic on ${label} LVR — brokers often find a path above conservative 70–80% caps in supported postcodes.`);
      } else if (bank.highDensityAppetite === 'moderate') {
        score += 2;
        reasons.push(`${label} is workable here in many postcodes, but expect LVR scrutiny around 80%.`);
      } else {
        score -= 14;
        reasons.push(`Tighter typical LVR caps on ${label} (often 70–80%) — less appetite without a strong postcode / development story.`);
      }
    }

    if (ruralLike) {
      if (bank.overall === 'flexible' || bank.id === 'boq') {
        score += 8;
        reasons.push('Regional / rural lending is more commonly accommodated here than at pure digital majors.');
      } else if (bank.overall === 'rate_focused') {
        score -= 10;
        reasons.push('Acreage / rural files are usually outside rate-focused digital lender appetite.');
      } else {
        score -= 6;
        reasons.push('Rural / acreage typically attracts lower max LVR at mainstream lenders.');
      }
    }

    if (cardLimits >= 10000) {
      if (bank.overall === 'rate_focused') {
        score -= 4;
        reasons.push(`$${cardLimits.toLocaleString('en-AU')} in card limits is a material serviceability drag — digital lenders are less flexible on residual commitments.`);
      }
    }

    if (hasAdverse) {
      if (bank.overall === 'flexible') {
        score -= 5;
        reasons.push('Adverse credit still hurts — flexible lenders may listen with a clear explanation and time-since-event.');
      } else {
        score -= 15;
        reasons.push('Adverse credit is a material headwind under standardised policy.');
      }
    }

    if (!isPpor && bank.rentalShadingPct != null && bank.rentalShadingPct >= 80) {
      score += 6;
      reasons.push(`Investment rental shading often around ${bank.rentalShadingPct}% (less conservative).`);
    }

    let fit = 'fair';
    if (score >= 70) fit = 'strong';
    else if (score >= 45) fit = 'fair';
    else if (score >= 25) fit = 'weak';
    else fit = 'unsuitable';

    if (reasons.length === 0) {
      reasons.push('No strong positive or negative posture flags from the inputs provided — treat as a mainstream shop.');
    }

    return {
      id: bank.id,
      name: bank.name,
      shortName: bank.shortName,
      overall: bank.overall,
      postureSummary: bank.postureSummary,
      fit,
      score,
      reasons,
      moreForgivingOn: bank.moreForgivingOn,
      stricterOn: bank.stricterOn,
      notes: bank.notes,
      disclaimer: 'Indicative broker posture based on commonly observed lending appetite — not a credit decision and not sourced from CDR.',
    };
  });

  rows.sort((a, b) => b.score - a.score);

  return {
    banks: rows,
    basis: 'curated_broker_posture',
    note: 'Bank-by-bank rows below are curated broker knowledge about typical credit appetite (tenure windows, self-employed flexibility, overtime shading, DTI tolerance, high-density/rural property policy). They are driven by flags already raised in the strict checks — not generic bank trivia. They are not live Open Banking fields and do not predict approval. Use with the CDR product-fit table for rates and published eligibility text.',
    reviewed: '2026-07',
  };
}

module.exports = {
  BANK_POSTURES,
  buildBankPostureFit,
};
