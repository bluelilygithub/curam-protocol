'use strict';

/**
 * Translate agent — LLM helpers (glossary prep, chunked translate, QA review).
 * Uses Vault callModel + user-selected translate/review models.
 */

const { callModel } = require('./callModel');
const { parseModelJson } = require('../utils/parseModelJson');
const { logUsage } = require('../utils/logUsage');
const {
  runDeterministicCompletenessCheck,
  mergeGarbledRows,
  verifyQaCategoryClaims,
  hardSanityGate,
  enforceRedactionPassThrough,
  lockedDoNotTranslateTerms,
  findPlaceholder,
} = require('./translateQaChecks');

const LANG_NAMES = {
  en: 'English', fr: 'French', 'fr-CA': 'Canadian French', es: 'Spanish',
  de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  zh: 'Chinese (Simplified)', 'zh-CN': 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', ru: 'Russian', pl: 'Polish', sv: 'Swedish',
  mi: 'te reo Māori',
};

function langName(code) {
  return LANG_NAMES[code] || code;
}

function isMaoriTarget(code) {
  const c = String(code || '').toLowerCase();
  return c === 'mi' || c === 'mao' || c === 'mri';
}

/**
 * Standard te reo guidance (Te Taura Whiri default; dialect only when user specifies).
 * Caveat for humans: verify against current Te Taura Whiri guidance for production-critical work.
 */
function maoriLanguagePolicy(intakeAnswers = {}) {
  const regional = String(intakeAnswers.regionalAudience || intakeAnswers.iwiOrRohe || '').trim();
  if (!regional) {
    return [
      'TE REO MĀORI POLICY (default):',
      '- Use standard / general te reo Māori as codified by Te Taura Whiri i te Reo Māori',
      '  (the form used in national media such as Te Hiku Media and Waatea News).',
      '- Do NOT default to a specific iwi dialect unless the user specifies a regional audience.',
      '- Prefer macrons (tohutō) correctly; keep established loanwords and proper names stable.',
      '- If a lexical choice is dialectally contested, prefer the standard form and note uncertainty.',
    ].join('\n');
  }
  return [
    'TE REO MĀORI POLICY (regional adaptation requested):',
    `- Default baseline is still Te Taura Whiri standard te reo Māori.`,
    `- User-specified audience / iwi / rohe: "${regional}".`,
    '- Adapt vocabulary where that audience expects dialectal variants.',
    '- In guidance and QA, explicitly FLAG each dialectal choice vs the standard form',
    '  (what you used, and the standard alternative if different).',
    '- Prefer macrons (tohutō) correctly; keep proper names stable.',
  ].join('\n');
}

function languagePolicyBlock(targetLanguage, intakeAnswers = {}) {
  if (isMaoriTarget(targetLanguage)) return maoriLanguagePolicy(intakeAnswers);
  return '';
}

function mergeGlossaryTerms(...lists) {
  const bySource = new Map();
  for (const list of lists) {
    for (const t of list || []) {
      if (!t?.source) continue;
      const key = String(t.source).toLowerCase();
      if (!bySource.has(key)) bySource.set(key, t);
    }
  }
  return [...bySource.values()];
}

const TRANSLATOR_HARD_RULES = `
HARD RULES (non-negotiable):
- Preserve polarity and relational wording. Do NOT flip "measured against / assessed against / mapped against / compliant with" into "not compliant" / "non-conforme" unless the source explicitly states non-compliance.
- Preserve identifiers exactly (e.g. Q-15, R3, R-01, P-16) — do not renumber or change letter prefixes.
- Copy [REDACTED] (and [REDACTED:…]) EXACTLY — never translate, explain, expand, or replace with meta-text such as "[texto no disponible…]", "[unable to translate]", etc.
- Never insert commentary about the translation process into the output.
- Apply the target language's decimal separator convention CONSISTENTLY to every number (e.g. French/Spanish/German use a comma: "4,5"; do not leave some numbers with a period "4.5" while others use a comma in the same document).
- Preserve grammatical mood exactly: an imperative/directive instruction in the source (e.g. "Proceed", "Submit", "Review") must stay imperative in the target, never softened into an infinitive or noun form that reads as a heading rather than an instruction.
- Glossary and do-not-translate terms must be grammatically INFLECTED to fit the sentence around them (gender, number, and any required article) — never paste a locked term's dictionary form verbatim if that creates a disagreement or a redundant double-noun with a word already in the sentence. Adapt the term's form; keep its core wording and meaning fixed.
`.trim();

