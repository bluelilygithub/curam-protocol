'use strict';

/**
 * Deterministic translation QA checks (no LLM).
 * Completeness / placeholder / identical-to-source must run before subjective review.
 */

/** Exact / near-exact failure markers (EN + common Romance / process stubs). */
const PLACEHOLDER_PATTERNS = [
  /\[\s*translation\s+incomplete\s*\]/i,
  /\[\s*unable\s+to\s+translate\s*\]/i,
  /\[\s*translation\s+error\s*\]/i,
  /\[\s*translation\s+failed\s*\]/i,
  /\[\s*no\s+translation\s*\]/i,
  /\[\s*texto\s+no\s+disponible(?:\s+para\s+traducir)?\s*\]/i,
  /\[\s*no\s+se\s+pudo\s+traducir\s*\]/i,
  /\[\s*traducci[oó]n\s+(?:incompleta|fallida|no\s+disponible)\s*\]/i,
  /\[\s*texte?\s+non\s+disponible(?:\s+[àa]\s+traduire)?\s*\]/i,
  /\[\s*impossible\s+[àa]\s+traduire\s*\]/i,
  /\[\s*TODO\s*\]/i,
  /\[\s*TBD\s*\]/i,
  /\bTBD\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /lorem\s+ipsum/i,
  /\bN\/?A\b\s*$/i,
  /^\[?\s*insert\s+translation/i,
];

/**
 * Bracketed meta-commentary about the translation process (any language).
 * Matches short [...] spans that talk about unavailable / failed / incomplete translation
 * rather than document content. Does NOT match [REDACTED].
 */
const BRACKETED_META_RE = /\[([^\]]{1,120})\]/g;
const META_COMMENT_HINTS = [
  /no\s+disponible/i,
  /no\s+se\s+pudo/i,
  /unable\s+to/i,
  /not\s+available/i,
  /unavailable/i,
  /incomplete/i,
  /failed\s+to\s+translate/i,
  /translation\s+(?:error|failed|incomplete)/i,
  /traducir/i,
  /traduire/i,
  /translate/i,
  /traducci[oó]n/i,
  /traduction/i,
  /non\s+disponible/i,
  /k[aā]hore/i,
  /kaore/i,
];

const REDACTION_TOKEN_RE = /\[REDACTED(?::[^\]]+)?\]/gi;

/** Fail job if this fraction of segments are byte-identical to source (after normalize). */
const IDENTICAL_FAIL_RATIO = 0.30;
/**
 * Soft warning if placeholders exceed this but stay below catastrophic.
 * Hard-fail only when ratio exceeds PLACEHOLDER_HARD_FAIL_RATIO (mass failure).
 */
const PLACEHOLDER_SOFT_RATIO = 0.05;
const PLACEHOLDER_SOFT_ABS = 2;
/** Catastrophic — fail the job (e.g. flash model returned incomplete for most chunks). */
const PLACEHOLDER_HARD_FAIL_RATIO = 0.25;
const PLACEHOLDER_HARD_FAIL_ABS_RATIO = 0.25;

