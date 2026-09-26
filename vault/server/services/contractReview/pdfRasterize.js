'use strict';

/**
 * Contract Review — server-side PDF page rasterization for the OCR fallback
 * (pipeline stage 1). Shells out to `pdftoppm` (poppler-utils), matching the
 * existing subprocess-tool pattern in server/services/officeConvert.js
 * (libreConvert). Chosen over pdfjs-dist + canvas to avoid a native-module npm
 * build — see docs/contract-review-spec.md's Decisions Log, Stage 2.
 *
 * translate.js's OCR fallback is fed by client-rendered page images (browser
 * pdf.js canvas) — checked directly, confirmed no code in this repo
 * rasterizes a PDF page server-side. This module fills that gap for Contract
 * Review's upload flow, which has no browser-rendering step. translate.js is
 * untouched.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PDFTOPPM_BIN = process.env.PDFTOPPM_BIN || 'pdftoppm';

/**
 * Rasterizes specific 1-indexed pages of a PDF to grayscale PNG buffers.
 * @param {Buffer} pdfBuffer
 * @param {number[]} pageNumbers — 1-indexed pages to rasterize
 * @param {{dpi?: number, maxPages?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<{[pageNum: number]: Buffer}>}
 */
async function rasterizePages(pdfBuffer, pageNumbers, opts = {}) {
  const dpi = opts.dpi || 300;
  const maxPages = opts.maxPages || 60;
  const timeoutMs = opts.timeoutMs || 120_000;

  const pages = [...new Set(pageNumbers || [])].filter((p) => Number.isInteger(p) && p > 0).sort((a, b) => a - b);
  if (!pages.length) return {};
  if (pages.length > maxPages) {
    throw new Error(`Too many scanned pages to OCR (${pages.length} > max ${maxPages}) — refusing to avoid an unbounded OCR run`);
  }

  const tmpDir = path.join(os.tmpdir(), `contract_review_pdf_${crypto.randomUUID()}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, 'input.pdf');
  await fsp.writeFile(inFile, pdfBuffer);

  try {
    const result = {};
    for (const pageNum of pages) {
      const outPrefix = path.join(tmpDir, `page_${pageNum}`);
      try {
        await execFileAsync(
          PDFTOPPM_BIN,
          ['-gray', '-r', String(dpi), '-f', String(pageNum), '-l', String(pageNum), '-png', inFile, outPrefix],
          { timeout: timeoutMs },
        );
      } catch (err) {
        if (err.code === 'ENOENT') {
          const e = new Error(`${PDFTOPPM_BIN} is not available on this server (poppler-utils not installed) — cannot OCR scanned pages`);
          e.code = 'ENOENT';
          throw e;
        }
        throw new Error(`pdftoppm failed on page ${pageNum}: ${err.message || err}`);
      }
      // pdftoppm with -f/-l equal to a single page still appends a
      // zero-padded page suffix (e.g. page_3-1.png for a single-page run,
      // or page_3-03.png depending on total pages in range) — find whatever
      // it actually produced rather than assuming an exact filename.
      const files = await fsp.readdir(tmpDir);
      const match = files.find((f) => f.startsWith(`page_${pageNum}-`) && f.endsWith('.png'));
      if (!match) throw new Error(`pdftoppm did not produce output for page ${pageNum}`);
      result[pageNum] = await fsp.readFile(path.join(tmpDir, match));
    }
    return result;
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** True if pdftoppm is reachable on PATH — used by tests to skip OCR-dependent
 * assertions with a clear log line instead of a silent false pass. */
async function isPdftoppmAvailable() {
  try {
    await execFileAsync(PDFTOPPM_BIN, ['-v'], { timeout: 5000 });
    return true;
  } catch (err) {
    // pdftoppm -v exits non-zero on some builds despite printing version info
    // to stderr — ENOENT is the only failure that actually means "not
    // installed"; anything else means the binary ran.
    return err.code !== 'ENOENT';
  }
}

module.exports = {
  rasterizePages,
  isPdftoppmAvailable,
};