function buildGlossaryBlock(terms) {
  if (!Array.isArray(terms) || !terms.length) return '(none)';
  return terms.map((t) => {
    if (t.doNotTranslate) return `- "${t.source}" → DO NOT TRANSLATE (keep exactly)`;
    return `- "${t.source}" → "${t.target || ''}"`;
  }).join('\n');
}

function finalizeTranslation(source, target) {
  return enforceRedactionPassThrough(source, String(target || '').trim());
}


/**
 * Propose / merge glossary from intake answers + source skim + optional saved glossary.
 * Also assigns canonical renderings to `recurringCandidates` (from
 * translateQaChecks.detectRepeatedTermCandidates — a pure string scan, computed by the caller
 * before this call, no LLM cost) in the SAME call: these are ordinary (non-brand) words/phrases
 * that read as defined terms because they recur mid-sentence, as a standalone label, or right
 * before a definition marker (Warranty Schedule, Nominated Vehicle, Period, Make) — too ordinary
 * for a glossary skim to nominate on its own, but exactly what drifts across chunks when nothing
 * pins them down. This used to be a separate `lockRepeatedTerms` call, run strictly after this
 * one — merged into one call to remove a full serial round-trip from every job before
 * translation starts (see docs/translate-agent.md pipeline notes).
 */
async function proposeGlossary({
  modelId, userId, intakeAnswers = {}, sourceSkim, targetLanguage, existingTerms = [],
  recurringCandidates = [],
}) {
  const system = `You prepare translation glossaries for professional documents.
Return ONLY valid JSON:
{
  "sourceLanguage": "xx",
  "terms": [ { "source": "...", "target": "...", "doNotTranslate": false, "note": "..." } ],
  "lockedTerms": [ { "source": "...", "target": "...", "doNotTranslate": false } ],
  "uncertainTerms": [ { "source": "...", "proposedTarget": "...", "reason": "..." } ],
  "dialectalChoices": [ { "used": "...", "standardForm": "...", "context": "iwi/rohe or why adapted" } ],
  "guidance": "1-3 sentences of translator instructions from the intake answers"
}
Rules:
- Prefer established industry renderings over literal dictionary translations.
- Mark brand names, product codes, and "do not translate" items with doNotTranslate:true and empty target.
- Always keep [REDACTED] as doNotTranslate (never invent a target-language substitute).
- Merge and respect any existing glossary terms provided (do not contradict them).
- Keep the "terms" list focused (typically 5–40 terms). No markdown fences.
- dialectalChoices: only when te reo Māori with a specified regional audience; otherwise [].
- "lockedTerms": assign ONE canonical rendering to each entry under "Recurring candidate terms"
  below, so a document translator uses the same rendering everywhere instead of drifting
  term-by-term. Treat each as a defined term or fixed field label, not a one-off word. One entry
  per candidate, same source spelling. If it's a brand/product name that should stay untranslated,
  set doNotTranslate:true and target:"". Omit "lockedTerms" (or return []) if no candidates were given.`;

  const policy = languagePolicyBlock(targetLanguage, intakeAnswers);
  const prompt = [
    `Target language: ${langName(targetLanguage)} (${targetLanguage})`,
    '',
    policy ? `${policy}\n` : '',
    'Intake answers from the user:',
    JSON.stringify(intakeAnswers || {}, null, 2),
    '',
    'Existing glossary terms (must honour):',
    JSON.stringify(existingTerms || [], null, 2),
    '',
    recurringCandidates.length ? 'Recurring candidate terms (assign each a canonical rendering under "lockedTerms", with one example sentence each):' : '',
    recurringCandidates.length
      ? recurringCandidates.map((c) => `- "${c.term}" (seen ${c.count}×) — e.g. "${c.example}"`).join('\n')
      : '',
    '',
    'Source document skim (beginning of extract):',
    String(sourceSkim || '').slice(0, 6000),
  ].filter(Boolean).join('\n');

  const res = await callModel(modelId, prompt, { maxTokens: 3000, system, returnUsage: true });
  if (userId) {
    logUsage({
      userId, model: modelId,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      feature: 'translate_glossary',
    }).catch(() => {});
  }

  const parsed = parseModelJson(res.text) || {};
  const terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  const lockedTerms = (Array.isArray(parsed.lockedTerms) ? parsed.lockedTerms : [])
    .filter((t) => t?.source && (t.doNotTranslate || t.target));
  return {
    sourceLanguage: parsed.sourceLanguage || 'auto',
    terms: mergeGlossaryTerms(lockedDoNotTranslateTerms(), existingTerms || [], terms, lockedTerms),
    uncertainTerms: Array.isArray(parsed.uncertainTerms) ? parsed.uncertainTerms : [],
    dialectalChoices: Array.isArray(parsed.dialectalChoices) ? parsed.dialectalChoices : [],
    guidance: parsed.guidance || '',
  };
}

