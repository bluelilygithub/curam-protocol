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

/** Locked glossary entries always injected — never translate these tokens. */
function lockedDoNotTranslateTerms() {
  return [
    { source: '[REDACTED]', target: '', doNotTranslate: true, note: 'Locked redaction marker — copy exactly' },
  ];
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
  isMetaCommentaryInner,
  looksNonLinguistic,
  isCodeLikeArtifact,
};
