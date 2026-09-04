'use strict';

/**
 * Deterministic translation QA checks (no LLM).
 * Completeness / placeholder / identical-to-source must run before subjective review.
 */

/** Known failure / stub markers in translated output. */
const PLACEHOLDER_PATTERNS = [
  /\[\s*translation\s+incomplete\s*\]/i,
  /\[\s*unable\s+to\s+translate\s*\]/i,
  /\[\s*translation\s+error\s*\]/i,
  /\[\s*translation\s+failed\s*\]/i,
  /\[\s*no\s+translation\s*\]/i,
  /\[\s*TODO\s*\]/i,
  /\[\s*TBD\s*\]/i,
  /\bTBD\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /lorem\s+ipsum/i,
  /\bN\/?A\b\s*$/i,
  /^\[?\s*insert\s+translation/i,
];

/** Fail job if this fraction of segments are byte-identical to source (after normalize). */
const IDENTICAL_FAIL_RATIO = 0.30;
/** Fail job if this fraction of segments contain a known placeholder marker. */
const PLACEHOLDER_FAIL_RATIO = 0.05;
/** Absolute floor: this many placeholders also fails (even on small docs). */
const PLACEHOLDER_FAIL_ABS = 2;

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
  // Pure numbers / codes / sheet refs — identical target is often correct
  if (/^[\d\s.,%$€£¥/+#:;@_-]+$/.test(t)) return true;
  if (/^\[[A-Z]+\d+\]\s*[\d\s.,%$€£¥/+_-]*$/i.test(t)) return true;
  return false;
}

function findPlaceholder(text) {
  const t = String(text || '');
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(t)) {
      const m = t.match(re);
      return m ? m[0] : 'placeholder';
    }
  }
  return null;
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
      identicalRatio: total ? identicalCount / total : 0,
      placeholderRatio: total ? placeholderCount / total : 0,
      sameLangSkippedIdentical: Boolean(sameLang),
    },
  };
}

/**
 * Hard gate outside the model. Fail the job rather than a silent green QA.
 * @returns {{ ok: true } | { ok: false, code: string, message: string, stats: object }}
 */
function hardSanityGate(pairs, opts = {}) {
  const {
    identicalFailRatio = IDENTICAL_FAIL_RATIO,
    placeholderFailRatio = PLACEHOLDER_FAIL_RATIO,
    placeholderFailAbs = PLACEHOLDER_FAIL_ABS,
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

  if (stats.placeholderCount >= placeholderFailAbs
    || stats.placeholderRatio > placeholderFailRatio
  ) {
    const pct = Math.round(stats.placeholderRatio * 100);
    const incompleteHeavy = (pairs || []).filter((p) =>
      /\[\s*translation\s+incomplete\s*\]/i.test(String(p?.target || ''))
    ).length;
    const hint = incompleteHeavy >= Math.max(2, stats.placeholderCount * 0.5)
      ? ' Most failures are “[Translation incomplete]” — the LLM batch likely returned truncated/invalid JSON. Retry, use a stronger translate model, or switch the engine to Google Translate for speed.'
      : '';
    return {
      ok: false,
      code: 'placeholders_present',
      message:
        `${stats.placeholderCount} segment(s) contain placeholder / incomplete markers `
        + `(${pct}% of segments). Job failed — fix translation and retry.`
        + hint,
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

  // Fisher-Yates sample
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
  PLACEHOLDER_FAIL_RATIO,
  PLACEHOLDER_FAIL_ABS,
  normalizeForCompare,
  checkSegmentCompleteness,
  runDeterministicCompletenessCheck,
  hardSanityGate,
  mergeGarbledRows,
  verifyQaCategoryClaims,
  findPlaceholder,
};
