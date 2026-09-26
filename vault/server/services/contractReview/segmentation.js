'use strict';

// Contract Review — Pipeline stage 2 (Segmentation). Heuristic numbered-clause
// pass -> sanity check -> paragraph fallback -> LLM boundary-quote fallback.
// Clause text is ALWAYS an exact slice of extractedText — including under the
// LLM fallback, which returns boundary quotes only, never clause text itself
// (see docs/contract-review-spec.md's guardrails + Pipeline stage 2).

const crypto = require('crypto');
const { pool } = require('../../db');

// Sub-clause markers like "(a)" or "(ii)" are DELIBERATELY not headings —
// they stay embedded in their parent numbered clause's body text (a real
// contract's 4.1(a)(ii) is a sub-item of clause 4.1, not its own top-level
// clause). Only true top-level section dividers start a new clause.
const HEADING_PATTERNS = [
  { re: /^Article\s+([IVXLC]+)\b/i, parse: (m) => ({ major: romanToInt(m[1]) }) },
  { re: /^Section\s+(\d+)\b/i, parse: (m) => ({ major: Number(m[1]) }) },
  { re: /^(\d+)\.(\d+)\b/, parse: (m) => ({ major: Number(m[1]), minor: Number(m[2]) }) }, // 4.1
  { re: /^(\d+)\.\s/, parse: (m) => ({ major: Number(m[1]) }) },                           // 1.
];

function romanToInt(roman) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  const s = roman.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    total += next && cur < next ? -cur : cur;
  }
  return total;
}

/** Splits extractedText into paragraphs (blank-line delimited, matching
 * translateExtract.js's own convention) with their [start, end) offsets. */
function splitIntoParagraphOffsets(extractedText) {
  const paragraphs = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g;
  let match;
  while ((match = re.exec(extractedText))) {
    const text = match[0];
    if (!text.trim()) continue;
    paragraphs.push({ text, start: match.index, end: match.index + text.length });
  }
  return paragraphs;
}

/** Returns { label, number: {major, minor?} } if the paragraph's first line
 * looks like a top-level section heading, else null. Doesn't judge whether
 * it CONTINUES the sequence — see acceptsSequence() for that. */
function matchHeading(paragraphText) {
  const firstLine = paragraphText.split('\n')[0].trim();
  for (const { re, parse } of HEADING_PATTERNS) {
    const m = firstLine.match(re);
    if (m) return { label: m[0].trim(), number: parse(m) };
  }
  return null;
}

/** Decides whether a candidate heading CONTINUES the numbering sequence from
 * the last accepted heading, rather than merely looking like one — rejects a
 * cross-reference ("Section 5 shall survive termination.") or an embedded
 * numbered list item, either of which can match HEADING_PATTERNS but neither
 * of which is really a new top-level clause. Accepted only if it's the
 * first heading in the document, continues the same section with the next
 * minor number, or starts the next section in sequence. */
function continuesSequence(candidate, last) {
  if (!last) return true;
  if (candidate.major === last.major) {
    // Same top-level section: only a genuine minor increment continues it —
    // a same-major candidate with no minor (e.g. a plain "1." numbered-list
    // item appearing under an existing "1.1" heading) is NOT accepted just
    // because the major matches; that's exactly the embedded-numbered-list
    // case this check exists to reject.
    return candidate.minor != null && last.minor != null && candidate.minor === last.minor + 1;
  }
  return candidate.major === last.major + 1;
}

/** Heuristic numbered-clause pass. Returns null if no headings found at all
 * (caller falls through to paragraph segmentation). */
