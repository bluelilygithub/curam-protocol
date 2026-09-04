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

function buildGlossaryBlock(terms) {
  if (!Array.isArray(terms) || !terms.length) return '(none)';
  return terms.map((t) => {
    if (t.doNotTranslate) return `- "${t.source}" → DO NOT TRANSLATE (keep exactly)`;
    return `- "${t.source}" → "${t.target || ''}"`;
  }).join('\n');
}

/**
 * Propose / merge glossary from intake answers + source skim + optional saved glossary.
 */
async function proposeGlossary({
  modelId, userId, sourceAnswers, sourceSkim, targetLanguage, existingTerms = [],
}) {
  const system = `You prepare translation glossaries for professional documents.
Return ONLY valid JSON:
{
  "sourceLanguage": "xx",
  "terms": [ { "source": "...", "target": "...", "doNotTranslate": false, "note": "..." } ],
  "uncertainTerms": [ { "source": "...", "proposedTarget": "...", "reason": "..." } ],
  "dialectalChoices": [ { "used": "...", "standardForm": "...", "context": "iwi/rohe or why adapted" } ],
  "guidance": "1-3 sentences of translator instructions from the intake answers"
}
Rules:
- Prefer established industry renderings over literal dictionary translations.
- Mark brand names, product codes, and "do not translate" items with doNotTranslate:true and empty target.
- Merge and respect any existing glossary terms provided (do not contradict them).
- Keep the list focused (typically 5–40 terms). No markdown fences.
- dialectalChoices: only when te reo Māori with a specified regional audience; otherwise [].`;

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
    'Source document skim (beginning of extract):',
    String(sourceSkim || '').slice(0, 6000),
  ].filter(Boolean).join('\n');

  const res = await callModel(modelId, prompt, { maxTokens: 2500, system, returnUsage: true });
  if (userId) {
    logUsage({
      userId, model: modelId,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      feature: 'translate_glossary',
    }).catch(() => {});
  }

  const parsed = parseModelJson(res.text) || {};
  const terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  // Merge existing terms first (they win on source key)
  const bySource = new Map();
  for (const t of existingTerms || []) {
    if (t?.source) bySource.set(String(t.source).toLowerCase(), t);
  }
  for (const t of terms) {
    if (!t?.source) continue;
    const key = String(t.source).toLowerCase();
    if (!bySource.has(key)) bySource.set(key, t);
  }

  return {
    sourceLanguage: parsed.sourceLanguage || 'auto',
    terms: [...bySource.values()],
    uncertainTerms: Array.isArray(parsed.uncertainTerms) ? parsed.uncertainTerms : [],
    dialectalChoices: Array.isArray(parsed.dialectalChoices) ? parsed.dialectalChoices : [],
    guidance: parsed.guidance || '',
  };
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

/**
 * Translate a batch of paragraphs. Returns array of strings same length as input.
 * On parse/length failure: split and retry, then single-paragraph calls — avoid marking
 * a whole chunk [Translation incomplete] when only the batch JSON failed.
 */
