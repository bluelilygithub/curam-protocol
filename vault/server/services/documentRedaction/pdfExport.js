'use strict';

/**
 * Local DOCX → PDF via LibreOffice, then scrub PDF info dict with pdf-lib.
 * Never uses Google Drive (privacy).
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PDFDocument } = require('pdf-lib');

const execFileAsync = promisify(execFile);

async function libreConvertToPdf(docxBuffer) {
  const id = crypto.randomUUID();
  const tmpDir = path.join(os.tmpdir(), `docredact_${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, 'input.docx');
  await fsp.writeFile(inFile, docxBuffer);
  try {
    await execFileAsync(
      'libreoffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inFile],
      { timeout: 90_000 },
    );
    const outFile = path.join(tmpDir, 'input.pdf');
    if (!fs.existsSync(outFile)) {
      throw new Error('LibreOffice did not produce a PDF');
    }
    return await fsp.readFile(outFile);
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

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
 * @returns {Promise<{ buffer: Buffer|null, pdfMetaScrub: object|null, error: string|null }>}
 */
async function exportSanitizedPdf(docxBuffer) {
  try {
    const raw = await libreConvertToPdf(docxBuffer);
    const { buffer, stripped, before } = await scrubPdfMetadata(raw);
    return {
      buffer,
      pdfMetaScrub: { stripped, before },
      error: null,
    };
  } catch (err) {
    return {
      buffer: null,
      pdfMetaScrub: null,
      error: err.message || String(err),
    };
  }
}

module.exports = {
  exportSanitizedPdf,
  scrubPdfMetadata,
  libreConvertToPdf,
};
