'use strict';

/**
 * Extract translate-ready paragraphs from PDF, Word (.docx), or spreadsheet (.xlsx/.xls).
 * Returns { sourceFormat, pageCount, paragraphsByPage, pageLabels }.
 * paragraphsByPage keys are 1-based "pages" (PDF pages, or sheets for spreadsheets, or 1 for Word).
 */

const path = require('path');

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

function extOf(filename = '') {
  return path.extname(filename).toLowerCase();
}

// Extension takes priority over browser-reported mimetype. Confirmed on a real upload: a file
// named `*.doc` whose browser-reported mimetype happened to be the DOCX one (browsers/OS content
// sniffing gets this wrong often enough) matched `ext === '.docx' || mt === MIME.docx` on the
// *docx* branch before ever reaching the `.doc` branch below it — since the check was OR'd on
// mimetype too, a mislabeled/misreported .doc slipped through as if it were docx: extraction
// "worked", a native Word download appeared, and the explicit "legacy .doc is rejected" gate
// never fired. Extension is the reliable, user-intended signal here — mimetype is only a
// fallback for the rare upload with no filename extension at all.
function detectSourceFormat(filename, mimetype = '') {
  const ext = extOf(filename);
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.doc') return 'doc';
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.xls') return 'xls';

  const mt = String(mimetype || '').toLowerCase();
  if (mt === MIME.pdf) return 'pdf';
  if (mt === MIME.docx) return 'docx';
  if (mt === MIME.doc) return 'doc';
  if (mt === MIME.xlsx) return 'xlsx';
  if (mt === MIME.xls) return 'xls';
  return null;
}

function isAllowedUpload(filename, mimetype) {
  return Boolean(detectSourceFormat(filename, mimetype));
}

// Terminal punctuation (incl. closing quotes/brackets after it) that marks a real sentence/para end.
const TERMINAL_RE = /[.!?:;""''\)\]]\s*$/;
// Word broken across a line wrap with a hyphen (e.g. "re-" / "appli-"). Typeset PDF text can use
// any of several hyphen-like characters for this, not just ASCII '-': U+2010 HYPHEN, U+2011
// NON-BREAKING HYPHEN, U+00AD SOFT HYPHEN, U+2012 FIGURE DASH — pdf-parse passes through
// whatever codepoint the font/PDF producer embedded, so matching only ASCII '-' silently missed
// real mid-word breaks.
const HYPHEN_BREAK_RE = /[A-Za-zÀ-ÿĀ-ž][-­‐‑‒]$/;
// A short run of Title-Case words with no internal punctuation/quotes/slashes — a form-field
// label ("Make", "Application Date"), not prose. Capitalisation is NOT a reliable "new sentence"
// signal otherwise: French capitalises defined terms, and quoted mid-sentence words are capitalised
// too (both were wrongly blocking merges before).
function isLabelLike(s) {
  const t = String(s || '').trim();
  if (!t || /["'()[\]/]/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length <= 3 && words.every((w) => /^[A-ZÀ-Ž][a-zà-ž'-]*$/.test(w));
}

/**
 * Merge PDF/line-extraction fragments that were split mid-sentence by layout noise
 * (uneven leading, wrapped lines, mid-word hyphenation) rather than by real paragraph breaks.
 * A fragment merges into the next one unless it already ends a sentence, or both it and the
 * next fragment look like standalone short field labels (kept separate so form headers like
 * "Make" / "Model" don't get run together).
 */
function stitchFragments(paragraphs) {
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const out = [];
  for (const raw of list) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && HYPHEN_BREAK_RE.test(prev)) {
      // Word split mid-hyphenation across a line wrap — rejoin without space, drop the hyphen.
      out[out.length - 1] = `${prev.slice(0, -1)}${p}`;
    } else if (
      prev !== undefined
      && !TERMINAL_RE.test(prev)
      && !(isLabelLike(prev) && isLabelLike(p))
    ) {
      out[out.length - 1] = `${prev} ${p}`;
    } else {
      out.push(p);
    }
  }
  return out;
}

function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 1);
}

