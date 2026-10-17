#!/usr/bin/env node
/**
 * ANZ credit card statement parser: credits and "CR" balances, foreign purchases with their overseas
 * fee row, and the proofs (running balance, closing balance, summary totals).
 * Run: node server/services/bankStatement/anzCard.test.js
 */
'use strict';
const assert = require('assert');
const { parseAnzCardStatement } = require('./anzCard');
const { parseStatementText } = require('./index');

// same layout as a real ANZ statement; names, address and card number are made up
const CARD = 'ANZ LOW RATE STATEMENT PERIOD: 11/02/26 to 10/03/26 ACCOUNT NUMBER: 0000-1111-2222-3333 MR A N OTHER 1 SOME ST TOWN QLD 4000 '
  + 'YOUR ANZ ACCOUNT SUMMARY Opening Balance $1,000.00 Purchases, Cash Advances & Other Debits $175.00 Interest Charges $0.00 '
  + 'Payments & Other Credits $1,200.00 Closing Balance $25.00 CR PAYMENT SUMMARY Due Date 07/04/26 Minimum Monthly Payment $40.00 '
  + 'Transaction Details Date Processed Date of Transaction Card Used Transaction Details Amount ($A) Balance '
  + '11/02/2026 06/02/2026 2456 ALDI STORES CANNON HILL $100.00 $1,100.00 '
  + '12/02/2026 10/02/2026 2456 REPLIT, INC. REPLIT.COM $50.00 $1,150.00 20.00 USD '
  + '12/02/2026 INCL OVERSEAS TXN FEE 2.38 AUD $1,150.00 '
  + 'Page 3 of 4 Date Processed Date of Transaction Card Used Transaction Details Amount ($A) Balance '
  + '17/02/2026 17/02/2026 2456 PAYMENT - THANK YOU $1,200.00 CR $50.00 CR '
  + '18/02/2026 14/02/2026 2456 BP CONNECT 1933 UPPER COOMERA $25.00 $25.00 CR '
  + 'Please refer to the last four digits of your credit card to identify card used.';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

test('reads header, signs, CR balances, and attaches the overseas fee to its purchase', () => {
  const r = parseAnzCardStatement(CARD);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.kind, 'card');
  assert.strictEqual(r.product, 'ANZ LOW RATE');
  assert.strictEqual(r.accountNumber, '…3333', 'only the last four digits are kept');
  assert.strictEqual(r.periodStart, '2026-02-11');
  assert.strictEqual(r.periodEnd, '2026-03-10');
  assert.strictEqual(r.openingBalance, 1000);
  assert.strictEqual(r.closingBalance, -25);
  assert.deepStrictEqual(r.lines.map((l) => [l.date, l.amount, l.balance]), [
    ['2026-02-06', -100, 1100],
    ['2026-02-10', -50, 1150],
    ['2026-02-17', 1200, -50],
    ['2026-02-14', -25, -25],
  ]);
  assert.strictEqual(r.lines[1].description, 'REPLIT, INC. REPLIT.COM (USD 20.00, incl. overseas fee 2.38)');
  assert.strictEqual(r.lines.length, 4, 'the fee row is not a transaction of its own');
});

test('a wrong balance, a missing row, or wrong summary totals are reported', () => {
  assert.ok(parseAnzCardStatement(CARD.replace('$1,100.00', '$1,101.00')).problems.some((p) => /does not follow/.test(p)));
  const missing = parseAnzCardStatement(CARD.replace('11/02/2026 06/02/2026 2456 ALDI STORES CANNON HILL $100.00 $1,100.00 ', ''));
  assert.strictEqual(missing.ok, false);
  const totals = parseAnzCardStatement(CARD.replace('Debits $175.00', 'Debits $176.00'));
  assert.ok(totals.problems.some((p) => /summary/.test(p)));
});

// The same layout as an October statement: "CR" glued to the amount, and an interest row whose total is its own
// summary line ("Interest Charges"), separate from purchases.
const OCT = 'ANZ LOW RATE STATEMENT PERIOD: 12/09/26 to 11/10/26 ACCOUNT NUMBER: 0000-1111-2222-3333 MR A N OTHER '
  + 'YOUR ANZ ACCOUNT SUMMARY Opening Balance $1,000.00 Purchases, Cash Advances & Other Debits $300.00 Interest Charges $20.01 '
  + 'Payments & Other Credits $400.00 Closing Balance $920.01 PAYMENT SUMMARY Transaction Details Date Processed Date of Transaction Card Used Transaction Details Amount ($A) Balance '
  + '15/09/2026 14/09/2026 2456 COLES 4578 MORNINGSIDE $300.00 $1,300.00 '
  + '08/10/2026 08/10/2026 2456 PAYMENT - THANK YOU $400.00CR $900.00 '
  + '11/10/2026 11/10/2026 2449 INTEREST CHARGED ON PURCHASES $20.01 $920.01 '
  + 'Please refer to the last four digits';

test('"CR" glued to the amount, and interest rows checked against their own summary line', () => {
  const r = parseAnzCardStatement(OCT);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.lines.map((l) => [l.amount, l.balance]), [[-300, 1300], [400, 900], [-20.01, 920.01]]);
  // an interest row that does not match the summary is reported
  const bad = parseAnzCardStatement(OCT.replace('Interest Charges $20.01', 'Interest Charges $25.00'));
  assert.ok(bad.problems.some((p) => /Interest rows add up/.test(p)), bad.problems.join('|'));
  // a space before CR works too, in the same statement
  const mixed = parseAnzCardStatement(OCT.replace('$400.00CR', '$400.00 CR'));
  assert.strictEqual(mixed.ok, true);
});

test('the dispatcher chooses the card reader, and leaves other statements to the bank reader', () => {
  assert.strictEqual(parseStatementText(CARD).kind, 'card');
  const other = parseStatementText('hello');
  assert.strictEqual(other.kind, 'bank');
  assert.strictEqual(other.ok, false);
});

test('not a card statement: refused with a reason', () => {
  const r = parseAnzCardStatement('hello');
  assert.strictEqual(r.ok, false);
  assert.ok(/credit card/.test(r.problems[0]));
});

console.log(`\nall ${n} passed`);
