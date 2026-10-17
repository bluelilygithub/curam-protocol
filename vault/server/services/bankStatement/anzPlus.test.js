#!/usr/bin/env node
/**
 * ANZ Plus statement parser: direction comes from the running balance, every row is cross-checked
 * against it, and the statement must prove opening + rows = closing.
 * Run: node server/services/bankStatement/anzPlus.test.js
 */
'use strict';
const assert = require('assert');
const { parseAnzPlusStatement } = require('./anzPlus');

// text layer of a real ANZ Plus Flex Saver statement (name and address removed)
const AUG = 'Account Statement  1 August 2026 - 31 August 2026   A N Other  1 Some ST  Town QLD 4000  AUS  '
  + 'Australia and New Zealand Banking Group Limited (ANZ) ABN 11 005 357 522. AFSL 234527. Aust. Credit License No. 234527.   Page 1 of 1  '
  + 'ANZ Plus Flex Saver  Branch Number (BSB)   Account Number   Opening Balance   Closing Balance  014 111   808 502 062   $20,830.43   $29,182.00  '
  + 'Interest Earned   Account Name  + $53.22   A N OTHER  Transactions  Date   Description   Credit   Debit   Balance  '
  + '31 Aug   CREDIT INTEREST PAID   $53.22   $29,182.00  '
  + '24 Aug   TRANSFER FROM SOMEONE 2026004   $8,500.00   $29,128.78  '
  + '21 Aug   BPAY TO ANZ CARDS #887809   $201.65   $20,628.78  '
  + 'Opening Balance   $20,830.43  Please check your statement carefully.  If you notice any errors';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

test('reads header, rows oldest first, direction from the balance', () => {
  const r = parseAnzPlusStatement(AUG);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.bsb, '014-111');
  assert.strictEqual(r.accountNumber, '808502062');
  assert.strictEqual(r.product, 'ANZ Plus Flex Saver');
  assert.strictEqual(r.periodStart, '2026-08-01');
  assert.strictEqual(r.periodEnd, '2026-08-31');
  assert.strictEqual(r.openingBalance, 20830.43);
  assert.strictEqual(r.closingBalance, 29182);
  assert.deepStrictEqual(r.lines.map((l) => [l.date, l.amount, l.direction]), [
    ['2026-08-21', -201.65, 'debit'],
    ['2026-08-24', 8500, 'credit'],
    ['2026-08-31', 53.22, 'credit'],
  ]);
  assert.strictEqual(r.lines[1].description, 'TRANSFER FROM SOMEONE 2026004');
});

test('a misread amount is reported, not accepted', () => {
  const r = parseAnzPlusStatement(AUG.replace('$8,500.00', '$8,400.00'));
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some((p) => /does not match the balance change/.test(p)), r.problems.join('|'));
});

test('a missing row fails the opening + rows = closing proof', () => {
  const r = parseAnzPlusStatement(AUG.replace('24 Aug   TRANSFER FROM SOMEONE 2026004   $8,500.00   $29,128.78  ', ''));
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.length >= 1);
});

test('a statement across New Year gets the right years', () => {
  const t = AUG.replace('1 August 2026 - 31 August 2026', '1 December 2026 - 15 January 2027')
    .replace('31 Aug', '15 Jan').replace('24 Aug', '02 Jan').replace('21 Aug', '28 Dec');
  const r = parseAnzPlusStatement(t);
  assert.deepStrictEqual(r.lines.map((l) => l.date), ['2026-12-28', '2027-01-02', '2027-01-15']);
});

test('not an ANZ statement, or no table: refused with a reason', () => {
  assert.strictEqual(parseAnzPlusStatement('hello').ok, false);
  assert.ok(/ANZ/.test(parseAnzPlusStatement('hello').problems[0]));
  assert.strictEqual(parseAnzPlusStatement(AUG.replace(/Transactions\s+Date\s+Description/, 'Nope')).ok, false);
});

console.log(`\nall ${n} passed`);
