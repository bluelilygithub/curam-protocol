'use strict';

/**
 * Contract Review's own PDF text extraction — poppler's pdftotext (already
 * installed via poppler-utils, same Dockerfile entry as pdfRasterize.js's
 * pdftoppm), NOT translateExtract.js's extractFromPdf/pdf-parse. Reversing
 * an earlier decision: pdf-parse's bundled pdfjs (v1.10.100) has two
 * confirmed, real, unfixed failure modes (cold-start and DB-adjacency —
 * see docs/contract-review-spec.md's Decisions Log for the full
 * investigation, including two structural fixes that were tried, measured
 * against the real deployed runtime, and still left a non-trivial residual
 * failure rate). The problem is the old bundled decoder itself, not how
 * ingest.js called it — no amount of retrying, warming up, or process
 * isolation fixes a bug in the library. pdftotext is an actively
 * maintained, independent binary with none of these failure modes.
 *
 * DOCX stays on mammoth via translateExtract.js's extractForTranslate —
 * unaffected, no reason to touch it.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { splitParagraphs } = require('../translateExtract');

const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN || 'pdftotext';

async function isPdftotextAvailable() {
  try {
    await execFileAsync(PDFTOTEXT_BIN, ['-v'], { timeout: 5000 });
    return true;
  } catch (err) {
    // pdftotext -v exits non-zero on some builds despite printing version
    // info to stderr — ENOENT is the only failure that actually means
    // "not installed"; anything else means the binary ran.
    return err.code !== 'ENOENT';
  }
}

/**
 * Extracts PDF text via pdftotext, returning the same shape translateExtract
 * .js's extractFromPdf does: { sourceFormat, pageCount, paragraphsByPage,
 * pageLabels, pageTexts, scannedCandidatePages }.
 */
async function extractPdfViaPoppler(buffer) {
  const tmpDir = path.join(os.tmpdir(), `contract-review-pdftotext-${crypto.randomUUID()}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, 'input.pdf');
  const outFile = path.join(tmpDir, 'output.txt');
  await fsp.writeFile(inFile, buffer);

  try {
    try {
      // -layout preserves reading order/columns better than raw stream order.
      await execFileAsync(PDFTOTEXT_BIN, ['-layout', inFile, outFile], { timeout: 60_000 });
    } catch (err) {
      if (err.code === 'ENOENT') {
        const e = new Error('pdftotext is not available on this server (poppler-utils not installed)');
        e.code = 'ENOENT';
        throw e;
      }
      throw new Error(`pdftotext failed: ${err.message}`);
    }

    const raw = await fsp.readFile(outFile, 'utf8');
    // pdftotext emits a form-feed (\f) after every page, including the last
    // — split on it and drop the single trailing empty entry that produces.
    const rawPages = raw.split('\f');
    if (rawPages.length && rawPages[rawPages.length - 1].trim() === '') rawPages.pop();

    const paragraphsByPage = {};
    const pageLabels = {};
    const scannedCandidatePages = [];
    rawPages.forEach((pageText, idx) => {
      const pageNum = idx + 1;
      const paragraphs = splitParagraphs(pageText);
      paragraphsByPage[pageNum] = paragraphs;
      pageLabels[pageNum] = `Page ${pageNum}`;
      // Same rule translateExtract.js's extractFromPdf uses for
      // scannedCandidatePages: near-zero text density -> likely scanned.
      const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0);
      if (totalChars < 20) scannedCandidatePages.push(pageNum);
    });

    return {
      sourceFormat: 'pdf',
      pageCount: rawPages.length || 1,
      paragraphsByPage,
      pageLabels,
      pageTexts: null,
      scannedCandidatePages,
    };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  extractPdfViaPoppler,
  isPdftotextAvailable,
};
