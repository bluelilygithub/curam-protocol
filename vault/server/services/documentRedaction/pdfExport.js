'use strict';

/**
 * Local DOCX → PDF via LibreOffice, then scrub PDF info dict with pdf-lib.
 * Falls back to a plain-text PDF (layout not preserved) when LibreOffice is
 * unavailable — same honesty as PDF→docx ingest.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { parseDocxBuffer } = require('./docxParse');

const execFileAsync = promisify(execFile);

const LIBRE_BINS = ['libreoffice', 'soffice', '/usr/bin/libreoffice', '/usr/bin/soffice'];

async function tryLibreConvertToPdf(docxBuffer) {
  const id = crypto.randomUUID();
  const tmpDir = path.join(os.tmpdir(), `docredact_${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, 'input.docx');
  await fsp.writeFile(inFile, docxBuffer);
  const errors = [];
  try {
    for (const bin of LIBRE_BINS) {
      try {
        await execFileAsync(
          bin,
          ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inFile],
          { timeout: 90_000 },
        );
        const outFile = path.join(tmpDir, 'input.pdf');
        if (fs.existsSync(outFile)) {
          return await fsp.readFile(outFile);
        }
        errors.push(`${bin}: no output PDF`);
      } catch (err) {
        errors.push(`${bin}: ${err.message || err}`);
      }
    }
    throw new Error(errors.join(' | ') || 'LibreOffice did not produce a PDF');
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Readable but layout-free PDF from DOCX text — always available without LibreOffice.
 */
async function exportPlainTextPdfFromDocx(docxBuffer) {
  const ir = await parseDocxBuffer(docxBuffer);
  const lines = (ir.paragraphs || [])
    .map((p) => String(p.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const lineHeight = 13;
  const margin = 48;
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const maxWidth = pageWidth - margin * 2;
  const maxY = pageHeight - margin;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = maxY;

  const wrapLine = (text) => {
    const words = text.split(/\s+/);
    const out = [];
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, fontSize) <= maxWidth) {
        cur = trial;
      } else {
        if (cur) out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };

  page.drawText('Redacted document (text PDF — layout not preserved)', {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= lineHeight * 1.6;

  for (const para of lines) {
    for (const wrapped of wrapLine(para)) {
      if (y < margin + lineHeight) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = maxY;
      }
      page.drawText(wrapped.slice(0, 2000), {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
    y -= lineHeight * 0.35;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
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
 * @returns {Promise<{ buffer: Buffer|null, pdfMetaScrub: object|null, error: string|null, fallback?: string }>}
 */
async function exportSanitizedPdf(docxBuffer) {
  try {
    let raw;
    let fallback = null;
    try {
      raw = await tryLibreConvertToPdf(docxBuffer);
    } catch (libreErr) {
      raw = await exportPlainTextPdfFromDocx(docxBuffer);
      fallback = `text-pdf (${libreErr.message || 'LibreOffice unavailable'})`;
    }
    const { buffer, stripped, before } = await scrubPdfMetadata(raw);
    return {
      buffer,
      pdfMetaScrub: { stripped, before, fallback },
      error: null,
      fallback,
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
  libreConvertToPdf: tryLibreConvertToPdf,
  exportPlainTextPdfFromDocx,
};
