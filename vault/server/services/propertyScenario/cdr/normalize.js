'use strict';

const { roundMoney } = require('../calc/tables');

/**
 * Map a CDR BankingProductDetail (or list item + detail) into Stage 6 lender row schema.
 */

function toPercent(rateStr) {
  if (rateStr == null || rateStr === '') return null;
  const n = Number(rateStr);
  if (!Number.isFinite(n)) return null;
  // CDR lending rates are decimals (0.0699 = 6.99%)
  if (n > 0 && n < 1) return roundMoney(n * 100);
  return roundMoney(n);
}

function parseIsoDurationMonths(value) {
  if (!value || typeof value !== 'string') return null;
  // P5Y / P36M / P1Y6M
  const y = value.match(/(\d+)Y/i);
  const m = value.match(/(\d+)M/i);
  let months = 0;
  if (y) months += Number(y[1]) * 12;
  if (m) months += Number(m[1]);
  return months > 0 ? months : null;
}

function hasFeature(features, type) {
  return (features || []).some((f) => String(f.featureType || '').toUpperCase() === type);
}

function featureMentionsOffset(features) {
  if (hasFeature(features, 'OFFSET')) return true;
  return (features || []).some((f) => /offset/i.test(`${f.additionalInfo || ''} ${f.additionalValue || ''}`));
}

