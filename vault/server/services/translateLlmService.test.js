#!/usr/bin/env node
/**
 * translateLlmService — applyGlossarySubstitutions / autoFixGlossaryDrift unit tests
 * (pure functions, no API calls). Run with:
 *   node vault/server/services/translateLlmService.test.js
 */

'use strict';

const assert = require('assert');
const { applyGlossarySubstitutions, autoFixGlossaryDrift, autoFixPartialReoTermDrift, reportGlossaryDrift, collapseRepeatedGlossaryTarget, collapseRepeatedPhraseLoops, dropHallucinatedTerms, normalizeTermKey, mergeGlossaryTerms, computeReviewCoverage } = require('./translateLlmService');

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

// Confirmed on a real job: "Transmittal_2024-157_Scanned.pdf" became
// "Bordereau de transmission_2024-157_Scanned.pdf" — a filename that no longer exists on disk.
test('does not substitute a locked term inside a filename token', () => {
  const terms = [{ source: 'Transmittal', target: 'Bordereau de transmission' }];
  const text = 'Transmittal_2024-157_Scanned.pdf (Transmittal) - Low-quality scan';
  const out = applyGlossarySubstitutions(text, terms);
  assert.ok(out.includes('Transmittal_2024-157_Scanned.pdf'), `filename was altered: ${out}`);
  assert.ok(out.includes('(Bordereau de transmission)'), `prose reference wasn't translated: ${out}`);
});

test('still substitutes the term normally when no filename is present', () => {
  const terms = [{ source: 'Tier', target: 'Palier' }];
  const out = applyGlossarySubstitutions('Tier 1: Time Savings', terms);
  assert.strictEqual(out, 'Palier 1: Time Savings');
});

test('protects multiple filename tokens with different extensions in the same string', () => {
  const terms = [{ source: 'Report', target: 'Rapport' }];
  const text = 'See Report_2024.pdf and Report_summary.xlsx for details.';
  const out = applyGlossarySubstitutions(text, terms);
  assert.ok(out.includes('Report_2024.pdf'), `pdf filename altered: ${out}`);
  assert.ok(out.includes('Report_summary.xlsx'), `xlsx filename altered: ${out}`);
});

// autoFixGlossaryDrift — confirmed real case: "Tier" locked to "Palier" but one chunk left it
// as literal English inside the French target.
test('autoFixGlossaryDrift repairs an untranslated-leftover drift', () => {
  const pairs = [
    { source: 'Tier 1: Time Savings', target: 'Palier 1 : Économies de temps' },
    { source: 'Tier 2: Error Reduction', target: 'Tier 2 : Réduction des erreurs' },
  ];
  const { fixedCount, remainingTerms } = autoFixGlossaryDrift({
    pairs, glossaryTerms: [{ source: 'Tier', target: 'Palier' }],
  });
  assert.strictEqual(fixedCount, 1);
  assert.strictEqual(pairs[1].target, 'Palier 2 : Réduction des erreurs');
  assert.strictEqual(remainingTerms.length, 0);
});

test('autoFixGlossaryDrift reports (does not guess) a non-leftover drift', () => {
  const pairs = [
    { source: 'Tier 1: Time Savings', target: 'Niveau 1 : Économies de temps' }, // different synonym, not a leftover
  ];
  const { fixedCount, remainingTerms } = autoFixGlossaryDrift({
    pairs, glossaryTerms: [{ source: 'Tier', target: 'Palier' }],
  });
  assert.strictEqual(fixedCount, 0);
  assert.strictEqual(remainingTerms.length, 1);
  assert.strictEqual(remainingTerms[0].source, 'Tier');
});

// collapseRepeatedGlossaryTarget — confirmed real case: proposeGlossary's LLM call degenerated
// on a "X / Y" bilingual gloss for te reo Māori terms, repeating its own alternatives several
// times over ("treasure / cherished taonga" -> "treasure / cherished treasure / cherished
// treasure / cherished taonga"), and applyGlossarySubstitutions pasted it in verbatim.
test('collapses a garbled recursive gloss to first + last alternative', () => {
  const out = collapseRepeatedGlossaryTarget(
    'treasure / cherished treasure / cherished treasure / cherished taonga',
  );
  assert.strictEqual(out, 'treasure / cherished taonga');
});

test('collapses a shorter garbled chain the same way', () => {
  const out = collapseRepeatedGlossaryTarget('iwi / tribe / tribe / tribe / tribes');
  assert.strictEqual(out, 'iwi / tribes');
});

test('leaves a normal 2-alternative gloss untouched', () => {
  assert.strictEqual(collapseRepeatedGlossaryTarget('research / studies'), 'research / studies');
});

test('leaves a single plain target untouched', () => {
  assert.strictEqual(collapseRepeatedGlossaryTarget('Palier'), 'Palier');
});

