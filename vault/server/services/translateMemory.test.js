#!/usr/bin/env node
/**
 * translateMemory — isSafeToPersist unit tests (pure function, no DB connection needed for this
 * part — lookupExact/savePairs/bumpHitCounts/stats/exportTmx all touch the database and are not
 * covered here). Run with:
 *   node vault/server/services/translateMemory.test.js
 */

'use strict';

const assert = require('assert');
const { isSafeToPersist } = require('./translateMemory');

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

// Confirmed real gap: savePairs only rejected the literal "[Translation incomplete]"/
// "[Translation error]" prefix, not the full range of placeholder patterns
// translateQaChecks.findPlaceholder knows about. Because a TM-hit paragraph skips the LLM/repair
// pipeline entirely on reuse, a bad translation that slipped past the old narrower filter would
// self-perpetuate — flagged as garbled on every future job containing that paragraph, but never
// corrected, since the paragraph never goes back through translation to produce a fresh result.
test('rejects the literal "[Translation incomplete]" marker (already covered before this fix)', () => {
  assert.strictEqual(isSafeToPersist('source text', '[Translation incomplete] source text'), false);
});

test('rejects the literal "[Translation error]" marker', () => {
  assert.strictEqual(isSafeToPersist('source text', '[Translation error] source text'), false);
});

test('rejects a bracketed meta-commentary placeholder the old narrow filter would have missed', () => {
  // e.g. a model apologizing/explaining instead of translating — findPlaceholder catches this,
  // the old literal-prefix-only check did not.
  assert.strictEqual(isSafeToPersist('source text', '[unable to translate this content]'), false);
});

test('accepts a normal, complete translation', () => {
  assert.strictEqual(isSafeToPersist('Bonjour le monde', 'Hello world'), true);
});

test('rejects an empty or 1-character source/target', () => {
  assert.strictEqual(isSafeToPersist('', 'Hello'), false);
  assert.strictEqual(isSafeToPersist('Hello', ''), false);
  assert.strictEqual(isSafeToPersist('a', 'Hello'), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
