'use strict';

// Figures in a model's text that do not appear in the input it was given: a year, phone number, count or price the model made up.
// Shared by Business Profiler (services/bip/summary.js, ask.js) and the Code Map Models summary (services/codeMap/models/summary.js).
// shortcut: checks digits only, not names or wording; a made-up name passes. Upgrade to a name check if that is seen in practice.

/** Number-like runs in a text. minDigits 2 (the default) ignores single digits, which suits years and phone numbers. */
const figures = (s, minDigits = 2) => (String(s || '').match(/\+?\d[\d ().,/-]*\d|\d+/g) || [])
  .map((t) => ({ text: t.trim(), digits: t.replace(/\D/g, '') }))
  .filter((t) => t.digits.length >= minDigits);

/**
 * The figures in `text` not found in `sourceText`, each once. A figure of 4+ digits may appear inside a longer run with other spacing
 * ("2005" inside "2005-2026"); shorter ones must be a whole number in the source ("13" and "6" from "13.6", never "40" from "04-09").
 * minDigits 1 checks every number, including single digits.
 */
function checkFigures(text, sourceText, { minDigits = 2 } = {}) {
  const tokens = figures(sourceText, 1);
  const whole = tokens.map((t) => t.digits);
  const parts = new Set(tokens.flatMap((t) => t.text.split(/\D+/).filter(Boolean)));
  const found = (t) => (t.digits.length >= 4 ? whole.some((d) => d.includes(t.digits)) : parts.has(t.digits) || whole.includes(t.digits));
  return [...new Set(figures(text, minDigits).filter((t) => !found(t)).map((t) => t.text))];
}

module.exports = { figures, checkFigures };
