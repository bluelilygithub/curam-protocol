'use strict';

const { webSearch, shoppingSearch, parsePriceString, getShoppingSearchConfig } = require('./webSearchService');

const AU_STORES = [
  { id: 'coles', label: 'Coles', domain: 'coles.com.au' },
  { id: 'woolworths', label: 'Woolworths', domain: 'woolworths.com.au' },
];

const STORE_IDS = AU_STORES.map((s) => s.id);
const STORE_MATCH = {
  coles: (s) => s.includes('coles'),
  woolworths: (s) => s.includes('woolworths') || s.includes('woolies'),
};

const PRODUCT_URL_PATTERN = {
  coles: /coles\.com\.au\/product\//i,
  woolworths: /woolworths\.com\.au\/shop\/productdetails\//i,
};

const REJECT_URL_PATTERN = /\/(recipe|recipes|how-to|howto|inspire|ideas|magazine|tips|productlist|catalog\/)/i;

const PREMIUM_KEYWORDS = [
  'himalayan', 'himalaya', 'pink salt', 'rock salt', 'truffle', 'gourmet', 'artisan',
  'luxury', 'imported', 'handmade', 'single origin', 'wagyu', 'gold label', 'reserve',
  'premium', 'select', 'finest', 'deluxe',
];

const VARIANT_RULES = [
  {
    id: 'milk-standard',
    matchLine: (raw) => /\bmilk\b/.test(raw) && !/\bskim|skimmed|lite|light|low\s*fat|no\s*fat|fat\s*free|0%\s*fat|full\s*cream|full\s*fat|whole\b/.test(raw),
    searchSuffix: 'full cream',
    prefer: ['full cream', 'full fat', 'whole'],
    avoid: ['skim', 'skimmed', 'lite', 'light', 'no fat', '0 fat', 'low fat', 'fat free', 'trim'],
  },
  {
    id: 'milk-skim',
    matchLine: (raw) => /\bskim|skimmed|lite|light|low\s*fat|no\s*fat|fat\s*free|0%\s*fat\b/.test(raw),
    searchSuffix: 'light',
    prefer: ['skim', 'skimmed', 'lite', 'light', 'low fat', 'no fat'],
    avoid: ['full cream', 'full fat', 'whole'],
  },
  {
    id: 'milk-full',
    matchLine: (raw) => /\bfull\s*(cream|fat)|whole\s*milk\b/.test(raw),
    searchSuffix: 'full cream',
    prefer: ['full cream', 'full fat', 'whole'],
    avoid: ['skim', 'skimmed', 'lite', 'light', 'no fat', 'low fat'],
  },
  {
    id: 'salt-table',
    matchLine: (raw) => /\bsalt\b/.test(raw) && !/himalayan|pink|sea|rock|flake|kosher/.test(raw),
    searchSuffix: 'table',
    prefer: ['table salt', 'iodised', 'iodized', 'cooking salt'],
    avoid: ['himalayan', 'pink', 'rock', 'sea salt', 'flake', 'flaky', 'kosher', 'celtic'],
  },
  {
    id: 'cream-pure',
    matchLine: (raw) => /\bcream\b/.test(raw) && !/\blight|lite|reduced\b/.test(raw),
    searchSuffix: 'pure',
    prefer: ['pure cream', 'thickened cream', 'whipping'],
    avoid: ['light', 'lite', 'reduced fat'],
  },
];

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

