'use strict';

const { CDR_BANKS, MORTGAGE_CATEGORY } = require('./banks');
const { fetchAllProducts, fetchProductDetail } = require('./client');
const {
  normalizeMortgageProduct,
  selectRepresentativeProducts,
  classifySpecialPurpose,
} = require('./normalize');

/** In-memory cache so UI reloads don't hammer every bank. */
let cache = {
  at: 0,
  payload: null,
};

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_DETAILS_PER_BANK = 12;

function preferDetailCandidates(products) {
  const scored = products.map((p) => {
    const name = `${p.name || ''} ${p.description || ''}`;
    let score = 0;
    if (/owner.?occup|owner occup|oo\b/i.test(name)) score += 3;
    if (/variable|svl|standard variable|flex\b|offset/i.test(name)) score += 2;
    if (/fixed/i.test(name)) score += 1;
    if (/invest/i.test(name)) score -= 1;
    if (/package|wealth/i.test(name)) score += 1;
    // Fetch mainstream products first — special-purpose are excluded from
    // the comparison table and waste detail budget if prioritised.
    if (classifySpecialPurpose(p.name || '', p.description || '').special_eligibility) {
      score -= 50;
    }
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.p);
}

/**
 * Fetch + normalize residential mortgage products for one bank.
 * Never throws — returns status object.
 */
async function fetchBankMortgages(bank, opts = {}) {
  const started = Date.now();
  const status = {
    bank_id: bank.id,
    bank_name: bank.name,
    ok: false,
    list_ok: false,
    detail_ok_count: 0,
    detail_fail_count: 0,
    product_list_count: 0,
    normalized_count: 0,
    version_list: null,
    issues: [],
    duration_ms: 0,
  };

  try {
    const list = await fetchAllProducts(bank.baseUrl, {
      category: MORTGAGE_CATEGORY,
      versions: bank.preferredVersions,
      pageSize: bank.pageSize || 25,
      maxPages: bank.maxPages || opts.maxPages || 4,
      timeoutMs: bank.timeoutMs || opts.timeoutMs || 20000,
      skipCategoryFilter: Boolean(bank.skipCategoryFilter),
    });

    if (!list.ok && !(list.products || []).length) {
      status.issues.push(list.error || 'Product list failed');
      status.duration_ms = Date.now() - started;
      return { status, products: [] };
    }

    status.list_ok = true;
    status.version_list = list.version;
    status.product_list_count = list.products.length;
    if (list.error) status.issues.push(`List partial: ${list.error}`);

    const candidates = preferDetailCandidates(list.products).slice(
      0,
      opts.maxDetailsPerBank || MAX_DETAILS_PER_BANK
    );

    const normalized = [];
    for (const item of candidates) {
      const detail = await fetchProductDetail(bank.baseUrl, item.productId, {
        versions: bank.preferredVersions,
        timeoutMs: opts.timeoutMs || 20000,
      });
      if (!detail.ok || !detail.product) {
        status.detail_fail_count += 1;
        status.issues.push(
          `Detail failed for ${item.productId}: ${detail.error || 'unknown'}`
        );
        continue;
      }
      status.detail_ok_count += 1;
      const row = normalizeMortgageProduct(detail.product, {
        bankId: bank.id,
        bankName: bank.name,
      });
      if (row) normalized.push(row);
    }

    status.normalized_count = normalized.length;
    status.ok = normalized.length > 0;
    if (!status.ok) {
      status.issues.push('No mortgage products with usable lending rates after detail fetch');
    }
    status.duration_ms = Date.now() - started;
    return { status, products: normalized };
  } catch (err) {
    status.issues.push(err.message || String(err));
    status.duration_ms = Date.now() - started;
    return { status, products: [] };
  }
}

/**
 * Fetch mortgages across configured banks.
 * @param {{ bankIds?: string[], forceRefresh?: boolean, ttlMs?: number }} [opts]
 */
async function getLiveMortgageLenders(opts = {}) {
  const ttl = opts.ttlMs != null ? opts.ttlMs : DEFAULT_TTL_MS;
  if (
    !opts.forceRefresh
    && cache.payload
    && Date.now() - cache.at < ttl
  ) {
    return { ...cache.payload, cache: { hit: true, age_ms: Date.now() - cache.at } };
  }

  const banks = opts.bankIds
    ? CDR_BANKS.filter((b) => opts.bankIds.includes(b.id))
    : CDR_BANKS;

  const coverage = [];
  const allProducts = [];

  // Parallel per bank (each bank sequential on details)
  const results = await Promise.all(banks.map((b) => fetchBankMortgages(b, opts)));
  results.forEach(({ status, products }) => {
    coverage.push(status);
    allProducts.push(...products);
  });

  const representative = selectRepresentativeProducts(allProducts, 2);
  const succeeded = coverage.filter((c) => c.ok).map((c) => c.bank_name);
  const failed = coverage.filter((c) => !c.ok).map((c) => ({
    bank: c.bank_name,
    issues: c.issues,
  }));

  const payload = {
    ok: representative.length > 0,
    source: 'cdr_prd',
    category: MORTGAGE_CATEGORY,
    fetched_at: new Date().toISOString(),
    lenders: representative,
    all_normalized: allProducts,
    coverage: {
      requested: banks.map((b) => b.name),
      succeeded,
      failed,
      per_bank: coverage,
      summary:
        `${succeeded.length}/${banks.length} lenders returned usable mortgage rates. `
        + (failed.length
          ? `Issues: ${failed.map((f) => f.bank).join(', ')}.`
          : 'All requested lenders OK.'),
    },
    cache: { hit: false, age_ms: 0 },
  };

  cache = { at: Date.now(), payload };
  return payload;
}

function clearCdrCache() {
  cache = { at: 0, payload: null };
}

/** Return warm CDR cache only — never triggers a network fetch. */
function peekLiveMortgageLenders() {
  if (cache.payload && Date.now() - cache.at < DEFAULT_TTL_MS) {
    return { ...cache.payload, cache: { hit: true, age_ms: Date.now() - cache.at } };
  }
  return null;
}

/**
 * Mean advertised rate across mainstream owner-occupier products of a given type.
 * Used as the UI default for Interest Rate / Target rate fields.
 *
 * @param {object[]} lenders — normalized CDR (or mock) lender rows
 * @param {'variable'|'fixed'} [rateType='variable']
 * @returns {{ rate_pct: number|null, sample_size: number }}
 */
function averageOwnerOccupiedRate(lenders, rateType = 'variable') {
  const kind = rateType === 'fixed' ? 'fixed' : 'variable';
  const pool = (Array.isArray(lenders) ? lenders : [])
    .filter((l) => l && l.fixed_or_variable === kind)
    .filter((l) => !l.special_eligibility)
    .filter((l) => !l.loan_purpose || l.loan_purpose === 'OWNER_OCCUPIED');

  let rates = pool
    .map((l) => Number(l.rate))
    .filter((r) => Number.isFinite(r) && r > 0 && r < 25);

  // If purpose tagging was sparse, fall back to any mainstream rate of that type.
  if (!rates.length) {
    rates = (Array.isArray(lenders) ? lenders : [])
      .filter((l) => l && l.fixed_or_variable === kind && !l.special_eligibility)
      .map((l) => Number(l.rate))
      .filter((r) => Number.isFinite(r) && r > 0 && r < 25);
  }

  if (!rates.length) return { rate_pct: null, sample_size: 0 };
  const mean = rates.reduce((sum, r) => sum + r, 0) / rates.length;
  return {
    rate_pct: Math.round(mean * 100) / 100,
    sample_size: rates.length,
  };
}

/** @deprecated use averageOwnerOccupiedRate(lenders, 'variable') */
function averageOwnerOccupiedVariableRate(lenders) {
  return averageOwnerOccupiedRate(lenders, 'variable');
}

module.exports = {
  getLiveMortgageLenders,
  peekLiveMortgageLenders,
  fetchBankMortgages,
  clearCdrCache,
  averageOwnerOccupiedRate,
  averageOwnerOccupiedVariableRate,
  DEFAULT_TTL_MS,
  MAX_DETAILS_PER_BANK,
};