test('applyGlossarySubstitutions sanitizes a garbled target before substituting', () => {
  const terms = [{ source: 'taonga', target: 'treasure / cherished treasure / cherished treasure / cherished taonga' }];
  const out = applyGlossarySubstitutions('This taonga is precious.', terms);
  assert.strictEqual(out, 'This treasure / cherished taonga is precious.');
});

// collapseRepeatedPhraseLoops — confirmed real case: the TRANSLATOR MODEL's own raw output
// (not a glossary-substitution leak — collapseRepeatedGlossaryTarget doesn't touch this) grew a
// repetition-loop over a later run of the same document: "treasure / cherished treasure /
// cherished treasure / cherished treasure / cherished treasure / cherished treasure / cherished
// taonga" (6 repeats of "cherished treasure"). This is a general guard applied inside
// applyGlossarySubstitutions to every translated segment, regardless of where the loop came from.
test('collapses a real 6x repetition-loop in translated prose', () => {
  const out = collapseRepeatedPhraseLoops(
    'The Māori language is a treasure / cherished treasure / cherished treasure / cherished treasure / cherished treasure / cherished treasure / cherished taonga passed down.',
  );
  assert.strictEqual(out, 'The Māori language is a treasure / cherished treasure / cherished taonga passed down.');
});

test('collapses a repetition-loop with a differently-worded trailing segment', () => {
  const out = collapseRepeatedPhraseLoops('deeply precious to Māori iwi / tribe / tribe / tribe / tribe / tribe (tribe) and to Aotearoa');
  assert.strictEqual(out, 'deeply precious to Māori iwi / tribe (tribe) and to Aotearoa');
});

test('leaves a normal 2-alternative gloss (no repetition) untouched', () => {
  const text = 'a normal research / studies phrase stays put';
  assert.strictEqual(collapseRepeatedPhraseLoops(text), text);
});

// Threshold is "any consecutive exact duplicate", not "3+ occurrences" — a real 2-way gloss
// always has two DIFFERENT alternatives, so two IDENTICAL consecutive segments can never be
// legitimate. Confirmed on a real job: "iwi / tribe / tribe" (only 2 occurrences of "tribe")
// needed collapsing too, not just longer 3+ chains.
test('collapses just 2 identical consecutive occurrences (no false-positive risk)', () => {
  assert.strictEqual(
    collapseRepeatedPhraseLoops('deeply precious to iwi / tribe / tribe and to Aotearoa'),
    'deeply precious to iwi / tribe and to Aotearoa',
  );
});

test('applyGlossarySubstitutions also catches a repetition-loop that never involved substitution', () => {
  // No glossary term matches this text at all — the loop guard must still fire on plain input.
  const out = applyGlossarySubstitutions(
    'a treasure / cherished treasure / cherished treasure / cherished treasure / cherished taonga result', [],
  );
  assert.strictEqual(out, 'a treasure / cherished treasure / cherished taonga result');
  assert.ok(!out.includes('cherished treasure / cherished treasure'), `loop not collapsed: ${out}`);
});

// dropHallucinatedTerms — confirmed real case from a QA "Lessons learnt" report: locked terms
// "ōrero", "ānui", "ītori", "ātou" were flagged as an "enforcement gap" (seen in 9 jobs — most
// rows "didn't use" the locked rendering). Investigated: those aren't real words. They're
// truncated fragments of "kōrero", "whānui", "hītori", "rātou" — the same dropped-leading-
// consonant-before-a-macron-vowel LLM generation defect documented elsewhere in this file, just
// showing up in a glossary term this time instead of a QA uncertain-term listing. No amount of
// "enforcement" can make a translator consistently use a rendering for a word that isn't in the
// document — the real fix is to never lock a term that doesn't verbatim exist in the source.
const MAORI_SOURCE_SAMPLE = 'He taonga tuku iho te reo Māori. Ka kōrero ngā tāngata i ēnei rā mō ō rātou take, mō te whānui o te motu, mō te hītori o te reo.';

test('dropHallucinatedTerms keeps a real word that appears in the source', () => {
  const out = dropHallucinatedTerms([{ source: 'kōrero', target: 'speech' }], MAORI_SOURCE_SAMPLE);
  assert.strictEqual(out.length, 1);
});

test('dropHallucinatedTerms keeps another real word (ēnei)', () => {
  const out = dropHallucinatedTerms([{ source: 'ēnei', target: 'these' }], MAORI_SOURCE_SAMPLE);
  assert.strictEqual(out.length, 1);
});

test('dropHallucinatedTerms drops a truncated fragment of "kōrero"', () => {
  const out = dropHallucinatedTerms([{ source: 'ōrero', target: 'speech / language' }], MAORI_SOURCE_SAMPLE);
  assert.strictEqual(out.length, 0);
});

