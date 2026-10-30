'use strict';

// Plain text out of one email attachment, for Email Follow-Up (case model §2: every attachment is a source).
// Result is always one of three states (Rule 2.6): parsed, reference_only (kept, with the reason it was not read), failed.
// The text is DATA from an untrusted file (Rule 12.1): only the visible text content of the file is taken. Metadata, form-field names
// and scripts are never read into the case, so there is nothing in them to act on. Hidden text (white-on-white) IS part of the text
// layer and is kept as data, like any other text; it can never do anything because nothing in the pipeline obeys text.
// Types read: PDF with a text layer, Word (.docx), plain text / CSV / Markdown. Not read in this version: scans and pictures (no OCR),
// spreadsheets (the installed reader is too old to trust with strangers' files), anything else.

const { extractPdfTextFromBuffer } = require('../../utils/pdfText');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 60000;
const PARSE_TIMEOUT_MS = 25000;
const PARSER_VERSION = 'efat-1';

const EXT = (name) => String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';

function sniff(buf) {
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') return 'image';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
  if (buf.length >= 4 && buf.slice(0, 3).toString('latin1') === 'GIF') return 'image';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image';
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'program';          // MZ: Windows program
  if (buf.length >= 4 && buf[0] === 0x7f && buf.slice(1, 4).toString('latin1') === 'ELF') return 'program';
  if (buf.length >= 2 && buf.slice(0, 2).toString('latin1') === '#!') return 'program';   // script
  return 'other';
}

function isMostlyText(buf) {
  const sample = buf.slice(0, 4000);
  if (!sample.length) return false;
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 9) || (b > 13 && b < 32)) bad += 1;
  return bad / sample.length < 0.02;
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('took too long to read')), ms); })]).finally(() => clearTimeout(t));
}

function result(parseStatus, text, parser, parseReason) {
  return { parseStatus, text: text || '', parser: parser ? `${parser}/${PARSER_VERSION}` : null, parseReason: parseReason || null };
}

/** Decide, from the name, type and size alone, whether the file is worth downloading. Saves a download for pictures and big files. */
function planAttachment({ filename, mimeType, size }) {
  const ext = EXT(filename);
  const mime = String(mimeType || '').toLowerCase();
  if (size && size > MAX_BYTES) return { fetch: false, parseStatus: 'reference_only', parseReason: `larger than ${MAX_BYTES / 1024 / 1024} MB: not read` };
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic'].includes(ext)) {
    return { fetch: false, parseStatus: 'reference_only', parseReason: 'picture: its text is not read in this version (no OCR)' };
  }
  if (['xls', 'xlsx', 'xlsm', 'ods'].includes(ext)) return { fetch: false, parseStatus: 'reference_only', parseReason: 'spreadsheet: not read in this version' };
  if (['pdf', 'docx', 'txt', 'csv', 'md', 'text'].includes(ext) || mime === 'application/pdf' || mime.startsWith('text/')
    || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return { fetch: true };
  return { fetch: false, parseStatus: 'reference_only', parseReason: `${ext ? `.${ext}` : 'this'} file type is not read in this version` };
}

/**
 * @param {{filename: string, mimeType?: string, buffer: Buffer}} f
 * @returns {Promise<{parseStatus: 'parsed'|'reference_only'|'failed', text: string, parser: string|null, parseReason: string|null}>}
 */
async function extractAttachmentText({ filename, mimeType, buffer }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return result('failed', '', null, 'the file is empty');
  if (buffer.length > MAX_BYTES) return result('reference_only', '', null, `larger than ${MAX_BYTES / 1024 / 1024} MB: not read`);
  const ext = EXT(filename);
  const kind = sniff(buffer);

  // The file's real type is what its first bytes say, never its name (a program renamed .pdf is still a program).
  if (kind === 'program') return result('failed', '', null, 'looks like a program or script, not a document: not opened');
  if (kind === 'image') return result('reference_only', '', null, 'picture: its text is not read in this version (no OCR)');

  try {
    if (kind === 'pdf') {
      let pages;
      try { pages = await withTimeout(extractPdfTextFromBuffer(buffer), PARSE_TIMEOUT_MS); }
      catch (e) {
        if (/password/i.test(String(e.message))) return result('failed', '', 'pdfjs', 'password protected');
        return result('failed', '', 'pdfjs', `could not read the PDF (${String(e.message).slice(0, 80)})`);
      }
      const text = pages.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (text.length < 20) return result('reference_only', '', 'pdfjs', 'no text layer (a scan or a picture of a page): its text is not read in this version (no OCR)');
      return result('parsed', text.slice(0, MAX_CHARS), 'pdfjs', text.length > MAX_CHARS ? `cut at ${MAX_CHARS} characters` : null);
    }
    if (kind === 'zip') {
      if (ext !== 'docx') return result('reference_only', '', null, 'a zip-based file other than Word: not read in this version');
      const mammoth = require('mammoth');
      const out = await withTimeout(mammoth.extractRawText({ buffer }), PARSE_TIMEOUT_MS);
      const text = String(out.value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (text.length < 5) return result('reference_only', '', 'mammoth', 'the document has no text');
      return result('parsed', text.slice(0, MAX_CHARS), 'mammoth', text.length > MAX_CHARS ? `cut at ${MAX_CHARS} characters` : null);
    }
    if (['txt', 'csv', 'md', 'text'].includes(ext) || String(mimeType || '').startsWith('text/')) {
      if (!isMostlyText(buffer)) return result('failed', '', null, 'not plain text');
      const text = buffer.toString('utf8').replace(/\r/g, '').trim();
      if (!text) return result('reference_only', '', null, 'the file has no text');
      return result('parsed', text.slice(0, MAX_CHARS), 'text', text.length > MAX_CHARS ? `cut at ${MAX_CHARS} characters` : null);
    }
    return result('reference_only', '', null, `${ext ? `.${ext}` : 'this'} file type is not read in this version`);
  } catch (e) {
    return result('failed', '', null, `could not read the file (${String(e.message).slice(0, 80)})`);
  }
}

module.exports = { extractAttachmentText, planAttachment, sniff, MAX_BYTES, MAX_CHARS, PARSER_VERSION };
