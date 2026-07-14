'use strict';

const { callModel } = require('./callModel');
const { getModelsForUser, pickTextModel } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { webSearch } = require('./webSearchService');

const AU_STORES = [
  { id: 'coles', label: 'Coles', domain: 'coles.com.au' },
  { id: 'woolworths', label: 'Woolworths', domain: 'woolworths.com.au' },
  { id: 'aldi', label: 'Aldi', domain: 'aldi.com.au' },
];

const GROCERY_SYSTEM = `You are an Australian supermarket price analyst for Coles, Woolworths, and Aldi.
Use ONLY prices and product names found in the provided web search snippets — never invent prices.
If a store price is not in the snippets, set confidence to "unknown" and price null.
Prefer own-brand and common pack sizes matching the ingredient quantity when possible.
All prices in AUD. Return ONLY valid JSON. No markdown fences.`;

function normalizeIngredientLines(raw) {
  const lines = String(raw || '')
    .split(/\n|,/)
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
  return [...new Set(lines)].slice(0, 20);
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

async function callGroceryModel(userId, modelId, prompt, { system, maxTokens = 3500, feature = 'recipes_grocery' } = {}) {
  if (!modelId) throw new Error('No text model configured — add a chat model in Settings → AI & Chat');
  const result = await callModel(modelId, prompt, { system, maxTokens, returnUsage: true });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature,
  });
  return result;
}

async function callGroceryJson(userId, modelId, prompt, opts = {}) {
  const { text: raw } = await callGroceryModel(userId, modelId, prompt, opts);
  let parsed = parseModelJson(raw);
  if (parsed) return parsed;

  const { text: retryRaw } = await callGroceryModel(
    userId,
    modelId,
    `Return ONLY valid JSON. Fix this output:\n${String(raw || '').slice(0, 8000)}`,
    { system: 'Output valid JSON only.', maxTokens: opts.maxTokens, feature: `${opts.feature || 'recipes_grocery'}_retry` }
  );
  parsed = parseModelJson(retryRaw);
  if (!parsed) throw new Error('Could not parse grocery price response — try again');
  return parsed;
}

async function gatherGrocerySearchResults(ingredientLines) {
  const items = ingredientLines.slice(0, 12);
  const summary = items.join(', ').slice(0, 280);
  const queries = [
    `Coles Australia ${summary} supermarket price`,
    `Woolworths Australia ${summary} supermarket price`,
    `Aldi Australia ${summary} supermarket price`,
  ];

  if (items.length <= 8) {
    for (const item of items.slice(0, 6)) {
      queries.push(`${item} price Coles Woolworths Aldi Australia AUD`);
    }
  }

  const seen = new Set();
  const merged = [];
  for (const query of [...new Set(queries)].slice(0, 8)) {
    try {
      const results = await webSearch(query, { num: 5 });
      for (const row of results) {
        const key = row.url || row.title;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    } catch {
      /* continue other queries */
    }
  }
  return merged.slice(0, 40);
}

function buildGroceryPrompt(ingredientLines, searchResults, { recipeTitle, servings } = {}) {
  const snippetBlock = searchResults.length
    ? searchResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
    : 'No search results — mark all prices unknown.';

  return `Shopping list (Australia — Coles, Woolworths, Aldi):
${ingredientLines.map((line, i) => `${i + 1}. ${line}`).join('\n')}
${recipeTitle ? `\nRecipe: ${recipeTitle}${servings ? ` (serves ${servings})` : ''}` : ''}

Web search snippets:
${snippetBlock}

Return JSON:
{
  "disclaimer": "Short note that prices are estimates from web search",
  "currency": "AUD",
  "items": [
    {
      "ingredient": "line from list",
      "quantity": "pack size if known",
      "coles": { "price": 2.5, "label": "$2.50", "product": "product name", "url": "https://...", "confidence": "high|medium|low|unknown" },
      "woolworths": { "price": null, "label": null, "product": null, "url": null, "confidence": "unknown" },
      "aldi": { "price": 2.2, "label": "$2.20", "product": "...", "url": null, "confidence": "medium" },
      "cheapestStore": "aldi|coles|woolworths|null",
      "notes": "optional"
    }
  ],
  "totals": {
    "coles": { "total": 45.2, "label": "$45.20", "complete": false },
    "woolworths": { "total": 47.1, "label": "$47.10", "complete": false },
    "aldi": { "total": 42.8, "label": "$42.80", "complete": false },
    "cheapestStore": "aldi"
  },
  "missingPrices": ["ingredients with no reliable price"],
  "links": [{ "store": "coles", "title": "...", "url": "..." }]
}

Sum totals only for items with known prices; set complete false if any item missing for that store.`;
}

function normalizeStorePrice(val) {
  if (!val || typeof val !== 'object') {
    return { price: null, label: null, product: null, url: null, confidence: 'unknown' };
  }
  const price = Number.isFinite(Number(val.price)) ? Number(val.price) : null;
  return {
    price,
    label: val.label != null ? String(val.label) : (price != null ? `$${price.toFixed(2)}` : null),
    product: val.product ? String(val.product) : null,
    url: val.url ? String(val.url) : null,
    confidence: val.confidence || (price != null ? 'medium' : 'unknown'),
  };
}

function normalizeGroceryResult(parsed, ingredientLines) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return {
    disclaimer: String(parsed?.disclaimer || 'Prices are estimates from web search — check each store before you shop.'),
    currency: 'AUD',
    stores: AU_STORES,
    ingredients: ingredientLines,
    items: items.map((row, i) => ({
      ingredient: String(row.ingredient || ingredientLines[i] || '').trim(),
      quantity: row.quantity ? String(row.quantity) : null,
      coles: normalizeStorePrice(row.coles),
      woolworths: normalizeStorePrice(row.woolworths),
      aldi: normalizeStorePrice(row.aldi),
      cheapestStore: row.cheapestStore || null,
      notes: row.notes ? String(row.notes) : null,
    })),
    totals: {
      coles: parsed?.totals?.coles || null,
      woolworths: parsed?.totals?.woolworths || null,
      aldi: parsed?.totals?.aldi || null,
      cheapestStore: parsed?.totals?.cheapestStore || null,
    },
    missingPrices: Array.isArray(parsed?.missingPrices) ? parsed.missingPrices.map(String) : [],
    links: Array.isArray(parsed?.links) ? parsed.links.map((l) => ({
      store: l.store,
      title: String(l.title || ''),
      url: String(l.url || ''),
    })).filter((l) => l.url) : [],
  };
}

async function priceIngredients(userId, { ingredients, recipeTitle, servings, recipeIngredients } = {}) {
  let lines = normalizeIngredientLines(ingredients);
  if (!lines.length && Array.isArray(recipeIngredients)) {
    lines = formatRecipeIngredients(recipeIngredients);
  }
  if (!lines.length) throw new Error('List at least one ingredient to price');

  const tiers = await getModelsForUser(userId);
  const modelId = pickTextModel(tiers, 'light');

  let searchResults = [];
  let searchError = null;
  try {
    searchResults = await gatherGrocerySearchResults(lines);
  } catch (err) {
    searchError = err.message;
  }

  const parsed = await callGroceryJson(
    userId,
    modelId,
    buildGroceryPrompt(lines, searchResults, { recipeTitle, servings }),
    { system: GROCERY_SYSTEM, maxTokens: 4000, feature: 'recipes_grocery' }
  );

  return {
    ...normalizeGroceryResult(parsed, lines),
    searchResultCount: searchResults.length,
    searchError,
  };
}

module.exports = {
  AU_STORES,
  priceIngredients,
  normalizeIngredientLines,
};