function normalizeForCompare(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function looksNonLinguistic(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return true;
  if (/^[\d\s.,%$€£¥/+#:;@_-]+$/.test(t)) return true;
  if (/^\[[A-Z]+\d+\]\s*[\d\s.,%$€£¥/+_-]*$/i.test(t)) return true;
  if (/^\[?\s*REDACTED\s*\]?$/i.test(t)) return true;
  if (/^\[REDACTED(?::[^\]]+)?\]$/i.test(t)) return true;
  if (/^(?:xxx+|…|\.\.\.)$/i.test(t)) return true;
  if (isCodeLikeArtifact(t)) return true;
  return false;
}

/**
 * Extracted "paragraph" is actually leaked code/template debris, not document
 * prose — e.g. a serialized object dump (`Paragraph( 'caseSensitive': 1 ...)`)
 * or an unresolved internal template token (`(check_internal_consistency target)`).
 * Seen coming from some source PDFs (embedded field/debug artifacts on the page).
 * These must never be sent to a translator — copy through verbatim instead.
 */
function isCodeLikeArtifact(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // Object/dict-style debug dumps: Paragraph( 'key': value 'key2': value ...)
  if (/^[A-Za-z]{2,30}\s*\(\s*'[\w]+'\s*:/.test(t)) return true;
  // Two or more quoted-key:value pairs anywhere in the string
  const kvMatches = t.match(/'[\w]+'\s*:\s*(?:'[^']*'|[\d.]+)/g) || [];
  if (kvMatches.length >= 2) return true;
  // Internal snake_case template token: (check_internal_consistency target)
  if (/\(\s*[a-z][a-z0-9_]{2,40}\s+target\s*\)/i.test(t)) return true;
  return false;
}

function isRedactionTokenInner(inner) {
  return /^REDACTED(?::.*)?$/i.test(String(inner || '').trim());
}

function isMetaCommentaryInner(inner) {
  const s = String(inner || '').trim();
  if (!s || isRedactionTokenInner(s)) return false;
  // Pure IDs / short codes like Q-15 are content, not meta
  if (/^[A-Z]{1,4}-?\d{1,4}$/i.test(s)) return false;
  return META_COMMENT_HINTS.some((re) => re.test(s));
}

/**
 * Find placeholder / process meta-text in translated output.
 * @returns {string|null} matched snippet
 */
function findPlaceholder(text) {
  const t = String(text || '');
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(t)) {
      const m = t.match(re);
      return m ? m[0] : 'placeholder';
    }
  }
  BRACKETED_META_RE.lastIndex = 0;
  let m;
  while ((m = BRACKETED_META_RE.exec(t)) !== null) {
    if (isMetaCommentaryInner(m[1])) {
      return m[0];
    }
  }
  return null;
}

/**
 * If source contains [REDACTED…], ensure target keeps those tokens verbatim
 * and does not replace them with meta-commentary.
 */
function enforceRedactionPassThrough(source, target) {
  const src = String(source || '');
  let tgt = String(target ?? '');
  const srcTokens = src.match(REDACTION_TOKEN_RE) || [];
  if (!srcTokens.length) return tgt;

  // Replace bracketed meta-commentary with the next unused source redaction token
  let tokenIdx = 0;
  tgt = tgt.replace(BRACKETED_META_RE, (full, inner) => {
    if (isRedactionTokenInner(inner)) return full; // already fine
    if (isMetaCommentaryInner(inner) || !/REDACTED/i.test(inner)) {
      // Meta or non-redaction bracket that appeared where redaction should be
      if (isMetaCommentaryInner(inner) && tokenIdx < srcTokens.length) {
        const tok = srcTokens[tokenIdx];
        tokenIdx += 1;
        return tok;
      }
    }
    return full;
  });

  // If target lost all REDACTED tokens, append / restore from source count
  const tgtTokens = tgt.match(REDACTION_TOKEN_RE) || [];
  if (tgtTokens.length < srcTokens.length) {
    // Prefer replacing remaining meta placeholders we missed
    for (let i = tgtTokens.length; i < srcTokens.length; i += 1) {
      if (findPlaceholder(tgt)) {
        tgt = tgt.replace(findPlaceholder(tgt), srcTokens[i]);
      } else if (!tgt.includes(srcTokens[i])) {
        tgt = `${tgt.trim()} ${srcTokens[i]}`.trim();
      }
    }
  }

  // Normalize any translated "redacted" spellings back to [REDACTED]
  tgt = tgt.replace(/\[\s*REDACTAD[OA]?\s*\]/gi, '[REDACTED]');
  tgt = tgt.replace(/\[\s*CENSURADO\s*\]/gi, '[REDACTED]');
  tgt = tgt.replace(/\[\s*SCHWARZ\s*\]/gi, '[REDACTED]');

  return tgt;
}

/**
 * Locked glossary entry for a real redaction marker — only returned when `text` actually
 * contains one. Confirmed on a real job: this used to be injected unconditionally into every
 * job's glossary and system prompt, priming the model with "[REDACTED]" as the thing to fall
 * back on for content it couldn't cleanly parse. On a document with zero legitimate redaction
 * (a normal commercial proposal) that primed marker got used as a hallucinated placeholder for
 * a garbled table-row paragraph — the model dumped that row's real content into the *previous*
 * paragraph and rendered its own slot as literal "[REDACTED]", a structural corruption with
 * nothing in the source to justify it. Only prime the model with this when it's actually needed.
 */
function lockedDoNotTranslateTerms(text) {
  if (!REDACTION_TOKEN_RE.test(String(text || ''))) return [];
  REDACTION_TOKEN_RE.lastIndex = 0; // reset — it's a global regex, reused by callers
  return [
    { source: '[REDACTED]', target: '', doNotTranslate: true, note: 'Locked redaction marker — copy exactly' },
  ];
}

// 1-4 Title-Case words, letters only (incl. accented) — candidate defined term / proper noun.
const CAPITALIZED_RUN_RE = /\b[A-ZÀ-Ž][a-zà-ž]*(?:\s+[A-ZÀ-Ž][a-zà-ž]*){0,3}\b/g;
const SENTENCE_END_RE = /[.!?]\s*$/;
// Definition-clause markers ("Warranty Schedule means...", "Period refers to...") — a phrase
// immediately followed by one of these is a defined term by definition, no repetition needed.
const DEFINITION_MARKER_RE = /^\s*(?:means|refers to|is defined as|has the meaning)\b/i;

// Common table/status-column words. Confirmed missed on a real job: CAPITALIZED_RUN_RE requires
// an initial capital followed by LOWERCASE letters, so an ALL-CAPS status word like "PASS" never
// matches it at all — the phrase it finds is just "P". A fixed whitelist (not "any ALL-CAPS
// token") deliberately avoids catching legitimate untranslated acronyms (ERP, API, ISO, CAD, STP)
// that appear in the same kind of document and must NOT be sent through the glossary as if they
// needed a translated rendering.
const STATUS_WORD_RE = /\b(PASS|FAIL|FAILED|REVIEW|WARN|WARNING|PENDING|APPROVED|REJECTED|COMPLETE|COMPLETED)\b/g;

// "Tier 1" / "Phase 2" / "Level 3" / "Category 4" — a Title-Case word immediately followed by a
// small number. Confirmed missed on a real job: "Tier" recurred often enough in general to pass
// the normal signals, yet still drifted (Palier in one chunk, Tier in another) — worth locking
// this pattern outright as soon as it recurs at all, rather than relying on it also happening to
// satisfy the mid-sentence/standalone thresholds for prose.
const NUMBERED_LABEL_RE = /\b([A-Z][a-zà-ž]{2,15})\s+\d{1,2}\b/g;

/**
 * Scan source paragraphs for repeated capitalized terms/phrases that read as defined terms
 * or domain vocabulary (e.g. "Warranty Schedule", "Nominated Vehicle", "Period", "Make") —
 * the kind of term an LLM translates inconsistently across chunks because it's an ordinary
 * word/phrase rather than an obvious brand name, so nothing nominates it for the glossary.
 *
 * Three independent signals qualify a phrase (any one is enough):
 * - Mid-sentence recurrence: appears at least twice NOT at a paragraph/sentence start —
 *   sentence-initial capitalization alone is just normal sentence-case, not a defined-term signal.
 * - Standalone recurrence: the phrase IS the entire paragraph (a field label like "Make" /
 *   "Model"), seen at least twice.
 * - Definition marker: immediately followed by "means" / "refers to" / "is defined as" /
 *   "has the meaning" — this alone proves it's a defined term even on a single occurrence,
 *   which is what catches a term that's only ever introduced once per definition clause
 *   ("Warranty Schedule means the document attached...") and never referenced inline elsewhere.
 *
 * Phrases already covered by existingTerms (case-insensitive) are skipped. Returns up to
 * `limit` candidates, most frequent first, each with one example sentence for context.
 */
function detectRepeatedTermCandidates(paragraphsByPage, existingTerms = [], { limit = 15, minCount = 2 } = {}) {
  const known = new Set((existingTerms || []).map((t) => String(t?.source || '').toLowerCase()).filter(Boolean));
  // phrase -> { count, midSentenceCount, standaloneCount, hasDefinitionMarker, example }
  const counts = new Map();

  const allParagraphs = Object.values(paragraphsByPage || {}).flat();

  // Status words and "Word N" labels qualify on recurrence alone (≥2×) — no mid-sentence/
  // standalone/definition-marker signal needed. Both patterns are inherently the kind of short
  // table/heading label that drifts between chunks precisely because nothing else about them
  // (brand-like capitalization, an obvious defined-term clause) would nominate them otherwise.
  const autoQualify = new Map(); // phrase -> { count, example }
  const recordAuto = (phrase, exampleText) => {
    const key = phrase.toLowerCase();
    if (known.has(key)) return;
    const entry = autoQualify.get(key) || { phrase, count: 0, example: exampleText };
    entry.count += 1;
    autoQualify.set(key, entry);
  };
  for (const para of allParagraphs) {
    const text = String(para || '');
    let m;
    STATUS_WORD_RE.lastIndex = 0;
    while ((m = STATUS_WORD_RE.exec(text)) !== null) recordAuto(m[1], text);
    NUMBERED_LABEL_RE.lastIndex = 0;
    while ((m = NUMBERED_LABEL_RE.exec(text)) !== null) recordAuto(m[1], text);
  }
  const autoQualified = [...autoQualify.values()]
    .filter((e) => e.count >= 2)
    .map((e) => ({ term: e.phrase, count: e.count, example: e.example.slice(0, 300) }));

  for (const para of allParagraphs) {
    const text = String(para || '');
    const trimmed = text.trim();
    let m;
    CAPITALIZED_RUN_RE.lastIndex = 0;
    while ((m = CAPITALIZED_RUN_RE.exec(text)) !== null) {
      const phrase = m[0].trim();
      const key = phrase.toLowerCase();
      if (known.has(key)) continue;
      if (phrase.split(/\s+/).length > 4) continue;
      const before = text.slice(0, m.index);
      const after = text.slice(m.index + m[0].length);
      const isSentenceInitial = before.length === 0 || SENTENCE_END_RE.test(before) || /^\s*$/.test(before.slice(-3));
      const isStandaloneParagraph = trimmed.replace(/[.,;:]$/, '') === phrase;
      const entry = counts.get(key) || {
        phrase, count: 0, midSentenceCount: 0, standaloneCount: 0, hasDefinitionMarker: false, example: text,
      };
      entry.count += 1;
      if (!isSentenceInitial) entry.midSentenceCount += 1;
      if (isStandaloneParagraph) entry.standaloneCount += 1;
      if (DEFINITION_MARKER_RE.test(after)) entry.hasDefinitionMarker = true;
      counts.set(key, entry);
    }
  }

  const prose = [...counts.values()]
    // Reject trivial short single-word matches ("If", "As", "Or") -- CAPITALIZED_RUN_RE has no
    // minimum length, so a common short word that happens to recur as its own line (a PDF
    // line-wrap fragment, not a real defined term) can otherwise get locked into the glossary.
    // Once locked, applyGlossarySubstitutions' unanchored regex replace matches that word as a
    // SUBSTRING inside unrelated target-language words (e.g. "If"->"Si" corrupting "différend"
    // into "dSiférend" via a bare "if" match) -- confirmed on a real QA run, not theoretical.
    .filter((e) => e.phrase.replace(/\s+/g, '').length >= 4)
    .filter((e) => e.count >= minCount
      && (e.midSentenceCount >= 2 || e.standaloneCount >= 2 || e.hasDefinitionMarker))
    .map((e) => ({ term: e.phrase, count: e.count, example: e.example.slice(0, 300) }));

  const byTerm = new Map();
  for (const c of [...prose, ...autoQualified]) {
    const key = c.term.toLowerCase();
    const existing = byTerm.get(key);
    if (!existing || c.count > existing.count) byTerm.set(key, c);
  }

  return [...byTerm.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Per-segment completeness: (a) non-empty (b) not identical to source (c) no placeholders.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function checkSegmentCompleteness(source, target, { skipIdentical = false } = {}) {
  const reasons = [];
  const tgt = String(target ?? '');
  if (!tgt.trim()) {
    reasons.push('empty_target');
  }
  const placeholder = findPlaceholder(tgt);
  if (placeholder) {
    reasons.push(`placeholder:${placeholder}`);
  }
  // Source had redaction but target lost it / replaced with meta
  const srcRedactions = (String(source || '').match(REDACTION_TOKEN_RE) || []).length;
  const tgtRedactions = (tgt.match(REDACTION_TOKEN_RE) || []).length;
  if (srcRedactions > 0 && tgtRedactions < srcRedactions) {
    reasons.push('redaction_token_missing');
  }
  if (!skipIdentical && !looksNonLinguistic(source)) {
    if (normalizeForCompare(source) === normalizeForCompare(tgt)) {
      reasons.push('identical_to_source');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Run completeness on every pair. Returns automatic garbled rows + stats.
 * This MUST run before subjective LLM checks and cannot be skipped.
 */
function runDeterministicCompletenessCheck(pairs, { sourceLanguage, targetLanguage } = {}) {
  const sameLang = sourceLanguage
    && targetLanguage
    && String(sourceLanguage).toLowerCase() === String(targetLanguage).toLowerCase();

  const garbledOrIncompleteRows = [];
  let emptyCount = 0;
  let identicalCount = 0;
  let placeholderCount = 0;
  let redactionMissingCount = 0;

  (pairs || []).forEach((pair, index) => {
    const source = pair?.source ?? '';
    const target = pair?.target ?? '';
    const { ok, reasons } = checkSegmentCompleteness(source, target, {
      skipIdentical: sameLang,
    });
    if (ok) return;

    if (reasons.some((r) => r === 'empty_target')) emptyCount += 1;
    if (reasons.some((r) => r === 'identical_to_source')) identicalCount += 1;
    if (reasons.some((r) => r.startsWith('placeholder:'))) placeholderCount += 1;
    if (reasons.some((r) => r === 'redaction_token_missing')) redactionMissingCount += 1;

    garbledOrIncompleteRows.push({
      index,
      source: String(source).slice(0, 400),
      target: String(target).slice(0, 400),
      excerpt: String(target || source).slice(0, 200),
      issue: reasons.join('; '),
      check: 'deterministic_completeness',
    });
  });

  const total = (pairs || []).length;
  return {
    garbledOrIncompleteRows,
    stats: {
      total,
      failing: garbledOrIncompleteRows.length,
      emptyCount,
      identicalCount,
      placeholderCount,
      redactionMissingCount,
      identicalRatio: total ? identicalCount / total : 0,
      placeholderRatio: total ? placeholderCount / total : 0,
      sameLangSkippedIdentical: Boolean(sameLang),
    },
  };
}

/**
 * Hard / soft gate outside the model.
 * - Catastrophic incomplete/passthrough → ok:false (fail job)
 * - Moderate placeholders after repair → ok:true, softFail:true (complete with QA flags)
 */
function hardSanityGate(pairs, opts = {}) {
  const {
    identicalFailRatio = IDENTICAL_FAIL_RATIO,
    placeholderSoftRatio = PLACEHOLDER_SOFT_RATIO,
    placeholderSoftAbs = PLACEHOLDER_SOFT_ABS,
    placeholderHardFailRatio = PLACEHOLDER_HARD_FAIL_RATIO,
    sourceLanguage,
    targetLanguage,
  } = opts;

  const { garbledOrIncompleteRows, stats } = runDeterministicCompletenessCheck(pairs, {
    sourceLanguage,
    targetLanguage,
  });

  if (stats.total === 0) {
    return {
      ok: false,
      code: 'no_segments',
      message: 'Translation produced no segments to review.',
      stats,
      garbledOrIncompleteRows,
    };
  }

  if (stats.identicalRatio > identicalFailRatio) {
    const pct = Math.round(stats.identicalRatio * 100);
    return {
      ok: false,
      code: 'too_many_identical',
      message:
        `${pct}% of translated segments are identical to the source `
        + `(threshold ${Math.round(identicalFailRatio * 100)}%). `
        + 'The translation looks like a passthrough — job failed before PDF generation.',
      stats,
      garbledOrIncompleteRows,
    };
  }

  const incompleteHeavy = (pairs || []).filter((p) =>
    /\[\s*translation\s+(incomplete|error)\s*\]/i.test(String(p?.target || ''))
    || findPlaceholder(p?.target)
  ).length;

  if (stats.placeholderRatio > placeholderHardFailRatio) {
    const pct = Math.round(stats.placeholderRatio * 100);
    return {
      ok: false,
      code: 'placeholders_present',
      message:
        `${stats.placeholderCount} segment(s) contain placeholder / incomplete markers `
        + `(${pct}% of segments — above ${Math.round(placeholderHardFailRatio * 100)}% hard-fail threshold). `
        + 'Job failed — fix translation and retry.'
        + (incompleteHeavy >= 2
          ? ' Includes process meta-text or “[Translation incomplete]” — try Google Translate or a stronger model.'
          : ''),
      stats,
      garbledOrIncompleteRows,
    };
  }

  if (stats.emptyCount > 0 && stats.emptyCount / stats.total > 0.1) {
    return {
      ok: false,
      code: 'too_many_empty',
      message:
        `${stats.emptyCount} empty translation segment(s) (${Math.round((stats.emptyCount / stats.total) * 100)}%). `
        + 'Job failed — incomplete translation.',
      stats,
      garbledOrIncompleteRows,
    };
  }

  if (
    stats.placeholderCount >= placeholderSoftAbs
    || stats.placeholderRatio > placeholderSoftRatio
    || (stats.redactionMissingCount || 0) >= 1
  ) {
    const pct = Math.round(stats.placeholderRatio * 100);
    return {
      ok: true,
      softFail: true,
      softFailCode: 'placeholders_present',
      message:
        `${stats.placeholderCount} segment(s) still have placeholder / meta markers (${pct}%)`
        + ((stats.redactionMissingCount || 0) ? `; ${stats.redactionMissingCount} missing [REDACTED]` : '')
        + '. Job completed with warnings — review Garbled / incomplete rows before sharing.',
      stats,
      garbledOrIncompleteRows,
    };
  }

  return { ok: true, stats, garbledOrIncompleteRows };
}

function mergeGarbledRows(deterministicRows, llmRows) {
  const out = [];
  const seen = new Set();
  const keyOf = (row) => {
    if (typeof row?.index === 'number') return `i:${row.index}`;
    return `e:${normalizeForCompare(row?.excerpt || row?.target || row?.source || '').slice(0, 80)}`;
  };
  for (const row of [...(deterministicRows || []), ...(llmRows || [])]) {
    const k = keyOf(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/**
 * Treat empty category counts as claims: spot-check random "clean" pairs for completeness.
 * Corrects garbledOrIncompleteRows when the claim was wrong.
 */
function verifyQaCategoryClaims(qaSummary, pairs, { sampleSize = 8 } = {}) {
  const qa = { ...(qaSummary || {}) };
  const flaggedIndexes = new Set();
  for (const row of qa.garbledOrIncompleteRows || []) {
    if (typeof row.index === 'number') flaggedIndexes.add(row.index);
  }

  const candidates = [];
  (pairs || []).forEach((pair, index) => {
    if (!flaggedIndexes.has(index)) candidates.push(index);
  });

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sample = candidates.slice(0, Math.min(sampleSize, candidates.length));

  const corrections = [];
  for (const index of sample) {
    const pair = pairs[index];
    const { ok, reasons } = checkSegmentCompleteness(pair.source, pair.target);
    if (!ok) {
      corrections.push({
        index,
        source: String(pair.source).slice(0, 400),
        target: String(pair.target).slice(0, 400),
        excerpt: String(pair.target || pair.source).slice(0, 200),
        issue: reasons.join('; '),
        check: 'claim_verification_sample',
      });
    }
  }

  if (corrections.length) {
    qa.garbledOrIncompleteRows = mergeGarbledRows(qa.garbledOrIncompleteRows, corrections);
  }

  const emptyClaims = [];
  const categories = [
    'uncertainTerms',
    'polarityOrSentenceTypeIssues',
    'restructuredSentences',
    'garbledOrIncompleteRows',
    'audienceFlags',
    'dialectalChoices',
  ];
  for (const cat of categories) {
    if (!Array.isArray(qa[cat]) || qa[cat].length === 0) emptyClaims.push(cat);
  }

  qa.claimVerification = {
    sampledIndexes: sample,
    sampleSize: sample.length,
    corrections: corrections.length,
    emptyClaimsBefore: emptyClaims,
    note: corrections.length
      ? `Spot-check found ${corrections.length} completeness failure(s) in categories that looked clean — added to Garbled / incomplete rows.`
      : sample.length
        ? `Spot-checked ${sample.length} unflagged segment(s) for completeness — no extra failures.`
        : 'No unflagged segments available to spot-check.',
    verifiedAt: new Date().toISOString(),
  };

  return qa;
}

module.exports = {
  PLACEHOLDER_PATTERNS,
  IDENTICAL_FAIL_RATIO,
  PLACEHOLDER_SOFT_RATIO,
  PLACEHOLDER_SOFT_ABS,
  PLACEHOLDER_HARD_FAIL_RATIO,
  PLACEHOLDER_HARD_FAIL_ABS_RATIO,
  normalizeForCompare,
  checkSegmentCompleteness,
  runDeterministicCompletenessCheck,
  hardSanityGate,
  mergeGarbledRows,
  verifyQaCategoryClaims,
  findPlaceholder,
  enforceRedactionPassThrough,
  lockedDoNotTranslateTerms,
  detectRepeatedTermCandidates,
  isMetaCommentaryInner,
  looksNonLinguistic,
  isCodeLikeArtifact,
};