test('dropHallucinatedTerms drops a truncated fragment of "whānui"', () => {
  const out = dropHallucinatedTerms([{ source: 'ānui', target: 'widely / broadly' }], MAORI_SOURCE_SAMPLE);
  assert.strictEqual(out.length, 0);
});

test('dropHallucinatedTerms drops a truncated fragment of "hītori"', () => {
  const out = dropHallucinatedTerms([{ source: 'ītori', target: 'history' }], MAORI_SOURCE_SAMPLE);
  assert.strictEqual(out.length, 0);
});

test('dropHallucinatedTerms drops a truncated fragment of "rātou"', () => {
  const out = dropHallucinatedTerms([{ source: 'ātou', target: 'your / their' }], MAORI_SOURCE_SAMPLE);
  assert.strictEqual(out.length, 0);
});

test('dropHallucinatedTerms filters a mixed list, keeping only real words', () => {
  const terms = [
    { source: 'kōrero', target: 'speech' },
    { source: 'ōrero', target: 'speech / language' },
    { source: 'ēnei', target: 'these' },
    { source: 'ātou', target: 'your / their' },
  ];
  const out = dropHallucinatedTerms(terms, MAORI_SOURCE_SAMPLE).map((t) => t.source);
  assert.deepStrictEqual(out, ['kōrero', 'ēnei']);
});

// autoFixPartialReoTermDrift — confirmed on a real job, benchmarked against Google Translate on
// the same document: a do-not-translate term shaped "<prefix> Reo <Language>" gets partially
// obeyed — the model leaves <prefix> alone but still renders the embedded "Reo <Language>" as
// its normal English gloss "<Language> language" ("Tāone Reo Māori" -> "Tāone Māori language",
// "Te Wiki o te Reo Māori" -> "Te Wiki o te Māori language"). Both this pipeline AND Google made
// the identical hybrid error at the identical sentence (a shared MT weakness, not unique to this
// tool) — but this pipeline additionally flip-flopped between 3 different renderings of the same
// term across one document, unlike Google's one (still wrong) consistent choice. This closes
// that consistency gap.
const REO_TERMS = [
  { source: 'Te Wiki o te Reo Māori', target: '', doNotTranslate: true },
  { source: 'Tāone Reo Māori', target: '', doNotTranslate: true },
];

test('autoFixPartialReoTermDrift repairs "Te Wiki o te Māori language" back to the canonical term', () => {
  const pairs = [{
    source: 'I tēnei tau, e ahu ana Te Wiki o te Reo Māori ki tō tāone!',
    target: 'This year, Te Wiki o te Māori language is coming to your town!',
  }];
  const { fixedCount } = autoFixPartialReoTermDrift({ pairs, glossaryTerms: REO_TERMS });
  assert.strictEqual(fixedCount, 1);
  assert.strictEqual(pairs[0].target, 'This year, Te Wiki o te Reo Māori is coming to your town!');
});

test('autoFixPartialReoTermDrift repairs the shorter "Tāone Māori language" hybrid too', () => {
  const pairs = [{
    source: "Tohua tō tāone hei 'Tāone Reo Māori'",
    target: "Designate your town as a 'Tāone Māori language'",
  }];
  const { fixedCount } = autoFixPartialReoTermDrift({ pairs, glossaryTerms: REO_TERMS });
  assert.strictEqual(fixedCount, 1);
  assert.strictEqual(pairs[0].target, "Designate your town as a 'Tāone Reo Māori'");
});

test('autoFixPartialReoTermDrift leaves an already-correct rendering untouched', () => {
  const pairs = [{ source: 'unrelated', target: 'Te Wiki o te Reo Māori stays correct here' }];
  const { fixedCount } = autoFixPartialReoTermDrift({ pairs, glossaryTerms: REO_TERMS });
  assert.strictEqual(fixedCount, 0);
  assert.strictEqual(pairs[0].target, 'Te Wiki o te Reo Māori stays correct here');
});

test('autoFixPartialReoTermDrift ignores terms with no "Reo <Language>" shape', () => {
  const pairs = [{ source: 'x', target: 'Kōhanga Reo language school' }];
  const { fixedCount } = autoFixPartialReoTermDrift({
    pairs, glossaryTerms: [{ source: 'Kōhanga Reo', target: '', doNotTranslate: true }],
  });
  assert.strictEqual(fixedCount, 0);
});