async function extractFromPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const pageTexts = {};
  let pageCount = 0;

  await pdfParse(buffer, {
    pagerender: (pageData) => pageData.getTextContent().then((tc) => {
      const pageNum = pageData.pageNumber;
      pageCount = Math.max(pageCount, pageNum);
      pageTexts[pageNum] = tc.items.map((item) => ({
        text: item.str,
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
        w: Math.round(item.width),
        h: Math.round(item.height || 12),
      }));
      return '';
    }),
  });

  const paragraphsByPage = {};
  const pageLabels = {};
  for (const [pageStr, items] of Object.entries(pageTexts)) {
    const pageNum = parseInt(pageStr, 10);
    pageLabels[pageNum] = `Page ${pageNum}`;
    const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines = [];
    for (const item of sorted) {
      if (!item.text.trim()) continue;
      const existing = lines.find((l) => Math.abs(l.y - item.y) <= 4);
      if (existing) existing.parts.push(item.text);
      else lines.push({ y: item.y, h: item.h || 12, parts: [item.text] });
    }
    const paragraphs = [];
    let current = [];
    let prevY = null;
    let prevH = 12;
    for (const line of lines) {
      const lineText = line.parts.join(' ').trim();
      if (!lineText) continue;
      if (prevY !== null && Math.abs(prevY - line.y) > prevH * 1.5) {
        if (current.length) {
          paragraphs.push(current.join(' '));
          current = [];
        }
      }
      current.push(lineText);
      prevY = line.y;
      prevH = line.h;
    }
    if (current.length) paragraphs.push(current.join(' '));
    paragraphsByPage[pageNum] = stitchFragments(paragraphs.filter((p) => p.length > 1));
  }

  return {
    sourceFormat: 'pdf',
    pageCount,
    paragraphsByPage,
    pageLabels,
    pageTexts,
    scannedCandidatePages: Object.entries(pageTexts)
      .filter(([, items]) => items.reduce((s, i) => s + i.text.length, 0) < 20)
      .map(([p]) => parseInt(p, 10)),
  };
}

async function extractFromDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const paragraphs = splitParagraphs(result.value);
  if (!paragraphs.length) {
    throw new Error('No extractable text found in Word document');
  }
  return {
    sourceFormat: 'docx',
    pageCount: 1,
    paragraphsByPage: { 1: paragraphs },
    pageLabels: { 1: 'Document' },
    pageTexts: null,
    scannedCandidatePages: [],
  };
}

function colLetter(n) {
  let s = '';
  let x = n;
  while (x >= 0) {
    s = String.fromCharCode((x % 26) + 65) + s;
    x = Math.floor(x / 26) - 1;
  }
  return s;
}

async function extractFromSpreadsheet(buffer, sourceFormat) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames?.length) {
    throw new Error('Spreadsheet has no sheets');
  }

  const paragraphsByPage = {};
  const pageLabels = {};
  let pageNum = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const paras = [];
    rows.forEach((row, rIdx) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, cIdx) => {
        const text = String(cell ?? '').trim();
        if (text.length <= 1) return;
        // Skip pure numbers / dates that look non-linguistic
        if (/^[\d\s.,%$€£¥/+-]+$/.test(text) && !/[A-Za-zÀ-ÿĀ-ž]/.test(text)) return;
        paras.push(`[${colLetter(cIdx)}${rIdx + 1}] ${text}`);
      });
    });
    if (!paras.length) continue;
    pageNum += 1;
    paragraphsByPage[pageNum] = paras;
    pageLabels[pageNum] = sheetName || `Sheet ${pageNum}`;
  }

  if (!pageNum) {
    throw new Error('No translatable text cells found in spreadsheet');
  }

  return {
    sourceFormat,
    pageCount: pageNum,
    paragraphsByPage,
    pageLabels,
    pageTexts: null,
    scannedCandidatePages: [],
  };
}

async function extractForTranslate({ buffer, filename, mimetype }) {
  const format = detectSourceFormat(filename, mimetype);
  if (!format) {
    throw new Error('Unsupported file type. Use PDF, Word (.docx), or Excel (.xlsx/.xls).');
  }
  if (format === 'pdf') return extractFromPdf(buffer);
  if (format === 'docx' || format === 'doc') {
    if (format === 'doc') {
      throw new Error('Legacy .doc is not supported — save as .docx and re-upload.');
    }
    return extractFromDocx(buffer);
  }
  return extractFromSpreadsheet(buffer, format);
}

module.exports = {
  MIME,
  detectSourceFormat,
  isAllowedUpload,
  extractForTranslate,
  splitParagraphs,
  stitchFragments,
};