function heuristicSegment(extractedText) {
  const paragraphs = splitIntoParagraphOffsets(extractedText);
  const headingIdxs = [];
  let last = null;
  for (let i = 0; i < paragraphs.length; i++) {
    const match = matchHeading(paragraphs[i].text);
    if (!match) continue;
    if (!continuesSequence(match.number, last)) continue; // looks like a heading, isn't one
    headingIdxs.push({ i, label: match.label });
    last = match.number;
  }
  if (!headingIdxs.length) return null;

  const clauses = [];
  // Any text before the first recognized heading (title, letterhead,
  // preamble) is a real part of the document and must not silently vanish —
  // captured as its own leading clause (no numberLabel) rather than dropped.
  if (headingIdxs[0].i > 0) {
    const leadStart = paragraphs[0];
    const leadEnd = paragraphs[headingIdxs[0].i - 1];
    clauses.push({
      numberLabel: null,
      text: extractedText.slice(leadStart.start, leadEnd.end),
      spanStart: leadStart.start,
      spanEnd: leadEnd.end,
    });
  }
  for (let h = 0; h < headingIdxs.length; h++) {
    const { i, label } = headingIdxs[h];
    const startPara = paragraphs[i];
    const nextHeadingParaIdx = h + 1 < headingIdxs.length ? headingIdxs[h + 1].i : paragraphs.length;
    const endPara = paragraphs[nextHeadingParaIdx - 1] || startPara;
    clauses.push({
      numberLabel: label,
      text: extractedText.slice(startPara.start, endPara.end),
      spanStart: startPara.start,
      spanEnd: endPara.end,
    });
  }
  return clauses;
}

/** Sanity-checks heuristic output against document length. Too few clauses
 * for a long document, or one implausibly large "clause", both mean the
 * heuristic misfired and should fall through to paragraph chunking. */
function heuristicPassesSanityCheck(clauses, extractedText) {
  if (!clauses || !clauses.length) return false;
  const docLen = extractedText.length;
  if (docLen > 3000 && clauses.length < 2) return false;
  const maxClauseLen = Math.max(...clauses.map((c) => c.spanEnd - c.spanStart));
  if (docLen > 500 && maxClauseLen > docLen * 0.85) return false;
  return true;
}

/** Paragraph fallback — one clause per paragraph boundary. */
function paragraphSegment(extractedText) {
  return splitIntoParagraphOffsets(extractedText).map((p) => ({
    numberLabel: null,
    text: extractedText.slice(p.start, p.end),
    spanStart: p.start,
    spanEnd: p.end,
  }));
}

/**
 * Locates each LLM-returned boundary pair {opening, closing} in extractedText
 * and slices the real text between them. A boundary pair that can't be
 * located returns null for that entry — caller falls back to paragraph
 * segmentation for that specific region, never accepts unlocated text.
 * Exported standalone (no model call inside) so it's directly testable with
 * a fabricated/malformed boundaries array — no live API call needed.
 */
function locateLlmBoundaries(extractedText, boundaries) {
  const located = [];
  let searchFrom = 0;
  for (const b of boundaries) {
    const opening = String(b.opening || '').trim();
    const closing = String(b.closing || '').trim();
    if (!opening || !closing) { located.push(null); continue; }

    let openIdx = extractedText.indexOf(opening, searchFrom);
    if (openIdx === -1) openIdx = normalizedIndexOf(extractedText, opening, searchFrom);
    if (openIdx === -1) { located.push(null); continue; }

    const closeSearchFrom = openIdx + opening.length;
    let closeIdx = extractedText.indexOf(closing, closeSearchFrom);
    if (closeIdx === -1) closeIdx = normalizedIndexOf(extractedText, closing, closeSearchFrom);
    if (closeIdx === -1) { located.push(null); continue; }

    const spanEnd = closeIdx + closing.length;
    located.push({ spanStart: openIdx, spanEnd });
    searchFrom = spanEnd;
  }
  return located;
}

/** Light whitespace/case-normalized retry — for OCR'd text where an exact
 * match can fail on stray whitespace differences. */
function normalizedIndexOf(haystack, needle, fromIndex) {
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ');
  const normHaystack = normalize(haystack);
  const normNeedle = normalize(needle);
  const idx = normHaystack.indexOf(normNeedle, fromIndex);
  return idx; // approximate offset into the normalized string; acceptable since
              // normalization only collapses whitespace, never removes chars.
}

/** Builds clauses from located boundaries, falling back to paragraph
 * segmentation for any region whose boundary pair couldn't be located. */
