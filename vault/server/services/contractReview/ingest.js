'use strict';

// Contract Review — Pipeline stage 1 (Ingest). Reuses translateExtract.js's
// extractFromPdf/extractFromDocx (page-aware, already computes
// scannedCandidatePages) rather than reinventing extraction. Scanned pages
// are rasterized via pdfRasterize.js (new — no server-side rasterizer existed
// anywhere in this repo, see docs/contract-review-spec.md's Decisions Log)
// and OCR'd via this feature's own ocrScheduler.js.
//
// Runs entirely inside the async pipeline job — never called from the upload
// request path. ContractService.addDocument stays extraction-free.

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const { pool } = require('../../db');
const { rasterizePages, isPdftoppmAvailable } = require('./pdfRasterize');
const { recognize } = require('./ocrScheduler');

const MAX_PAGES = 300;
const MAX_CHARS = 2_000_000;

// pdf-parse's bundled pdfjs (v1.10.100, inside translateExtract.js's
// extractForTranslate) has a confirmed non-deterministic corruption bug.
// Root-caused via direct repro: the failure rate tracks specifically with a
// DB query being awaited immediately, synchronously adjacent to the
// extraction call in the SAME process (this function's own real shape) —
// up to 80% (16/20) in that exact pattern — not pure randomness, and not
// simply "many extraction calls" (20 truly concurrent extractions with no
// DB: 0 failures; 20 serialized extractions with unrelated background DB
// churn not synchronized to each call: 1/20). That points at an event-loop
// tick-timing collision with pdf-parse's legacy setTimeout-based "fake
// worker" scheduling. STRUCTURAL FIX: extraction now runs in its own child
// process (extractInChildProcess.js) with nothing else sharing that
// process's event loop — 0 failures observed across ~75 combined trials
// whenever nothing else was running in the same process. The bounded retry
// below is kept only as a backstop for whatever residual rate remains, not
// the primary fix. Every failure observed, in every trial, was a loud
// thrown exception — never a silent, successfully-returned-but-wrong
// extractedText — so a corrupted extraction could never have silently
// become "ground truth" for spans/lineage/corrections even before this fix.
// Logged as a Suggestions-inbox alert against translateExtract.js itself
// (shared with Translate's live production route — Translate calls
// extractForTranslate directly, in-process, interleaved with its own DB
// work on every upload, so it very likely has the identical concurrency
// failure in production today; the same child-process isolation would fix
// it there too). Not fixed in translate.js — out of scope for this feature.
// See docs/contract-review-spec.md's Decisions Log for the full
// investigation, including before/after failure-rate measurements.
const KNOWN_PDF_PARSE_FLAKE = /Invalid PDF structure|Unknown compression method/;
const MAX_EXTRACTION_RETRIES = 3;
const EXTRACT_CHILD_SCRIPT = path.join(__dirname, 'extractInChildProcess.js');

async function extractInChildProcess(buffer, filename, mimetype) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inputFilePath = path.join(tmpDir, `contract-review-extract-in-${id}`);
  const outputFilePath = path.join(tmpDir, `contract-review-extract-out-${id}.json`);
  const fs = require('fs');
  fs.writeFileSync(inputFilePath, buffer);
  try {
    try {
      await execFileAsync(
        process.execPath, [EXTRACT_CHILD_SCRIPT, inputFilePath, filename, mimetype, outputFilePath],
        { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }
      );
      return JSON.parse(fs.readFileSync(outputFilePath, 'utf8'));
    } catch (err) {
      let message = err.message;
      try { message = JSON.parse(fs.readFileSync(outputFilePath, 'utf8')).error || message; } catch (_) { /* keep raw */ }
      const e = new Error(message);
      throw e;
    }
  } finally {
    try { fs.unlinkSync(inputFilePath); } catch (_) {}
    try { fs.unlinkSync(outputFilePath); } catch (_) {}
  }
}

