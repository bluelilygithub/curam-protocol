#!/usr/bin/env node
/**
 * translateQaChecks.detectRepeatedTermCandidates — unit tests (pure function, no API calls).
 * Run with:  node vault/server/services/translateQaChecks.test.js
 */

'use strict';

const assert = require('assert');
const { detectRepeatedTermCandidates } = require('./translateQaChecks');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
