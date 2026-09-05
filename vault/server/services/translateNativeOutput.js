'use strict';

/**
 * Native (editable) output for .xlsx / .docx sources — hands the client back the same file
 * format they uploaded, with translated text in place, instead of always converting to PDF.
 *
 * Xlsx is deterministic: `translateExtract.extractFromSpreadsheet` prefixes every paragraph with
 * its exact cell ref (`[A1] text`), so writing the translation back is a direct cell lookup — no
 * alignment guessing.
 *
 * Docx has no such anchor (mammoth only returns flattened text), so paragraph N of our extraction
 * is matched to the Nth non-empty <w:p> block in the original document.xml by position. If the
 * counts don't match — a doc with unusual structure (nested tables, text boxes) mammoth counts
 * differently than the raw XML — we refuse rather than guess wrong, and the caller falls back to
 * the existing PDF output for that job.
 */

function stripCellRef(text) {
  return String(text ?? '').replace(/^\[[A-Z]+\d+\]\s*/, '');
}

/** Write translated cell text back into the original workbook, preserving styling/formulas of
 *  untouched cells. Returns an .xlsx buffer, or null if no cells could be matched. */
function buildNativeXlsx({ originalBuffer, paragraphsByPage, translatedByPage, pageLabels }) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(originalBuffer, { type: 'buffer', cellDates: true });
  let matched = 0;

  for (const pageNum of Object.keys(paragraphsByPage).map(Number)) {
    const sheetName = pageLabels?.[pageNum];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) continue;

    const sources = paragraphsByPage[pageNum] || [];
    const targets = translatedByPage[pageNum] || [];
    sources.forEach((src, i) => {
      const m = /^\[([A-Z]+)(\d+)\]/.exec(src);
      if (!m) return;
      const cellRef = `${m[1]}${m[2]}`;
      const cell = sheet[cellRef];
      if (!cell) return;
      const translated = stripCellRef(targets[i]);
      if (!translated) return;
      cell.v = translated;
      cell.t = 's';
      delete cell.f;   // formula result no longer applies to translated text
      delete cell.w;   // drop cached formatted string so it's recomputed from the new value
      matched += 1;
    });
  }

  if (!matched) return null;
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function docxParagraphText(block) {
  const runs = block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
  return runs.map((r) => r.replace(/<[^>]+>/g, '')).join('').trim();
}

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Best-effort in-place docx rewrite. Returns a .docx buffer, or null if paragraph counts
 *  between our extraction and the raw document.xml don't line up (caller should fall back to PDF). */
async function buildNativeDocx({ originalBuffer, paragraphs, translations }) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(originalBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) return null;
  const xml = await docFile.async('string');

  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  const blocks = xml.match(paraRe) || [];
  const nonEmptyIdxs = [];
  blocks.forEach((b, i) => { if (docxParagraphText(b)) nonEmptyIdxs.push(i); });

  if (nonEmptyIdxs.length !== paragraphs.length) return null; // alignment mismatch — bail out

  nonEmptyIdxs.forEach((blockIdx, i) => {
    const translated = escapeXml(translations[i] || '');
    let first = true;
    blocks[blockIdx] = blocks[blockIdx].replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (whole, attrs) => {
      if (first) {
        first = false;
        const cleanAttrs = attrs.replace(/\s*xml:space="[^"]*"/g, '');
        return `<w:t${cleanAttrs} xml:space="preserve">${translated}</w:t>`;
      }
      return `<w:t${attrs}></w:t>`; // keep the run (formatting marks), drop its now-duplicate text
    });
  });

  let i = 0;
  const newXml = xml.replace(paraRe, () => blocks[i++]);
  zip.file('word/document.xml', newXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildNativeXlsx, buildNativeDocx };
