'use strict';

const VARIANCE_KEY = 'product_scout_price_variance_pct';
const AMAZON_DOMAIN_KEY = 'product_scout_amazon_domain';
const DEFAULT_VARIANCE_PCT = 10;
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

async function getPriceVariancePct(pool) {
  const { rows } = await pool.query(
    'SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1',
    [VARIANCE_KEY]
  );
  const n = Number(rows[0]?.value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VARIANCE_PCT;
  return Math.min(100, n);
}

async function setPriceVariancePct(pool, pct) {
  const n = Math.min(100, Math.max(0, Number(pct) || 0));
  await pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [VARIANCE_KEY, String(n)]
  );
  return n;
}

async function getProductScoutSettings(pool) {
  const amazonDomain = await getAmazonDomain(pool);
  return {
    priceVariancePct: await getPriceVariancePct(pool),
    defaultPriceVariancePct: DEFAULT_VARIANCE_PCT,
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

function applyBudgetFilter(candidates, maxPrice, variancePct) {
  const max = Number(maxPrice);
  if (!Number.isFinite(max) || max <= 0) {
    return { primary: [...candidates], stretch: [], budget: null };
  }

  const pct = Number.isFinite(variancePct) ? variancePct : DEFAULT_VARIANCE_PCT;
  const ceiling = Math.round(max * (1 + pct / 100) * 100) / 100;
  const primary = [];
  const stretch = [];

  for (const c of candidates) {
    const p = parseNumericPrice(c);
    const base = { ...c, price_numeric: p };
    if (p == null) {
      primary.push(base);
      continue;
    }
    if (p <= max) {
      primary.push(base);
    } else if (p <= ceiling) {
      stretch.push({
        ...base,
        over_budget_amount: Math.round((p - max) * 100) / 100,
        over_budget_pct: Math.round(((p - max) / max) * 1000) / 10,
      });
    }
  }

  return {
    primary,
    stretch,
    budget: { maxPrice: max, variancePct: pct, ceiling },
  };
}

module.exports = {
  VARIANCE_KEY,
  AMAZON_DOMAIN_KEY,
  DEFAULT_VARIANCE_PCT,
  DEFAULT_AMAZON_DOMAIN,
  AMAZON_MARKETPLACES,
  marketplaceLabel,
  getAmazonDomain,
  setAmazonDomain,
  getPriceVariancePct,
  setPriceVariancePct,
  getProductScoutSettings,
  parseNumericPrice,
  applyBudgetFilter,
};
