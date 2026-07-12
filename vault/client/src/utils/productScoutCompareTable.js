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

function normalizeLlmTable(featureTable, productCount) {
  if (!Array.isArray(featureTable)) return null;
  const rows = featureTable
    .filter((row) => row?.feature && Array.isArray(row.values))
    .map((row) => ({
      feature: row.feature,
      values: row.values.slice(0, productCount).concat(
        Array(Math.max(0, productCount - row.values.length)).fill('—')
      ),
    }));
  return rows.length ? rows : null;
}

function coreMetricRows(products) {
  return [
    {
      feature: 'Price',
      values: products.map((p) => p.price ?? p.price_display ?? '—'),
    },
    {
      feature: 'Delivery',
      values: products.map((p) => p.delivery_display || '—'),
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
      feature: 'Value score',
      values: products.map((p) => (p.value_score != null ? String(p.value_score) : '—')),
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

  const fromLlm = normalizeLlmTable(comparison?.feature_table, products.length);
  const rows = mergeTableRows(products, fromLlm);

  const priority = comparison?.priority_features || [];
  const existing = new Set(rows.map((r) => r.feature.toLowerCase()));

  for (const pf of priority) {
    if (existing.has(pf.feature.toLowerCase())) continue;
    rows.push({
      feature: pf.feature,
      values: products.map((p) => matchFeatureValue(p, pf.feature) || '—'),
    });
    existing.add(pf.feature.toLowerCase());
  }

  if (!fromLlm && !priority.length) {
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
