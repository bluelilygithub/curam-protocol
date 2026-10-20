#!/usr/bin/env node
/**
 * Vendor invoice/receipt checks. Run: node server/services/vendorDocument/normalise.test.js
 * The inputs are what a reader should return for real sample documents (Anthropic, ElevenLabs,
 * Railway, Replit, fal, Lovable, Luma, DeepSeek).
 */
'use strict';
const assert = require('assert');
const { normaliseVendorRead, pairKey, parseModelJson, taxIdDigits } = require('./normalise');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

test('Anthropic 2025 receipt: USD, tax without a registration number', () => {
  const r = normaliseVendorRead({ vendor: 'Anthropic, PBC', documentKind: 'receipt', invoiceNumber: 'IWIVT6DN-0001', receiptNumber: '2004-6603-0540', date: '2025-07-09', currency: null, subtotal: 5, tax: 0.5, total: 5.5, taxKind: 'gst', taxRatePct: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.currency, null); // a receipt that shows only "$" is not guessed
  assert.strictEqual(r.record.supplierTaxId, null);
});

test('Anthropic 2026 invoice: AUD with GST and an ARN', () => {
  const r = normaliseVendorRead({ vendor: 'Anthropic, PBC', invoiceNumber: '3CC95CCC-0015', date: '2026-10-14', currency: 'AUD', subtotal: '20.00', tax: '2.00', total: '22.00', taxKind: 'gst', taxLabel: 'GST - Australia', taxRatePct: 10, supplierTaxId: 'ARN: 3000 3184 9729' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.taxKind, 'gst');
  assert.strictEqual(r.record.supplierTaxId, '300031849729');
});

test('Railway: usage credit applied, subtotal is after the credit', () => {
  const r = normaliseVendorRead({ vendor: 'Railway Corporation', invoiceNumber: 'J3JSVWPM-0016', date: '2026-10-02', currency: 'USD', subtotal: 34.6, tax: 3.47, total: 38.07, taxKind: 'gst', taxRatePct: 10 });
  assert.strictEqual(r.ok, true); // 34.60 x 10% = 3.46, a one-cent rounding gap is allowed
});

test('Replit: bare $, GST', () => {
  const r = normaliseVendorRead({ vendor: 'Replit Inc', invoiceNumber: 'OEWQMR-00002', date: '2026-01-12', currency: null, subtotal: 50.8, tax: 5.07, total: 55.87, taxKind: 'gst', taxRatePct: 10 });
  assert.strictEqual(r.ok, true);
});

test('fal, Lovable, Luma: no tax', () => {
  for (const [v, t] of [['fal - Features & Labels, Inc.', 20], ['Lovable Labs Incorporated', 25], ['LUMA AI, INC.', 30]]) {
    const r = normaliseVendorRead({ vendor: v, invoiceNumber: 'X-1', date: '2026-04-16', currency: 'USD', subtotal: t, tax: 0, total: t });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.record.taxKind, 'none');
  }
});

test('DeepSeek: China VAT is foreign tax, never GST', () => {
  const r = normaliseVendorRead({ vendor: 'DeepSeek', documentKind: 'receipt', date: '2026-04-15', subtotal: 20, tax: 1.2, total: 21.2, taxKind: 'foreign', taxLabel: 'VAT-China', taxRatePct: 6 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.taxKind, 'foreign');
});

test('amounts that do not add up are flagged, not filed', () => {
  const r = normaliseVendorRead({ vendor: 'X', date: '2026-01-01', subtotal: 20, tax: 2, total: 25 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.problems.some(p => /do not add up/.test(p)));
});

test('a stated rate that disagrees with the tax amount is flagged', () => {
  const r = normaliseVendorRead({ vendor: 'X', date: '2026-01-01', subtotal: 20, tax: 5, total: 25, taxKind: 'gst', taxRatePct: 10 });
  assert.strictEqual(r.ok, false);
});

test('missing vendor, date and total are all reported', () => {
  const r = normaliseVendorRead({});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.problems.length, 3);
});

test('an invoice and its receipt share a pair key', () => {
  const a = pairKey({ vendor: 'Anthropic, PBC', invoiceNumber: 'IWIVT6DN-0001' });
  const b = pairKey({ vendor: 'Anthropic PBC', invoiceNumber: 'iwivt6dn0001' });
  assert.strictEqual(a, b);
  assert.strictEqual(pairKey({ vendor: 'DeepSeek', invoiceNumber: null }), null);
});

test('model replies with fences or a leading sentence still parse', () => {
  assert.deepStrictEqual(parseModelJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.strictEqual(parseModelJson('no json'), null);
});

test('tax ids: ABN and ARN reduce to digits, short junk is dropped', () => {
  assert.strictEqual(taxIdDigits('AU ABN 88973570541'), '88973570541');
  assert.strictEqual(taxIdDigits('PMB 90375'), null);
});

console.log(`\n${n} passed`);
