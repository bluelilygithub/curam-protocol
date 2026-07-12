'use strict';

const CORE_ROW_NAMES = new Set([
  'price',
  'delivery',
  'star rating',
  'listing ratings',
  'value score',
  'pre-score',
]);

const DUPLICATE_PATTERNS = [
  /^rating(s)?(\s+and\s+review)?(\s+count)?$/i,
  /^review(s|\s+count|\s+counts)?$/i,
  /^star(s|\s+rating)?$/i,
  /^listing\s+rating(s)?$/i,
  /^customer\s+rating(s)?$/i,
  /^number\s+of\s+reviews?$/i,
  /^rating.*review/i,
];

function normalizeFeatureName(name) {
  return String(name || '').trim().toLowerCase();
}

function isDuplicateCoreRow(featureName) {
  const n = normalizeFeatureName(featureName);
  if (CORE_ROW_NAMES.has(n)) return true;
  return DUPLICATE_PATTERNS.some((re) => re.test(n));
}

function parseNumericRating(val) {
  const m = String(val ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseReviewCount(val) {
  const digits = String(val ?? '').replace(/,/g, '').match(/(\d+)/);
  return digits ? Number(digits[1]) : null;
}

function rowMatchesField(row, products, field, parser) {
  if (!row?.values?.length || row.values.length !== products.length) return false;
  return row.values.every((val, i) => {
    const expected = products[i]?.[field];
    if (expected == null) return true;
    const parsed = parser(val);
    if (parsed == null) return false;
    if (field === 'rating') return Math.abs(parsed - Number(expected)) < 0.05;
    return parsed === Number(expected);
  });
}

function isVerifiedSpecRow(row, products) {
  const name = normalizeFeatureName(row.feature);
  if (/rating|review|price|delivery|value\s*score/.test(name)) {
    return false;
  }
  if (rowMatchesField(row, products, 'rating', parseNumericRating)) return false;
  if (rowMatchesField(row, products, 'review_count', parseReviewCount)) return false;
  return true;
}

/**
 * Drop duplicate core rows and LLM rows whose rating/review columns don't match listings.
 * @param {object[]} featureTable
 * @param {object[]} products — top3 (+ optional stretch) in column order
 */
function sanitizeFeatureTable(featureTable, products) {
  if (!Array.isArray(featureTable) || !products?.length) return [];

  const out = [];
  const seen = new Set(CORE_ROW_NAMES);

  for (const row of featureTable) {
    if (!row?.feature || !Array.isArray(row.values)) continue;
    const n = normalizeFeatureName(row.feature);
    if (isDuplicateCoreRow(row.feature) || seen.has(n)) continue;
    if (!isVerifiedSpecRow(row, products)) continue;

    out.push({
      feature: row.feature,
      values: row.values.slice(0, products.length).concat(
        Array(Math.max(0, products.length - row.values.length)).fill('—')
      ),
    });
    seen.add(n);
  }

  return out;
}

/** Strip product price accidentally appended to delivery strings. */
function cleanDeliveryDisplay(display, productPrice) {
  let s = String(display || '').trim();
  if (!s) return s;

  const priceNum = Number(productPrice);
  if (Number.isFinite(priceNum) && priceNum > 0) {
    const pricePatterns = [
      new RegExp(`\\s·\\s\\$${priceNum.toFixed(2).replace('.', '\\.')}$`),
      new RegExp(`\\s·\\s\\$${Math.round(priceNum)}$`),
    ];
    for (const re of pricePatterns) {
      s = s.replace(re, '');
    }
  }

  return s.trim() || '—';
}

module.exports = {
  sanitizeFeatureTable,
  isDuplicateCoreRow,
  cleanDeliveryDisplay,
  normalizeFeatureName,
};
