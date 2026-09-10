#!/usr/bin/env node
/**
 * translateLlmService — applyGlossarySubstitutions / autoFixGlossaryDrift unit tests
 * (pure functions, no API calls). Run with:
 *   node vault/server/services/translateLlmService.test.js
 */

'use strict';

const assert = require('assert');
const { applyGlossarySubstitutions, autoFixGlossaryDrift } = require('./translateLlmService');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
