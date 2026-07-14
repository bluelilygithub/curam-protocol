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

// Real Coles/Woolworths product-page URL shapes. Anything else indexed on their domain
// (recipe pages, "how to" guides, category listings) is not a priced product page.
const PRODUCT_URL_PATTERN = {
  coles: /coles\.com\.au\/product\//i,
  woolworths: /woolworths\.com\.au\/shop\/productdetails\//i,
};

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

/** Significant words (4+ letters, not a stopword) used to sanity-check a product match. */
function significantTokens(term) {
  return String(term || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

// Collapses doubled letters so US/AU spelling variants match ("chili" vs "chilli", "yogurt" vs "yoghurt"-adjacent cases).
function collapseRepeatedLetters(s) {
  return String(s || '').toLowerCase().replace(/(.)\1+/g, '$1');
}

/** Guards against matches like "chili" -> screwdriver set just because some number appeared nearby. */
function isRelevantMatch(term, title) {
  const tokens = significantTokens(term);
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

/** Google Shopping AU results, filtered to the two chains we care about. */
async function findViaShopping(term) {
  const found = {};
  try {
    const results = await shoppingSearch(`${term} australia`, { num: 20 });
    if (!Array.isArray(results)) return found;
    for (const r of results) {
      const src = String(r.source || '').toLowerCase();
      if (!r.price || r.price > MAX_PLAUSIBLE_ITEM_PRICE || !isRelevantMatch(term, r.title)) continue;
      for (const storeId of STORE_IDS) {
        if (found[storeId]) continue;
        if (STORE_MATCH[storeId](src)) {
          found[storeId] = {
            product: r.title,
            price: r.price,
            url: r.url,
            source: r.source || AU_STORES.find((s) => s.id === storeId)?.label,
            confidence: 'sourced',
          };
        }
      }
    }
  } catch { /* provider may not support shopping search */ }
  return found;
}

/**
 * Fallback: site-restricted search for an actual product page. Google indexes far more
 * recipe/guide pages than product pages on supermarket domains, so a matched result must
 * (a) look like a real product-page URL, (b) contain a genuine "$" price, and
 * (c) be topically relevant to the ingredient — otherwise it's discarded rather than
 * returning a confident-looking but meaningless number.
 */
async function findViaOrganic(storeId, term) {
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain;
  const urlPattern = PRODUCT_URL_PATTERN[storeId];
  if (!domain) return null;
  try {
    const results = await webSearch(`${term} site:${domain}`, { num: 8 });
    for (const r of results) {
      if (urlPattern && !urlPattern.test(r.url || '')) continue;
      if (!isRelevantMatch(term, r.title)) continue;
      const price = parsePriceString(r.title) || parsePriceString(r.snippet);
      if (price && price <= MAX_PLAUSIBLE_ITEM_PRICE) {
        return {
          product: r.title,
          price,
          url: r.url,
          source: AU_STORES.find((s) => s.id === storeId)?.label,
          confidence: 'sourced',
        };
      }
    }
  } catch { /* search unavailable */ }
  return null;
}

async function findStorePrices(line) {
  const term = ingredientSearchTerm(line);
  const result = { coles: null, woolworths: null };
  if (!term) return result;

  const viaShopping = await findViaShopping(term);
  result.coles = viaShopping.coles || null;
  result.woolworths = viaShopping.woolworths || null;

  await Promise.all(
    STORE_IDS.filter((id) => !result[id]).map(async (id) => {
      result[id] = await findViaOrganic(id, term);
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
  try {
    await getSearchConfig();
  } catch {
    searchAvailable = false;
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

  return {
    disclaimer: searchAvailable
      ? 'Prices sourced from live product search results — confirm in-app or in-store before you buy, as prices and stock change.'
      : 'Add SEARCH_API_KEY in Settings → Web search to look up real prices. Use the store links below to check manually.',
    currency: 'AUD',
    sourced: true,
    searchAvailable,
    stores: AU_STORES,
    ingredients: lines,
    items,
    totals: computeTotals(items),
    missingPrices: items.filter((row) => !row.coles.price && !row.woolworths.price).map((r) => r.ingredient),
    liveFetchNote: !searchAvailable
      ? null
      : foundCount === 0
        ? 'No product listings matched — try simpler ingredient names, or use the store links to search manually.'
        : foundCount < items.length
          ? `Found prices for ${foundCount} of ${items.length} items — the rest need a manual store search.`
          : null,
  };
}

module.exports = {
  AU_STORES,
  priceIngredients,
  normalizeIngredientLines,
};
