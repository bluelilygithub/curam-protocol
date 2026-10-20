'use strict';

// Turns what the model read from a vendor invoice/receipt into one checked record. The model only
// reads; every number is re-checked here (subtotal + tax = total) and anything that does not add up
// is marked 'check' for the person, never filed silently.
//
// currency is null when the document only shows "$" — the matching card line settles it later.
// taxKind: 'gst' (Australian GST), 'foreign' (overseas VAT etc., never a GST credit), 'none'.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? round2(n) : null;
};
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'CAD', 'SGD', 'JPY', 'CNY'];

// "AU ARN 300031695540", "ABN 88 973 570 541", "ARN: 3000 3184 9729" -> digits only; null when absent
function taxIdDigits(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 9 ? d : null;
}

function normaliseVendorRead(raw) {
  const problems = [];
  const r = raw && typeof raw === 'object' ? raw : {};

  const vendor = String(r.vendor || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if (!vendor) problems.push('No vendor name found');

  const docKind = r.documentKind === 'receipt' ? 'receipt' : 'invoice';
  const invoiceNumber = String(r.invoiceNumber || '').trim().slice(0, 80) || null;
  const receiptNumber = String(r.receiptNumber || '').trim().slice(0, 80) || null;

  // a receipt's date is the date PAID (that is the card date); an invoice's is the date of issue
  const docDate = isDate(r.date) ? r.date : null;
  if (!docDate) problems.push('No usable date found');
  const periodStart = isDate(r.periodStart) ? r.periodStart : null;
  const periodEnd = isDate(r.periodEnd) ? r.periodEnd : null;

  let currency = String(r.currency || '').toUpperCase().trim();
  currency = CURRENCIES.includes(currency) ? currency : null;

  const subtotal = num(r.subtotal);
  const tax = num(r.tax) ?? 0;
  const total = num(r.total);
  if (total === null || total <= 0) problems.push('No total found');
  if (subtotal !== null && total !== null && Math.abs(round2(subtotal + tax) - total) > 0.011) {
    problems.push(`Amounts do not add up: ${subtotal.toFixed(2)} + tax ${tax.toFixed(2)} is not ${total.toFixed(2)}`);
  }

  let taxKind = ['gst', 'foreign', 'none'].includes(r.taxKind) ? r.taxKind : (tax > 0 ? 'foreign' : 'none');
  if (tax <= 0) taxKind = 'none';
  const taxLabel = r.taxLabel ? String(r.taxLabel).slice(0, 80) : null;
  const taxRatePct = num(r.taxRatePct);
  const taxId = taxIdDigits(r.supplierTaxId);
  // a stated rate should roughly match the stated amount, otherwise the tax split cannot be trusted
  if (tax > 0 && taxRatePct && subtotal) {
    const expected = round2(subtotal * taxRatePct / 100);
    if (Math.abs(expected - tax) > 0.06) problems.push(`Tax ${tax.toFixed(2)} is not ${taxRatePct}% of ${subtotal.toFixed(2)}`);
  }

  return {
    ok: problems.length === 0,
    problems,
    record: {
      vendor, documentKind: docKind, invoiceNumber, receiptNumber, docDate, periodStart, periodEnd,
      currency, subtotal, tax, total, taxKind, taxLabel, taxRatePct, supplierTaxId: taxId,
      description: r.description ? String(r.description).replace(/\s+/g, ' ').trim().slice(0, 300) : null,
    },
  };
}

// Pull the first JSON object out of a model reply (it may add fences or a sentence around it).
function parseModelJson(text) {
  const s = String(text || '').replace(/```json?/gi, '').replace(/```/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

module.exports = { normaliseVendorRead, parseModelJson, taxIdDigits };
