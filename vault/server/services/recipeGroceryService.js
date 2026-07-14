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

function normalizeIngredientLines(raw) {
  const lines = String(raw || '')
    .split(/\n|,/)
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
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

function ingredientSearchTerm(line) {
  return String(line || '')
    .replace(/\d+(\.\d+)?\s*(g|kg|ml|l|tbsp|tsp|cup|cups|oz|lb|pcs?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || String(line || '').trim().slice(0, 80);
}

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
      for (const storeId of STORE_IDS) {
        if (found[storeId] || !r.price) continue;
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

/** Fallback: site-restricted organic search, price parsed from title/snippet. */
async function findViaOrganic(storeId, term) {
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain;
  if (!domain) return null;
  try {
    const results = await webSearch(`${term} site:${domain}`, { num: 5 });
    for (const r of results) {
      const price = parsePriceString(r.title) || parsePriceString(r.snippet);
      if (price) {
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
