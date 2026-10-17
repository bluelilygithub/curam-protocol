#!/usr/bin/env node
/**
 * CMC dividend email parser: reads gross / tax / net / FX as stated (never derived), converts USD to
 * AUD at the stated rate (USD per AUD), DD/MM/YYYY dates, several emails in one paste, bad input.
 *
 * Run: node server/services/sharesDividendEmail.test.js
 */
'use strict';

const assert = require('assert');
const { parseCmcDividendEmails } = require('./sharesDividendEmail');

const near = (a, b) => Math.abs(a - b) < 0.005;

const TSM = `
Account Number: 000000

Account Name: A N OTHER

Dividend On: TSM:US

The following represents the dividend proceeds on your holdings of the above stock.

Pay Date    09/10/2026
Ex Date    16/09/2026
Holdings as at Ex Date    89 shares
Gross Dividend Rate    USD 1.0962506
Gross Amount    USD 97.57
Fees    USD 0.00
Tax Withheld    USD 20.49
Net amount (Local)    USD 77.08
Exchange Rate @    0.69800

Net Amount (AUD)    AUD 110.43
`;

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

test('US dividend: stated figures, converted at the stated rate, dates DD/MM/YYYY', () => {
  const r = parseCmcDividendEmails(TSM);
  assert.strictEqual(r.lines.length, 1);
  assert.deepStrictEqual(r.skipped, []);
  assert.deepStrictEqual(r.warnings, []);
  const l = r.lines[0];
  assert.strictEqual(l.lineType, 'dividend');
  assert.strictEqual(l.symbol, 'TSM');
  assert.strictEqual(l.date, '2026-10-09', 'pay date, not ex date');
  assert.strictEqual(l.exDate, '2026-09-16');
  assert.strictEqual(l.shares, 89);
  assert.ok(near(l.amount, 110.43), 'net AUD as stated');
  assert.ok(near(l.withholdingTaxAud, 29.36), `tax ${l.withholdingTaxAud}`);
  assert.ok(near(l.grossAmountAud, 139.79), `gross ${l.grossAmountAud}`);
  assert.ok(near(l.grossAmountAud - l.withholdingTaxAud, l.amount), 'gross - tax = net');
  assert.strictEqual(l.grossLocal, 97.57);
  assert.strictEqual(l.taxLocal, 20.49);
  assert.strictEqual(l.fxRate, 0.698);
});

test('the account number and name are not kept', () => {
  const l = parseCmcDividendEmails(TSM).lines[0];
  const all = JSON.stringify(l);
  assert.ok(!/000000/.test(all) && !/OTHER/.test(all));
});

test('two emails pasted together give two lines', () => {
  const r = parseCmcDividendEmails(`${TSM}\n\n${TSM.replace('TSM:US', 'NVDA:US').replace('09/10/2026', '10/10/2026')}`);
  assert.deepStrictEqual(r.lines.map((l) => [l.symbol, l.date]), [['TSM', '2026-10-09'], ['NVDA', '2026-10-10']]);
});

test('AUD dividend (no FX): amounts taken as AUD, zero tax when none withheld', () => {
  const r = parseCmcDividendEmails(`Dividend On: BHP:AU
Pay Date    25/03/2026
Holdings as at Ex Date    100 shares
Gross Amount    AUD 85.00
Fees    AUD 0.00
Tax Withheld    AUD 0.00
Net amount (Local)    AUD 85.00
Net Amount (AUD)    AUD 85.00`);
  const l = r.lines[0];
  assert.ok(near(l.amount, 85) && near(l.grossAmountAud, 85) && l.withholdingTaxAud === 0);
  assert.strictEqual(l.fxRate, null);
});

test('a net that disagrees with the rate is flagged, not silently trusted', () => {
  const r = parseCmcDividendEmails(TSM.replace('AUD 110.43', 'AUD 120.43'));
  assert.strictEqual(r.lines.length, 1);
  assert.ok(r.warnings.some((w) => /differs/.test(w)), r.warnings.join('|'));
});

test('bad input is skipped with a reason, never guessed', () => {
  assert.strictEqual(parseCmcDividendEmails('hello').lines.length, 0);
  const noDate = parseCmcDividendEmails(TSM.replace('09/10/2026', '2026-10-09'));
  assert.strictEqual(noDate.lines.length, 0);
  assert.ok(/Pay Date/.test(noDate.skipped[0]));
  const impossible = parseCmcDividendEmails(TSM.replace('09/10/2026', '31/02/2026'));
  assert.strictEqual(impossible.lines.length, 0, '31 February is not a date');
  const noFx = parseCmcDividendEmails(TSM.replace(/Exchange Rate @\s+0.69800/, '').replace(/Net Amount \(AUD\).*/, ''));
  assert.strictEqual(noFx.lines.length, 0);
  assert.ok(/Exchange Rate/.test(noFx.skipped[0]));
});

console.log(`\nall ${n} passed`);
