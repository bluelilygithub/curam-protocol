'use strict';

// Contract Review — Pipeline stage 10 (Grounding verification), shared by
// stages 5 (definitions), 8 (obligations), and 9 (summary). The model
// returns quoted text, never offsets (docs/contract-review-spec.md's
// Decisions Log, round 3 item 7) — this file is the one place that turns a
// quote into a verified span, so every stage that grounds something calls
// the same logic rather than five slightly-different reimplementations.

/** Case-insensitive comparison, used by callers that just need to compare
 * two strings for "same text" (party-name reconciliation, tests) — NOT used
 * internally by verifyQuote's normalized match below, which must never
 * change string length (see that function's own comment for why). */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a regex that matches `text` inside the ORIGINAL (un-normalized)
 * source, tolerant of whitespace-run differences (any run of whitespace,
 * including a paragraph-break "\n\n", matches any other run of whitespace)
 * and straight-vs-curly quote glyphs — without ever building a separate,
 * length-changed copy of the source. A prior version matched against a
 * separately-normalized copy of the source and approximated the end offset
 * by adding the NORMALIZED needle's length back onto the ORIGINAL string's
 * start offset — which silently truncated the span whenever normalization
 * changed length (e.g. "\n\n" collapsing to one space costs 1 character per
 * occurrence), confirmed directly via a live grounding failure on a summary
 * point whose quote spanned a paragraph break. Matching directly against the
 * real source via regex means match indices are always exact by
 * construction — nothing to approximate. */
function buildTolerantRegex(text) {
  const escaped = escapeRegExp(text.trim())
    .replace(/['']/g, "['']")
    .replace(/[""]/g, '[""]')
    .replace(/\s+/g, '\\s+');
  return new RegExp(escaped, 'i');
}

/**
 * Locates quotedText inside haystack (the source clause's own text first
 * when a span is given via `withinSpan`, else the full document), exact
 * match first, then a whitespace/case/quote-glyph-tolerant regex retry.
 * Returns { spanStart, spanEnd, verificationStatus } — spanStart/spanEnd are
 * always offsets into `haystack` as passed in (caller adds any clause-span
 * offset back on when searching within a clause). verificationStatus is
 * 'verified_exact' | 'verified_normalized' | 'failed'; a 'failed' result
 * always has null spans — never silently accepted as verified.
 */
function verifyQuote(haystack, quotedText, { withinSpan = null } = {}) {
  const text = String(quotedText || '').trim();
  if (!text) return { spanStart: null, spanEnd: null, verificationStatus: 'failed' };

  const search = (source, offset) => {
    const exactIdx = source.indexOf(text);
    if (exactIdx !== -1) {
      return { spanStart: offset + exactIdx, spanEnd: offset + exactIdx + text.length, verificationStatus: 'verified_exact' };
    }
    let regex;
    try { regex = buildTolerantRegex(text); } catch (_) { return null; }
    const m = regex.exec(source);
    if (m && m[0]) {
      return { spanStart: offset + m.index, spanEnd: offset + m.index + m[0].length, verificationStatus: 'verified_normalized' };
    }
    return null;
  };

  if (withinSpan) {
    const { text: clauseText, offset } = withinSpan;
    const withinClause = search(clauseText, offset);
    if (withinClause) return withinClause;
  }
  const wholeDoc = search(haystack, 0);
  if (wholeDoc) return wholeDoc;

  return { spanStart: null, spanEnd: null, verificationStatus: 'failed' };
}

module.exports = { verifyQuote, normalize };
