/** Build side-by-side feature comparison for Product Scout results. */

export function getCompareProducts(top3 = [], stretch = []) {
  const products = [...top3];
  if (stretch.length) {
    products.push({ ...stretch[0], isStretch: true, rank: 'Stretch' });
  }
  return products.slice(0, 4);
}

function shortTitle(title, max = 36) {
  const t = String(title || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

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

export function isDuplicateCoreRow(featureName) {
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

export function sanitizeFeatureTable(featureTable, products) {
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

export function cleanDeliveryDisplay(display, productPrice) {
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

function matchFeatureValue(product, featureName) {
  const bullets = product?.key_features || product?.feature_bullets || [];
  if (!bullets.length || !featureName) return null;
  const lower = featureName.toLowerCase();
  const word = lower.split(/\s+/)[0];
  const hit = bullets.find((b) => {
    const bl = String(b).toLowerCase();
    return bl.includes(lower) || lower.includes(bl.slice(0, 12)) || (word.length > 3 && bl.includes(word));
  });
  return hit || null;
}

function coreMetricRows(products) {
  return [
    {
      feature: 'Price',
      values: products.map((p) => p.price ?? p.price_display ?? '—'),
    },
    {
      feature: 'Delivery',
      values: products.map((p) => cleanDeliveryDisplay(p.delivery_display, p.price) || '—'),
    },
    {
      feature: 'Star rating',
      values: products.map((p) => (p.rating != null ? `${p.rating}★` : '—')),
    },
    {
      feature: 'Listing ratings',
      values: products.map((p) => (
        p.review_count != null ? Number(p.review_count).toLocaleString() : '—'
      )),
    },
    {
      feature: 'Pre-score',
      values: products.map((p) => (p.pre_score != null ? String(p.pre_score) : '—')),
      hint: 'Objective score from price, star rating, and review count (65% weight in final rank).',
    },
    {
      feature: 'Value score',
      values: products.map((p) => (p.value_score != null ? String(p.value_score) : '—')),
      hint: 'Final rank score: pre-score blended with AI adjustment (max ±12).',
    },
  ];
}

function mergeTableRows(products, llmRows) {
  const core = coreMetricRows(products);
  const coreNames = new Set(core.map((r) => r.feature.toLowerCase()));
  const extra = (llmRows || []).filter(
    (row) => !coreNames.has(String(row.feature).toLowerCase())
  );
  return [...core, ...extra];
}

export function buildFeatureTable(comparison) {
  const top3 = comparison?.top3 || [];
  const stretch = comparison?.stretch_suggestions || [];
  const products = getCompareProducts(top3, stretch);
  if (!products.length) return { products: [], rows: [] };

  const fromLlm = sanitizeFeatureTable(comparison?.feature_table, products);
  const rows = mergeTableRows(products, fromLlm);

  const priority = comparison?.priority_features || [];
  const existing = new Set(rows.map((r) => r.feature.toLowerCase()));

  for (const pf of priority) {
    if (existing.has(pf.feature.toLowerCase()) || isDuplicateCoreRow(pf.feature)) continue;
    rows.push({
      feature: pf.feature,
      values: products.map((p) => matchFeatureValue(p, pf.feature) || '—'),
      inferred: true,
    });
    existing.add(pf.feature.toLowerCase());
  }

  if (!fromLlm.length && !priority.length) {
    const maxBullets = Math.max(...products.map((p) => (p.key_features || p.feature_bullets || []).length), 0);
    for (let i = 0; i < Math.min(maxBullets, 4); i += 1) {
      rows.push({
        feature: `Feature ${i + 1}`,
        values: products.map((p) => {
          const bullets = p.key_features || p.feature_bullets || [];
          return bullets[i] || '—';
        }),
      });
    }
  }

  return { products, rows };
}

export function formatListingRatings(count) {
  if (count == null) return '—';
  return `${Number(count).toLocaleString()} listing ratings`;
}

export { shortTitle };
