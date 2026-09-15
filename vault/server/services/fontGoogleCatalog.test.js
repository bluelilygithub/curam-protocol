#!/usr/bin/env node
/**
 * Google Fonts catalog cache tests: OFL filtering excludes a known
 * non-OFL family (Roboto Slab), variable/static flags are correct, and
 * the cache is actually cached (repeat calls don't rebuild).
 *
 * Run: node server/services/fontGoogleCatalog.test.js
 */
'use strict';

const assert = require('assert');
const { getCatalog } = require('./fontGoogleCatalog');

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

async function main() {
  let catalog;

  await test('builds a catalog with a substantial number of OFL families', async () => {
    catalog = await getCatalog();
    assert.ok(catalog.count > 500, `expected >500 families, got ${catalog.count}`);
    assert.ok(Array.isArray(catalog.families));
  });

  await test('excludes a known non-OFL family (Roboto Slab is Apache-2.0)', () => {
    const present = catalog.families.some((f) => f.family === 'Roboto Slab');
    assert.strictEqual(present, false);
  });

  await test('includes a known OFL family with correct static/variable flags', () => {
    const ptSerif = catalog.families.find((f) => f.family === 'PT Serif');
    assert.ok(ptSerif, 'PT Serif should be in the catalog');
    assert.strictEqual(ptSerif.isVariable, false);

    const robotoFlex = catalog.families.find((f) => f.family === 'Roboto Flex');
    assert.ok(robotoFlex, 'Roboto Flex should be in the catalog');
    assert.strictEqual(robotoFlex.isVariable, true);
    assert.ok(robotoFlex.axisTags.includes('wght'));
  });

  await test('repeat calls hit the cache (same object, no rebuild)', async () => {
    const again = await getCatalog();
    assert.strictEqual(again, catalog);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error running tests:', err);
  process.exit(1);
});
