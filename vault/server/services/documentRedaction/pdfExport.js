'use strict';

/**
 * Redacted DOCX → sanitized.pdf using the same LibreOffice path as PDF Tools
 * (`server/services/officeConvert.js` / `/api/pdf/office-to-pdf`), then scrub
 * PDF info dict with pdf-lib. Does not use Google Drive (privacy).
 */

const { PDFDocument } = require('pdf-lib');
const { libreConvert } = require('../officeConvert');

async function scrubPdfMetadata(pdfBuffer) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const before = {
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    subject: doc.getSubject() || '',
    keywords: (doc.getKeywords() || '').toString(),
    producer: doc.getProducer() || '',
    creator: doc.getCreator() || '',
  };
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('Curam Vault document redaction');
  doc.setCreator('');
  const stripped = Object.entries(before)
    .filter(([, v]) => v && String(v).trim())
    .map(([k]) => k);
  const out = await doc.save();
  return { buffer: Buffer.from(out), stripped, before };
}

/**
 * @param {Buffer} docxBuffer
 * @returns {Promise<{ buffer: Buffer|null, pdfMetaScrub: object|null, error: string|null, fallback?: string|null }>}
 */
async function exportSanitizedPdf(docxBuffer) {
  try {
    const raw = await libreConvert(docxBuffer, '.docx', 'pdf');
    const { buffer, stripped, before } = await scrubPdfMetadata(raw);
    return {
      buffer,
      pdfMetaScrub: { stripped, before },
      error: null,
      fallback: null,
    };
  } catch (err) {
    return {
      buffer: null,
      pdfMetaScrub: null,
      error: err.message || String(err),
      fallback: null,
    };
  }
}

module.exports = {
  exportSanitizedPdf,
  scrubPdfMetadata,
  libreConvertToPdf: (buf) => libreConvert(buf, '.docx', 'pdf'),
};
