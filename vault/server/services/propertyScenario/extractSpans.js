'use strict';

/**
 * Deterministic pre-extraction of literal numeric / date spans from raw scenario text.
 * Pure pattern matching — zero invention. Does NOT assign values to scenario fields.
 */

let chrono = null;
try {
  // Optional: relative dates ("next month", "in September")
  chrono = require('chrono-node');
} catch {
  chrono = null;
}

function toIsoDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseAsOf(asOf) {
  if (asOf instanceof Date && !Number.isNaN(asOf.getTime())) return asOf;
  if (typeof asOf === 'string' && /^\d{4}-\d{2}-\d{2}/.test(asOf)) {
    const d = new Date(`${asOf.slice(0, 10)}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** Higher = keep when ranges overlap (dates often over-match numeric noise). */
const KIND_PRIORITY = {
  currency: 40,
  percent: 35,
  duration: 30,
  date: 10,
};

/**
 * Prefer higher-priority / longer spans when ranges overlap.
 * @param {object[]} spans
 */
function dedupeOverlaps(spans) {
  const sorted = [...spans].sort((a, b) => {
    const pA = KIND_PRIORITY[a.kind] || 0;
    const pB = KIND_PRIORITY[b.kind] || 0;
    if (pB !== pA) return pB - pA;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenB !== lenA) return lenB - lenA;
    return a.start - b.start;
  });
  const kept = [];
  sorted.forEach((s) => {
    if (kept.some((k) => overlaps(k, s))) return;
    kept.push(s);
  });
  return kept.sort((a, b) => a.start - b.start);
}

function pushSpan(list, span) {
  if (span.start == null || span.end == null || span.end <= span.start) return;
  if (!span.text) return;
  list.push(span);
}

/**
 * Currency amounts: $650,000 | 650k | 1.45 million | $1.2m
 */
function extractCurrency(text) {
  const out = [];
  const patterns = [
    {
      re: /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?/g,
      value: (m) => Number(m.replace(/[$,\s]/g, '')),
    },
    {
      re: /\$\s*\d+(?:\.\d{1,2})?(?!\s*[kKmM])/g,
      value: (m) => Number(m.replace(/[$,\s]/g, '')),
    },
    {
      re: /\b(\d+(?:\.\d+)?)\s*[kK]\b/g,
      value: (m, g1) => Number(g1) * 1_000,
    },
    {
      re: /\b(\d+(?:\.\d+)?)\s*[mM](?:illion)?\b/g,
      value: (m, g1) => Number(g1) * 1_000_000,
    },
    {
      re: /\b(\d+(?:\.\d+)?)\s+million\b/gi,
      value: (m, g1) => Number(g1) * 1_000_000,
    },
  ];

  patterns.forEach(({ re, value }) => {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[0];
      const num = value(raw, match[1]);
      if (!Number.isFinite(num) || num < 0) continue;
      pushSpan(out, {
        kind: 'currency',
        text: raw,
        start: match.index,
        end: match.index + raw.length,
        value: num,
      });
    }
  });
  return out;
}

/**
 * Percentages: 6.1% | 5.4 per cent | 5.4 percent
 */
function extractPercents(text) {
  const out = [];
  // "%" is a non-word char — do not require a trailing \b after it.
  const patterns = [
    /\b(\d+(?:\.\d+)?)\s*%/g,
    /\b(\d+(?:\.\d+)?)\s*per\s*cents?\b/gi,
    /\b(\d+(?:\.\d+)?)\s*percents?\b/gi,
  ];
  patterns.forEach((re) => {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[0];
      const num = Number(match[1]);
      if (!Number.isFinite(num)) continue;
      pushSpan(out, {
        kind: 'percent',
        text: raw,
        start: match.index,
        end: match.index + raw.length,
        value: num,
      });
    }
  });
  return out;
}

/**
 * Durations → normalized months where possible.
 * "24 months", "3-year fixed", "15 years left", "2 yrs"
 */
function extractDurations(text) {
  const out = [];
  const patterns = [
    // N-year / N year(s) / N-yr
    {
      re: /\b(\d+(?:\.\d+)?)\s*[-–]?\s*(years?|yrs?)\b/gi,
      unit: 'year',
    },
    {
      re: /\b(\d+(?:\.\d+)?)\s*[-–]?\s*(months?|mos?)\b/gi,
      unit: 'month',
    },
    {
      re: /\b(\d+(?:\.\d+)?)\s*[-–]?\s*(days?)\b/gi,
      unit: 'day',
    },
  ];

  patterns.forEach(({ re, unit }) => {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = match[0];
      // Avoid treating calendar years in ISO dates (already handled as dates)
      const before = text.slice(Math.max(0, match.index - 1), match.index);
      if (before === '-' || before === '/') continue;
      const count = Number(match[1]);
      if (!Number.isFinite(count) || count <= 0) continue;
      // Skip 4-digit year-looking counts when unit is year (e.g. "2015 years" nonsense rare;
      // more important: "settled 2015" is not a duration — chrono handles dates)
      if (unit === 'year' && count >= 1000) continue;

      let value_months = null;
      let value_days = null;
      if (unit === 'year') value_months = Math.round(count * 12);
      else if (unit === 'month') value_months = Math.round(count);
      else if (unit === 'day') value_days = Math.round(count);

      pushSpan(out, {
        kind: 'duration',
        text: raw,
        start: match.index,
        end: match.index + raw.length,
        unit,
        count,
        value_months,
        value_days,
      });
    }
  });
  return out;
}

/**
 * Absolute ISO dates in text + chrono relative/partial dates.
 */
function extractDates(text, asOfDate) {
  const out = [];

  // Explicit ISO-ish dates
  const isoRe = /\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/g;
  let match;
  while ((match = isoRe.exec(text)) !== null) {
    const raw = match[0];
    pushSpan(out, {
      kind: 'date',
      text: raw,
      start: match.index,
      end: match.index + raw.length,
      resolved_iso: raw,
      relative: false,
    });
  }

  // AU-ish day/month/year: 15/07/2026 or 15-07-2026
  const auRe = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2}|19\d{2})\b/g;
  while ((match = auRe.exec(text)) !== null) {
    const raw = match[0];
    const d = Number(match[1]);
    const m = Number(match[2]);
    const y = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) continue;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    pushSpan(out, {
      kind: 'date',
      text: raw,
      start: match.index,
      end: match.index + raw.length,
      resolved_iso: iso,
      relative: false,
    });
  }

  if (chrono) {
    const results = chrono.parse(text, asOfDate, { forwardDate: true });
    (results || []).forEach((r) => {
      const start = r.index;
      const raw = r.text;
      const end = start + raw.length;
      const when = r.start?.date?.();
      const iso = toIsoDate(when);
      if (!iso) return;
      const trimmed = raw.trim();
      // Skip numeric / rate / money fragments chrono occasionally misreads as dates
      if (/^\d+(\.\d+)?%?$/.test(trimmed)) return;
      if (/^\$/.test(trimmed)) return;
      if (/^(at|of|by)\s+\d+(\.\d+)?%?$/i.test(trimmed)) return;
      if (/\d+(\.\d+)?\s*%/.test(trimmed) && !/[a-z]{3,}/i.test(trimmed.replace(/%/g, ''))) return;
      pushSpan(out, {
        kind: 'date',
        text: raw,
        start,
        end,
        resolved_iso: iso,
        relative: Boolean(r.start && typeof r.start.isCertain === 'function' && !r.start.isCertain('day')),
      });
    });
  }

  return out;
}

/**
 * @param {string} text
 * @param {{ asOf?: string|Date }} [opts]
 * @returns {{
 *   as_of: string,
 *   spans: object[],
 * }}
 */
function extractSpans(text, opts = {}) {
  const source = String(text || '');
  const asOfDate = parseAsOf(opts.asOf);
  const as_of = toIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);

  const raw = [
    ...extractCurrency(source),
    ...extractPercents(source),
    ...extractDurations(source),
    ...extractDates(source, asOfDate),
  ];

  const spans = dedupeOverlaps(raw).map((s, i) => ({
    id: `S${i + 1}`,
    ...s,
  }));

  return { as_of, spans };
}

/**
 * Format spans for the LLM prompt (assignment task, not discovery).
 * @param {{ spans: object[], as_of: string }} pack
 */
function formatSpansForPrompt(pack) {
  const spans = pack?.spans || [];
  if (!spans.length) {
    return (
      'Pre-extracted spans: (none found with high confidence). '
      + 'Still do not invent currency amounts, rates, durations, or dates — omit and ask.'
    );
  }
  const lines = spans.map((s) => {
    let detail = '';
    if (s.kind === 'currency') detail = `→ AUD ${s.value}`;
    else if (s.kind === 'percent') detail = `→ ${s.value}%`;
    else if (s.kind === 'duration') {
      detail = s.value_months != null
        ? `→ ${s.count} ${s.unit}(s) ≈ ${s.value_months} months`
        : `→ ${s.count} ${s.unit}(s)`;
    } else if (s.kind === 'date') {
      detail = `→ ${s.resolved_iso}${s.relative ? ' (relative, resolved vs as-of)' : ''}`;
    }
    return `[${s.id}] ${s.kind} "${s.text}" ${detail} (chars ${s.start}-${s.end})`;
  });
  return (
    `Assumed "today" for relative dates: ${pack.as_of}\n`
    + 'Pre-extracted literal spans (deterministic pattern match — these substrings EXIST in the user text):\n'
    + `${lines.join('\n')}\n`
    + 'Your job is to ASSIGN these values to the correct scenario fields/events (and dependencies/timeline), '
    + 'NOT to discover new numbers. Do not invent any currency amount, percentage, duration, or date '
    + 'that is not represented above. For qualitative facts (PPOR vs investment, first-home-buyer, '
    + 'eligibility context, which property a number belongs to), use judgment on the full text. '
    + 'If something important in the text is missing from the span list, say so via unresolved_assumptions '
    + 'rather than inventing a filled-in value.'
  );
}

/** Approx equal for money / months. */
function approxEqual(a, b, tol = 0.01) {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function spanMatchesCurrency(spans, amount) {
  return (spans || []).some(
    (s) => s.kind === 'currency' && approxEqual(s.value, amount, 1)
  );
}

function spanMatchesPercent(spans, pct) {
  return (spans || []).some(
    (s) => s.kind === 'percent' && approxEqual(s.value, pct, 0.001)
  );
}

function spanMatchesDurationMonths(spans, months) {
  const m = Number(months);
  if (!Number.isFinite(m)) return false;
  return (spans || []).some((s) => {
    if (s.kind !== 'duration') return false;
    if (s.value_months != null && approxEqual(s.value_months, m, 0.5)) return true;
    // Allow matching year count when field is years expressed as months elsewhere
    if (s.unit === 'year' && approxEqual(s.count * 12, m, 0.5)) return true;
    if (s.unit === 'month' && approxEqual(s.count, m, 0.5)) return true;
    return false;
  });
}

function spanMatchesDays(spans, days) {
  const d = Number(days);
  if (!Number.isFinite(d)) return false;
  return (spans || []).some((s) => {
    if (s.kind === 'duration' && s.unit === 'day' && approxEqual(s.count, d, 0.5)) return true;
    if (s.kind === 'duration' && s.value_days != null && approxEqual(s.value_days, d, 0.5)) return true;
    return false;
  });
}

function spanMatchesDate(spans, iso) {
  if (!iso || typeof iso !== 'string') return false;
  const want = String(iso).slice(0, 10);
  return (spans || []).some(
    (s) => s.kind === 'date' && s.resolved_iso && String(s.resolved_iso).slice(0, 10) === want
  );
}

module.exports = {
  extractSpans,
  formatSpansForPrompt,
  spanMatchesCurrency,
  spanMatchesPercent,
  spanMatchesDurationMonths,
  spanMatchesDays,
  spanMatchesDate,
  approxEqual,
  dedupeOverlaps,
};
