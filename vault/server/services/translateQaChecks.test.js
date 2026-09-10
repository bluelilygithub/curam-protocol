#!/usr/bin/env node
/**
 * translateQaChecks.detectRepeatedTermCandidates — unit tests (pure function, no API calls).
 * Run with:  node vault/server/services/translateQaChecks.test.js
 */

'use strict';

const assert = require('assert');
const { detectRepeatedTermCandidates, hasStraySourceWord, hardSanityGate, findPlaceholder } = require('./translateQaChecks');

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

test('detects a recurring mid-sentence phrase as a candidate', () => {
  const paras = {
    1: [
      'Any lapse in registration of your Nominated Vehicle will void this warranty.',
      'You must maintain your Nominated Vehicle in good condition at all times.',
      'Loss of use of your Nominated Vehicle is not covered.',
    ],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(terms.includes('Nominated Vehicle'), `expected Nominated Vehicle in ${JSON.stringify(terms)}`);
});

test('detects a recurring single capitalised word used as a defined term', () => {
  const paras = {
    1: [
      'A Valid Warranty Claim must be made within the Period.',
      'Claims made after the Period will not be honoured.',
      'The Period begins on the Application Date and ends after 12 months from the Period start.',
    ],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(terms.includes('Period'), `expected Period in ${JSON.stringify(terms)}`);
});

test('detects a term only ever introduced via a definition-clause marker (paragraph-initial every time)', () => {
  // This is the exact pattern that evaded detection before the definition-marker signal was
  // added: the term is always at the start of its own defining paragraph, never mid-sentence.
  const paras = {
    1: [
      'Warranty Schedule means the document attached as Schedule 3 to this warranty.',
      'Some unrelated clause about registration requirements.',
      'Another unrelated clause about the claims process.',
    ],
  };
  const out = detectRepeatedTermCandidates(paras, [], { minCount: 1 });
  const terms = out.map((c) => c.term);
  assert.ok(terms.includes('Warranty Schedule'), `expected Warranty Schedule in ${JSON.stringify(terms)}`);
});

test('detects a standalone recurring field-label paragraph even with zero mid-sentence occurrences', () => {
  const paras = {
    1: ['Application Term', 'Some other unrelated paragraph.', 'Application Term', 'Application Term'],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(terms.includes('Application Term'), `expected Application Term in ${JSON.stringify(terms)}`);
});

test('rejects a trivial short word even if it recurs as its own line', () => {
  // Confirmed on a real QA run: "If" recurring as an isolated line (a PDF line-wrap fragment
  // from repeated "If the warranty claim is valid..." conditional clauses) qualified via the
  // standalone-paragraph signal and got locked into the glossary as "If" -> "Si". Because
  // applyGlossarySubstitutions matches the locked source as a bare substring, every occurrence
  // of "if" inside an unrelated French word in the target text was corrupted too (e.g.
  // "différend" -> "dSiférend", "modifiées" -> "modSiiées"). A candidate this short should never
  // reach the glossary regardless of how often it recurs.
  const paras = {
    1: ['If', 'Some unrelated clause about registration requirements.', 'If', 'If'],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(!terms.includes('If'), `did not expect "If" in ${JSON.stringify(terms)}`);
});

test('does not flag ordinary sentence-initial capitalisation', () => {
  const paras = {
    1: [
      'The vehicle must be registered.',
      'The owner must maintain records.',
      'The warranty does not cover misuse.',
    ],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(!terms.includes('The'), `did not expect sentence-initial "The" in ${JSON.stringify(terms)}`);
});

test('skips terms already in the existing glossary', () => {
  const paras = {
    1: [
      'Diamond Plate warrants the Product against defects.',
      'This Diamond Plate warranty applies to the Product only.',
      'Diamond Plate reserves the right to inspect the Product.',
    ],
  };
  const out = detectRepeatedTermCandidates(paras, [{ source: 'Diamond Plate', target: 'Diamond Plate', doNotTranslate: true }]);
  const terms = out.map((c) => c.term);
  assert.ok(!terms.includes('Diamond Plate'), `expected Diamond Plate to be excluded, got ${JSON.stringify(terms)}`);
});

test('requires at least minCount total occurrences', () => {
  const paras = {
    1: [
      'This covers the Warranty Schedule once only.',
    ],
  };
  const out = detectRepeatedTermCandidates(paras, [], { minCount: 3 });
  assert.deepStrictEqual(out, []);
});

test('respects the limit option', () => {
  const paras = { 1: [] };
  for (let i = 0; i < 20; i += 1) {
    paras[1].push(`Term this Alpha${i} Beta${i} Gamma${i} in the middle of a sentence.`);
    paras[1].push(`Again this Alpha${i} Beta${i} Gamma${i} shows up mid sentence.`);
    paras[1].push(`Once more the Alpha${i} Beta${i} Gamma${i} recurs here too.`);
  }
  const out = detectRepeatedTermCandidates(paras, [], { limit: 5 });
  assert.ok(out.length <= 5, `expected at most 5, got ${out.length}`);
});

test('handles empty paragraphsByPage', () => {
  assert.deepStrictEqual(detectRepeatedTermCandidates({}, []), []);
  assert.deepStrictEqual(detectRepeatedTermCandidates(undefined, []), []);
});

// Confirmed missed on a real feasibility-report translation job: CAPITALIZED_RUN_RE requires
// the initial capital to be followed by lowercase letters, so an ALL-CAPS status word like
// "PASS" never matched it at all (the regex would only capture the leading "P").
test('detects a recurring ALL-CAPS status word even though it never matches the Title-Case pattern', () => {
  const paras = {
    1: ['Field Accuracy 96.2% PASS', 'STP Rate 92.5% PASS', 'Exceptions 11 REVIEW'],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(terms.includes('PASS'), `expected PASS in ${JSON.stringify(terms)}`);
});

// Confirmed missed on the same job: "Tier 1" / "Tier 2" recur exactly twice each, spread across
// a table row and a heading — below the old minCount=3 floor even though the pattern itself
// (a Title-Case word directly followed by a small number) is a strong recurring-label signal.
test('detects a "Word N" numbered-label pattern on just two occurrences', () => {
  const paras = {
    1: ['Tier 1: Time Savings', 'Tier 2: Error Reduction'],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(terms.includes('Tier'), `expected Tier in ${JSON.stringify(terms)}`);
});

// A legitimate technical acronym (ERP) must not be swept up by the status-word/numbered-label
// signals just because it's short and capitalized — it should still need the normal prose signals.
test('does not auto-qualify an ordinary acronym as a status word', () => {
  const paras = {
    1: ['The ERP system needs API integration.', 'Confirm the ERP system supports API calls.'],
  };
  const out = detectRepeatedTermCandidates(paras, []);
  const terms = out.map((c) => c.term);
  assert.ok(!terms.includes('ERP'), `did not expect ERP in ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes('API'), `did not expect API in ${JSON.stringify(terms)}`);
});

// hasStraySourceWord — confirmed real false-positive: a do-not-translate term like
// "Fair and Square Ltd" left correctly untranslated verbatim contains "and", a genuine denylist
// word that's also genuinely present in the source — without masking DNT spans first, this
// flagged an entirely correct segment as having a stray untranslated word, which caused
// repairIncompletePairs to needlessly (and riskily) re-translate it.
test('does not flag "and" inside a correctly-preserved do-not-translate term', () => {
  const source = 'Fair and Square Ltd was founded in 1990.';
  const target = 'Fair and Square Ltd a été fondée en 1990.';
  const result = hasStraySourceWord(source, target, {
    sourceLanguage: 'en', targetLanguage: 'fr',
    glossaryTerms: [{ source: 'Fair and Square Ltd', doNotTranslate: true }],
  });
  assert.strictEqual(result, null);
});

test('still flags a genuine stray word outside any do-not-translate span', () => {
  const source = 'Several people were hurt during the event.';
  const target = 'Plusieurs personnes ont été hurt pendant l\'événement.';
  const result = hasStraySourceWord(source, target, {
    sourceLanguage: 'en', targetLanguage: 'fr',
    glossaryTerms: [{ source: 'Fair and Square Ltd', doNotTranslate: true }], // unrelated DNT term present
  });
  assert.strictEqual(result, 'hurt');
});

test('still flags a stray word with no glossaryTerms at all (backward compatible)', () => {
  const source = 'Several people were hurt during the event.';
  const target = 'Plusieurs personnes ont été hurt pendant l\'événement.';
  const result = hasStraySourceWord(source, target, { sourceLanguage: 'en', targetLanguage: 'fr' });
  assert.strictEqual(result, 'hurt');
});

// hardSanityGate placeholder threshold — confirmed real gap: a job with 10-13% of segments still
// reading "[Translation incomplete] <source>" after both repair attempts failed soft-passed
// under the old 25% ratio threshold, shipping real broken text into the PDF with only a QA-report
// footnote to catch it.
function makePairs(okCount, badCount) {
  const pairs = [];
  for (let i = 0; i < okCount; i++) pairs.push({ source: `ok sentence ${i}`, target: `translated ok sentence ${i}` });
  for (let i = 0; i < badCount; i++) pairs.push({ source: `bad ${i}`, target: `[Translation incomplete] bad ${i}` });
  return pairs;
}

test('hardSanityGate hard-fails a realistic document with 10-13% placeholder segments', () => {
  // 30 segments, 4 bad = 13.3% — the exact real-world scenario this threshold exists to catch.
  const gate = hardSanityGate(makePairs(26, 4), {});
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.code, 'placeholders_present');
});

test('hardSanityGate does not hard-fail a tiny document on ratio alone below the absolute floor', () => {
  // 1 bad out of 5 is 20% — well above the ratio threshold — but only 1 failing segment, below
  // the absolute floor (3), so a small document doesn't hard-fail on one unlucky paragraph.
  const gate = hardSanityGate(makePairs(4, 1), {});
  assert.strictEqual(gate.ok, true);
});

test('hardSanityGate hard-fails when repairStillFailing reaches the absolute count, regardless of ratio', () => {
  // Otherwise-clean document (0% placeholder ratio) but repairIncompletePairs reported 2
  // segments that survived BOTH independent repair attempts — a stronger signal than ratio alone.
  const gate = hardSanityGate(makePairs(20, 0), { repairStillFailing: 2 });
  assert.strictEqual(gate.ok, false);
  assert.strictEqual(gate.code, 'repair_still_failing');
});

test('hardSanityGate passes a clean document with repairStillFailing below the count threshold', () => {
  const gate = hardSanityGate(makePairs(20, 0), { repairStillFailing: 1 });
  assert.strictEqual(gate.ok, true);
});

// SERIOUS CONFIRMED REGRESSION, fixed — findPlaceholder's bare (unbracketed) TBD/TODO/N-A
// patterns matched completely ordinary, legitimate English business content, not just genuine
// leftover placeholder markup. Combined with hardSanityGate's lowered hard-fail threshold, a
// routine document with a few "N/A" form fields could hard-fail entirely (no PDF generated) for
// content that was translated correctly. None of these three had a "confirmed on a real job"
// citation like every other entry in PLACEHOLDER_PATTERNS — a red flag they were unverified.
test('does not flag ordinary business sentences containing TBD or TODO as a placeholder', () => {
  assert.strictEqual(findPlaceholder('The launch date is still TBD.'), null);
  assert.strictEqual(findPlaceholder('Please review the TODO list before the meeting.'), null);
});

test('does not flag a legitimate "N/A" field value as a placeholder', () => {
  assert.strictEqual(findPlaceholder('N/A'), null);
  assert.strictEqual(findPlaceholder('Status: N/A'), null);
  assert.strictEqual(findPlaceholder('Q1 revenue: N/A'), null);
});

test('still flags the bracketed [TBD]/[TODO] template-marker forms — genuine leftover markup', () => {
  assert.strictEqual(findPlaceholder('[TBD]'), '[TBD]');
  assert.strictEqual(findPlaceholder('[TODO]'), '[TODO]');
});

test('still flags a genuine incomplete-translation marker', () => {
  assert.strictEqual(findPlaceholder('[Translation incomplete] some text'), '[Translation incomplete]');
});

// The realistic scenario this whole fix exists for: a routine document with a few legitimate
// "N/A" cells must not hard-fail just because it crossed the (correctly) tightened threshold.
test('hardSanityGate does not hard-fail a routine document with legitimate N/A form fields', () => {
  const pairs = [];
  for (let i = 0; i < 17; i++) pairs.push({ source: `Field ${i} value`, target: `Valeur du champ ${i}` });
  for (let i = 0; i < 3; i++) pairs.push({ source: 'Not applicable', target: 'N/A' });
  const gate = hardSanityGate(pairs, {});
  assert.strictEqual(gate.ok, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
