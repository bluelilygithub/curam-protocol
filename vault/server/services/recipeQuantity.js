'use strict';

// Lightweight, self-contained ingredient-amount parsing for serving-size
// scaling and meal-plan aggregation. Deliberately NOT the same code as
// recipeGroceryService.js's parseQuantityFromIngredient/normalizeQuantity —
// those exist to match ingredients against store product titles (grams/ml
// for pricing). This module exists only to scale/merge amounts *before*
// pricing runs, so grocery pricing still sees the same kind of ingredient
// lines it always has, just with updated numbers.

function parseFraction(str) {
  const s = String(str || '').trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (b) return a / b;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Parses a leading quantity (supports mixed numbers "1 1/2", plain fractions
// "1/2", decimals "0.5") plus an optional unit word, returning the numeric
// value, the unit token (lowercased, as written), and everything after as
// free text (e.g. "cloves garlic, minced" -> value 1, unit 'clove'? no —
// unit words are matched from a fixed list; anything else stays in `rest`).
const UNIT_WORDS = [
  'kg', 'g', 'gram', 'grams', 'ml', 'l', 'litre', 'litres', 'liter', 'liters',
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'clove', 'cloves', 'pcs', 'pc', 'each', 'bunch', 'bunches', 'can', 'cans',
  'jar', 'jars', 'packet', 'packets', 'pkt', 'bottle', 'bottles', 'loaf', 'loaves',
  'slice', 'slices', 'pinch', 'pinches', 'stick', 'sticks', 'sprig', 'sprigs',
];

function parseAmount(amountStr) {
  const s = String(amountStr || '').trim();
  if (!s) return null;

  // Mixed number "1 1/2 cups"
  let m = s.match(/^(\d+)\s+(\d+\/\d+)\s*([a-zA-Z]+)?(.*)$/);
  if (m) {
    const whole = Number(m[1]);
    const frac = parseFraction(m[2]);
    if (frac != null) {
      return {
        value: whole + frac,
        unit: (m[3] || '').toLowerCase(),
        rest: (m[4] || '').trim(),
      };
    }
  }

  // Plain fraction or decimal, optional unit
  m = s.match(/^(\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?(.*)$/);
  if (m) {
    const value = parseFraction(m[1]);
    if (value != null) {
      return {
        value,
        unit: (m[2] || '').toLowerCase(),
        rest: (m[3] || '').trim(),
      };
    }
  }

  return null;
}

/** Trim a scaled number to a sane display precision. */
function formatScaledValue(n) {
  const r = Math.round(n * 100) / 100;
  if (r % 1 === 0) return r.toFixed(0);
  // Prefer common fraction-looking halves/thirds/quarters over long decimals.
  const rounded4 = Math.round(r * 4) / 4;
  if (Math.abs(rounded4 - r) < 0.02) {
    const whole = Math.floor(rounded4);
    const frac = rounded4 - whole;
    const fracLabel = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }[frac];
    if (fracLabel) return whole ? `${whole} ${fracLabel}` : fracLabel;
  }
  return String(Math.round(r * 100) / 100);
}

/**
 * Scale a single ingredient's amount string by `factor`. Returns the original
 * string unchanged if it can't be parsed as a leading number (e.g. "to
 * taste", "a splash") — deliberately conservative rather than guessing.
 */
function scaleAmountString(amountStr, factor) {
  const parsed = parseAmount(amountStr);
  if (!parsed || !Number.isFinite(factor) || factor <= 0) return amountStr;
  const scaledValue = parsed.value * factor;
  const unitPart = parsed.unit ? ` ${parsed.unit}` : '';
  const restPart = parsed.rest ? ` ${parsed.rest}` : '';
  return `${formatScaledValue(scaledValue)}${unitPart}${restPart}`.trim();
}

/** Scale an { item, amount } ingredients array by a serving-size factor. */
function scaleIngredients(ingredients, factor) {
  if (!Array.isArray(ingredients)) return [];
  if (!Number.isFinite(factor) || factor === 1) return ingredients;
  return ingredients.map((ing) => ({
    ...ing,
    amount: ing?.amount ? scaleAmountString(ing.amount, factor) : ing?.amount,
  }));
}

/**
 * Merge ingredient lines from multiple recipes into one shopping list. Items
 * are grouped by a normalized item name; when both entries parse to the same
 * unit their quantities are summed, otherwise both amounts are kept side by
 * side on one line (e.g. "2 onions + 1 cup diced onion") rather than
 * silently dropping one — safer than guessing an equivalence.
 */
function mergeIngredientLists(recipeIngredientLists) {
  const byItem = new Map();
  for (const list of recipeIngredientLists) {
    for (const ing of list || []) {
      const item = String(ing?.item || ing?.name || '').trim();
      if (!item) continue;
      const key = item.toLowerCase();
      const amount = String(ing?.amount || '').trim();
      const parsed = amount ? parseAmount(amount) : null;

      if (!byItem.has(key)) {
        byItem.set(key, { item, amounts: [], parsedTotal: null, unit: null, rest: null });
      }
      const entry = byItem.get(key);
      if (amount) entry.amounts.push(amount);

      if (parsed && (entry.unit === null || entry.unit === parsed.unit) && (entry.rest === null || entry.rest === parsed.rest)) {
        entry.unit = parsed.unit;
        entry.rest = parsed.rest;
        entry.parsedTotal = (entry.parsedTotal || 0) + parsed.value;
      } else if (parsed) {
        // Conflicting unit/qualifier — bail on the merged number for this item.
        entry.parsedTotal = null;
      }
    }
  }

  return [...byItem.values()].map((entry) => {
    if (entry.parsedTotal != null) {
      const unitPart = entry.unit ? ` ${entry.unit}` : '';
      const restPart = entry.rest ? ` ${entry.rest}` : '';
      return { item: entry.item, amount: `${formatScaledValue(entry.parsedTotal)}${unitPart}${restPart}`.trim() };
    }
    // Couldn't merge numerically — list every amount used across recipes.
    return { item: entry.item, amount: entry.amounts.filter(Boolean).join(' + ') || null };
  });
}

module.exports = {
  parseAmount,
  scaleAmountString,
  scaleIngredients,
  mergeIngredientLists,
};