/**
 * Post-translate drift REPORT for forced glossary terms (user-declared + auto-locked via the
 * "lockedTerms" step in proposeGlossary). Chunks translate in parallel with no shared state, so even a
 * term every chunk was told the same canonical rendering for can still land differently in
 * chunk A vs chunk B. Rather than spend an LLM call re-translating each drifted segment (tried
 * previously — added real wall-clock time and did not reliably fix anything, since the model can
 * pick a different wrong synonym on retry too), this is pure string comparison: scan every pair
 * whose SOURCE contains a forced term, flag it when the TARGET doesn't contain that term's
 * canonical rendering, and return the findings for the QA summary. Zero LLM calls, zero added
 * latency. Does not mutate pairs — surfacing the drift beats silently guessing at a fix.
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reportGlossaryDrift({ pairs, glossaryTerms }) {
  const forced = (glossaryTerms || []).filter((t) => t?.source && t?.target && !t.doNotTranslate);
  if (!forced.length || !pairs?.length) return { checked: 0, terms: [] };

  const byTerm = new Map(); // term.source -> { source, target, count, examples: [pairIndex,...] }
  pairs.forEach((pair, i) => {
    const src = String(pair?.source || '');
    const tgt = String(pair?.target || '');
    if (!src || !tgt) return;
    for (const t of forced) {
      const re = new RegExp(`\\b${escapeRegExp(t.source)}\\b`, 'i');
      if (!re.test(src) || tgt.toLowerCase().includes(String(t.target).toLowerCase())) continue;
      const key = t.source;
      const entry = byTerm.get(key) || { source: t.source, target: t.target, count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 5) entry.examples.push(i);
      byTerm.set(key, entry);
    }
  });

  return { checked: pairs.length, terms: [...byTerm.values()] };
}

/**
 * Deterministic drift FIX (not just report) for the one sub-case that's safe to auto-correct:
 * the chunk simply left the source term untranslated, verbatim, inside the target. Confirmed on
 * a real job — a locked term ("Tier") rendered correctly ("Palier") in most chunks but left as
 * literal English in one — the exact pattern this catches and repairs with zero LLM cost.
 *
 * Deliberately does NOT attempt to fix a drift where the target used some OTHER wrong rendering
 * (a different synonym, a mistranslation) — we have no reliable way to locate and replace that
 * without an LLM call, and guessing wrong is worse than leaving it flagged. Those still come back
 * in `remainingTerms` for the QA panel, same shape as `reportGlossaryDrift`'s output.
 *
 * Mutates `pairs[i].target` in place for every fix applied — caller is responsible for syncing
 * the fixed text back into its own page/paragraph structure (translatedByPage).
 */
function autoFixGlossaryDrift({ pairs, glossaryTerms }) {
  const forced = (glossaryTerms || []).filter((t) => t?.source && t?.target && !t.doNotTranslate);
  if (!forced.length || !pairs?.length) return { fixedCount: 0, remainingTerms: [] };

  const remaining = new Map();
  let fixedCount = 0;

  pairs.forEach((pair, i) => {
    const src = String(pair?.source || '');
    if (!src || !pair?.target) return;
    for (const t of forced) {
      const srcRe = new RegExp(`\\b${escapeRegExp(t.source)}\\b`, 'i');
      if (!srcRe.test(src)) continue;
      const tgt = String(pair.target);
      if (tgt.toLowerCase().includes(String(t.target).toLowerCase())) continue; // canonical already present

      const leakRe = new RegExp(`\\b${escapeRegExp(t.source)}\\b`, 'gi');
      if (leakRe.test(tgt)) {
        pair.target = tgt.replace(leakRe, t.target);
        fixedCount += 1;
      } else {
        const entry = remaining.get(t.source) || { source: t.source, target: t.target, count: 0, examples: [] };
        entry.count += 1;
        if (entry.examples.length < 5) entry.examples.push(i);
        remaining.set(t.source, entry);
      }
    }
  });

  return { fixedCount, remainingTerms: [...remaining.values()] };
}

