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
 * translateExtract.js's own convention) with their [start, end) offsets.
 * Used by the no-numbering fallback (paragraphSegment) — genuinely the
 * right boundary unit when there's no numbering signal to key off at all. */
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

/** Splits extractedText into individual lines with their [start, end)
 * offsets — the numbered heuristic pass scans at this granularity (not
 * paragraph granularity) so a heading with no blank line before it (e.g.
 * "1.1 Foo\n1.2 Bar" on consecutive lines, common in a real DOCX numbered
 * list) is still found; matchHeading only ever looked at a paragraph
 * block's FIRST line, so two dotted subclauses separated by a plain line
 * break instead of a blank line silently merged into one clause. */
function splitIntoLineOffsets(extractedText) {
  const lines = [];
  let idx = 0;
  for (const lineText of extractedText.split('\n')) {
    const start = idx;
    const end = idx + lineText.length;
    lines.push({ text: lineText, start, end });
    idx = end + 1; // account for the '\n' consumed by split()
  }
  return lines;
}

/** Returns { label, number: {major, minor?} } if this single line looks
 * like a top-level section heading, else null. Doesn't judge whether it
 * CONTINUES the sequence — see continuesSequence() for that. */
function matchHeading(lineText) {
  const line = String(lineText || '').trim();
  for (const { re, parse } of HEADING_PATTERNS) {
    const m = line.match(re);
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
  // A bare "N."/"Article N" heading (no minor) is the ambiguous pattern —
  // an embedded numbered list commonly restarts at "1." right after any
  // dotted clause, and its later items ("2.", "3.") would otherwise satisfy
  // this same "next major in sequence" rule purely by coincidence (caught
  // via line-level scanning once dotted "1.1, 1.2" splitting needed every
  // line checked individually, not just a paragraph block's first line).
  // Only accept a bare-major continuation when the PRIOR heading was ALSO a
  // bare-major pattern (a document genuinely using flat "1. / 2. / 3."
  // numbering throughout) — never right after a dotted "N.M" heading, which
  // is exactly what an embedded list under a real numbered clause looks like.
  if (candidate.minor == null && last.minor != null) return false;
  return candidate.major === last.major + 1;
}

/** Heuristic numbered-clause pass. Returns null if no headings found at all
 * (caller falls through to paragraph segmentation). Scans at LINE
 * granularity (not paragraph) so two dotted subclauses on consecutive lines
 * with no blank line between them ("1.1 Foo\n1.2 Bar") each still start
 * their own clause. */
function heuristicSegment(extractedText) {
  const lines = splitIntoLineOffsets(extractedText);
  const headingIdxs = [];
  let last = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].text.trim()) continue; // blank lines never start a heading
    const match = matchHeading(lines[i].text);
    if (!match) continue;
    if (!continuesSequence(match.number, last)) continue; // looks like a heading, isn't one
    headingIdxs.push({ i, label: match.label });
    last = match.number;
  }
  if (!headingIdxs.length) return null;

  // Trailing blank lines right before the next heading (or end of document)
  // don't belong in a clause's own span.
  const trimEnd = (fromIdx, minIdx) => {
    let idx = fromIdx;
    while (idx > minIdx && !lines[idx].text.trim()) idx -= 1;
    return idx;
  };

  const clauses = [];
  // Any text before the first recognized heading (title, letterhead,
  // preamble) is a real part of the document and must not silently vanish —
  // captured as its own leading clause (no numberLabel) rather than dropped.
  if (headingIdxs[0].i > 0) {
    const leadEndIdx = trimEnd(headingIdxs[0].i - 1, 0);
    const leadStart = lines[0];
    const leadEnd = lines[leadEndIdx];
    if (leadEnd.end > leadStart.start) {
      clauses.push({
        numberLabel: null,
        text: extractedText.slice(leadStart.start, leadEnd.end),
        spanStart: leadStart.start,
        spanEnd: leadEnd.end,
      });
    }
  }
  for (let h = 0; h < headingIdxs.length; h++) {
    const { i, label } = headingIdxs[h];
    const startLine = lines[i];
    const nextHeadingLineIdx = h + 1 < headingIdxs.length ? headingIdxs[h + 1].i : lines.length;
    const endLineIdx = trimEnd(nextHeadingLineIdx - 1, i);
    const endLine = lines[endLineIdx] || startLine;
    clauses.push({
      numberLabel: label,
      text: extractedText.slice(startLine.start, endLine.end),
      spanStart: startLine.start,
      spanEnd: endLine.end,
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

    const openMatch = findMatch(extractedText, opening, searchFrom);
    if (!openMatch) { located.push(null); continue; }

    const closeMatch = findMatch(extractedText, closing, openMatch.index + openMatch.length);
    if (!closeMatch) { located.push(null); continue; }

    const spanEnd = closeMatch.index + closeMatch.length;
    located.push({ spanStart: openMatch.index, spanEnd });
    searchFrom = spanEnd;
  }
  return located;
}

/** Locates `needle` in `haystack` at/after fromIndex — exact substring match
 * first (returned length === needle.length), else grounding.js's own
 * whitespace/case/quote-glyph-tolerant regex retry, matched directly against
 * the ORIGINAL (un-normalized) text so the returned index is always exact.
 * The returned `length` is the ACTUAL matched text's length, which can differ
 * from needle.length whenever the source's whitespace run differs from the
 * LLM's quoted one (e.g. a "\n\n" paragraph break vs a single space) —
 * using needle.length for spanEnd in that case would silently shift the
 * clause boundary, the same bug class grounding.js's buildTolerantRegex was
 * built to avoid for quote verification; this reuses that exact fix rather
 * than a second, separately-normalized-copy implementation. */
function findMatch(haystack, needle, fromIndex) {
  const text = String(needle || '').trim();
  if (!text) return null;
  const exactIdx = haystack.indexOf(text, fromIndex);
  if (exactIdx !== -1) return { index: exactIdx, length: text.length };
  const { buildTolerantRegex } = require('./grounding');
  let regex;
  try { regex = buildTolerantRegex(text); } catch (_) { return null; }
  const searchSpace = haystack.slice(fromIndex);
  const m = regex.exec(searchSpace);
  if (!m || !m[0]) return null;
  return { index: fromIndex + m.index, length: m[0].length };
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
  const { resolveContractReviewModel } = require('../contractReviewModelResolver');
  const { callModel } = require('../callModel');
  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const prompt = `This is the full text of a contract with no clear paragraph or numbering structure. ` +
    `Identify clause boundaries. For each clause, return ONLY the opening few words and closing few words ` +
    `of that clause EXACTLY as they appear in the text — never the clause text itself. ` +
    `Respond as a JSON array: [{"opening": "...", "closing": "..."}]. Text:\n\n${extractedText}`;
  const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');
  const text = await callModel(resolved, prompt, { maxTokens: 2000, timeoutMs: LLM_CALL_TIMEOUT_MS });
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
    for (let i = 0; i < clauses.length; i++) {
      const c = clauses[i];
      if (!c.text || !c.text.trim()) continue;
      await client.query(
        `INSERT INTO contract_clauses
           ("reviewId", "lineageId", ordinal, "numberLabel", text, "spanStart", "spanEnd", "startPage", "endPage", "isContextOnly")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [reviewId, crypto.randomUUID(), ordinal, c.numberLabel || null, c.text, c.spanStart, c.spanEnd,
          pageForOffset(c.spanStart), pageForOffset(Math.max(c.spanStart, c.spanEnd - 1)), isContextOnlyClause(c, i, method)]
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

// Preamble/recitals/signature-block clauses must not be risk-scored (a
// clause with no substantive obligation always scores 'unclear', which
// looked like a genuine flag to a reviewer even though there's nothing to
// assess) — flagged here, deterministically, rather than left to the risk-
// scoring model to somehow recognize on every single clause.
const SIGNATURE_BLOCK_RE = /\b(IN WITNESS WHEREOF|SIGNED (?:BY|FOR AND ON BEHALF OF)|EXECUTED AS (?:A DEED|AN AGREEMENT)|AUTHORI[SZ]ED SIGNATORY)\b/i;

function isContextOnlyClause(clause, index, method) {
  // The one clause heuristicSegment captures for text before the first
  // recognized heading (title/preamble/recitals) — only meaningful for the
  // 'numbered' method, where a null numberLabel at index 0 specifically
  // means "this is that captured lead-in text". Under 'paragraph'/'llm',
  // EVERY clause has numberLabel null, so this check would otherwise wrongly
  // flag every clause in those documents as context-only.
  if (index === 0 && method === 'numbered' && !clause.numberLabel) return true;
  if (SIGNATURE_BLOCK_RE.test(clause.text)) return true;
  return false;
}

module.exports = {
  segmentDocument,
  isContextOnlyClause,
  heuristicSegment,
  heuristicPassesSanityCheck,
  paragraphSegment,
  locateLlmBoundaries,
  llmBoundarySegment,
  splitIntoParagraphOffsets,
  splitIntoLineOffsets,
  matchHeading,
  continuesSequence,
};