async function extractPdfOrDocxWithRetry(buffer, doc, reviewId) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_RETRIES; attempt++) {
    try {
      return await extractInChildProcess(buffer, doc.filename, doc.mimeType);
    } catch (err) {
      if (/Unsupported file type|Legacy \.doc/.test(err.message || '')) {
        await markReviewNotSupported(reviewId, err.message);
        return { outcome: 'not_supported' };
      }
      lastErr = err;
      if (!KNOWN_PDF_PARSE_FLAKE.test(err.message || '') || attempt === MAX_EXTRACTION_RETRIES) break;
      console.warn(`[contract-review] known pdf-parse flake on review ${reviewId} (attempt ${attempt}/${MAX_EXTRACTION_RETRIES}) — retrying: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await markReviewFailed(reviewId, `Extraction failed after ${MAX_EXTRACTION_RETRIES} attempt(s): ${lastErr.message}`);
  throw lastErr;
}

/** Builds extractedText + pageMap from paragraphsByPage, in true page order
 * regardless of whether a given page's paragraphs came from the text layer
 * or OCR — paragraphsByPage is keyed by page number, so joining by sorted
 * numeric key keeps a mixed document's page order (and therefore every later
 * span) correct. */
function buildExtractedTextAndPageMap(paragraphsByPage, pageLabels, ocrPages) {
  const pageNums = Object.keys(paragraphsByPage).map(Number).sort((a, b) => a - b);
  let cursor = 0;
  const pageMap = {};
  const chunks = [];
  for (const pageNum of pageNums) {
    const paras = paragraphsByPage[pageNum] || [];
    const pageText = paras.join('\n\n');
    const startOffset = cursor;
    chunks.push(pageText);
    cursor += pageText.length;
    const endOffset = cursor;
    cursor += 2; // for the '\n\n' page separator appended below (except after the last page)
    pageMap[pageNum] = {
      startOffset,
      endOffset,
      label: (pageLabels && pageLabels[pageNum]) || `Page ${pageNum}`,
      ocrUsed: Boolean(ocrPages && ocrPages[pageNum]),
      ocrConfidence: (ocrPages && ocrPages[pageNum] && ocrPages[pageNum].confidence) || null,
    };
  }
  return { extractedText: chunks.join('\n\n'), pageMap };
}

/**
 * Runs pipeline stage 1 (ingest) for a document: extraction + OCR fallback.
 * Creates/updates the contract_reviews row itself (status/stageProgress are
 * real, not stubbed) so Stage 3+ can build on a genuine review lifecycle.
 * @returns {Promise<{reviewId: number, outcome: 'complete'|'not_supported', extractedText?: string, pageMap?: object}>}
 */
async function ingestDocument(documentId) {
  const { rows: [doc] } = await pool.query(
    `SELECT id, "contractId", "mimeType", "storedPath", filename FROM contract_documents WHERE id=$1`,
    [documentId]
  );
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const { rows: [review] } = await pool.query(
    `INSERT INTO contract_reviews
       ("documentId", "modelId", "promptVersion", "taxonomyVersion", "contractTypeEnumVersion", status, "stageProgress")
     VALUES ($1, 'none', 'v1', 'v1', 'v1', 'extracting', '{"stage":"ingest"}')
     RETURNING id`,
    [documentId]
  );
  const reviewId = review.id;

  const fs = require('fs');
  let buffer;
  try {
    buffer = fs.readFileSync(doc.storedPath);
  } catch (err) {
    await markReviewFailed(reviewId, `Could not read stored file: ${err.message}`);
    throw err;
  }

  const extracted = await extractPdfOrDocxWithRetry(buffer, doc, reviewId);
  if (extracted.outcome === 'not_supported') return { reviewId, outcome: 'not_supported' };
  if (extracted.sourceFormat !== 'pdf' && extracted.sourceFormat !== 'docx') {
    // Contract Review only supports PDF/DOCX uploads (per addDocument's
    // upload policy) — extractForTranslate also accepts .xlsx/.txt for
    // Translate's own use case, which are not real contract documents here.
    await markReviewNotSupported(reviewId, `Unsupported file type for Contract Review: ${extracted.sourceFormat}`);
    return { reviewId, outcome: 'not_supported' };
  }

  if (extracted.pageCount > MAX_PAGES) {
    await markReviewNotSupported(reviewId, `Document has ${extracted.pageCount} pages, exceeding the ${MAX_PAGES}-page limit`);
    return { reviewId, outcome: 'not_supported' };
  }

  const ocrPages = {};
  let ocrAttempted = false;
  if (extracted.sourceFormat === 'pdf' && (extracted.scannedCandidatePages || []).length) {
    ocrAttempted = true;
    const available = await isPdftoppmAvailable();
    if (!available) {
      // No rasterizer on this host (e.g. local dev without poppler-utils) —
      // proceed with whatever text-layer content exists rather than failing
      // the whole ingest; scanned pages simply stay empty. Real OCR coverage
      // is verified against the Railway staging deploy, which has
      // poppler-utils via the Dockerfile.
      console.warn(`[contract-review] pdftoppm unavailable — skipping OCR for review ${reviewId}, scanned pages will have no text`);
    } else {
      const images = await rasterizePages(buffer, extracted.scannedCandidatePages);
      for (const [pageStr, imageBuf] of Object.entries(images)) {
        const pageNum = Number(pageStr);
        const { text, confidence } = await recognize(imageBuf);
        const paras = String(text || '')
          .split(/\n{2,}/)
          .map((p) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
          .filter((p) => p.length > 1);
        extracted.paragraphsByPage[pageNum] = paras.length ? paras : (text.trim() ? [text.trim()] : []);
        ocrPages[pageNum] = { confidence };
      }
    }
  }

  const { extractedText, pageMap } = buildExtractedTextAndPageMap(
    extracted.paragraphsByPage, extracted.pageLabels, ocrPages
  );

  if (extractedText.length > MAX_CHARS) {
    await markReviewNotSupported(reviewId, `Document text exceeds ${MAX_CHARS} characters`);
    return { reviewId, outcome: 'not_supported' };
  }

  const ocrConfidences = Object.values(ocrPages).map((p) => p.confidence).filter((c) => typeof c === 'number');
  const ocrUsed = ocrConfidences.length > 0;
  const ocrConfidence = ocrUsed ? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length : null;

  await pool.query(
    `UPDATE contract_documents SET "extractedText"=$1, "pageMap"=$2, "ocrUsed"=$3, "ocrConfidence"=$4 WHERE id=$5`,
    [extractedText, JSON.stringify(pageMap), ocrUsed, ocrConfidence, documentId]
  );
  await pool.query(
    `UPDATE contract_reviews SET status='segmenting', "stageProgress"='{"stage":"segmentation"}' WHERE id=$1`,
    [reviewId]
  );

  return { reviewId, outcome: 'complete', extractedText, pageMap, ocrAttempted };
}

async function markReviewFailed(reviewId, errorMessage) {
  await pool.query(
    `UPDATE contract_reviews SET status='failed', "errorMessage"=$1, "completedAt"=NOW() WHERE id=$2`,
    [errorMessage, reviewId]
  );
}

async function markReviewNotSupported(reviewId, errorMessage) {
  await pool.query(
    `UPDATE contract_reviews SET status='not_supported', "errorMessage"=$1, "completedAt"=NOW() WHERE id=$2`,
    [errorMessage, reviewId]
  );
}

module.exports = {
  ingestDocument,
  buildExtractedTextAndPageMap,
};
