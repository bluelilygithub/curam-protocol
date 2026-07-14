'use strict';

const { webSearch, shoppingSearch, parsePriceString, getSearchConfig } = require('./webSearchService');

const AU_STORES = [
  { id: 'coles', label: 'Coles', domain: 'coles.com.au' },
  { id: 'woolworths', label: 'Woolworths', domain: 'woolworths.com.au' },
];

const STORE_IDS = AU_STORES.map((s) => s.id);
const STORE_MATCH = {
  coles: (s) => s.includes('coles'),
  woolworths: (s) => s.includes('woolworths') || s.includes('woolies'),
};

// Prefer real product pages when present, but don't require them — Brave/organic search
// rarely returns indexed product URLs, so we reject bad pages instead of demanding good ones.
const PRODUCT_URL_PATTERN = {
  coles: /coles\.com\.au\/product\//i,
  woolworths: /woolworths\.com\.au\/shop\/productdetails\//i,
};

const REJECT_URL_PATTERN = /\/(recipe|recipes|how-to|howto|inspire|ideas|magazine|tips|productlist|catalog\/)/i;

function searchTermVariants(term) {
  const variants = [term];
  const words = String(term || '').split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    variants.push(words.slice(-2).join(' '));
    const last = words[words.length - 1];
    if (last.length >= 3) variants.push(last);
  }
  return [...new Set(variants)].slice(0, 3);
}

function isRejectedUrl(url) {
  return REJECT_URL_PATTERN.test(String(url || ''));
}

function matchesStore(storeId, source, url) {
  const src = String(source || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain || '';
  return STORE_MATCH[storeId](src) || (domain && u.includes(domain));
}

function extractPriceFromResult(r) {
  const combined = `${r?.title || ''} ${r?.snippet || ''}`;
  return parsePriceString(r?.title) || parsePriceString(r?.snippet) || parsePriceString(combined);
}

function pickFromOrganicResults(results, term, storeId) {
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain;
  const productPattern = PRODUCT_URL_PATTERN[storeId];
  const label = AU_STORES.find((s) => s.id === storeId)?.label;
  const candidates = [];

  for (const r of results) {
    const url = r.url || '';
    if (!domain || !url.includes(domain)) continue;
    if (isRejectedUrl(url)) continue;
    const price = extractPriceFromResult(r);
    if (!price || price > MAX_PLAUSIBLE_ITEM_PRICE) continue;
    const isProduct = productPattern?.test(url);
    const text = `${r.title || ''} ${r.snippet || ''}`;
    if (!isRelevantMatch(term, text, { isProduct })) continue;
    candidates.push({ r, price, isProduct });
  }

  candidates.sort((a, b) => b.isProduct - a.isProduct);
  if (!candidates.length) return null;
  const { r, price } = candidates[0];
  return {
    product: r.title,
    price,
    url: r.url,
    source: label,
    confidence: 'sourced',
  };
}

// Only ever split on newlines. Recipe ingredient text routinely contains internal commas
// (e.g. "1 can (400g), drained and rinsed cooked beans (e.g. black or kidney)") — splitting
// on commas shreds a single ingredient into meaningless fragments like "1 can" or "black or
// kidney)", which then search for completely unrelated products.
function normalizeIngredientLines(raw) {
  const text = String(raw || '');
  let lines = text.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  // A single comma-separated line (freeform "chicken, rice, coconut milk" paste) is the
  // one case where commas really do separate distinct ingredients.
  if (lines.length === 1 && lines[0].includes(',') && !/\([^)]*,[^)]*\)/.test(lines[0])) {
    lines = lines[0].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [...new Set(lines)].slice(0, 12);
}

function formatRecipeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map((ing) => {
      const item = String(ing?.item || ing || '').trim();
      const amount = String(ing?.amount || '').trim();
      return amount ? `${amount} ${item}` : item;
    })
    .filter(Boolean);
}

const FILLER_PHRASES = [
  'to taste', 'adjust to taste', 'drained and rinsed', 'e\\.g\\.', 'eg\\.',
  'finely', 'roughly', 'freshly', 'optional', 'for garnish', 'as needed',
  'preferably', 'day-old', 'day old', 'skin removed', 'shredded', 'zested', 'about',
];
const CONTAINER_WORDS = ['can', 'cans', 'jar', 'jars', 'packet', 'packets', 'pkt', 'bottle', 'bottles', 'bunch', 'bunches', 'clove', 'cloves', 'large', 'small', 'medium'];

