#!/usr/bin/env node
/**
 * Statement line -> invoice/expense suggestions. Run: node server/services/bankStatement/match.test.js
 */
'use strict';
const assert = require('assert');
const { suggestMatch, numberInDescription } = require('./match');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };
const invoices = [{ id: 1, number: 'INV-2026004', total: 8500 }, { id: 2, number: 'INV-2026005', total: 1200 }];
const expenses = [
  { id: 10, date: '2026-08-20', description: 'Card fee', amount: 183.32, gst: 18.33, supplier: 'ANZ Cards' },
  { id: 11, date: '2026-07-01', description: 'Old thing', amount: 201.65, gst: 0, supplier: 'Other' },
];

test('invoice number digits inside the description count', () => {
  assert.ok(numberInDescription('INV-2026004', 'TRANSFER FROM SOMEONE 2026004'));
  assert.ok(!numberInDescription('INV-2026004', 'TRANSFER 99'));
  assert.ok(!numberInDescription('INV-01', 'TRANSFER 01'), 'short numbers are too weak to trust');
});

test('credit: number and amount agree = exact', () => {
  const m = suggestMatch({ amount: 8500, description: 'TRANSFER FROM SOMEONE 2026004', date: '2026-08-24' }, invoices, expenses);
  assert.deepStrictEqual([m.invoiceId, m.strength], [1, 'exact']);
});

test('credit: number named but amount differs, or amount only = possible', () => {
  assert.strictEqual(suggestMatch({ amount: 8000, description: 'TRANSFER 2026004', date: '2026-08-24' }, invoices, expenses).strength, 'possible');
  const m = suggestMatch({ amount: 1200, description: 'TRANSFER FROM X', date: '2026-08-24' }, invoices, expenses);
  assert.deepStrictEqual([m.invoiceId, m.strength], [2, 'possible']);
  assert.strictEqual(suggestMatch({ amount: 53.22, description: 'CREDIT INTEREST PAID', date: '2026-08-31' }, invoices, expenses), null);
});

test('debit: same total within 7 days, supplier named = exact', () => {
  const m = suggestMatch({ amount: -201.65, description: 'BPAY TO ANZ CARDS #887809', date: '2026-08-21' }, invoices, expenses);
  assert.deepStrictEqual([m.expenseId, m.strength], [10, 'exact']);
});

test('debit: too far apart or wrong total = no suggestion', () => {
  assert.strictEqual(suggestMatch({ amount: -201.65, description: 'X', date: '2026-08-21' }, invoices, [expenses[1]]), null);
  assert.strictEqual(suggestMatch({ amount: -5, description: 'X', date: '2026-08-21' }, invoices, expenses), null);
});

console.log(`\nall ${n} passed`);