// boundedPhraseRegex / Unicode-safe boundaries — confirmed real gap: reportGlossaryDrift,
// autoFixGlossaryDrift, and autoFixPartialReoTermDrift all used plain `\b`, which doesn't fire
// before/after a macron'd character. A glossary term starting or ending with one (e.g. "Ōtākou")
// silently never matched at all in these three functions — drift went undetected/unfixed with a
// false "clean" QA signal, worse than not checking, since it looks like nothing was ever wrong.
test('autoFixGlossaryDrift detects and fixes a leak for a term starting with a macron', () => {
  const pairs = [{ source: 'Kei te haere mai a Ōtākou', target: 'Ōtākou is arriving' }];
  const terms = [{ source: 'Ōtākou', target: 'The Otago Peninsula' }];
  const { fixedCount, remainingTerms } = autoFixGlossaryDrift({ pairs, glossaryTerms: terms });
  assert.strictEqual(fixedCount, 1);
  assert.strictEqual(remainingTerms.length, 0);
  assert.strictEqual(pairs[0].target, 'The Otago Peninsula is arriving');
});

test('reportGlossaryDrift detects drift for a term ending with a macron', () => {
  const pairs = [{ source: 'He kōrero mō Whanganui-a-Tara', target: 'A discussion about the capital' }];
  const terms = [{ source: 'Whanganui-a-Tara', target: 'Wellington' }];
  const { checked, terms: drifted } = reportGlossaryDrift({ pairs, glossaryTerms: terms });
  assert.strictEqual(checked, 1);
  assert.strictEqual(drifted.length, 1);
  assert.strictEqual(drifted[0].source, 'Whanganui-a-Tara');
});

test('autoFixPartialReoTermDrift still repairs a hybrid when the prefix itself is macron-bounded', () => {
  const pairs = [{ source: 'x', target: 'Ōpōtiki Māori language event' }];
  const terms = [{ source: 'Ōpōtiki Reo Māori', target: '', doNotTranslate: true }];
  const { fixedCount } = autoFixPartialReoTermDrift({ pairs, glossaryTerms: terms });
  assert.strictEqual(fixedCount, 1);
  assert.strictEqual(pairs[0].target, 'Ōpōtiki Reo Māori event');
});

// normalizeTermKey / mergeGlossaryTerms dedup — a precomposed macron'd word (e.g. "ko" + U+014D
// "rero", i.e. a single precomposed codepoint for "o") and its combining-diacritic form (base
// "o" + U+0304 combining macron) render visually identical but are different strings to plain
// .toLowerCase(). Without NFKC normalization first, two glossary entries for what's visually the
// same term would be treated as different keys and NOT deduped — OCR output is a plausible
// source of the decomposed form, so this could silently double glossary entries over time.
// Built via String.fromCodePoint, not typed macron characters, to guarantee the two strings are
// actually byte-distinct rather than both accidentally normalizing to the same sequence when
// this file itself is saved/read.
const PRECOMPOSED_KORERO = `ko${String.fromCodePoint(0x014d)}rero`;
const DECOMPOSED_KORERO = `ko${String.fromCodePoint(0x006f, 0x0304)}rero`;

test('normalizeTermKey treats precomposed and decomposed macron forms as the same key', () => {
  assert.notStrictEqual(PRECOMPOSED_KORERO, DECOMPOSED_KORERO); // confirm they really are different strings first
  assert.strictEqual(normalizeTermKey(PRECOMPOSED_KORERO), normalizeTermKey(DECOMPOSED_KORERO));
});

test('mergeGlossaryTerms dedupes precomposed vs decomposed forms of the same term', () => {
  const merged = mergeGlossaryTerms(
    [{ source: PRECOMPOSED_KORERO, target: 'speech' }],
    [{ source: DECOMPOSED_KORERO, target: 'language' }],
  );
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].target, 'speech'); // first list wins, same as existing merge semantics
});

// computeReviewCoverage — confirmed real gap: reviewTranslation's summary set reviewedPairCount
// to the FULL pair count regardless of whether a review batch's LLM call actually failed,
// falsely implying every segment got subjective QA review (polarity, uncertain terms, etc.) when
// a whole batch's worth never did.
test('computeReviewCoverage reports full coverage when no batch failed', () => {
  const result = computeReviewCoverage(100, []);
  assert.deepStrictEqual(result, {
    reviewedPairCount: 100, unreviewedPairCount: 0, reviewCoverageIncomplete: false,
  });
});

test('computeReviewCoverage subtracts failed-batch pairs instead of claiming full coverage', () => {
  const result = computeReviewCoverage(100, [35]); // one 35-pair batch failed
  assert.deepStrictEqual(result, {
    reviewedPairCount: 65, unreviewedPairCount: 35, reviewCoverageIncomplete: true,
  });
});

test('computeReviewCoverage sums multiple failed batches', () => {
  const result = computeReviewCoverage(100, [35, 35]);
  assert.deepStrictEqual(result, {
    reviewedPairCount: 30, unreviewedPairCount: 70, reviewCoverageIncomplete: true,
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
