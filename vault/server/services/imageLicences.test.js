#!/usr/bin/env node
/**
 * The licence filter (spec 6.2, tested with sample metadata for every licence code). Hard rule: NC, ND and unknown licences are rejected by
 * default, share-alike is display-only and never used for cut-outs. Run: node server/services/imageLicences.test.js
 */
'use strict';
const assert = require('assert');
const { classifyLicence, mayModify, DEFAULT_ALLOWED } = require('./imageLicences');

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const c = (raw, o = {}) => classifyLicence(raw, { env: {}, ...o });
const iNat = { sourceDefaultVersion: '4.0' };

test('allowed by default: CC0, public domain, CC BY 2.5 AU / 3.0 AU / 4.0 / 4.0 AU', () => {
  for (const raw of ['CC0', 'cc0', 'CC0 1.0', 'Public domain', 'PDM', 'CC BY 2.5 AU', 'CC-BY 3.0 (Au)', 'CC BY 4.0', 'CC-BY 4.0 (Int)', 'CC BY 4.0 AU', 'https://creativecommons.org/licenses/by/4.0/', 'https://creativecommons.org/licenses/by/3.0/au/', 'https://creativecommons.org/publicdomain/zero/1.0/']) {
    const r = c(raw);
    assert.strictEqual(r.allowed, true, `${raw} -> ${r.code}: ${r.reason}`);
    assert.strictEqual(r.displayOnly, false, raw);
    assert.strictEqual(mayModify(r), true, `${raw} may be modified`);
  }
});

test('share-alike (CC BY-SA) is allowed for display only, and is NEVER usable for cut-outs or modified copies', () => {
  for (const raw of ['CC BY-SA 4.0', 'CC-BY-SA 4.0 (Int)', 'CC BY-SA 3.0 AU', 'cc-by-sa', 'https://creativecommons.org/licenses/by-sa/4.0']) {
    const r = c(raw, iNat);
    assert.strictEqual(r.allowed, true, raw);
    assert.strictEqual(r.displayOnly, true, raw);
    assert.strictEqual(mayModify(r), false, `${raw} must never be cut out`);
  }
});

test('every non-commercial licence is rejected by default', () => {
  for (const raw of ['CC BY-NC 4.0', 'CC-BY-NC 4.0 (Int)', 'CC BY-NC-SA 4.0', 'CC-BY-NC 3.0 (Au)', 'cc-by-nc', 'cc-by-nc-sa', 'https://creativecommons.org/licenses/by-nc/4.0/']) {
    const r = c(raw, iNat);
    assert.strictEqual(r.allowed, false, raw);
    assert.strictEqual(r.nonCommercial, true, raw);
    assert.match(r.reason, /non-commercial/);
  }
});

test('ALLOW_NONCOMMERCIAL switches NC on (still never usable for cut-outs); ND stays excluded either way', () => {
  const on = { allowNonCommercial: true, ...iNat };
  assert.strictEqual(c('CC BY-NC 4.0', on).allowed, true);
  assert.strictEqual(c('cc-by-nc-sa', on).allowed, true);
  assert.strictEqual(mayModify(c('CC BY-NC 4.0', on)), false);
  assert.match(c('CC BY-NC 4.0', on).reason, /non-commercial use is switched on/);
  assert.strictEqual(c('CC BY-NC 2.0', on).allowed, false, 'a version not on the list is still refused');
  assert.strictEqual(classifyLicence('CC BY-NC 4.0', { env: { ALLOW_NONCOMMERCIAL: 'true' } }).allowed, true, 'read from the environment');
  assert.strictEqual(classifyLicence('CC BY-NC 4.0', { env: { ALLOW_NONCOMMERCIAL: 'false' } }).allowed, false);
});

test('every no-derivatives licence is rejected, with or without the non-commercial switch', () => {
  for (const raw of ['CC BY-ND 4.0', 'CC-BY-NC-ND 4.0 (Int)', 'cc-by-nd', 'https://creativecommons.org/licenses/by-nd/4.0/']) {
    assert.strictEqual(c(raw, iNat).allowed, false, raw);
    assert.strictEqual(c(raw, { allowNonCommercial: true, ...iNat }).allowed, false, `${raw} even with NC on`);
    assert.match(c(raw, iNat).reason, /no-derivatives|non-commercial/);
  }
});

test('unrecognised licences are rejected: all rights reserved, unspecified, GFDL, free use, blank, junk', () => {
  for (const raw of ['All rights reserved', 'UNSPECIFIED', 'unrecognised_licence', 'GFDL', 'Copyrighted free use', '', null, undefined, 'some licence', 42, 'CC', 'cc-sa']) {
    const r = c(raw);
    assert.strictEqual(r.allowed, false, String(raw));
    assert.strictEqual(r.code, null, String(raw));
  }
});

test('a CC BY version that is not on the list is rejected, a missing version is rejected unless the source defines it', () => {
  assert.strictEqual(c('CC BY 2.0').allowed, false);
  assert.strictEqual(c('CC BY 3.0').allowed, true, 'unported 3.0 is on the default list (decision 2026-10-10)');
  assert.strictEqual(c('CC BY-SA 3.0').displayOnly, true);
  assert.strictEqual(c('https://creativecommons.org/licenses/by/3.0/us/').allowed, false, 'ported 3.0 US stays excluded');
  assert.strictEqual(c('CC BY 1.0').allowed, false);
  assert.strictEqual(c('cc-by').allowed, false, 'no version stated and no source default');
  assert.match(c('cc-by').reason, /version not stated/);
  assert.strictEqual(c('cc-by', iNat).allowed, true, 'iNaturalist CC BY is 4.0');
  assert.strictEqual(c('cc-by', iNat).code, 'CC BY 4.0');
});

test('canonical codes and licence URLs', () => {
  assert.strictEqual(c('CC-BY 4.0 (Int)').code, 'CC BY 4.0');
  assert.strictEqual(c('CC-BY 3.0 (Au)').code, 'CC BY 3.0 AU');
  assert.strictEqual(c('CC-BY 3.0 (Au)').url, 'https://creativecommons.org/licenses/by/3.0/au/');
  assert.strictEqual(c('CC BY-SA 4.0').url, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.strictEqual(c('cc0').url, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.strictEqual(c('PDM').code, 'Public domain');
});

test('ALLOWED_LICENCES narrows or widens the list', () => {
  assert.strictEqual(classifyLicence('CC BY 3.0', { env: { ALLOWED_LICENCES: 'CC0 1.0, CC BY 3.0' } }).allowed, true);
  assert.strictEqual(classifyLicence('CC BY 4.0', { env: { ALLOWED_LICENCES: 'CC0 1.0' } }).allowed, false);
  assert.strictEqual(classifyLicence('cc0', { env: { ALLOWED_LICENCES: 'CC BY 4.0' } }).allowed, false);
  assert.ok(DEFAULT_ALLOWED.includes('CC BY 4.0') && !DEFAULT_ALLOWED.some((x) => /NC|ND/.test(x)));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
