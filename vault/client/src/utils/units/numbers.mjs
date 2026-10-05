/**
 * Number parsing shared by the scanner and the voice parser.
 *   parseNumeric("2 1/4")   → { value: 2.25, flags: [] }
 *   parseNumberWords(tokens, i) → { value, next } | null     ("one and a half", "point five")
 */

export const UNICODE_FRACTIONS = {
  '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const UF = Object.keys(UNICODE_FRACTIONS).join('');

/** Regex source for one numeric quantity as it appears in documents (no sign). */
export const NUMBER_SRC = [
  String.raw`\d+\s+\d+\/\d+`, // 2 1/4
  String.raw`\d*\s?[` + UF + String.raw`]`, // 1½, 1 ½, ½
  String.raw`\d+\/\d+`, // 3/4
  String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?`, // 1,200.5
  String.raw`\d+(?:[.,]\d+)?`, // 12, 1.5, 1,5
].join('|');

/**
 * Parse a numeric string. opts.decimalComma: true | false | 'auto' — how to read "1,500".
 * Flags: 'decimal-comma' (read a comma as decimal point), 'separator-uncertain'.
 */
export function parseNumeric(str, opts = {}) {
  let s = String(str).trim().replace(/ /g, ' ');
  if (!s) return null;
  let sign = 1;
  if (/^[-−]/.test(s)) { sign = -1; s = s.slice(1).trim(); }
  const flags = [];
  let m;
  if ((m = s.match(new RegExp(String.raw`^(\d*)\s?([` + UF + String.raw`])$`)))) {
    return { value: sign * ((m[1] ? Number(m[1]) : 0) + UNICODE_FRACTIONS[m[2]]), flags };
  }
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) {
    if (Number(m[3]) === 0) return null;
    return { value: sign * (Number(m[1]) + Number(m[2]) / Number(m[3])), flags };
  }
  if ((m = s.match(/^(\d+)\/(\d+)$/))) {
    if (Number(m[2]) === 0) return null;
    return { value: sign * (Number(m[1]) / Number(m[2])), flags };
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    // Single group like "1,500" may be a decimal comma in comma-decimal documents.
    if (/^\d{1,3},\d{3}$/.test(s) && opts.decimalComma === true) {
      flags.push('decimal-comma');
      return { value: sign * Number(s.replace(',', '.')), flags };
    }
    if (/^\d{1,3},\d{3}$/.test(s) && opts.decimalComma === 'auto-uncertain') flags.push('separator-uncertain');
    return { value: sign * Number(s.replace(/,/g, '')), flags };
  }
  if (/^\d+,\d+$/.test(s)) {
    flags.push('decimal-comma');
    return { value: sign * Number(s.replace(',', '.')), flags };
  }
  if (/^\d+(\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) return { value: sign * Number(s), flags };
  return null;
}

// ── Number words ──────────────────────────────────────────────────────────────
const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DENOMS = { half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6, eighth: 8, eighths: 8, tenth: 10, tenths: 10, sixteenth: 16, sixteenths: 16 };
const DIGIT_WORDS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

const isDigits = (t) => /^[-−]?(\d[\d.,/]*\d|\d)$/.test(t) || (t.length === 1 && t in UNICODE_FRACTIONS);
const isNumWord = (t) => t in ONES || t in TENS || t === 'hundred' || t === 'thousand';

/** Parse a whole-number phrase at tokens[i]. Returns { value, next } or null. */
function parseInteger(tokens, i) {
  let total = 0;
  let current = 0;
  let j = i;
  let used = false;
  let sawBig = false;
  while (j < tokens.length) {
    const t = tokens[j];
    if (t in ONES) { current += ONES[t]; used = true; j += 1; }
    else if (t in TENS) { current += TENS[t]; used = true; j += 1; }
    else if (t === 'hundred') { if (!used && !(tokens[j - 1] === 'a')) break; current = (current || 1) * 100; used = true; sawBig = true; j += 1; }
    else if (t === 'thousand') { if (!used && !(tokens[j - 1] === 'a')) break; total += (current || 1) * 1000; current = 0; used = true; sawBig = true; j += 1; }
    else if (t === 'and' && sawBig && j + 1 < tokens.length && (tokens[j + 1] in ONES || tokens[j + 1] in TENS)) { j += 1; }
    else break;
  }
  if (!used) return null;
  return { value: total + current, next: j };
}

function parseDigitsAfterPoint(tokens, j) {
  let digits = '';
  let k = j;
  while (k < tokens.length) {
    const t = tokens[k];
    if (t in DIGIT_WORDS) { digits += DIGIT_WORDS[t]; k += 1; }
    else if (/^\d+$/.test(t)) { digits += t; k += 1; }
    else break;
  }
  return digits ? { digits, next: k } : null;
}

function fractionAt(tokens, j) {
  // [a|an|<integer words>] <denominator>
  let k = j;
  let numerator = null;
  if (tokens[k] === 'a' || tokens[k] === 'an') { numerator = 1; k += 1; }
  else if (isDigits(tokens[k]) && /^\d+$/.test(tokens[k])) { numerator = Number(tokens[k]); k += 1; }
  else {
    const int = parseInteger(tokens, k);
    if (int) { numerator = int.value; k = int.next; }
  }
  if (numerator === null || !(tokens[k] in DENOMS)) return null;
  let den = DENOMS[tokens[k]];
  if ((tokens[k] === 'half' || tokens[k] === 'halves') && numerator !== 1 && numerator !== 0) den = 2;
  return { value: numerator / den, next: k + 1 };
}

/**
 * Parse a number at tokens[i]: digits, number words, fractions, decimals.
 * "one and a half", "three quarters", "twenty three", "point five", "two point five", "half".
 */
export function parseNumberWords(tokens, i) {
  let j = i;
  let sign = 1;
  if ((tokens[j] === 'minus' || tokens[j] === 'negative') && j + 1 < tokens.length) { sign = -1; j += 1; }
  const t = tokens[j];
  if (t === undefined) return null;

  let value = null;
  let hadInteger = false;

  if (t === 'point' || t === 'dot') {
    const d = parseDigitsAfterPoint(tokens, j + 1);
    if (!d) return null;
    return { value: sign * Number(`0.${d.digits}`), next: d.next };
  }
  if (t === 'half' || (t === 'a' && tokens[j + 1] === 'half') || (t === 'an' && tokens[j + 1] === 'half')) {
    let next = t === 'half' ? j + 1 : j + 2;
    if ((tokens[next] === 'a' || tokens[next] === 'an') && tokens[next + 1] !== undefined && !isNumWord(tokens[next + 1])) next += 1; // "half a cup"
    return { value: sign * 0.5, next };
  }
  if (t === 'quarter' || ((t === 'a' || t === 'an') && tokens[j + 1] === 'quarter')) {
    let next = t === 'quarter' ? j + 1 : j + 2;
    if ((tokens[next] === 'a' || tokens[next] === 'an') && tokens[next + 1] !== undefined && !isNumWord(tokens[next + 1])) next += 1;
    return { value: sign * 0.25, next };
  }

  if (isDigits(t)) {
    const p = parseNumeric(t);
    if (!p) return null;
    value = p.value;
    hadInteger = true;
    j += 1;
  } else {
    const int = parseInteger(tokens, j);
    if (!int) {
      if ((t === 'a' || t === 'an') && (tokens[j + 1] === 'hundred' || tokens[j + 1] === 'thousand')) {
        const int2 = parseInteger(tokens, j + 1);
        if (int2) return { value: sign * int2.value, next: int2.next };
      }
      return null;
    }
    value = int.value;
    hadInteger = true;
    j = int.next;
  }

  // "three quarters", "one half": the integer was a numerator
  if (hadInteger && tokens[j] in DENOMS) {
    const den = DENOMS[tokens[j]];
    return { value: sign * (value / den), next: j + 1 };
  }
  // decimals: "two point five"
  if ((tokens[j] === 'point' || tokens[j] === 'dot') && Number.isInteger(value)) {
    const d = parseDigitsAfterPoint(tokens, j + 1);
    if (d) return { value: sign * Number(`${value}.${d.digits}`), next: d.next };
  }
  // "one and a half", "two and three quarters"
  if (tokens[j] === 'and') {
    const f = fractionAt(tokens, j + 1);
    if (f) return { value: sign * (value + f.value), next: f.next };
  }
  // "one half" handled above; "1 1/2" handled by the numeric parser
  return { value: sign * value, next: j };
}

/** Tokenise spoken or typed text (keeps numerals, words, unit glyphs). */
export function tokenize(text) {
  const s = String(text || '').toLowerCase().replace(/[‐-―]/g, ' ').replace(/[‘’`´]/g, "'");
  const re = /[-−]?\d[\d.,/]*\d|\d|[a-z°²³µ]+(?:\/[a-z0-9]+)*|[½¼¾⅓⅔⅛⅜⅝⅞]/g;
  return s.match(re) || [];
}

/** "twenty three point five" → 23.5; non-number text → null. Accepts typed digits too. */
export function parseSpokenNumber(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const direct = parseNumeric(raw.replace(/\s+/g, ' '));
  if (direct) return direct.value;
  const tokens = tokenize(raw);
  if (!tokens.length) return null;
  const r = parseNumberWords(tokens, 0);
  if (r && r.next >= tokens.length) return r.value;
  return null;
}

/** Replace number words with digits, leave everything else: "twelve hundred millimetres" → "1200 millimetres". */
export function numberWordsToDigits(text) {
  const tokens = tokenize(text);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const r = parseNumberWords(tokens, i);
    if (r) { out.push(String(Math.round(r.value * 1e9) / 1e9)); i = r.next; } else { out.push(tokens[i]); i += 1; }
  }
  return out.join(' ');
}
