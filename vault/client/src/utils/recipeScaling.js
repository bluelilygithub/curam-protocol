// Lightweight, client-side ingredient-amount scaling for the serving-size
// stepper. Deliberately a lighter-weight equivalent of the parsing done in
// server/services/recipeGroceryService.js (parseQuantityFromIngredient etc)
// rather than a forced shared import across the client/server boundary —
// this only needs to scale a leading number, not match store product titles.

function parseFraction(str) {
  const s = String(str || '').trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (b) return a / b;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseAmount(amountStr) {
  const s = String(amountStr || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d+)\s+(\d+\/\d+)\s*([a-zA-Z]+)?(.*)$/);
  if (m) {
    const whole = Number(m[1]);
    const frac = parseFraction(m[2]);
    if (frac != null) {
      return { value: whole + frac, unit: (m[3] || '').toLowerCase(), rest: (m[4] || '').trim() };
    }
  }

  m = s.match(/^(\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?(.*)$/);
  if (m) {
    const value = parseFraction(m[1]);
    if (value != null) {
      return { value, unit: (m[2] || '').toLowerCase(), rest: (m[3] || '').trim() };
    }
  }

  return null;
}

function formatScaledValue(n) {
  const r = Math.round(n * 100) / 100;
  if (r % 1 === 0) return r.toFixed(0);
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
 * Scale a single ingredient amount string by `factor`. Returns the string
 * unchanged if it doesn't start with a recognisable number (e.g. "to
 * taste") — conservative rather than guessing.
 */
export function scaleAmountString(amountStr, factor) {
  const parsed = parseAmount(amountStr);
  if (!parsed || !Number.isFinite(factor) || factor <= 0) return amountStr;
  const scaledValue = parsed.value * factor;
  const unitPart = parsed.unit ? ` ${parsed.unit}` : '';
  const restPart = parsed.rest ? ` ${parsed.rest}` : '';
  return `${formatScaledValue(scaledValue)}${unitPart}${restPart}`.trim();
}

/** Scale an { item, amount } ingredients array by a servings factor. */
export function scaleIngredients(ingredients, factor) {
  if (!Array.isArray(ingredients)) return [];
  if (!Number.isFinite(factor) || factor === 1) return ingredients;
  return ingredients.map((ing) => ({
    ...ing,
    amount: ing?.amount ? scaleAmountString(ing.amount, factor) : ing?.amount,
  }));
}