/**
 * Pull a translations[] array out of model text — full JSON, fenced, or truncated.
 */
function extractTranslationsArray(text, expectedLen) {
  const parsed = parseModelJson(text);
  if (Array.isArray(parsed?.translations)) return parsed.translations;
  if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;

  const raw = String(text || '');
  // Recover complete JSON string literals from a (possibly truncated) translations array
  const keyIdx = raw.search(/"translations"\s*:\s*\[/i);
  const slice = keyIdx >= 0 ? raw.slice(keyIdx) : raw;
  const strings = [];
  const re = /"(?:\\.|[^"\\])*"/g;
  let m;
  let started = keyIdx < 0; // if no key, still try scanning quoted strings after [
  const arrStart = slice.indexOf('[');
  const scanFrom = arrStart >= 0 ? slice.slice(arrStart + 1) : slice;
  if (keyIdx >= 0 || arrStart >= 0) started = true;
  if (started) {
    while ((m = re.exec(scanFrom)) !== null) {
      // Skip the key name "translations" if captured
      if (m[0] === '"translations"') continue;
      try {
        strings.push(JSON.parse(m[0]));
      } catch {
        /* skip bad token */
      }
      if (expectedLen && strings.length >= expectedLen) break;
    }
  }

  if (strings.length === expectedLen) return strings;
  if (strings.length > 0 && strings.length < expectedLen) return strings; // partial — caller may retry rest

  // Numbered lines: [1] ... / 1. ...
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('{') && !l.startsWith('}') && l !== '[' && l !== ']');
  if (lines.length === expectedLen) return lines;

  return null;
}

function translationMaxTokens(paragraphs) {
  const inputChars = paragraphs.join('').length;
  // Spanish/Māori often expand; JSON wrapper adds overhead. Old formula (800+len) truncated often.
  return Math.min(16000, Math.max(4096, Math.ceil(inputChars * 3.5) + 1200));
}

const TRANSLATE_CALL_TIMEOUT_MS = 45000;

/**
 * Translate a batch of paragraphs. Returns array of strings same length as input.
 * On parse/length failure: split and retry, then single-paragraph calls — avoid marking
 * a whole chunk [Translation incomplete] when only the batch JSON failed.
 */
async function translateParagraphBatch({
  modelId, userId, paragraphs, sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary,
  intakeAnswers = {},
  _depth = 0,
  timeoutMs = TRANSLATE_CALL_TIMEOUT_MS,
  onProgress,
}) {
  if (!paragraphs?.length) return [];

  // Single paragraph — simplest path
  if (paragraphs.length === 1) {
    return [await translateOneParagraph({
      modelId, userId,
      paragraph: paragraphs[0],
      sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary, intakeAnswers,
      timeoutMs,
    })];
  }

  const glossaryTermsMerged = mergeGlossaryTerms(lockedDoNotTranslateTerms(), glossaryTerms);
  const policy = languagePolicyBlock(targetLanguage, intakeAnswers);

  const system = `You are a professional document translator.
Translate each numbered paragraph into ${langName(targetLanguage)}.
Preserve sentence type (statement vs question), polarity (affirmative vs negative), and meaning.
Obey the glossary exactly. Maintain terminology consistency with the running glossary.
${TRANSLATOR_HARD_RULES}
${policy ? `\n${policy}\n` : ''}
Return ONLY valid JSON: { "translations": ["...", "..."] } with exactly ${paragraphs.length} strings, same order.
No markdown fences. No commentary.`;

  const prompt = [
    `Source language: ${sourceLanguage || 'auto'}`,
    `Target language: ${langName(targetLanguage)} (${targetLanguage})`,
    `Required translations array length: ${paragraphs.length}`,
    '',
    'Translator guidance:',
    guidance || '(none)',
    '',
    'Glossary:',
    buildGlossaryBlock(glossaryTermsMerged),
    '',
    'Running terminology already used (reuse exact renderings):',
    runningGlossary && Object.keys(runningGlossary).length
      ? Object.entries(runningGlossary).map(([s, t]) => `- "${s}" → "${t}"`).join('\n')
      : '(none yet)',
    '',
    'Paragraphs to translate:',
    paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n'),
  ].join('\n');

  const maxTokens = translationMaxTokens(paragraphs);
  let res;
  try {
    res = await callModel(modelId, prompt, {
      maxTokens,
      system,
      returnUsage: true,
      timeoutMs,
    });
  } catch (err) {
    console.error('[translate] batch call failed:', err.message, { n: paragraphs.length, maxTokens });
    return splitAndRetryTranslate({
      modelId, userId, paragraphs, sourceLanguage, targetLanguage, glossaryTerms, guidance,
      runningGlossary, intakeAnswers, _depth, reason: err.message, timeoutMs, onProgress,
    });
  }

  if (userId) {
    logUsage({
      userId, model: modelId,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      feature: 'translate_chunk',
    }).catch(() => {});
  }

  const rawText = String(res.text || '');
  let translations = extractTranslationsArray(rawText, paragraphs.length);

  if (translations && translations.length === paragraphs.length) {
    return translations.map((t, i) => finalizeTranslation(paragraphs[i], t));
  }

  // Partial recovery: keep good prefix, retry the rest
  if (translations && translations.length > 0 && translations.length < paragraphs.length) {
    console.warn('[translate] partial batch recovery', {
      got: translations.length,
      expected: paragraphs.length,
      textLen: rawText.length,
      maxTokens,
      finish: res.diagnostics?.finishReason,
    });
    const rest = await translateParagraphBatch({
      modelId, userId,
      paragraphs: paragraphs.slice(translations.length),
      sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary, intakeAnswers,
      _depth: _depth + 1,
      timeoutMs,
      onProgress,
    });
    return [
      ...translations.map((t, i) => finalizeTranslation(paragraphs[i], t)),
      ...rest,
    ];
  }

  console.warn('[translate] batch parse failed — splitting', {
    expected: paragraphs.length,
    textLen: rawText.length,
    maxTokens,
    preview: rawText.slice(0, 180).replace(/\s+/g, ' '),
    finish: res.diagnostics?.finishReason,
  });

  return splitAndRetryTranslate({
    modelId, userId, paragraphs, sourceLanguage, targetLanguage, glossaryTerms, guidance,
    runningGlossary, intakeAnswers, _depth, reason: 'parse_mismatch', timeoutMs, onProgress,
  });
}

