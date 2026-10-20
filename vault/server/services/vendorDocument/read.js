'use strict';

// Reads one vendor invoice/receipt PDF into fields. The reader is the model (these layouts differ too
// much for fixed patterns: Railway and Replit scramble in plain text); normalise.js checks the result.

const { extractPdfTextFromBuffer } = require('../../utils/pdfText');
const { getModelsForUser } = require('../modelResolver');
const { callModel } = require('../callModel');
const { logUsage } = require('../../utils/logUsage');
const { normaliseVendorRead, parseModelJson } = require('./normalise');

const SYSTEM = `You read one vendor invoice or receipt for an Australian sole trader and return ONE JSON object, nothing else.

Fields:
{
  "vendor": company that issued it (not the customer),
  "documentKind": "invoice" or "receipt" (a receipt says it was paid and has a date paid),
  "invoiceNumber": string or null,
  "receiptNumber": string or null,
  "date": "YYYY-MM-DD" — for a receipt the DATE PAID, for an invoice the date of issue,
  "periodStart": "YYYY-MM-DD" or null (billing period of the subscription),
  "periodEnd": "YYYY-MM-DD" or null,
  "currency": "AUD", "USD" etc., or null when the document only shows a bare "$" and never names the currency. "A$" means AUD. Do not guess.
  "subtotal": total excluding tax, number,
  "tax": total tax amount, number, 0 when none,
  "total": amount charged including tax, number,
  "taxKind": "gst" for Australian GST, "foreign" for any overseas VAT/sales tax, "none" when no tax is charged,
  "taxLabel": the label printed (e.g. "GST - Australia", "VAT-China"), or null,
  "taxRatePct": number or null,
  "supplierTaxId": the supplier's ABN / ARN / VAT registration number as printed, or null,
  "description": a short phrase for what was bought (e.g. "Prepaid extra usage", "Pro plan monthly")
}

Rules:
- Dates in these documents are written like "July 9, 2025" or "Jan 12, 2026": convert to YYYY-MM-DD.
- Usage tables with many small lines: ignore the lines, use the Subtotal / Tax / Total at the bottom. If a "monthly included usage" credit is subtracted, the subtotal is the figure after the credit.
- Take figures exactly as printed. Never calculate or invent a value; use null when it is not on the page.
- Output only the JSON object.`;

async function readVendorDocument(userId, buffer) {
  const pages = await extractPdfTextFromBuffer(buffer);
  const text = pages.join('\n').trim();
  if (!text) {
    const err = new Error('This PDF has no text to read (a scanned image cannot be read yet)');
    err.statusCode = 400;
    throw err;
  }
  const { light: model } = await getModelsForUser(userId);
  const result = await callModel(model, text.slice(0, 30000), { system: SYSTEM, maxTokens: 1500, returnUsage: true });
  logUsage({ userId, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'vendorDocumentRead' });
  const raw = parseModelJson(result.text);
  if (!raw) {
    const err = new Error('The reader did not return a usable answer — try again');
    err.statusCode = 502;
    throw err;
  }
  return normaliseVendorRead(raw);
}

module.exports = { readVendorDocument, SYSTEM };
