#!/usr/bin/env node
/** Receipt -> card line -> expense. Run: node server/services/vendorDocument/lineMatch.test.js */
'use strict';
const assert = require('assert');
const { suggestLines, matchReceipt, foreignOf, vendorWord } = require('./lineMatch');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

const lines = [
  { id: 1, date: '2026-03-11', description: 'ANTHROPIC ANTHROPIC.COM (USD 27.50, incl. overseas fee 1.38)', amount: -40.81, matchExpenseId: null },
  { id: 2, date: '2026-03-13', description: 'ANTHROPIC ANTHROPIC.COM (USD 27.50, incl. overseas fee 1.35)', amount: -40.02, matchExpenseId: null },
  { id: 3, date: '2026-04-15', description: 'DEEPSEEK DEEPSEEK.COM (USD 21.20, incl. overseas fee 0.90)', amount: -30.84, matchExpenseId: null },
  { id: 4, date: '2026-03-12', description: 'KOGAN ENERGY BRISBANE', amount: -27.5, matchExpenseId: null },
  { id: 5, date: '2026-03-12', description: 'PAYMENT RECEIVED', amount: 500, matchExpenseId: null },
];
const expenses = [
  { id: 10, date: '2026-04-14', description: 'DeepSeek API', supplier: 'DeepSeek', total: 30.84 },
  { id: 11, date: '2026-03-11', description: 'Anthropic', supplier: 'Anthropic', total: 40.81 },
  { id: 12, date: '2026-03-13', description: 'Anthropic', supplier: 'Anthropic', total: 40.02 },
  { id: 13, date: '2026-04-16', description: 'fal credits', supplier: 'fal', total: 32.10 },
];

test('foreign amount is read out of the card line description', () => {
  assert.deepStrictEqual(foreignOf(lines[0].description), { currency: 'USD', amount: 27.5 });
  assert.strictEqual(foreignOf('KOGAN ENERGY'), null);
});

test('the DeepSeek example: receipt 21.20 with no currency -> line USD 21.20 -> expense $30.84', () => {
  const r = matchReceipt({ vendor: 'DeepSeek', docDate: '2026-04-15', total: 21.2, currency: null }, lines, expenses);
  assert.strictEqual(r.status, 'clear');
  assert.strictEqual(r.line.lineId, 3);
  assert.strictEqual(r.expense.id, 10);
});

test('a line already matched to an expense in Statement review wins over a guess', () => {
  const linked = lines.map(l => (l.id === 3 ? { ...l, matchExpenseId: 13 } : l));
  const r = matchReceipt({ vendor: 'DeepSeek', docDate: '2026-04-15', total: 21.2, currency: null }, linked, expenses);
  assert.strictEqual(r.expense.id, 13);
});

test('two identical charges two days apart: the receipt takes the nearer date', () => {
  const r = matchReceipt({ vendor: 'Anthropic, PBC', docDate: '2026-03-13', total: 27.5, currency: 'USD' }, lines, expenses);
  assert.strictEqual(r.status, 'clear');
  assert.strictEqual(r.line.lineId, 2);
  assert.strictEqual(r.expense.id, 12);
});

test('equally near identical charges are not guessed: status check, both offered', () => {
  const r = matchReceipt({ vendor: 'Anthropic', docDate: '2026-03-12', total: 27.5, currency: 'USD' }, lines, expenses);
  assert.strictEqual(r.status, 'check');
  assert.strictEqual(r.candidates.lines.length, 2);
});

test('an AUD invoice with no card line falls back to an expense of the same AUD total', () => {
  const r = matchReceipt({ vendor: 'fal', docDate: '2026-04-16', total: 32.1, currency: 'AUD' }, [], expenses);
  assert.strictEqual(r.status, 'check'); // amount-only: shown, never auto-linked
  assert.strictEqual(r.expense.id, 13);
});

test('more than one expense of the line amount: not guessed', () => {
  const twin = [...expenses, { id: 14, date: '2026-04-15', description: 'DeepSeek top up', supplier: 'DeepSeek', total: 30.84 }];
  const r = matchReceipt({ vendor: 'DeepSeek', docDate: '2026-04-15', total: 21.2, currency: null }, lines, twin);
  assert.strictEqual(r.status, 'check');
  assert.strictEqual(r.expense, null);
  assert.strictEqual(r.candidates.expenses.length, 2);
});

test('a line with no expense of that amount is reported, not linked', () => {
  const r = matchReceipt({ vendor: 'DeepSeek', docDate: '2026-04-15', total: 21.2, currency: null }, lines, []);
  assert.strictEqual(r.status, 'check');
  assert.strictEqual(r.expense, null);
});

test('nothing near the date or amount gives none; credits and other vendors are ignored', () => {
  assert.strictEqual(matchReceipt({ vendor: 'Luma AI', docDate: '2026-03-12', total: 99, currency: 'USD' }, lines, expenses).status, 'none');
  assert.deepStrictEqual(suggestLines({ vendor: 'Anthropic', docDate: '2026-06-30', total: 27.5, currency: 'USD' }, lines), []);
});

test('a stated currency that disagrees with the card line is not matched on amount', () => {
  const r = matchReceipt({ vendor: 'Unknown Co', docDate: '2026-04-15', total: 21.2, currency: 'EUR' }, lines, expenses);
  assert.strictEqual(r.status, 'none');
});

test('vendor word skips company suffixes', () => {
  assert.strictEqual(vendorWord('Anthropic, PBC'), 'anthropic');
  assert.strictEqual(vendorWord('Eleven Labs Inc.'), 'eleven');
  assert.strictEqual(vendorWord('LUMA AI, INC.'), 'luma');
});

console.log(`\n${n} passed`);