async function translateParagraphBatch({
  modelId, userId, paragraphs, sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary,
  intakeAnswers = {},
  _depth = 0,
}) {
  if (!paragraphs?.length) return [];

  // Single paragraph — simplest path
  if (paragraphs.length === 1) {
    return [await translateOneParagraph({
      modelId, userId,
      paragraph: paragraphs[0],
      sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary, intakeAnswers,
    })];
  }

  const policy = languagePolicyBlock(targetLanguage, intakeAnswers);
  const system = `You are a professional document translator.
Translate each numbered paragraph into ${langName(targetLanguage)}.
Preserve sentence type (statement vs question), polarity (affirmative vs negative), and meaning.
Obey the glossary exactly. Maintain terminology consistency with the running glossary.
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
    buildGlossaryBlock(glossaryTerms),
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
    });
  } catch (err) {
    console.error('[translate] batch call failed:', err.message, { n: paragraphs.length, maxTokens });
    return splitAndRetryTranslate({
      modelId, userId, paragraphs, sourceLanguage, targetLanguage, glossaryTerms, guidance,
      runningGlossary, intakeAnswers, _depth, reason: err.message,
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
    return translations.map((t) => String(t || '').trim());
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
    });
    return [...translations.map((t) => String(t || '').trim()), ...rest];
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
    runningGlossary, intakeAnswers, _depth, reason: 'parse_mismatch',
  });
}

async function splitAndRetryTranslate(opts) {
  const { paragraphs, _depth = 0, reason } = opts;
  if (paragraphs.length <= 1) {
    return [await translateOneParagraph({ ...opts, paragraph: paragraphs[0] })];
  }
  if (_depth > 6) {
    console.error('[translate] giving up after splits:', reason, { n: paragraphs.length });
    return paragraphs.map((p) => `[Translation incomplete] ${p}`);
  }
  const mid = Math.ceil(paragraphs.length / 2);
  const left = await translateParagraphBatch({ ...opts, paragraphs: paragraphs.slice(0, mid), _depth: _depth + 1 });
  const right = await translateParagraphBatch({ ...opts, paragraphs: paragraphs.slice(mid), _depth: _depth + 1 });
  return [...left, ...right];
}

async function translateOneParagraph({
  modelId, userId, paragraph, sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary,
  intakeAnswers = {},
}) {
  const policy = languagePolicyBlock(targetLanguage, intakeAnswers);
  const system = `You are a professional document translator.
Translate the paragraph into ${langName(targetLanguage)}.
Preserve meaning, polarity, and sentence type. Obey the glossary.
${policy ? `\n${policy}\n` : ''}
Return ONLY valid JSON: { "translation": "..." }
No markdown fences.`;

  const prompt = [
    `Source language: ${sourceLanguage || 'auto'}`,
    `Target language: ${langName(targetLanguage)} (${targetLanguage})`,
    '',
    'Guidance:', guidance || '(none)',
    '',
    'Glossary:', buildGlossaryBlock(glossaryTerms),
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
    const res = await callModel(modelId, prompt, { maxTokens, system, returnUsage: true });
    if (userId) {
      logUsage({
        userId, model: modelId,
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        feature: 'translate_one',
      }).catch(() => {});
    }
    const parsed = parseModelJson(res.text);
    if (parsed?.translation && String(parsed.translation).trim()) {
      return String(parsed.translation).trim();
    }
    // Bare string / first recovered quoted string
    const arr = extractTranslationsArray(res.text, 1);
    if (arr?.[0]?.trim()) return String(arr[0]).trim();
    const cleaned = String(res.text || '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (cleaned && !cleaned.startsWith('{') && cleaned.length > 0) return cleaned;
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

  // ── 2. LLM review of ALL pairs in batches (side-by-side) ───────────────────
  const BATCH = 35;
  const llmAcc = {
    uncertainTerms: [],
    restructuredSentences: [],
    polarityOrSentenceTypeIssues: [],
    garbledOrIncompleteRows: [],
    audienceFlags: [],
    dialectalChoices: [],
    overallNotes: [],
  };

  for (let offset = 0; offset < allPairs.length; offset += BATCH) {
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
function applyGlossarySubstitutions(text, terms) {
  let t = String(text || '');
  const subs = (terms || []).filter((x) => !x.doNotTranslate && x.source && x.target);
  // Longer sources first
  subs.sort((a, b) => String(b.source).length - String(a.source).length);
  for (const sub of subs) {
    const escaped = String(sub.source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(escaped, 'gi'), sub.target);
  }
  return t;
}

module.exports = {
  proposeGlossary,
  translateParagraphBatch,
  reviewTranslation,
  applyGlossarySubstitutions,
  langName,
  hardSanityGate,
  runDeterministicCompletenessCheck,
};