function pickLendingRate(lendingRates = [], prefer = {}) {
  const preferPurpose = prefer.loanPurpose || 'OWNER_OCCUPIED';
  const preferRepay = prefer.repaymentType || 'PRINCIPAL_AND_INTEREST';
  const scored = lendingRates
    .map((r) => {
      let score = 0;
      if (r.loanPurpose === preferPurpose) score += 4;
      if (r.loanPurpose == null) score += 1;
      if (r.repaymentType === preferRepay) score += 3;
      if (r.repaymentType == null) score += 1;
      if (prefer.lendingRateType && r.lendingRateType === prefer.lendingRateType) score += 2;
      if (r.rate != null) score += 1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.r || null;
}

function sumFees(fees = [], predicate) {
  let total = 0;
  let matched = 0;
  fees.forEach((f) => {
    if (!predicate(f)) return;
    let amount = null;
    if (f.feeMethodUType === 'fixedAmount' && f.fixedAmount?.amount != null) {
      amount = Number(f.fixedAmount.amount);
    } else if (f.amount != null) {
      amount = Number(f.amount);
    }
    if (Number.isFinite(amount)) {
      total += amount;
      matched += 1;
    }
  });
  return { total: roundMoney(total), matched };
}

function estimateUpfrontFees(fees = []) {
  return sumFees(fees, (f) => {
    const type = String(f.feeType || '').toUpperCase();
    const name = String(f.name || '');
    if (['UPFRONT', 'PURCHASE', 'ESTABLISHMENT'].includes(type)) return true;
    if (/settlement|establishment|application|setup|rate lock/i.test(name)) return true;
    return false;
  }).total;
}

function estimateOngoingAnnualFees(fees = []) {
  let annual = 0;
  fees.forEach((f) => {
    const type = String(f.feeType || '').toUpperCase();
    if (!['PERIODIC', 'VARIABLE', 'ANNUAL'].includes(type) && !/annual|package|monthly fee/i.test(f.name || '')) {
      return;
    }
    let amount = null;
    if (f.feeMethodUType === 'fixedAmount' && f.fixedAmount?.amount != null) {
      amount = Number(f.fixedAmount.amount);
    } else if (f.amount != null) {
      amount = Number(f.amount);
    }
    if (!Number.isFinite(amount)) return;
    const freq = String(f.additionalValue || f.feeFrequency || '').toUpperCase();
    if (/P1Y|ANNUAL|YEAR/.test(freq) || type === 'ANNUAL') annual += amount;
    else if (/P1M|MONTH/.test(freq)) annual += amount * 12;
    else if (/package|annual/i.test(f.name || '')) annual += amount;
  });
  return roundMoney(annual);
}

function eligibilitySummary(eligibility = []) {
  return (eligibility || [])
    .slice(0, 6)
    .map((e) => e.additionalInfo || e.eligibilityType || e.additionalValue)
    .filter(Boolean);
}

/**
 * Special-purpose / restricted products must not appear as unlabeled "headline"
 * rates in the mainstream comparison (e.g. Westpac Sustainable Upgrades @ 4.49%).
 * Prefer filtering out; badge is a backstop if a row still surfaces.
 *
 * Patterns are intentionally title-focused. Do NOT use bare `\bemployee\b` against
 * eligibility text — it false-positives on "self-employed" and wiped mainstream
 * UBank products in live probes.
 */
const TITLE_SPECIAL_PATTERNS = [
  /\bsustainable\b/i,
  /\bgreen\b(?!\s*field)/i,
  /\bupgrades?\b/i,
  /\benvironment(al)?\b/i,
  /\benergy\s*efficient\b/i,
  /\bdefence\b/i,
  /\bdefense\b/i,
  /\badf\b/i,
  /\bveterans?\b/i,
  /\bstaff[\s-]?(loan|rate|package|offer)\b/i,
  /\bemployee[\s-]?(loan|rate|package|offer|scheme)\b/i,
  /\b(physician|doctor)[\s-]?(loan|rate|package)?\b/i,
  /\bprofessional\s+pack(age)?\b/i,
  /\bkey\s*worker\b/i,
  /\bsmsf\b/i,
  /\bself[\s-]?managed\b/i,
  /\breverse\s*mortgage\b/i,
  /\bequity\s*release\b/i,
  /\bbridg(e|ing)\b/i,
  /\bconstruction\b/i,
  /\bland\s*only\b/i,
  /\bline\s*of\s*credit\b/i,
  /\blow[\s-]?doc\b/i,
  /\bnon[\s-]?resident\b/i,
  /\bexpat\b/i,
  /\bguarantor\s+only\b/i,
];

const SPECIAL_ELIGIBILITY_LABEL = 'Special eligibility required';

/**
 * @param {string} name
 * @param {string} [description]
 * @param {string[]} [eligibilityTexts] — unused for staff/employee; kept for API compat
 * @returns {{ special_eligibility: boolean, special_reason: string|null }}
 */
function classifySpecialPurpose(name, description = '', eligibilityTexts = []) {
  // Title + description only — eligibility blobs often say "self-employed" / generic policy text.
  const haystack = [name, description].filter(Boolean).join(' ');
  const hit = TITLE_SPECIAL_PATTERNS.find((re) => re.test(haystack));
  if (hit) {
    const m = haystack.match(hit);
    return {
      special_eligibility: true,
      special_reason: m ? m[0] : 'restricted product',
    };
  }
  // SMSF / bridging sometimes only appear in eligibility lines — keep those specific.
  const elig = (eligibilityTexts || []).join(' ');
  const eligHit = [/\bsmsf\b/i, /\breverse\s*mortgage\b/i, /\bbridg(e|ing)\s+finance\b/i]
    .find((re) => re.test(elig));
  if (eligHit) {
    const m = elig.match(eligHit);
    return {
      special_eligibility: true,
      special_reason: m ? m[0] : 'restricted eligibility',
    };
  }
  return { special_eligibility: false, special_reason: null };
}

/**
 * @param {object} product — CDR product detail
 * @param {{ bankId: string, bankName: string, listMeta?: object }} ctx
 * @returns {object|null} Stage 6 lender row, or null if no usable rate
 */
function normalizeMortgageProduct(product, ctx = {}) {
  if (!product || product.productCategory !== 'RESIDENTIAL_MORTGAGES') return null;

  const rates = product.lendingRates || [];
  const variable = pickLendingRate(rates, { lendingRateType: 'VARIABLE' });
  const fixed = pickLendingRate(rates, { lendingRateType: 'FIXED' });
  const chosen = variable || fixed || pickLendingRate(rates, {});
  if (!chosen || chosen.rate == null) return null;

  const ratePct = toPercent(chosen.rate);
  const comparisonPct = toPercent(chosen.comparisonRate);
  if (ratePct == null) return null;

  const features = product.features || [];
  const fees = product.fees || [];
  const add = product.additionalInformation || {};
  const fixedMonths = chosen.lendingRateType === 'FIXED'
    ? parseIsoDurationMonths(chosen.additionalValue)
    : null;

  const idBase = `${ctx.bankId || product.brand || 'bank'}_${product.productId || product.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 80);

  const eligibility = eligibilitySummary(product.eligibility);
  const special = classifySpecialPurpose(
    product.name || '',
    product.description || '',
    eligibility
  );

  const upfront = estimateUpfrontFees(fees);
  const ongoing = estimateOngoingAnnualFees(fees);

  return {
    id: idBase,
    product_id: product.productId || null,
    name: product.name || 'Home loan',
    lender: ctx.bankName || product.brandName || product.brand || 'Unknown',
    product: product.name || null,
    brand: product.brand || null,
    rate: ratePct,
    comparison_rate: comparisonPct,
    fixed_or_variable: chosen.lendingRateType === 'FIXED' ? 'fixed' : 'variable',
    fixed_period_months: fixedMonths,
    lending_rate_type: chosen.lendingRateType || null,
    loan_purpose: chosen.loanPurpose || null,
    repayment_type: chosen.repaymentType || null,
    upfront_fees: upfront,
    ongoing_annual_fees: ongoing,
    // Fee figures are summed from CDR fee objects heuristically — never present as authoritative.
    upfront_fees_estimated: true,
    ongoing_annual_fees_estimated: true,
    fees_estimated: true,
    offset: featureMentionsOffset(features),
    redraw: hasFeature(features, 'REDRAW'),
    max_lvr: null,
    notes: chosen.additionalInfo || product.description || null,
    eligibility,
    special_eligibility: special.special_eligibility,
    special_eligibility_label: special.special_eligibility
      ? SPECIAL_ELIGIBILITY_LABEL
      : null,
    special_reason: special.special_reason,
    links: {
      application: product.applicationUri || null,
      overview: add.overviewUri || null,
      terms: add.termsUri || null,
      fees: add.feesAndPricingUri || null,
      eligibility: add.eligibilityUri || null,
      rate_info: chosen.additionalInfoUri || null,
    },
    last_updated: product.lastUpdated || null,
    source: 'cdr_prd',
    stub: false,
    bank_id: ctx.bankId || null,
    missing_fields: [
      comparisonPct == null ? 'comparison_rate' : null,
      fixedMonths == null && chosen.lendingRateType === 'FIXED' ? 'fixed_period_months' : null,
    ].filter(Boolean),
  };
}

/**
 * Prefer one variable + one fixed mainstream OO P&I product per bank.
 * Special-eligibility products are excluded from the mainstream comparison by default
 * (Sustainable Upgrades / Defence Force / SMSF / etc. must not look like headline rates).
 *
 * @param {object[]} normalizedRows
 * @param {number} [maxPerBank=2]
 * @param {{ includeSpecial?: boolean }} [opts]
 */
function selectRepresentativeProducts(normalizedRows, maxPerBank = 2, opts = {}) {
  const includeSpecial = opts.includeSpecial === true;
  const byBank = new Map();
  normalizedRows.forEach((row) => {
    const key = row.bank_id || row.lender;
    if (!byBank.has(key)) byBank.set(key, []);
    byBank.get(key).push(row);
  });

  const selected = [];
  byBank.forEach((rows) => {
    const pool = includeSpecial
      ? rows
      : rows.filter((r) => !r.special_eligibility);
    // If filtering removed everything, do not fall back to special products —
    // better a missing Westpac mainstream row than a misleading 4.49% green loan.
    if (!pool.length) return;

    const score = (r) => {
      let s = 0;
      if (r.loan_purpose === 'OWNER_OCCUPIED') s += 5;
      if (r.repayment_type === 'PRINCIPAL_AND_INTEREST') s += 3;
      if (r.comparison_rate != null) s += 1;
      if (r.offset) s += 1;
      if (r.special_eligibility) s -= 20;
      // Prefer lower comparison / rate for "headline" display among similars
      s -= (r.rate || 0) * 0.01;
      return s;
    };
    const vars = pool.filter((r) => r.fixed_or_variable === 'variable').sort((a, b) => score(b) - score(a));
    const fixs = pool.filter((r) => r.fixed_or_variable === 'fixed').sort((a, b) => score(b) - score(a));
    const picks = [];
    if (vars[0]) picks.push(vars[0]);
    if (fixs[0] && picks.length < maxPerBank) picks.push(fixs[0]);
    if (!picks.length) {
      picks.push(...pool.sort((a, b) => score(b) - score(a)).slice(0, maxPerBank));
    }
    selected.push(...picks.slice(0, maxPerBank));
  });
  return selected;
}

module.exports = {
  toPercent,
  parseIsoDurationMonths,
  pickLendingRate,
  classifySpecialPurpose,
  SPECIAL_ELIGIBILITY_LABEL,
  normalizeMortgageProduct,
  selectRepresentativeProducts,
  estimateUpfrontFees,
  estimateOngoingAnnualFees,
};
