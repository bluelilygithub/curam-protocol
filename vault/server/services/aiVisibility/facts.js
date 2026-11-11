'use strict';

/**
 * Key-fact matching for the AI Visibility audit.
 *
 * This is a documented heuristic, not entailment. It answers a narrower and more
 * useful question: does the answer state the numbers and distinctive terms that
 * were supplied as the business's key facts? It deliberately checks numbers with
 * their units, because "0.5°C" and "0.5" mean different things, and "6 weeks" is
 * not "6 months".
 */

const STOPWORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'between',
  'both', 'but', 'can', 'could', 'does', 'each', 'from', 'has', 'have', 'having', 'into',
  'its', 'just', 'more', 'most', 'not', 'only', 'other', 'our', 'out', 'over', 'same',
  'should', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'until', 'very', 'was', 'were',
  'what', 'when', 'where', 'which', 'while', 'will', 'with', 'within', 'would', 'your',
  'standard', 'using', 'used', 'uses',
]);

const UNIT_ALIASES = {
  a: ['a', 'amp', 'amps', 'ampere', 'amperes'],
  amp: ['a', 'amp', 'amps', 'ampere', 'amperes'],
  v: ['v', 'volt', 'volts'],
  w: ['w', 'watt', 'watts', 'kw'],
  c: ['c', '°c', 'degree', 'degrees', 'celsius'],
  f: ['f', '°f', 'fahrenheit'],
  mm: ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'],
  cm: ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters'],
  m: ['m', 'metre', 'metres', 'meter', 'meters'],
  kg: ['kg', 'kilogram', 'kilograms'],
  g: ['g', 'gram', 'grams'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  week: ['week', 'weeks', 'wk', 'wks'],
  day: ['day', 'days'],
  hour: ['hour', 'hours', 'hr', 'hrs'],
  month: ['month', 'months'],
  year: ['year', 'years', 'yr', 'yrs'],
  percent: ['%', 'percent', 'per cent'],
};

function normalise(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/±/g, '+-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unitFamily(unit) {
  const u = normalise(unit).replace(/^°/, '').replace(/\.$/, '');
  if (!u) return null;
  for (const [family, aliases] of Object.entries(UNIT_ALIASES)) {
    if (aliases.includes(u) || aliases.includes(`°${u}`)) return family;
  }
  return u;
}

const NUMBER_RE = /(?:(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*)?(\d+(?:\.\d+)?)\s*(°c|°f|degrees?|celsius|fahrenheit|amps?|a\b|volts?|v\b|watts?|w\b|kw|mm|cm|kg|g\b|litres?|l\b|weeks?|wks?|days?|hours?|hrs?|months?|years?|yrs?|%|percent|aud|usd|\$)?/gi;

/** Numbers in a fact, with the unit written next to them (and a range's low value). */
function extractNumbers(text) {
  const out = [];
  const source = normalise(text);
  let match;
  NUMBER_RE.lastIndex = 0;
  while ((match = NUMBER_RE.exec(source))) {
    if (!match[0].trim()) continue;
    const low = match[1] != null ? Number(match[1]) : null;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    const unit = match[3] || '';
    if (low != null && Number.isFinite(low)) out.push({ value: low, unit, raw: match[0] });
    out.push({ value, unit, raw: match[0] });
  }
  return out;
}

function significantWords(text) {
  const words = normalise(text)
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ''))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}

function stem(word) {
  return String(word || '').replace(/(ies)$/i, 'y').replace(/(es|s)$/i, '');
}

function wordPresent(word, haystack) {
  const stemmed = stem(word);
  const pattern = new RegExp(`\\b${stemmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return pattern.test(haystack);
}

function numberPresent(entry, haystack) {
  const value = entry.value;
  const asText = Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '');
  const numberRe = new RegExp(`(^|[^\\d.])${asText.replace('.', '\\.')}([^\\d.]|$)`, 'i');
  const m = numberRe.exec(haystack);
  if (!m) return false;
  if (!entry.unit) return true;

  const family = unitFamily(entry.unit);
  if (!family) return true;
  const aliases = UNIT_ALIASES[family] || [family];
  // The unit can be before the number ("10 amp") or after it ("10a"); look in a
  // small window around the match rather than the whole answer.
  const start = Math.max(0, m.index - 18);
  const end = Math.min(haystack.length, m.index + m[0].length + 18);
  const window = haystack.slice(start, end);
  return aliases.some((alias) => {
    const re = new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
    return re.test(window);
  });
}

/**
 * Match one key fact against text. `present` requires every number to be found (with
 * its unit) and at least 60% of the distinctive words. `confidence` is 0..1.
 */
function matchFact(fact, text) {
  const statement = String(fact == null ? '' : fact).trim();
  if (!statement) {
    return { statement, present: false, confidence: 0, matchedWords: [], missingWords: [], missingNumbers: [], evidence: '' };
  }

  const haystack = normalise(text);
  const numbers = extractNumbers(statement);
  const words = significantWords(statement);

  const missingNumbers = numbers.filter((n) => !numberPresent(n, haystack));
  const matchedWords = words.filter((w) => wordPresent(w, haystack));
  const missingWords = words.filter((w) => !matchedWords.includes(w));

  const numberScore = numbers.length ? (numbers.length - missingNumbers.length) / numbers.length : 1;
  const wordScore = words.length ? matchedWords.length / words.length : 1;
  const confidence = Math.round((numberScore * 0.6 + wordScore * 0.4) * 100) / 100;

  let evidence = '';
  const anchor = numbers.find((n) => numberPresent(n, haystack)) || null;
  if (anchor) {
    const re = new RegExp(`(^|[^\\d.])${String(anchor.value).replace('.', '\\.')}`, 'i');
    const m = re.exec(haystack);
    if (m) evidence = haystack.slice(Math.max(0, m.index - 70), Math.min(haystack.length, m.index + 110)).trim();
  } else if (matchedWords.length) {
    const idx = haystack.indexOf(matchedWords[0]);
    if (idx >= 0) evidence = haystack.slice(Math.max(0, idx - 70), Math.min(haystack.length, idx + 110)).trim();
  }

  return {
    statement,
    present: missingNumbers.length === 0 && confidence >= 0.6,
    confidence,
    matchedWords,
    missingWords,
    missingNumbers: missingNumbers.map((n) => n.raw),
    evidence,
  };
}

function evaluateFacts(facts, text) {
  return (Array.isArray(facts) ? facts : [])
    .map((fact) => matchFact(fact, text))
    .filter((result) => result.statement);
}

/** A fact is "covered" when any answer states it. Used for the report's summary table. */
function factCoverage(facts, answers) {
  const list = Array.isArray(facts) ? facts : [];
  return list.map((statement) => {
    const matches = (answers || []).map((a) => matchFact(statement, a));
    const hit = matches.find((m) => m.present) || null;
    return {
      statement,
      present: !!hit,
      evidence: hit ? hit.evidence : '',
      confidence: hit ? hit.confidence : 0,
      answersFound: matches.filter((m) => m.present).length,
    };
  });
}

module.exports = {
  normalise,
  extractNumbers,
  significantWords,
  matchFact,
  evaluateFacts,
  factCoverage,
};