function matchesStore(storeId, source, url, title = '') {
  const src = String(source || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  const t = String(title || '').toLowerCase();
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain || '';
  return STORE_MATCH[storeId](src) || STORE_MATCH[storeId](t) || (domain && u.includes(domain));
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

function normalizeIngredientLines(raw) {
  const text = String(raw || '');
  let lines = text.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
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

function ingredientSearchTerm(line) {
  let s = String(line || '');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/\d+(\.\d+)?\s*-?\s*\d*(\.\d+)?\s*(g|kg|ml|l|tbsp|tablespoons?|tsp|teaspoons?|cups?|oz|lb|pcs?)\b/gi, ' ');
  s = s.replace(/\b(tablespoons?|teaspoons?|tbsp|tsp|cups?)\b/gi, ' ');
  for (const phrase of FILLER_PHRASES) {
    s = s.replace(new RegExp(phrase, 'gi'), ' ');
  }
  const wordBoundary = CONTAINER_WORDS.join('|');
  s = s.replace(new RegExp(`\\b(${wordBoundary})\\b`, 'gi'), ' ');
  s = s.replace(/^[\d\s.,\-]+/, '');
  s = s.replace(/[,\s]+/g, ' ').trim();
  return (s || String(line || '').trim()).slice(0, 80);
}

const STOPWORDS = new Set(['and', 'or', 'the', 'with', 'for', 'from', 'into', 'fresh', 'sliced', 'chopped', 'cooked', 'ground']);

function significantTokens(term, { minLen = 4 } = {}) {
  return String(term || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= minLen && !STOPWORDS.has(w));
}

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

function buildProductSpec(line) {
  const raw = String(line || '').toLowerCase();
  const term = ingredientSearchTerm(line);
  const rule = VARIANT_RULES.find((r) => r.matchLine(raw)) || null;
  const variantHints = rule ? [...rule.prefer] : [];
  const avoidHints = rule ? [...rule.avoid] : [];
  const searchSuffix = rule?.searchSuffix || null;
  return {
    line,
    term,
    raw,
    variantHints,
    avoidHints,
    searchSuffix,
    requiredTokens: significantTokens(term, { minLen: 3 }),
  };
}

function normalizeTitleTokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\w\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function titleSimilarity(a, b) {
  const A = new Set(normalizeTitleTokens(a));
  const B = new Set(normalizeTitleTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function scoreProduct(title, spec, referenceTitle = null) {
  const t = String(title || '').toLowerCase();
  let score = 0;

  for (const tok of spec.requiredTokens) {
    if (t.includes(tok)) score += 12;
    else score -= 4;
  }

  for (const hint of spec.variantHints) {
    if (t.includes(hint)) score += 10;
  }

  for (const avoid of spec.avoidHints) {
    if (t.includes(avoid)) score -= 22;
  }

  for (const premium of PREMIUM_KEYWORDS) {
    if (t.includes(premium) && !spec.variantHints.some((h) => t.includes(h))) score -= 12;
  }

  if (referenceTitle) {
    score += titleSimilarity(title, referenceTitle) * 35;
  }

  return score;
}

function buildStoreQueries(storeId, spec) {
  const label = AU_STORES.find((s) => s.id === storeId)?.label;
  const domain = AU_STORES.find((s) => s.id === storeId)?.domain;
  const queries = new Set();

  for (const variant of searchTermVariants(spec.term)) {
    if (spec.searchSuffix) queries.add(`${variant} ${spec.searchSuffix} ${label}`);
    queries.add(`${variant} ${label}`);
    if (domain) {
      if (spec.searchSuffix) queries.add(`${variant} ${spec.searchSuffix} site:${domain}`);
      queries.add(`${variant} site:${domain}`);
    }
  }

  return [...queries];
}

async function collectShoppingCandidates(storeId, spec) {
  const label = AU_STORES.find((s) => s.id === storeId)?.label;
  const seen = new Set();
  const candidates = [];
  let lastErr = null;

  for (const q of buildStoreQueries(storeId, spec)) {
    try {
      const results = await shoppingSearch(q, { num: 25 });
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (!r.price || r.price > MAX_PLAUSIBLE_ITEM_PRICE) continue;
        if (!matchesStore(storeId, r.source, r.url, r.title)) continue;
        if (!isRelevantMatch(spec.term, r.title)) continue;
        const key = `${r.title}|${r.price}|${r.url || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          product: r.title,
          price: r.price,
          url: r.url,
          source: r.source || label,
          confidence: 'sourced',
        });
      }
    } catch (err) {
      lastErr = err;
      console.warn('[recipeGrocery] shoppingSearch failed:', q, err.message);
    }
  }

  if (!candidates.length && lastErr) throw lastErr;
  return candidates;
}

function pickBestSingle(candidates, spec, referenceTitle = null) {
  if (!candidates.length) return null;
  const ranked = candidates
    .map((c) => ({ ...c, score: scoreProduct(c.product, spec, referenceTitle) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score || a.price - b.price);
  return ranked[0] || null;
}

function pickLikeForLikePair(colesCandidates, woolworthsCandidates, spec) {
  const topColes = colesCandidates
    .map((c) => ({ ...c, score: scoreProduct(c.product, spec) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, 10);
  const topWool = woolworthsCandidates
    .map((c) => ({ ...c, score: scoreProduct(c.product, spec) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, 10);

  if (!topColes.length && !topWool.length) return { coles: null, woolworths: null, matched: false };
  if (!topColes.length) return { coles: null, woolworths: topWool[0], matched: false };
  if (!topWool.length) return { coles: topColes[0], woolworths: null, matched: false };

  let best = null;
  let bestScore = -Infinity;

  for (const c of topColes) {
    for (const w of topWool) {
      const sim = titleSimilarity(c.product, w.product);
      const pairScore = Math.min(c.score, w.score) + sim * 40 + (c.score + w.score) * 0.15;
      if (pairScore > bestScore) {
        bestScore = pairScore;
        best = { coles: c, woolworths: w, similarity: sim, matched: sim >= 0.2 };
      }
    }
  }

  if (best && best.similarity >= 0.2) return best;

  const anchor = topColes[0].score >= topWool[0].score ? topColes[0] : topWool[0];
  const anchorStore = topColes[0].score >= topWool[0].score ? 'coles' : 'woolworths';
  const otherList = anchorStore === 'coles' ? topWool : topColes;
  const otherBest = pickBestSingle(otherList, spec, anchor.product);

  return {
    coles: anchorStore === 'coles' ? anchor : otherBest,
    woolworths: anchorStore === 'woolworths' ? anchor : otherBest,
    matched: otherBest ? titleSimilarity(anchor.product, otherBest.product) >= 0.2 : false,
  };
}

function parseFraction(str) {
  const s = String(str || '').trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (b) return a / b;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseQuantityFromIngredient(ing) {
  if (!ing || typeof ing !== 'object') return null;
  const amount = String(ing.amount || '').trim();
  const item = String(ing.item || ing.name || '').trim();
  if (!amount) return null;
  return parseQuantityFromLine(`${amount} ${item}`.trim());
}

/** Recipe quantity needed — grams, ml, or count. */
function parseQuantityFromLine(line) {
  const s = String(line || '').trim();
  const paren = s.match(/\((\d+(?:\.\d+)?|\d+\/\d+)\s*(g|kg|ml|l|litre|liters|oz|lb)\)/i);
  if (paren) {
    const val = parseFraction(paren[1]);
    if (val != null) return normalizeQuantity(val, paren[2]);
  }

  const measure = s.match(/(\d+(?:\.\d+)?|\d+\/\d+)\s*(kg|g|ml|mL|l|litre|liters|L|cup|cups|tbsp|tablespoons?|tsp|teaspoons?|clove|cloves|pcs?|each|bunch|can|cans|jar|packet|pkt|bottle|loaf|slice|slices|pinch)?/i);
  if (measure) {
    const val = parseFraction(measure[1]);
    if (val != null) return normalizeQuantity(val, measure[2] || 'each');
  }

  return null;
}

function normalizeQuantity(value, unitRaw) {
  const unit = String(unitRaw || 'each').toLowerCase().replace(/\./g, '');
  if (unit === 'kg') return { kind: 'mass', value: value * 1000, unit: 'g', label: `${value}kg` };
  if (unit === 'g') return { kind: 'mass', value, unit: 'g', label: `${value}g` };
  if (unit === 'l' || unit === 'litre' || unit === 'liters') return { kind: 'volume', value: value * 1000, unit: 'ml', label: `${value}L` };
  if (unit === 'ml') return { kind: 'volume', value, unit: 'ml', label: `${value}ml` };
  if (unit === 'cup' || unit === 'cups') return { kind: 'volume', value: value * 250, unit: 'ml', label: `${value} cup${value === 1 ? '' : 's'}` };
  if (unit === 'tbsp' || unit === 'tablespoon' || unit === 'tablespoons') return { kind: 'volume', value: value * 15, unit: 'ml', label: `${value} tbsp` };
  if (unit === 'tsp' || unit === 'teaspoon' || unit === 'teaspoons') return { kind: 'volume', value: value * 5, unit: 'ml', label: `${value} tsp` };
  if (unit === 'pinch') return { kind: 'volume', value: 1, unit: 'ml', label: 'pinch' };
  return { kind: 'count', value, unit: 'each', label: `${value}` };
}

const DEFAULT_PACK_BY_TERM = [
  { test: /\bmilk\b/, pack: { kind: 'volume', value: 2000, unit: 'ml', label: '2L', estimated: true } },
  { test: /\bcream\b/, pack: { kind: 'volume', value: 300, unit: 'ml', label: '300ml', estimated: true } },
  { test: /\bbutter\b/, pack: { kind: 'mass', value: 500, unit: 'g', label: '500g', estimated: true } },
  { test: /\bsalt\b/, pack: { kind: 'mass', value: 500, unit: 'g', label: '500g', estimated: true } },
  { test: /\b(flour|sugar|rice)\b/, pack: { kind: 'mass', value: 1000, unit: 'g', label: '1kg', estimated: true } },
  { test: /\b(chicken|beef|pork|lamb|mince)\b/, pack: { kind: 'mass', value: 500, unit: 'g', label: '500g', estimated: true } },
  { test: /\begg/, pack: { kind: 'count', value: 12, unit: 'each', label: '12 eggs', estimated: true } },
];

function inferDefaultPackSize(spec) {
  const term = `${spec?.term || ''} ${spec?.raw || ''}`.toLowerCase();
  for (const row of DEFAULT_PACK_BY_TERM) {
    if (row.test.test(term)) return { ...row.pack };
  }
  return null;
}

/** Convert tsp/cup of salt, flour, etc. to grams so we can compare to a g pack. */
function normalizeNeededForPack(needed, spec) {
  if (!needed) return null;
  const term = `${spec?.term || ''} ${spec?.raw || ''}`.toLowerCase();
  if (needed.kind === 'volume' && needed.unit === 'ml') {
    if (/\bsalt\b/.test(term)) {
      const grams = Math.max(1, Math.round(needed.value * 1.2));
      return { kind: 'mass', value: grams, unit: 'g', label: `${needed.label} (~${grams}g)` };
    }
    if (/\bflour\b/.test(term)) {
      const grams = Math.max(1, Math.round(needed.value * 0.5));
      return { kind: 'mass', value: grams, unit: 'g', label: `${needed.label} (~${grams}g)` };
    }
    if (/\bsugar\b/.test(term)) {
      const grams = Math.max(1, Math.round(needed.value * 0.85));
      return { kind: 'mass', value: grams, unit: 'g', label: `${needed.label} (~${grams}g)` };
    }
  }
  return needed;
}

function parsePackSizeFromTitle(title) {
  const t = String(title || '').toLowerCase();
  const found = [];

  for (const m of t.matchAll(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|litre|liters|millilitre|millilitres)\b/g)) {
    const per = normalizeQuantity(parseFloat(m[2]), m[3]);
    found.push({ ...per, value: per.value * parseInt(m[1], 10), label: `${m[1]}×${m[2]}${m[3]}` });
  }

  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g)\b/g)) {
    found.push(normalizeQuantity(parseFloat(m[1]), m[2]));
  }

  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(l|litre|liters|litres|millilitre|millilitres|ml|mL)\b/g)) {
    found.push(normalizeQuantity(parseFloat(m[1]), m[2]));
  }

  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(l|ml)\b/g)) {
    found.push(normalizeQuantity(parseFloat(m[1]), m[2]));
  }

  const countPack = t.match(/\b(\d+)\s*(?:pk|pack|eggs?)\b/);
  if (countPack) {
    found.push({ kind: 'count', value: parseInt(countPack[1], 10), unit: 'each', label: `${countPack[1]} pack` });
  }

  if (!found.length) return null;
  return found.sort((a, b) => b.value - a.value)[0];
}

function resolvePackSize(title, spec) {
  return parsePackSizeFromTitle(title) || inferDefaultPackSize(spec);
}

function quantitiesCompatible(needed, pack) {
  if (!needed || !pack) return false;
  if (needed.kind === pack.kind) return true;
  return false;
}

function computeProportionalPrices(packPrice, needed, pack) {
  const ratio = needed.value / pack.value;
  const recipePrice = Math.round(packPrice * ratio * 100) / 100;
  const checkoutPrice = ratio > 1
    ? Math.round(Math.ceil(ratio) * packPrice * 100) / 100
    : packPrice;
  return { ratio, recipePrice, checkoutPrice };
}

function enrichCellWithQuantity(cell, line, { needed: neededOverride, spec: specOverride } = {}) {
  if (!cell || cell.price == null) return cell;

  const spec = specOverride || buildProductSpec(line);
  const neededRaw = neededOverride || parseQuantityFromLine(line);
  const needed = normalizeNeededForPack(neededRaw, spec);
  let pack = resolvePackSize(cell.product, spec);
  const packEstimated = !!pack?.estimated;

  cell.quantityNeeded = neededRaw || needed;
  cell.packSize = pack;

  if (needed && pack && quantitiesCompatible(needed, pack) && pack.value > 0) {
    const { ratio, recipePrice, checkoutPrice } = computeProportionalPrices(cell.price, needed, pack);
    cell.recipePrice = recipePrice;
    cell.recipePriceLabel = `$${recipePrice.toFixed(2)}`;
    cell.quantityLabel = needed.label;
    cell.packSizeLabel = pack.label;
    cell.checkoutPrice = checkoutPrice;
    cell.checkoutPriceLabel = `$${checkoutPrice.toFixed(2)}`;
    cell.proportional = ratio < 0.999 || ratio > 1.001;
    const est = packEstimated ? ' (est. pack)' : '';
    cell.priceNote = ratio <= 1
      ? `${needed.label} of ${pack.label}${est}`
      : `${needed.label} · ${Math.ceil(ratio)} pack(s)${est}`;
  } else if (needed) {
    cell.recipePrice = null;
    cell.recipePriceLabel = null;
    cell.quantityLabel = needed.label;
    cell.checkoutPrice = cell.price;
    cell.checkoutPriceLabel = `$${cell.price.toFixed(2)}`;
    cell.proportional = false;
    cell.priceNote = pack ? 'Units not comparable — pack price only' : 'Pack size unknown — pack price only';
  } else {
    cell.recipePrice = null;
    cell.recipePriceLabel = null;
    cell.checkoutPrice = cell.price;
    cell.checkoutPriceLabel = `$${cell.price.toFixed(2)}`;
    cell.proportional = false;
    cell.priceNote = 'Add quantity to ingredient for recipe cost';
  }

  return cell;
}

async function findViaShopping(storeId, term) {
  const spec = buildProductSpec(term);
  spec.term = ingredientSearchTerm(term);
  const candidates = await collectShoppingCandidates(storeId, spec);
  return pickBestSingle(candidates, spec);
}

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

async function findMatchedStorePrices(line) {
  const spec = buildProductSpec(line);
  spec.term = ingredientSearchTerm(line);
  if (!spec.term) return { coles: null, woolworths: null, matched: false };

  let colesCandidates = [];
  let woolCandidates = [];
  try {
    [colesCandidates, woolCandidates] = await Promise.all([
      collectShoppingCandidates('coles', spec),
      collectShoppingCandidates('woolworths', spec),
    ]);
  } catch (err) {
    console.warn('[recipeGrocery] shopping candidates:', err.message);
  }

  let pair = pickLikeForLikePair(colesCandidates, woolCandidates, spec);

  for (const storeId of STORE_IDS) {
    if (!pair[storeId]) {
      try {
        pair[storeId] = (await findViaOrganic(storeId, spec.term))
          || pickBestSingle(storeId === 'coles' ? colesCandidates : woolCandidates, spec);
      } catch { /* ignore */ }
    }
  }

  if (pair.coles && pair.woolworths && !pair.matched) {
    const colesScore = scoreProduct(pair.coles.product, spec);
    const woolScore = scoreProduct(pair.woolworths.product, spec);
    const anchor = colesScore >= woolScore ? pair.coles : pair.woolworths;
    const otherId = anchor === pair.coles ? 'woolworths' : 'coles';
    const otherList = otherId === 'coles' ? colesCandidates : woolCandidates;
    const realigned = pickBestSingle(otherList, spec, anchor.product);
    if (realigned) {
      pair[otherId] = realigned;
      pair.matched = titleSimilarity(anchor.product, realigned.product) >= 0.2;
    }
  }

  return pair;
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
  let cheapestRecipeStore = null;
  let cheapestRecipeSum = Infinity;
  let cheapestBasketStore = null;
  let cheapestBasketSum = Infinity;

  for (const store of STORE_IDS) {
    let basketSum = 0;
    let recipeSum = 0;
    let priced = 0;
    let recipePriced = 0;

    for (const row of items) {
      const c = row[store];
      const checkout = c?.checkoutPrice ?? c?.price;
      if (checkout != null && checkout > 0) {
        basketSum += checkout;
        priced += 1;
      }
      if (c?.recipePrice != null && c.recipePrice > 0) {
        recipeSum += c.recipePrice;
        recipePriced += 1;
      }
    }

    totals[store] = {
      recipeTotal: recipePriced > 0 ? recipeSum : null,
      recipeLabel: recipePriced > 0 ? `$${recipeSum.toFixed(2)}` : null,
      basketTotal: priced > 0 ? basketSum : null,
      basketLabel: priced > 0 ? `$${basketSum.toFixed(2)}` : null,
      total: recipePriced > 0 ? recipeSum : (priced > 0 ? basketSum : null),
      label: recipePriced > 0 ? `$${recipeSum.toFixed(2)}` : (priced > 0 ? `$${basketSum.toFixed(2)}` : null),
      complete: recipePriced === items.length && items.length > 0,
      pricedCount: priced,
      recipePricedCount: recipePriced,
    };

    if (recipePriced > 0 && recipeSum < cheapestRecipeSum) {
      cheapestRecipeSum = recipeSum;
      cheapestRecipeStore = store;
    }
    if (priced > 0 && basketSum < cheapestBasketSum) {
      cheapestBasketSum = basketSum;
      cheapestBasketStore = store;
    }
  }

  return {
    ...totals,
    cheapestStore: cheapestRecipeStore || cheapestBasketStore || null,
    cheapestRecipeStore: cheapestRecipeStore || null,
    cheapestBasketStore: cheapestBasketStore || null,
  };
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

  let searchAvailable = false;
  let searchProvider = null;
  let searchConfigError = null;
  try {
    ({ provider: searchProvider } = await getShoppingSearchConfig());
    searchAvailable = true;
  } catch (err) {
    searchConfigError = err.message;
  }

  let items;
  if (!searchAvailable) {
    items = lines.map((line) => {
      const term = ingredientSearchTerm(line);
      const qty = parseQuantityFromLine(line);
      return {
        ingredient: line,
        quantity: qty?.label || null,
        matched: false,
        coles: emptyStoreCell('coles', term),
        woolworths: emptyStoreCell('woolworths', term),
        cheapestStore: null,
        notes: null,
      };
    });
  } else {
    const lineEntries = lines.map((line, idx) => ({ line, idx }));
    items = await mapWithConcurrency(lineEntries, 3, async ({ line, idx }) => {
      const spec = buildProductSpec(line);
      const needed = parseQuantityFromIngredient(recipeIngredients?.[idx]) || parseQuantityFromLine(line);
      const qtyLabel = needed?.label || null;
      const ctx = { needed, spec };
      const found = await findMatchedStorePrices(line);
      const coles = enrichCellWithQuantity(found.coles || emptyStoreCell('coles', spec.term), line, ctx);
      const woolworths = enrichCellWithQuantity(found.woolworths || emptyStoreCell('woolworths', spec.term), line, ctx);

      let cheapestStore = null;
      let min = Infinity;
      for (const [storeId, cell] of [['coles', coles], ['woolworths', woolworths]]) {
        const p = cell.recipePrice ?? cell.checkoutPrice ?? cell.price;
        if (p != null && p < min) { min = p; cheapestStore = storeId; }
      }

      return {
        ingredient: line,
        quantity: qtyLabel,
        matched: found.matched,
        coles,
        woolworths,
        cheapestStore,
        notes: found.matched ? null : 'Stores may show different variants — check product names.',
      };
    });
  }

  const foundCount = items.filter((row) => row.coles.price || row.woolworths.price).length;

  let liveFetchNote = null;
  if (!searchAvailable) {
    liveFetchNote = searchConfigError || 'Shopping search API not configured.';
  } else if (foundCount === 0) {
    liveFetchNote = 'No Coles or Woolworths listings matched — try simpler ingredient names (e.g. "500g chicken breast"), or use the store links.';
  } else if (foundCount < items.length) {
    liveFetchNote = `Found prices for ${foundCount} of ${items.length} items — the rest need a manual store search.`;
  } else {
    liveFetchNote = 'Recipe cost uses the quantity in your ingredient line; pack total is what you pay at checkout (whole packs). Products are matched like-for-like across stores where possible.';
  }

  return {
    disclaimer: searchAvailable
      ? 'Prices sourced from live product search — confirm in-store before you buy. Recipe cost is proportional to the quantity listed; pack total assumes whole packs at checkout.'
      : 'Add SERPER_SEARCH_API_KEY on Railway — configure Shopping search in Settings → AI & Chat → AI Models.',
    currency: 'AUD',
    sourced: true,
    searchAvailable,
    searchProvider,
    searchConfigError,
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
  buildProductSpec,
  parseQuantityFromLine,
  parsePackSizeFromTitle,
  parseQuantityFromIngredient,
  pickLikeForLikePair,
  scoreProduct,
};