/** Strips quantities, pack sizes, and instructional filler so the search term is the actual food item. */
function ingredientSearchTerm(line) {
  let s = String(line || '');
  s = s.replace(/\([^)]*\)/g, ' '); // parenthetical asides ("(e.g. black or kidney)", "(200g)", "(adjust to taste)")
  s = s.replace(/\d+(\.\d+)?\s*-?\s*\d*(\.\d+)?\s*(g|kg|ml|l|tbsp|tablespoons?|tsp|teaspoons?|cups?|oz|lb|pcs?)\b/gi, ' '); // pack sizes / measures
  s = s.replace(/\b(tablespoons?|teaspoons?|tbsp|tsp|cups?)\b/gi, ' '); // unit words with no leading number
  for (const phrase of FILLER_PHRASES) {
    s = s.replace(new RegExp(phrase, 'gi'), ' ');
  }
  const wordBoundary = CONTAINER_WORDS.join('|');
  s = s.replace(new RegExp(`\\b(${wordBoundary})\\b`, 'gi'), ' ');
  s = s.replace(/^[\d\s.,\-]+/, ''); // leading bare numbers/ranges ("1-2 ", "1 ")
  s = s.replace(/[,\s]+/g, ' ').trim();
  return (s || String(line || '').trim()).slice(0, 80);
}

const STOPWORDS = new Set(['and', 'or', 'the', 'with', 'for', 'from', 'into', 'fresh', 'sliced', 'chopped', 'cooked', 'ground']);

/** Significant words used to sanity-check a product match. Shorter min on product pages. */
function significantTokens(term, { minLen = 4 } = {}) {
  return String(term || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= minLen && !STOPWORDS.has(w));
}

// Collapses doubled letters so US/AU spelling variants match ("chili" vs "chilli").
function collapseRepeatedLetters(s) {
  return String(s || '').toLowerCase().replace(/(.)\1+/g, '$1');
}

function isRelevantMatch(term, title, { isProduct = false } = {}) {
  const minLen = isProduct ? 3 : 4;
  const tokens = significantTokens(term, { minLen });
  if (!tokens.length) return true;
  const t = collapseRepeatedLetters(title);
  return tokens.some((tok) => t.includes(collapseRepeatedLetters(tok)));
}

const MAX_PLAUSIBLE_ITEM_PRICE = 60;

function storeSearchUrl(storeId, term) {
  const encoded = encodeURIComponent(term);
  return storeId === 'coles'
    ? `https://www.coles.com.au/search?q=${encoded}`
    : `https://www.woolworths.com.au/shop/search/products?searchTerm=${encoded}`;
}

/** Google Shopping — Serper/SerpApi only. Matches store by retailer name or product URL domain. */
async function findViaShopping(storeId, term) {
  const label = AU_STORES.find((s) => s.id === storeId)?.label;
  for (const variant of searchTermVariants(term)) {
    try {
      const results = await shoppingSearch(`${variant} ${label}`, { num: 15 });
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (!r.price || r.price > MAX_PLAUSIBLE_ITEM_PRICE) continue;
        if (!matchesStore(storeId, r.source, r.url)) continue;
        if (!isRelevantMatch(variant, r.title)) continue;
        return {
          product: r.title,
          price: r.price,
          url: r.url,
          source: r.source || label,
          confidence: 'sourced',
        };
      }
    } catch { /* shopping API unavailable */ }
  }
  return null;
}

/** Site-restricted web search — works with Brave, Serper, and SerpApi. */
async function findViaOrganic(storeId, term) {
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain;
  const label = AU_STORES.find((s) => s.id === storeId)?.label;
  if (!domain) return null;

  for (const variant of searchTermVariants(term)) {
    const productPath = storeId === 'coles' ? 'site:coles.com.au/product/' : 'site:woolworths.com.au/shop/productdetails/';
    const queries = [
      `${variant} ${productPath}`,
      `${variant} price site:${domain}`,
      `${variant} site:${domain}`,
      `buy ${variant} site:${domain}`,
    ];
    for (const q of queries) {
      try {
        const results = await webSearch(q, { num: 8, preferSerper: true });
        const hit = pickFromOrganicResults(results, variant, storeId);
        if (hit) return hit;
      } catch { /* continue */ }
    }
  }

  try {
    const results = await webSearch(`${term} ${label} australia price`, { num: 10, preferSerper: true });
    return pickFromOrganicResults(results, term, storeId);
  } catch { /* search unavailable */ }

  return null;
}

