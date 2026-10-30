'use strict';

// node server/services/emailFollowUp/ocrPdf.test.js
// Runs the REAL tesseract engine on a picture of an invoice, end to end through attachmentText.js, so the rule tests' fake OCR is
// checked against the real thing. pdftoppm (poppler) is not installed on every machine, so the page picture is supplied here by
// `sharp` instead; on the server the page picture comes from pdftoppm (contractReview/pdfRasterize.js). If the engine cannot start
// (no network for its language data, say) this prints SKIPPED and exits 0: a skipped check is never reported as a pass.

const assert = require('assert');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { extractAttachmentText } = require('./attachmentText');
const { ocrPages } = require('./ocrPdf');

(async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="500">
    <rect width="100%" height="100%" fill="white"/>
    <text x="40" y="120" font-family="Arial, Helvetica, sans-serif" font-size="64" fill="black">INVOICE 1042</text>
    <text x="40" y="240" font-family="Arial, Helvetica, sans-serif" font-size="64" fill="black">Total due $3,450.00</text>
    <text x="40" y="360" font-family="Arial, Helvetica, sans-serif" font-size="64" fill="black">Payable within 30 days</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  // a PDF whose only page is that picture: no text layer, exactly what a scanner makes
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([595, 842]);
  page.drawImage(img, { x: 20, y: 500, width: 555, height: 198 });
  const scan = Buffer.from(await doc.save());

  const deps = { rasterizePages: async (_pdf, pages) => Object.fromEntries(pages.map((p) => [p, png])) };
  let result;
  try {
    result = await extractAttachmentText({ filename: 'scan.pdf', mimeType: 'application/pdf', buffer: scan, ocr: (buf, pages) => ocrPages(buf, pages, deps) });
  } catch (e) {
    console.log(`SKIPPED ocrPdf real-engine test: ${e.message}`);
    process.exit(0);
  }
  if (result.parseStatus === 'failed' && /OCR failed/.test(result.parseReason || '')) {
    console.log(`SKIPPED ocrPdf real-engine test: ${result.parseReason}`);
    process.exit(0);
  }

  assert.strictEqual(result.parseStatus, 'parsed', JSON.stringify(result));
  assert.match(result.parser, /tesseract/);
  assert.ok(result.ocrUsed);
  assert.match(result.text, /1042/, `invoice number read: ${result.text}`);
  assert.match(result.text.replace(/\s+/g, ' '), /3,?450\.00/, `the total was read: ${result.text}`);
  assert.match(result.parseReason, /confidence \d+%/);
  console.log(`email-follow-up real OCR: passed (${result.parseReason})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