function llmBoundarySegment(extractedText, boundaries) {
  const located = locateLlmBoundaries(extractedText, boundaries);
  const clauses = [];
  let cursor = 0;
  for (let i = 0; i < located.length; i++) {
    const loc = located[i];
    if (!loc) {
      // Can't trust this boundary — paragraph-segment the gap between the
      // last located clause's end and the next located clause's start.
      const nextLocated = located.slice(i + 1).find(Boolean);
      const regionEnd = nextLocated ? nextLocated.spanStart : extractedText.length;
      if (regionEnd > cursor) {
        for (const p of paragraphSegment(extractedText.slice(cursor, regionEnd))) {
          clauses.push({ ...p, spanStart: p.spanStart + cursor, spanEnd: p.spanEnd + cursor, numberLabel: null });
        }
      }
      cursor = regionEnd;
      continue;
    }
    clauses.push({ numberLabel: null, text: extractedText.slice(loc.spanStart, loc.spanEnd), spanStart: loc.spanStart, spanEnd: loc.spanEnd });
    cursor = loc.spanEnd;
  }
  return clauses;
}

/** Real model call for the LLM fallback — asks for boundary quotes only,
 * never clause text. Separate from llmBoundarySegment so tests can exercise
 * boundary-location logic without a live API call. */
async function requestLlmBoundaries(extractedText, userId) {
  const { getModelsForUser } = require('../modelResolver');
  const { callModel } = require('../callModel');
  const { standard } = await getModelsForUser(userId);
  const prompt = `This is the full text of a contract with no clear paragraph or numbering structure. ` +
    `Identify clause boundaries. For each clause, return ONLY the opening few words and closing few words ` +
    `of that clause EXACTLY as they appear in the text — never the clause text itself. ` +
    `Respond as a JSON array: [{"opening": "...", "closing": "..."}]. Text:\n\n${extractedText}`;
  const text = await callModel(standard, prompt, { maxTokens: 2000 });
  try {
    const parsed = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
    if (Array.isArray(parsed)) return parsed;
  } catch (_) { /* fall through */ }
  return [];
}

/**
 * Segments a document's extractedText into contract_clauses rows.
 * @param {number} reviewId
 * @param {string} extractedText
 * @param {object} pageMap
 * @param {{userId?: number, llmBoundaries?: Array<{opening,closing}>}} [opts] —
 *   llmBoundaries lets callers/tests inject a boundary list directly instead
 *   of making a live model call.
 */
async function segmentDocument(reviewId, extractedText, pageMap, opts = {}) {
  let clauses = heuristicSegment(extractedText);
  let method = 'numbered';
  if (!heuristicPassesSanityCheck(clauses, extractedText)) {
    clauses = paragraphSegment(extractedText);
    method = 'paragraph';
  }

  // Genuine single-blob fallback — no numbering AND paragraph segmentation
  // also produced essentially one giant "paragraph".
  if (method === 'paragraph' && clauses.length <= 1 && extractedText.length > 1000) {
    const boundaries = opts.llmBoundaries || await requestLlmBoundaries(extractedText, opts.userId);
    if (boundaries.length) {
      clauses = llmBoundarySegment(extractedText, boundaries);
      method = 'llm';
    }
  }

  const pageForOffset = (offset) => {
    for (const [pageNum, info] of Object.entries(pageMap || {})) {
      if (offset >= info.startOffset && offset < info.endOffset) return Number(pageNum);
    }
    return null;
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ordinal = 1;
    for (const c of clauses) {
      if (!c.text || !c.text.trim()) continue;
      await client.query(
        `INSERT INTO contract_clauses
           ("reviewId", "lineageId", ordinal, "numberLabel", text, "spanStart", "spanEnd", "startPage", "endPage")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [reviewId, crypto.randomUUID(), ordinal, c.numberLabel || null, c.text, c.spanStart, c.spanEnd,
          pageForOffset(c.spanStart), pageForOffset(Math.max(c.spanStart, c.spanEnd - 1))]
      );
      ordinal += 1;
    }
    await client.query(
      `UPDATE contract_reviews SET "segmentationMethod"=$1 WHERE id=$2`,
      [method, reviewId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { method, clauseCount: clauses.filter((c) => c.text && c.text.trim()).length };
}

module.exports = {
  segmentDocument,
  heuristicSegment,
  heuristicPassesSanityCheck,
  paragraphSegment,
  locateLlmBoundaries,
  llmBoundarySegment,
  splitIntoParagraphOffsets,
  matchHeading,
  continuesSequence,
};
