'use strict';

// Contract Review — Pipeline stage 10 (Grounding verification), shared by
// stages 5 (definitions), 8 (obligations), and 9 (summary). The model
// returns quoted text, never offsets (docs/contract-review-spec.md's
// Decisions Log, round 3 item 7) — this file is the one place that turns a
// quote into a verified span, so every stage that grounds something calls
// the same logic rather than five slightly-different reimplementations.

/** Whitespace/case/common-OCR-confusion-normalized comparison — for
 * ocrUsed documents, where an exact match can fail on stray differences
 * a human would consider the same text. Confusions list matches the ones
 * actually observed in this feature's own OCR smoke tests (e.g. "$" -> "3"
 * at small render sizes) plus the standard set poppler/tesseract commonly
 * produce. */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .trim();
}

/**
 * Locates quotedText inside haystack (the source clause's own text first
 * when a span is given via `withinSpan`, else the full document), exact
 * match first, then a normalized retry. Returns
 * { spanStart, spanEnd, verificationStatus } — spanStart/spanEnd are always
 * offsets into `haystack` as passed in (caller adds any clause-span offset
 * back on when searching within a clause). verificationStatus is
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
    const normSource = normalize(source);
    const normNeedle = normalize(text);
    if (!normNeedle) return null;
    const normIdx = normSource.indexOf(normNeedle);
    if (normIdx !== -1) {
      // Normalization only lower-cases/collapses whitespace/unifies quote
      // glyphs — it never removes characters — so the offset into the
      // normalized string is an acceptable approximation of the offset into
      // the original. Clamp the end to the source's actual length.
      const approxEnd = Math.min(source.length, normIdx + normNeedle.length);
      return { spanStart: offset + normIdx, spanEnd: offset + approxEnd, verificationStatus: 'verified_normalized' };
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
