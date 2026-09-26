'use strict';

// Contract Review — Pipeline stage 1 (Ingest). PDFs go through pdftotext
// (pdfTextExtract.js — poppler-utils, NOT translateExtract.js/pdf-parse; see
// that file's header and docs/contract-review-spec.md's Decisions Log for
// why this reverses an earlier "reuse translateExtract.js for everything"
// decision). DOCX still reuses translateExtract.js's extractForTranslate
// (mammoth) — unaffected, no reason to touch it. Scanned pages are
// rasterized via pdfRasterize.js and OCR'd via this feature's own
// ocrScheduler.js.
//
// Runs entirely inside the async pipeline job — never called from the upload
// request path. ContractService.addDocument stays extraction-free.

const fs = require('fs');
const { pool } = require('../../db');
const { detectSourceFormat, extractForTranslate } = require('../translateExtract');
const { extractPdfViaPoppler, isPdftotextAvailable } = require('./pdfTextExtract');
const { rasterizePages, isPdftoppmAvailable } = require('./pdfRasterize');
const { recognize } = require('./ocrScheduler');

const MAX_PAGES = 300;
const MAX_CHARS = 2_000_000;

async function extractPdfOrDocx(buffer, doc, reviewId) {
  const format = detectSourceFormat(doc.filename, doc.mimeType);

  if (format === 'pdf') {
    if (!(await isPdftotextAvailable())) {
      const e = new Error('pdftotext is not available on this server (poppler-utils not installed)');
      e.code = 'ENOENT';
      throw e;
    }
    return extractPdfViaPoppler(buffer);
  }
  if (format === 'docx') {
    return extractForTranslate({ buffer, filename: doc.filename, mimetype: doc.mimeType });
  }
  const err = new Error(`Unsupported file type for Contract Review: ${format || 'unknown'}`);
  err.notSupported = true;
  throw err;
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

  let buffer;
  try {
    buffer = fs.readFileSync(doc.storedPath);
  } catch (err) {
    await markReviewFailed(reviewId, `Could not read stored file: ${err.message}`);
    throw err;
  }

  let extracted;
  try {
    extracted = await extractPdfOrDocx(buffer, doc, reviewId);
  } catch (err) {
    if (err.notSupported) {
      await markReviewNotSupported(reviewId, err.message);
      return { reviewId, outcome: 'not_supported' };
    }
    await markReviewFailed(reviewId, `Extraction failed: ${err.message}`);
    throw err;
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
