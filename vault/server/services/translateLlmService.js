'use strict';

/**
 * Translate agent — LLM helpers (glossary prep, chunked translate, QA review).
 * Uses Vault callModel + user-selected translate/review models.
 */

const { callModel } = require('./callModel');
const { parseModelJson } = require('../utils/parseModelJson');
const { logUsage } = require('../utils/logUsage');

const LANG_NAMES = {
  en: 'English', fr: 'French', 'fr-CA': 'Canadian French', es: 'Spanish',
  de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', ru: 'Russian',
};

function langName(code) {
  return LANG_NAMES[code] || code;
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
  "guidance": "1-3 sentences of translator instructions from the intake answers"
}
Rules:
- Prefer established industry renderings over literal dictionary translations.
- Mark brand names, product codes, and "do not translate" items with doNotTranslate:true and empty target.
- Merge and respect any existing glossary terms provided (do not contradict them).
- Keep the list focused (typically 5–40 terms). No markdown fences.`;

  const prompt = [
    `Target language: ${langName(targetLanguage)} (${targetLanguage})`,
    '',
    'Intake answers from the user:',
    JSON.stringify(intakeAnswers || {}, null, 2),
    '',
    'Existing glossary terms (must honour):',
    JSON.stringify(existingTerms || [], null, 2),
    '',
    'Source document skim (beginning of extract):',
    String(sourceSkim || '').slice(0, 6000),
  ].join('\n');

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
    guidance: parsed.guidance || '',
  };
}

/**
 * Translate a batch of paragraphs. Returns array of strings same length as input.
 */
async function translateParagraphBatch({
  modelId, userId, paragraphs, sourceLanguage, targetLanguage, glossaryTerms, guidance, runningGlossary,
}) {
  const system = `You are a professional document translator.
Translate each numbered paragraph into ${langName(targetLanguage)}.
Preserve sentence type (statement vs question), polarity (affirmative vs negative), and meaning.
Obey the glossary exactly. Maintain terminology consistency with the running glossary.
Return ONLY valid JSON: { "translations": ["...", "..."] } with the same number of items, same order.
No commentary.`;

  const prompt = [
    `Source language: ${sourceLanguage || 'auto'}`,
    `Target language: ${langName(targetLanguage)} (${targetLanguage})`,
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

  const res = await callModel(modelId, prompt, {
    maxTokens: Math.min(8000, 800 + paragraphs.join('').length),
    system,
    returnUsage: true,
  });
  if (userId) {
    logUsage({
      userId, model: modelId,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      feature: 'translate_chunk',
    }).catch(() => {});
  }

  const parsed = parseModelJson(res.text);
  let translations = Array.isArray(parsed?.translations) ? parsed.translations : null;

  // Fallback: try line-split if model ignored JSON
  if (!translations || translations.length !== paragraphs.length) {
    const lines = String(res.text || '').split(/\n+/).map((l) => l.replace(/^\s*\[\d+\]\s*/, '').trim()).filter(Boolean);
    if (lines.length === paragraphs.length) translations = lines;
  }

  if (!translations || translations.length !== paragraphs.length) {
    // Last resort: return originals marked
    translations = paragraphs.map((p) => `[Translation incomplete] ${p}`);
  }

  return translations.map((t) => String(t || '').trim());
}

/**
 * Second-pass QA review. Returns structured summary for human review.
 */
async function reviewTranslation({
  modelId, userId, sourceLanguage, targetLanguage, pairs, glossaryTerms,
}) {
  const system = `You are a translation QA reviewer for business / compliance documents.
Read source and target pairs. Flag real problems only.
Return ONLY valid JSON:
{
  "uncertainTerms": [ { "source": "...", "renderedAs": "...", "issue": "..." } ],
  "restructuredSentences": [ { "source": "...", "target": "...", "why": "..." } ],
  "polarityOrSentenceTypeIssues": [ { "source": "...", "target": "...", "issue": "..." } ],
  "garbledOrIncompleteRows": [ { "excerpt": "...", "issue": "..." } ],
  "audienceFlags": [ { "target": "...", "issue": "why an auditor/stakeholder might be confused or alarmed" } ],
  "overallNotes": "2-4 sentences"
}
Be concise. Empty arrays are fine. No markdown fences.`;

  // Cap pairs to keep prompt bounded
  const sample = pairs.slice(0, 40);
  const prompt = [
    `Source language: ${sourceLanguage || 'auto'}`,
    `Target language: ${langName(targetLanguage)}`,
    '',
    'Glossary that should have been followed:',
    buildGlossaryBlock(glossaryTerms),
    '',
    'Pairs (source ⟶ target):',
    sample.map((p, i) => `${i + 1}. SRC: ${p.source}\n   TGT: ${p.target}`).join('\n\n'),
  ].join('\n');

  const res = await callModel(modelId, prompt, { maxTokens: 3000, system, returnUsage: true });
  if (userId) {
    logUsage({
      userId, model: modelId,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens,
      feature: 'translate_review',
    }).catch(() => {});
  }

  const parsed = parseModelJson(res.text) || {};
  return {
    uncertainTerms: parsed.uncertainTerms || [],
    restructuredSentences: parsed.restructuredSentences || [],
    polarityOrSentenceTypeIssues: parsed.polarityOrSentenceTypeIssues || [],
    garbledOrIncompleteRows: parsed.garbledOrIncompleteRows || [],
    audienceFlags: parsed.audienceFlags || [],
    overallNotes: parsed.overallNotes || '',
    reviewedPairCount: sample.length,
    totalPairCount: pairs.length,
  };
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
};