async function findForStore(storeId, term) {
  return (await findViaShopping(storeId, term)) || (await findViaOrganic(storeId, term));
}

async function findStorePrices(line) {
  const term = ingredientSearchTerm(line);
  const result = { coles: null, woolworths: null };
  if (!term) return result;

  await Promise.all(
    STORE_IDS.map(async (id) => {
      result[id] = await findForStore(id, term);
    })
  );

  return result;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function computeTotals(items) {
  const totals = {};
  let cheapestStore = null;
  let cheapestSum = Infinity;

  for (const store of STORE_IDS) {
    let sum = 0;
    let priced = 0;
    for (const row of items) {
      const p = row[store]?.price;
      if (p != null && p > 0) {
        sum += p;
        priced += 1;
      }
    }
    totals[store] = {
      total: priced > 0 ? sum : null,
      label: priced > 0 ? `$${sum.toFixed(2)}` : null,
      complete: priced === items.length && items.length > 0,
      pricedCount: priced,
    };
    if (priced > 0 && sum < cheapestSum) {
      cheapestSum = sum;
      cheapestStore = store;
    }
  }

  return { ...totals, cheapestStore: cheapestStore || null };
}

function emptyStoreCell(storeId, term) {
  return {
    price: null,
    label: null,
    product: null,
    url: storeSearchUrl(storeId, term),
    source: null,
    confidence: 'not_found',
  };
}

async function priceIngredients(_userId, { ingredients, recipeIngredients } = {}) {
  let lines = normalizeIngredientLines(ingredients);
  if (!lines.length && Array.isArray(recipeIngredients)) {
    lines = formatRecipeIngredients(recipeIngredients);
  }
  if (!lines.length) throw new Error('List at least one ingredient to price');

  let searchAvailable = true;
  let searchProvider = null;
  try {
    ({ provider: searchProvider } = await getSearchConfig({ preferSerper: true }));
  } catch {
    try {
      ({ provider: searchProvider } = await getSearchConfig());
    } catch {
      searchAvailable = false;
    }
  }

  let items;
  if (!searchAvailable) {
    items = lines.map((line) => {
      const term = ingredientSearchTerm(line);
      return {
        ingredient: line,
        quantity: null,
        coles: emptyStoreCell('coles', term),
        woolworths: emptyStoreCell('woolworths', term),
        cheapestStore: null,
        notes: null,
      };
    });
  } else {
    items = await mapWithConcurrency(lines, 4, async (line) => {
      const term = ingredientSearchTerm(line);
      const found = await findStorePrices(line);
      const coles = found.coles || emptyStoreCell('coles', term);
      const woolworths = found.woolworths || emptyStoreCell('woolworths', term);
      let cheapestStore = null;
      let min = Infinity;
      for (const [storeId, cell] of [['coles', coles], ['woolworths', woolworths]]) {
        if (cell.price != null && cell.price < min) { min = cell.price; cheapestStore = storeId; }
      }
      return { ingredient: line, quantity: null, coles, woolworths, cheapestStore, notes: null };
    });
  }

  const foundCount = items.filter((row) => row.coles.price || row.woolworths.price).length;

  let liveFetchNote = null;
  if (searchAvailable && foundCount === 0) {
    liveFetchNote = searchProvider === 'brave'
      ? 'Brave Search has no shopping index — only pages with a visible $ price in the search snippet can be matched. Serper or SerpApi in Settings give better grocery results.'
      : 'No product listings matched — try simpler ingredient names, or use the store links to search manually.';
  } else if (searchAvailable && foundCount < items.length) {
    liveFetchNote = `Found prices for ${foundCount} of ${items.length} items — the rest need a manual store search.`;
  }

  return {
    disclaimer: searchAvailable
      ? 'Prices sourced from live product search results — confirm in-app or in-store before you buy, as prices and stock change.'
      : 'Add SERPER_SEARCH_API_KEY on Railway — key status in Settings → AI & Chat → Shopping search.',
    currency: 'AUD',
    sourced: true,
    searchAvailable,
    searchProvider,
    stores: AU_STORES,
    ingredients: lines,
    items,
    totals: computeTotals(items),
    missingPrices: items.filter((row) => !row.coles.price && !row.woolworths.price).map((r) => r.ingredient),
    liveFetchNote,
  };
}

module.exports = {
  AU_STORES,
  priceIngredients,
  normalizeIngredientLines,
};
