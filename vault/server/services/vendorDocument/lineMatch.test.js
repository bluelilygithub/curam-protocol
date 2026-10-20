#!/usr/bin/env node
/** Receipt -> card line suggestions. Run: node server/services/vendorDocument/lineMatch.test.js */
'use strict';
const assert = require('assert');
const { suggestLines, foreignOf, vendorWord } = require('./lineMatch');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

const lines = [
  { id: 1, date: '2026-03-11', description: 'ANTHROPIC ANTHROPIC.COM (USD 27.50, incl. overseas fee 1.38)', amount: -40.81, decision: 'pending' },
  { id: 2, date: '2026-03-13', description: 'ANTHROPIC ANTHROPIC.COM (USD 27.50, incl. overseas fee 1.35)', amount: -40.02, decision: 'pending' },
  { id: 3, date: '2026-03-12', description: 'REPLIT, INC. REPLIT.COM (USD 22.85, incl. overseas fee 1.15)', amount: -34.01, decision: 'business' },
  { id: 4, date: '2026-03-12', description: 'KOGAN ENERGY BRISBANE', amount: -27.5, decision: 'pending' },
  { id: 5, date: '2026-03-12', description: 'PAYMENT RECEIVED', amount: 500, decision: 'pending' },
];

test('foreign amount is read out of the card line description', () => {
  assert.deepStrictEqual(foreignOf(lines[0].description), { currency: 'USD', amount: 27.5 });
  assert.strictEqual(foreignOf('KOGAN ENERGY'), null);
});

test('USD receipt matches on the foreign amount, not the AUD amount', () => {
  const r = suggestLines({ vendor: 'Anthropic, PBC', docDate: '2026-03-11', total: 27.5, currency: 'USD' }, lines);
  assert.strictEqual(r[0].lineId, 1);
  assert.strictEqual(r[0].strength, 'exact');
  assert.ok(/USD 27.50 matches/.test(r[0].note));
});

test('two identical charges on different days are both offered, the nearer date first', () => {
  const r = suggestLines({ vendor: 'Anthropic', docDate: '2026-03-13', total: 27.5, currency: 'USD' }, lines);
  assert.deepStrictEqual(r.map(x => x.lineId), [2, 1]);
});

test('a receipt with no stated currency still matches on the foreign amount', () => {
  const r = suggestLines({ vendor: 'Replit Inc', docDate: '2026-03-12', total: 22.85, currency: null }, lines);
  assert.strictEqual(r[0].lineId, 3);
});

test('an AUD invoice matches the AUD amount directly', () => {
  const r = suggestLines({ vendor: 'Anthropic', docDate: '2026-03-11', total: 40.81, currency: 'AUD' }, lines);
  assert.strictEqual(r[0].lineId, 1);
});

test('a different amount with no vendor name is not suggested; credits are ignored', () => {
  const r = suggestLines({ vendor: 'Luma AI', docDate: '2026-03-12', total: 99, currency: 'USD' }, lines);
  assert.deepStrictEqual(r, []);
});

test('lines more than a week from the document date are not suggested', () => {
  const r = suggestLines({ vendor: 'Anthropic', docDate: '2026-04-30', total: 27.5, currency: 'USD' }, lines);
  assert.deepStrictEqual(r, []);
});

test('vendor word skips company suffixes', () => {
  assert.strictEqual(vendorWord('Anthropic, PBC'), 'anthropic');
  assert.strictEqual(vendorWord('Eleven Labs Inc.'), 'eleven');
  assert.strictEqual(vendorWord('LUMA AI, INC.'), 'luma');
});

console.log(`\n${n} passed`);