async function splitAndRetryTranslate(opts) {
  const { paragraphs, _depth = 0, reason, timeoutMs, onProgress } = opts;
  if (paragraphs.length <= 1) {
    return [await translateOneParagraph({ ...opts, paragraph: paragraphs[0] })];
  }
  if (_depth > 6) {
    console.error('[translate] giving up after splits:', reason, { n: paragraphs.length });
    return paragraphs.map((p) => `[Translation incomplete] ${p}`);
  }
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'split-retry', depth: _depth, n: paragraphs.length, reason });
  }
  const mid = Math.ceil(paragraphs.length / 2);
  // Parallel halves — cut wall-clock time when a batch fails
  const [left, right] = await Promise.all([
    translateParagraphBatch({ ...opts, paragraphs: paragraphs.slice(0, mid), _depth: _depth + 1 }),
    translateParagraphBatch({ ...opts, paragraphs: paragraphs.slice(mid), _depth: _depth + 1 }),
  ]);
  return [...left, ...right];
}

async function translateOneParagraph({
  modelId, userId, paragraph, sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary,
  intakeAnswers = {},
  timeoutMs = TRANSLATE_CALL_TIMEOUT_MS,
}) {
  const policy = languagePolicyBlock(targetLanguage, intakeAnswers);
  const system = `You are a professional document translator.
Translate the paragraph into ${langName(targetLanguage)}.
Preserve meaning, polarity, and sentence type. Obey the glossary.
${TRANSLATOR_HARD_RULES}
${policy ? `\n${policy}\n` : ''}
Return ONLY valid JSON: { "translation": "..." }
No markdown fences.`;

  const glossaryTermsMerged = mergeGlossaryTerms(lockedDoNotTranslateTerms(), glossaryTerms);
  const prompt = [
    `Source language: ${sourceLanguage || 'auto'}`,
    `Target language: ${langName(targetLanguage)} (${targetLanguage})`,
    '',
    'Guidance:', guidance || '(none)',
    '',
    'Glossary:', buildGlossaryBlock(glossaryTermsMerged),
    '',
    'Running terms:',
    runningGlossary && Object.keys(runningGlossary).length
      ? Object.entries(runningGlossary).map(([s, t]) => `- "${s}" → "${t}"`).join('\n')
      : '(none)',
    '',
    'Paragraph:',
    paragraph,
  ].join('\n');

  const maxTokens = translationMaxTokens([paragraph]);
  try {
    const res = await callModel(modelId, prompt, {
      maxTokens, system, returnUsage: true, timeoutMs,
    });
    if (userId) {
      logUsage({
        userId, model: modelId,
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        feature: 'translate_one',
      }).catch(() => {});
    }
    const parsed = parseModelJson(res.text);
    if (parsed?.translation && String(parsed.translation).trim()) {
      return finalizeTranslation(paragraph, parsed.translation);
    }
    const arr = extractTranslationsArray(res.text, 1);
    if (arr?.[0]?.trim()) return finalizeTranslation(paragraph, arr[0]);
    const cleaned = String(res.text || '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (cleaned && !cleaned.startsWith('{') && cleaned.length > 0) {
      return finalizeTranslation(paragraph, cleaned);
    }
    console.warn('[translate] single paragraph empty/unparsed', {
      textLen: String(res.text || '').length,
      preview: String(res.text || '').slice(0, 120),
    });
  } catch (err) {
    console.error('[translate] single paragraph failed:', err.message);
  }
  return `[Translation incomplete] ${paragraph}`;
}

/**
 * Second-pass QA review.
 * 1) Deterministic completeness on EVERY pair (cannot skip) → garbled rows
 * 2) LLM compares source⟶target side-by-side in batches for subjective issues
 * 3) Merge + claim verification spot-check on "None flagged" categories
 */
async function reviewTranslation({
  modelId, userId, sourceLanguage, targetLanguage, pairs, glossaryTerms, intakeAnswers = {},
}) {
  const allPairs = Array.isArray(pairs) ? pairs : [];
  const policy = languagePolicyBlock(targetLanguage, intakeAnswers);

  // ── 1. Deterministic completeness FIRST (all segments) ────────────────────
  const det = runDeterministicCompletenessCheck(allPairs, { sourceLanguage, targetLanguage });

  const system = `You are a translation QA reviewer for business / compliance documents.
You will receive numbered SOURCE ⟶ TARGET pairs. Compare them line by line.
Completeness (empty / identical-to-source / placeholder markers) is already checked deterministically —
focus on subjective issues only. Still list any incomplete rows you notice under garbledOrIncompleteRows.
Flag polarity flips (e.g. source "measured/assessed against" rendered as "not compliant" / "no conforme") under polarityOrSentenceTypeIssues.
Flag identifier drift (Q-15 → P-16) under uncertainTerms or garbledOrIncompleteRows.
Flag target-language process meta (e.g. "[texto no disponible para traducir]") under garbledOrIncompleteRows.

Return ONLY valid JSON:
{
  "uncertainTerms": [ { "source": "...", "renderedAs": "...", "issue": "..." } ],
  "restructuredSentences": [ { "source": "...", "target": "...", "why": "..." } ],
  "polarityOrSentenceTypeIssues": [ { "source": "...", "target": "...", "issue": "..." } ],
  "garbledOrIncompleteRows": [ { "index": 0, "excerpt": "...", "issue": "..." } ],
  "audienceFlags": [ { "target": "...", "issue": "why an auditor/stakeholder might be confused or alarmed" } ],
  "dialectalChoices": [ { "used": "...", "standardForm": "...", "context": "..." } ],
  "overallNotes": "2-4 sentences"
}
Be concise. Empty arrays are fine. No markdown fences.
Use the pair index (0-based global index shown) when flagging rows.
${policy ? `\nFor te reo Māori: verify Te Taura Whiri standard unless regional audience was specified; list dialectalChoices when non-standard forms were used.\n` : ''}`;

  // ── 2. LLM review of ALL pairs in batches (side-by-side), run in parallel ──
  const BATCH = 35;
  const REVIEW_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.TRANSLATE_REVIEW_CONCURRENCY) || 4));
  const llmAcc = {
    uncertainTerms: [],
    restructuredSentences: [],
    polarityOrSentenceTypeIssues: [],
    garbledOrIncompleteRows: [],
    audienceFlags: [],
    dialectalChoices: [],
    overallNotes: [],
  };

  const offsets = [];
  for (let offset = 0; offset < allPairs.length; offset += BATCH) offsets.push(offset);

  async function reviewOneBatch(offset) {
    const batch = allPairs.slice(offset, offset + BATCH);
    const prompt = [
      `Source language: ${sourceLanguage || 'auto'}`,
      `Target language: ${langName(targetLanguage)}`,
      `Batch: pairs ${offset}–${offset + batch.length - 1} of ${allPairs.length} (compare each SRC against TGT)`,
      '',
      policy || '',
      '',
      'Glossary that should have been followed:',
      buildGlossaryBlock(glossaryTerms),
      '',
      'Deterministic completeness already flagged these pair indexes (do not drop them; you may add more):',
      det.garbledOrIncompleteRows.length
        ? det.garbledOrIncompleteRows.map((r) => `- #${r.index}: ${r.issue}`).join('\n')
        : '(none yet)',
      '',
      'Pairs — compare source against target line by line:',
      batch.map((p, i) => {
        const idx = offset + i;
        return `#${idx}\nSRC: ${p.source}\nTGT: ${p.target}`;
      }).join('\n\n'),
    ].filter(Boolean).join('\n');

    try {
      const res = await callModel(modelId, prompt, { maxTokens: 3500, system, returnUsage: true });
      if (userId) {
        logUsage({
          userId, model: modelId,
          inputTokens: res.inputTokens, outputTokens: res.outputTokens,
          feature: 'translate_review',
        }).catch(() => {});
      }
      const parsed = parseModelJson(res.text) || {};
      for (const key of [
        'uncertainTerms', 'restructuredSentences', 'polarityOrSentenceTypeIssues',
        'garbledOrIncompleteRows', 'audienceFlags', 'dialectalChoices',
      ]) {
        if (Array.isArray(parsed[key])) llmAcc[key].push(...parsed[key]);
      }
      if (parsed.overallNotes) llmAcc.overallNotes.push(String(parsed.overallNotes));
    } catch (err) {
      console.error('[translate] review batch failed:', err.message);
      llmAcc.overallNotes.push(`Review batch starting at ${offset} failed: ${err.message}`);
    }
  }

  {
    let next = 0;
    async function worker() {
      while (true) {
        const slot = next;
        next += 1;
        if (slot >= offsets.length) return;
        await reviewOneBatch(offsets[slot]);
      }
    }
    const n = Math.max(1, Math.min(REVIEW_CONCURRENCY, offsets.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
  }

  // ── 3. Merge: deterministic garbled always wins / prepends ─────────────────
  let summary = {
    uncertainTerms: llmAcc.uncertainTerms,
    restructuredSentences: llmAcc.restructuredSentences,
    polarityOrSentenceTypeIssues: llmAcc.polarityOrSentenceTypeIssues,
    garbledOrIncompleteRows: mergeGarbledRows(
      det.garbledOrIncompleteRows,
      llmAcc.garbledOrIncompleteRows
    ),
    audienceFlags: llmAcc.audienceFlags,
    dialectalChoices: llmAcc.dialectalChoices,
    overallNotes: llmAcc.overallNotes.filter(Boolean).join(' '),
    reviewedPairCount: allPairs.length,
    totalPairCount: allPairs.length,
    completenessCheck: {
      ran: true,
      beforeSubjectiveReview: true,
      ...det.stats,
      autoFlagged: det.garbledOrIncompleteRows.length,
    },
  };

  // ── 4. Verify empty-category claims against sample of actual pairs ─────────
  summary = verifyQaCategoryClaims(summary, allPairs, { sampleSize: 8 });

  return summary;
}

/** Apply forced glossary substitutions on already-translated text (belt and braces). */
// A filename token (identifier, not prose) that happens to contain a locked term as a substring
// separated only by underscores/digits — e.g. "Transmittal_2024-157_Scanned.pdf" — still passes
// applyGlossarySubstitutions' word-boundary check, because an underscore isn't a letter either.
// Confirmed on a real job: "Transmittal" inside that exact filename got replaced with "Bordereau
// de transmission", producing a filename that no longer exists on disk. Filenames are
// identifiers and must never be touched by glossary substitution.
const FILENAME_TOKEN_RE = /\S*\.(?:pdf|docx?|xlsx?|pptx?|tiff?|dwg|dxf|jpe?g|png|gif|bmp|csv|txt|zip|msg|eml)\b/gi;

function applyGlossarySubstitutions(text, terms) {
  let t = String(text || '');
  const subs = (terms || []).filter((x) => !x.doNotTranslate && x.source && x.target);
  if (!subs.length) return t;

  // Swap filename-like tokens out for placeholders before substituting, restore after — keeps
  // them completely outside every glossary regex regardless of what term happens to match inside.
  const filenames = [];
  t = t.replace(FILENAME_TOKEN_RE, (m) => {
    filenames.push(m);
    return `⁣FN${filenames.length - 1}⁣`;
  });

  // Longer sources first
  subs.sort((a, b) => String(b.source).length - String(a.source).length);
  for (const sub of subs) {
    // Second line of defence against a short/generic term corrupting unrelated words as a bare
    // substring match (e.g. a locked "If"->"Si" term turning "différend" into "dSiférend") --
    // word-boundary anchors mean this only ever replaces the term as a whole word/phrase.
    // \b doesn't reliably bound accented characters, so also require the match not be flanked
    // by a letter on either side.
    const escaped = String(sub.source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(^|[^\\p{L}])(${escaped})(?![\\p{L}])`, 'giu'), (m, pre, hit) => pre + sub.target);
  }

  t = t.replace(/⁣FN(\d+)⁣/g, (m, i) => filenames[Number(i)]);
  return t;
}

function isIncompleteTarget(target) {
  return /\[\s*translation\s+(incomplete|error)\s*\]/i.test(String(target || ''))
    || !String(target || '').trim();
}

/**
 * Repair failed LLM segments: one more single-paragraph LLM try, then Google if configured.
 * Mutates pairs in place (updates .target). Returns stats.
 */
async function repairIncompletePairs({
  pairs,
  modelId,
  userId,
  sourceLanguage,
  targetLanguage,
  glossaryTerms,
  guidance,
  runningGlossary,
  intakeAnswers,
  allowGoogleFallback = true,
  concurrency = 3,
  onProgress,
}) {
  const indexes = [];
  (pairs || []).forEach((p, i) => {
    if (isIncompleteTarget(p?.target)) indexes.push(i);
  });
  if (!indexes.length) {
    return { attempted: 0, llmRepaired: 0, googleRepaired: 0, stillFailing: 0 };
  }

  const {
    isGoogleTranslateConfigured,
    translateTexts: googleTranslateTexts,
    wrapDoNotTranslate,
    stripDoNotTranslateSpans,
  } = require('./googleTranslateService');

  let llmRepaired = 0;
  let googleRepaired = 0;
  let next = 0;

  async function worker() {
    while (true) {
      const slot = next;
      next += 1;
      if (slot >= indexes.length) return;
      const i = indexes[slot];
      const pair = pairs[i];
      if (typeof onProgress === 'function') {
        onProgress({ done: slot, total: indexes.length });
      }

      // 1) LLM single-paragraph retry
      if (modelId) {
        try {
          const [t] = await translateParagraphBatch({
            modelId,
            userId,
            paragraphs: [pair.source],
            sourceLanguage,
            targetLanguage,
            glossaryTerms,
            guidance,
            runningGlossary,
            intakeAnswers,
          });
          const cleaned = finalizeTranslation(
            pair.source,
            applyGlossarySubstitutions(t, glossaryTerms)
          );
          if (cleaned && !isIncompleteTarget(cleaned) && !findPlaceholder(cleaned)) {
            pair.target = cleaned;
            llmRepaired += 1;
            continue;
          }
        } catch (err) {
          console.warn('[translate] repair LLM failed:', err.message);
        }
      }

      // 2) Google fallback for this segment
      if (allowGoogleFallback && isGoogleTranslateConfigured()) {
        try {
          const wrapped = wrapDoNotTranslate(pair.source, glossaryTerms);
          const [gt] = await googleTranslateTexts({
            texts: [wrapped],
            targetLanguage,
            sourceLanguage,
          });
          const cleaned = enforceRedactionPassThrough(
            pair.source,
            applyGlossarySubstitutions(stripDoNotTranslateSpans(gt), glossaryTerms)
          );
          if (cleaned && cleaned.trim() && !findPlaceholder(cleaned)) {
            pair.target = cleaned;
            googleRepaired += 1;
            continue;
          }
        } catch (err) {
          console.warn('[translate] repair Google failed:', err.message);
        }
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, indexes.length));
  await Promise.all(Array.from({ length: n }, () => worker()));

  const stillFailing = pairs.filter((p) => isIncompleteTarget(p.target)).length;
  return {
    attempted: indexes.length,
    llmRepaired,
    googleRepaired,
    stillFailing,
  };
}

module.exports = {
  proposeGlossary,
  reportGlossaryDrift,
  autoFixGlossaryDrift,
  translateParagraphBatch,
  reviewTranslation,
  applyGlossarySubstitutions,
  repairIncompletePairs,
  isIncompleteTarget,
  langName,
  hardSanityGate,
  runDeterministicCompletenessCheck,
};
