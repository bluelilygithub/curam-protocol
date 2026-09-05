#!/usr/bin/env node
/**
 * translateExtract.stitchFragments — unit tests (pure function, no API calls).
 * Run with:  node vault/server/services/translateExtract.test.js
 */

'use strict';

const assert = require('assert');
const { stitchFragments } = require('./translateExtract');

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

test('merges a fragment with no terminal punctuation into the next line', () => {
  const out = stitchFragments([
    'This will dislodge any loose dirt',
    'and debris before applying the product.',
  ]);
  assert.deepStrictEqual(out, [
    'This will dislodge any loose dirt and debris before applying the product.',
  ]);
});

test('does not merge when prior fragment ends in terminal punctuation', () => {
  const out = stitchFragments([
    'Any lapse in registration of your Nominated Vehicle will void this warranty.',
    'The warranty does not cover accidental damage.',
  ]);
  assert.strictEqual(out.length, 2);
});

test('merges even when next fragment is capitalised (capitalisation alone is not a sentence-start signal)', () => {
  const out = stitchFragments([
    'Nominated Vehicle means the vehicle listed above',
    'Warranty Schedule sets out the applicable terms.',
  ]);
  assert.deepStrictEqual(out, [
    'Nominated Vehicle means the vehicle listed above Warranty Schedule sets out the applicable terms.',
  ]);
});

test('merges a quoted defined term split mid-sentence despite capitalisation', () => {
  const out = stitchFragments(['("the', 'Product")']);
  assert.deepStrictEqual(out, ['("the Product")']);
});

test('merges a slash-broken compound term across the split', () => {
  const out = stitchFragments(['loss of use of your Nominated /', 'Vehicle will void this warranty.']);
  assert.deepStrictEqual(out, [
    'loss of use of your Nominated / Vehicle will void this warranty.',
  ]);
});

test('merges a dangling lowercase clause into the next capitalised noun phrase', () => {
  const out = stitchFragments(['afin que le', "L'évaluateur confirme le résultat."]);
  assert.deepStrictEqual(out, ["afin que le L'évaluateur confirme le résultat."]);
});

test('rejoins a mid-word hyphen break without a space', () => {
  const out = stitchFragments(['This requires re-', 'application within 90 days.']);
  assert.deepStrictEqual(out, ['This requires reapplication within 90 days.']);
});

test('rejoins a mid-word break using typeset hyphen variants, not just ASCII "-"', () => {
  // pdf-parse passes through whatever hyphen-like codepoint the PDF producer embedded —
  // a real regression seen in production used U+2010 HYPHEN here, not ASCII '-'.
  assert.deepStrictEqual(
    stitchFragments(['must not be re‐', 'sprayed without inspection.']),
    ['must not be resprayed without inspection.']
  );
  assert.deepStrictEqual(
    stitchFragments(['must not be re­', 'sprayed without inspection.']),
    ['must not be resprayed without inspection.']
  );
});

test('keeps standalone short form-field labels separate', () => {
  const out = stitchFragments(['Make', 'Model', 'Application Date']);
  assert.deepStrictEqual(out, ['Make', 'Model', 'Application Date']);
});

test('merges multi-fragment run-on across several lines', () => {
  const out = stitchFragments([
    'You are entitled to a replacement or refund for a major',
    'failure and compensation for any other reasonably',
    'foreseeable loss or damage.',
  ]);
  assert.deepStrictEqual(out, [
    'You are entitled to a replacement or refund for a major failure and compensation for any other reasonably foreseeable loss or damage.',
  ]);
});

test('preserves separate paragraphs when both end/start cleanly', () => {
  const out = stitchFragments([
    'Section 1: Definitions.',
    'Section 2: Warranty terms.',
  ]);
  assert.deepStrictEqual(out, [
    'Section 1: Definitions.',
    'Section 2: Warranty terms.',
  ]);
});

test('drops empty/whitespace-only fragments', () => {
  const out = stitchFragments(['Hello world.', '   ', '', 'Next line.']);
  assert.deepStrictEqual(out, ['Hello world.', 'Next line.']);
});

test('handles empty input array', () => {
  assert.deepStrictEqual(stitchFragments([]), []);
});

test('handles non-array input gracefully', () => {
  assert.deepStrictEqual(stitchFragments(undefined), []);
  assert.deepStrictEqual(stitchFragments(null), []);
});

test('does not merge across a fragment ending in a colon into a new capitalised clause', () => {
  const out = stitchFragments([
    'Definitions:',
    'Nominated Vehicle means the vehicle listed above.',
  ]);
  assert.strictEqual(out.length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
