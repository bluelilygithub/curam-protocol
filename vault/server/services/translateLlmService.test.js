#!/usr/bin/env node
/**
 * translateLlmService — applyGlossarySubstitutions / autoFixGlossaryDrift unit tests
 * (pure functions, no API calls). Run with:
 *   node vault/server/services/translateLlmService.test.js
 */

'use strict';

const assert = require('assert');
const { applyGlossarySubstitutions, autoFixGlossaryDrift, collapseRepeatedGlossaryTarget, collapseRepeatedPhraseLoops } = require('./translateLlmService');

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

test('applyGlossarySubstitutions also catches a repetition-loop that never involved substitution', () => {
  // No glossary term matches this text at all — the loop guard must still fire on plain input.
  // 3+ repeats required to trigger (2 total is a legitimate one-off "X / Y" gloss, not a loop).
  const out = applyGlossarySubstitutions(
    'a treasure / cherished treasure / cherished treasure / cherished treasure / cherished taonga result', [],
  );
  assert.strictEqual(out, 'a treasure / cherished treasure / cherished taonga result');
  assert.ok(!out.includes('cherished treasure / cherished treasure'), `loop not collapsed: ${out}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
