'use strict';

/**
 * Normalize uploaded documents to .docx for the redaction pipeline.
 * Accepts common document formats; pipeline still works on DOCX IR + apply.
 */

const JSZip = require('jszip');
const { libreConvert } = require('../officeConvert');

/** Extensions accepted at upload (lowercase, with dot). */
const ACCEPTED_EXTENSIONS = [
  '.docx',
  '.doc',
  '.odt',
  '.rtf',
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.html',
  '.htm',
];

const ACCEPTED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
  'application/octet-stream', // some browsers send this for .doc / .docx
]);

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm']);
const LIBRE_EXTENSIONS = new Set(['.doc', '.odt', '.rtf']);

function extOf(filename) {
  const base = String(filename || '').toLowerCase();
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i) : '';
}

function isAcceptedUpload(filename, mimetype) {
  const ext = extOf(filename);
  if (ACCEPTED_EXTENSIONS.includes(ext)) return true;
  const mime = String(mimetype || '').toLowerCase();
  return ACCEPTED_MIMES.has(mime);
}

function acceptAttribute() {
  return [
    '.docx', '.doc', '.odt', '.rtf',
    '.pdf',
    '.txt', '.md', '.csv', '.json', '.html',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'text/html',
  ].join(',');
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Minimal OOXML docx from plain paragraphs (same shape as pipeline tests).
 * @param {string[]} paragraphs
 * @returns {Promise<Buffer>}
 */
async function buildDocxFromParagraphs(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const lines = (paragraphs || []).length
    ? paragraphs
    : ['(empty document)'];
  const body = lines.map((t) => {
    const safe = escapeXml(t);
    return `<w:p><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  }).join('');
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function textToParagraphs(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = raw.split('\n');
  const maxParas = 8000;
  return parts.slice(0, maxParas);
}

async function extractPdfTextFromBuffer(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const getDocument = pdfjsLib.getDocument || pdfjsLib.default?.getDocument;
  if (!getDocument) throw new Error('pdfjs-dist getDocument unavailable');
  const data = new Uint8Array(buffer);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items || []).map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
    if (line) pages.push(line);
    pages.push('');
  }
  return pages.join('\n').trim();
}

/**
 * @param {{ buffer: Buffer, filename?: string, mimetype?: string }} opts
 */
async function normalizeUploadToDocx({ buffer, filename, mimetype }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('File buffer required');
    err.status = 400;
    throw err;
  }

  const originalFilename = filename || 'upload.docx';
  let ext = extOf(originalFilename);

  if (!ext) {
    const mime = String(mimetype || '').toLowerCase();
    if (mime.includes('pdf')) ext = '.pdf';
    else if (mime.includes('msword')) ext = '.doc';
    else if (mime.includes('wordprocessingml')) ext = '.docx';
    else if (mime.startsWith('text/')) ext = '.txt';
    else ext = '.docx';
  }

  if (!isAcceptedUpload(originalFilename, mimetype) && !ACCEPTED_EXTENSIONS.includes(ext)) {
    const err = new Error(
      `Unsupported file type (${ext || 'unknown'}). Upload .docx, .doc, .pdf, .txt, .odt, .rtf, .md, .csv, .json, or .html.`,
    );
    err.status = 400;
    throw err;
  }

  if (ext === '.docx') {
    return {
      docxBuffer: buffer,
      sourceExt: ext,
      converted: false,
      conversionNote: null,
      originalFilename,
    };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const text = buffer.toString('utf8');
    if (!text.trim()) {
      const err = new Error('Uploaded text file is empty');
      err.status = 400;
      throw err;
    }
    const docxBuffer = await buildDocxFromParagraphs(textToParagraphs(text));
    return {
      docxBuffer,
      sourceExt: ext,
      converted: true,
      conversionNote: `Converted ${ext} text into a working .docx for redaction.`,
      originalFilename,
    };
  }

  if (ext === '.pdf') {
    // Prefer the same LibreOffice PDF→Word path as PDF Tools for better layout.
    try {
      const docxBuffer = await libreConvert(buffer, '.pdf', 'docx');
      return {
        docxBuffer,
        sourceExt: ext,
        converted: true,
        conversionNote:
          'Converted PDF → .docx via LibreOffice (same engine as PDF Tools → PDF → Word).',
        originalFilename,
      };
    } catch (libreErr) {
      let text;
      try {
        text = await extractPdfTextFromBuffer(buffer);
      } catch (err) {
        const e = new Error(
          `Could not convert PDF. LibreOffice: ${libreErr.message}. Text extract: ${err.message}. `
          + 'Tip: open PDF Tools → PDF → Word, then upload the .docx here.',
        );
        e.status = 400;
        throw e;
      }
      if (!text.trim()) {
        const err = new Error(
          'PDF has no extractable text and LibreOffice conversion failed. '
          + 'Use PDF Tools → PDF → Word for a layout-preserving .docx, then upload that.',
        );
        err.status = 400;
        throw err;
      }
      const docxBuffer = await buildDocxFromParagraphs(textToParagraphs(text));
      return {
        docxBuffer,
        sourceExt: ext,
        converted: true,
        conversionNote:
          'LibreOffice unavailable — extracted text into a working .docx (layout not preserved). '
          + 'For better layout use PDF Tools → PDF → Word, then upload the .docx.',
        originalFilename,
      };
    }
  }

  if (LIBRE_EXTENSIONS.has(ext)) {
    try {
      const docxBuffer = await libreConvert(buffer, ext, 'docx');
      return {
        docxBuffer,
        sourceExt: ext,
        converted: true,
        conversionNote: `Converted ${ext} to .docx via LibreOffice (same engine as PDF Tools).`,
        originalFilename,
      };
    } catch (err) {
      const e = new Error(
        `Could not convert ${ext} to .docx. Use PDF Tools → Office → PDF / PDF → Word, or upload a .docx. (${err.message})`,
      );
      e.status = 400;
      throw e;
    }
  }

  const err = new Error(
    `Unsupported file type (${ext}). Upload .docx, .doc, .pdf, .txt, .odt, .rtf, .md, .csv, .json, or .html.`,
  );
  err.status = 400;
  throw err;
}

module.exports = {
  ACCEPTED_EXTENSIONS,
  isAcceptedUpload,
  acceptAttribute,
  normalizeUploadToDocx,
  buildDocxFromParagraphs,
};
