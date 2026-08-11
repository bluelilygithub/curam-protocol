'use strict';

const AMAZON_DOMAIN_KEY = 'product_scout_amazon_domain';
const DEFAULT_AMAZON_DOMAIN = 'amazon.com.au';

/** Rainforest-supported Amazon domains (common marketplaces). */
const AMAZON_MARKETPLACES = [
  { domain: 'amazon.com.au', label: 'Australia', currency: 'AUD' },
  { domain: 'amazon.com', label: 'United States', currency: 'USD' },
  { domain: 'amazon.co.uk', label: 'United Kingdom', currency: 'GBP' },
  { domain: 'amazon.ca', label: 'Canada', currency: 'CAD' },
  { domain: 'amazon.de', label: 'Germany', currency: 'EUR' },
  { domain: 'amazon.fr', label: 'France', currency: 'EUR' },
  { domain: 'amazon.co.jp', label: 'Japan', currency: 'JPY' },
  { domain: 'amazon.in', label: 'India', currency: 'INR' },
  { domain: 'amazon.com.mx', label: 'Mexico', currency: 'MXN' },
  { domain: 'amazon.com.br', label: 'Brazil', currency: 'BRL' },
];

const VALID_DOMAINS = new Set(AMAZON_MARKETPLACES.map((m) => m.domain));

function normalizeAmazonDomain(value) {
  const d = String(value || '').trim().toLowerCase();
  return VALID_DOMAINS.has(d) ? d : null;
}

function marketplaceLabel(domain) {
  return AMAZON_MARKETPLACES.find((m) => m.domain === domain)?.label || domain;
}

/** Env var overrides workspace setting when set. */
async function getAmazonDomain(pool) {
  const env = normalizeAmazonDomain(process.env.AMAZON_DOMAIN);
  if (env) return env;

  const { rows } = await pool.query(
    'SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1',
    [AMAZON_DOMAIN_KEY]
  );
  const stored = normalizeAmazonDomain(rows[0]?.value);
  return stored || DEFAULT_AMAZON_DOMAIN;
}

async function setAmazonDomain(pool, domain) {
  const d = normalizeAmazonDomain(domain);
  if (!d) throw new Error('Invalid Amazon marketplace');
  await pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [AMAZON_DOMAIN_KEY, d]
  );
  return d;
}

async function getProductScoutSettings(pool) {
  const amazonDomain = await getAmazonDomain(pool);
  return {
    amazonDomain,
    amazonCountry: marketplaceLabel(amazonDomain),
    amazonDomainFromEnv: Boolean(normalizeAmazonDomain(process.env.AMAZON_DOMAIN)),
    marketplaces: AMAZON_MARKETPLACES,
  };
}

function parseNumericPrice(candidate) {
  if (typeof candidate?.price === 'number' && Number.isFinite(candidate.price)) {
    return candidate.price;
  }
  const raw = candidate?.price_display || '';
  const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function applyBudgetFilter(candidates, maxPrice, minPrice = null) {
  const max = Number(maxPrice);
  const min = Number(minPrice);
  const hasMax = Number.isFinite(max) && max > 0;
  const hasMin = Number.isFinite(min) && min > 0;

  if (!hasMax && !hasMin) {
    return { primary: [...candidates], stretch: [], budget: null };
  }

  const primary = [];

  for (const c of candidates) {
    const p = parseNumericPrice(c);
    const base = { ...c, price_numeric: p };
    // Unpriced listings only allowed when no minimum is set (can't verify band).
    if (p == null) {
      if (!hasMin) primary.push(base);
      continue;
    }
    if (hasMin && p < min) continue;
    if (hasMax && p > max) continue;
    primary.push(base);
  }

  return {
    primary,
    stretch: [],
    budget: {
      ...(hasMax ? { maxPrice: max } : {}),
      ...(hasMin ? { minPrice: min } : {}),
    },
  };
}

/** Keep listings within a tier's price band (inclusive). */
function filterByPriceBand(candidates, minPrice, maxPrice) {
  const min = minPrice != null && Number.isFinite(Number(minPrice)) ? Number(minPrice) : null;
  const max = maxPrice != null && Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : null;

  if (min == null && max == null) return [...candidates];

  return candidates.filter((c) => {
    const p = parseNumericPrice(c);
    if (p == null) return min == null;
    if (min != null && p < min) return false;
    if (max != null && p > max) return false;
    return true;
  });
}

function buildBudgetFitNote(budgetHint, tierFramework) {
  if (!Number.isFinite(budgetHint) || budgetHint <= 0 || !tierFramework?.length) return '';

  const match = tierFramework.find((t) => {
    const min = Number(t.price_min);
    const max = Number(t.price_max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return budgetHint >= min && budgetHint <= max;
    }
    if (Number.isFinite(max)) return budgetHint <= max;
    if (Number.isFinite(min)) return budgetHint >= min;
    return false;
  });

  if (match) {
    return `Your ~$${budgetHint} budget aligns with the **${match.label}** tier — scout results below are tuned to that price band.`;
  }

  const below = tierFramework.filter((t) => Number(t.price_max) < budgetHint);
  const above = tierFramework.find((t) => Number(t.price_min) > budgetHint);
  if (above) {
    return `Your ~$${budgetHint} budget sits below **${above.label}** (${above.price_min != null ? `$${above.price_min}+` : 'higher tier'}). Essentials or Smart upgrade scouts are your best starting points.`;
  }
  if (below.length) {
    const top = below[below.length - 1];
    return `Your ~$${budgetHint} budget can reach **${top.label}** or above — compare scouts at each step to see what extra spend buys.`;
  }
  return '';
}

module.exports = {
  AMAZON_DOMAIN_KEY,
  DEFAULT_AMAZON_DOMAIN,
  AMAZON_MARKETPLACES,
  marketplaceLabel,
  getAmazonDomain,
  setAmazonDomain,
  getProductScoutSettings,
  parseNumericPrice,
  applyBudgetFilter,
  filterByPriceBand,
  buildBudgetFitNote,
};
