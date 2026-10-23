#!/usr/bin/env node
/**
 * Shares accountant pack: figures from the CMC EOFY statement (FY 2025-26) come out right, the pack has
 * the expected pages, and the Finance PDF/Excel renderers lay it out. Run: node server/services/sharesPack/collect.test.js
 */
'use strict';
const assert = require('assert');
const XLSX = require('xlsx');
const { buildSharesPack } = require('./collect');
const { renderPackPdf } = require('../financePack/pdf');
const { renderPackXlsx } = require('../financePack/xlsx');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`  ok   ${name}`); };

const T = (id, symbol, exchange, side, quantity, pricePerShare, feesAud, tradedAt) => ({ id, symbol, exchange, side, quantity, pricePerShare, feesAud, tradedAt, currency: 'AUD' });
// AEST noon is 02:00Z, so the Brisbane calendar day is the date written here
const trades = [
  T(1, 'INTC', 'NASDAQ', 'buy', 136, 71.4219, 0, '2026-01-14T02:00:00Z'),
  T(2, 'COH', 'ASX', 'buy', 37, 264.3914, 11, '2026-01-14T02:00:00Z'),
  T(3, 'INTC', 'NASDAQ', 'sell', 136, 61.5982, 0, '2026-01-27T02:00:00Z'),
  T(4, 'COH', 'ASX', 'sell', 37, 97.7614, 11, '2026-05-07T02:00:00Z'),
  T(5, 'TSM', 'NYSE', 'buy', 20, 471.4695, 0, '2025-10-16T02:00:00Z'),
  T(6, 'TSM', 'NYSE', 'buy', 17, 692.3412, 0, '2026-07-01T02:00:00Z'), // next financial year
];
const D = (id, symbol, net, gross, paidOnText, derived = false) => ({ id, type: 'dividend', symbol, amountAud: net, grossAud: gross, withholdingTaxAud: Math.round((gross - net) * 100) / 100, withholdingRatePct: 30, grossDerived: derived, paidOnText });
const ledger = [
  D(1, 'TSM', 18.73, 23.72, '2026-01-13'),
  D(2, 'AAPL', 6.37, 9.09, '2026-02-16'),
  D(3, 'GOOG', 10.43, 14.90, '2026-06-22'),
  D(4, 'TSM', 60.75, 70.00, '2026-07-14'), // next financial year
];
const docs = [{ id: 1, title: 'CMC EOFY statement', originalName: 'EOFY.pdf', docDate: '2026-10-23', notes: '' }];
const pack = buildSharesPack({ fy: '2025-26', trades, ledger, docs, notes: 'Line one\n\nLine two', tz: 'Australia/Brisbane', today: '2026-10-23', generatedAt: '23 October 2026' });
const rep = (key) => pack.reports.find((r) => r.key === key);

(async () => {
  await test('capital loss matches the broker: brokerage on both sides of COH is in', () => {
    const sec = rep('tax_summary').sections[0].rows;
    const get = (label) => sec.find((r) => r.item.startsWith(label)).amount;
    assert.strictEqual(get('Sales in the year (2 parcels): proceeds'), 11983.53); // 8377.36 + 3606.17
    assert.strictEqual(get('Sales in the year: cost base'), 19506.86);            // 9713.38 + 9793.48
    assert.strictEqual(get('Net capital loss carried forward'), 7523.33);
    assert.strictEqual(rep('tax_summary').summary[0].label, 'Net capital loss carried forward');
  });

  await test('only the financial year is reported: next-year trades and dividends are left out', () => {
    assert.strictEqual(rep('trades').sections[0].rows.length, 5);
    assert.ok(!rep('trades').sections[0].rows.some((r) => r.date >= '2026-07-01'));
    assert.strictEqual(rep('dividends').sections[0].rows.length, 3);
    assert.strictEqual(rep('dividends').sections[0].totals.net, 35.53);
    assert.strictEqual(rep('dividends').sections[0].totals.gross, 47.71);
  });

  await test('holdings at 30 June replay the trades up to the year end (the 1 July buy is not in)', () => {
    const rows = rep('holdings').sections[0].rows;
    assert.deepStrictEqual(rows.map((r) => [r.symbol, r.qty]), [['TSM', '20']]);
    assert.strictEqual(rows[0].cost, 9429.39);
  });

  await test('observations: generated notes plus the owner\'s own lines, none blank', () => {
    const rows = rep('observations').sections[0].rows;
    assert.ok(rows.some((r) => r.topic === 'Method'));
    assert.ok(rows.some((r) => r.topic === 'Foreign tax withheld' && /W-8BEN/.test(r.observation)));
    assert.deepStrictEqual(rows.filter((r) => r.topic === 'Owner note').map((r) => r.observation), ['Line one', 'Line two']);
    assert.ok(rows.every((r) => r.observation));
  });

  await test('a derived gross is called out as derived', () => {
    const p = buildSharesPack({ fy: '2025-26', trades: [], ledger: [D(9, 'GOOG', 8.5, 10, '2026-03-01', true)], tz: 'Australia/Brisbane', today: '2026-10-23' });
    assert.strictEqual(p.reports.find((r) => r.key === 'dividends').sections[0].rows[0].source, 'derived');
    assert.ok(p.reports.find((r) => r.key === 'observations').sections[0].rows.some((r) => /worked out from the net/.test(r.observation)));
  });

  await test('the Finance renderers lay the pack out (PDF and Excel), cover without GST lines', async () => {
    const pdf = await renderPackPdf(pack);
    assert.ok(pdf.length > 3000 && pdf.slice(0, 4).toString() === '%PDF');
    const xlsx = await renderPackXlsx(pack, 0);
    const wb = XLSX.read(xlsx, { type: 'buffer' });
    assert.ok(wb.SheetNames.includes('Data - All trades'), wb.SheetNames.join(','));
    assert.ok(wb.SheetNames.includes('Tax summary'));
    const cover = XLSX.utils.sheet_to_json(wb.Sheets.Cover, { header: 1 }).flat().join('|');
    assert.ok(!/GST/.test(cover) && !/flagged to check/.test(cover), cover);
  });

  console.log(`\nall ${n} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
