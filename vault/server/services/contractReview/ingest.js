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

const { pool } = require('../../db');
const { extractForTranslate } = require('../translateExtract');
const { rasterizePages, isPdftoppmAvailable } = require('./pdfRasterize');
const { recognize } = require('./ocrScheduler');

const MAX_PAGES = 300;
const MAX_CHARS = 2_000_000;

// pdf-parse's bundled pdfjs (v1.10.100, inside translateExtract.js's
// extractForTranslate) has a confirmed COLD-START bug, re-characterized
// after testing directly against the real deployed runtime (Node 20 in the
// Railway container — this dev machine runs Node 24, which does NOT show
// the same failure shape, an earlier false lead): the first 1-2 extraction
// calls in a freshly-started process fail reliably; every call afterward,
// in the SAME warm process, succeeds reliably (confirmed: 2/2 cold fails,
// then 0/18 warm, repeated). An EARLIER fix here isolated each extraction
// into its own fresh child process, reasoning from an event-loop-timing
// theory that held on Node 24 but is actively WRONG for Node 20 in
// production — a fresh child process is always cold, so that "fix"
// guaranteed hitting this bug on every single real extraction (confirmed:
// 10/10 fails via that path in the actual container). Reverted. The real
// fix for a long-lived server process (which only cold-starts once, at
// boot, not per-document) is to burn the cold-start failures against a
// throwaway warm-up call at module load, not a real user's document — see
// warmUpExtractor() below. The bounded retry stays as a backstop for
// whatever residual rate remains post-warm-up. Every failure observed, in
// every trial across both characterizations, was a loud thrown exception —
// never a silent, successfully-returned-but-wrong extractedText — so a
// corrupted extraction could never silently become "ground truth" for
// spans/lineage/corrections either way. Logged as a Suggestions-inbox
// alert against translateExtract.js itself (shared with Translate's live
// production route, likely affected the same way at server boot — much
// less severe there than the original per-document theory suggested,
// since Translate's process also only cold-starts once). Not fixed in
// translate.js — out of scope for this feature. See docs/contract-review-
// spec.md's Decisions Log for the full investigation and both
// characterizations, including why the first one was wrong.
const KNOWN_PDF_PARSE_FLAKE = /Invalid PDF structure|Unknown compression method/;
const MAX_EXTRACTION_RETRIES = 3;

// A minimal, valid one-page PDF (built once, lazily, via pdf-lib) used
// purely to absorb the cold-start failures at boot instead of a real
// document. Fire-and-forget — never blocks server startup, and any error
// here is expected/harmless (that's the whole point).
let warmedUp = false;
async function warmUpExtractor() {
  if (warmedUp) return;
  warmedUp = true;
  try {
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 200]);
    page.drawText('warm-up', { x: 20, y: 100, size: 12, font });
    const buffer = Buffer.from(await doc.save());
    for (let i = 0; i < 3; i++) {
      try {
        await extractForTranslate({ buffer, filename: 'warmup.pdf', mimetype: 'application/pdf' });
        console.log('[contract-review] pdf-parse warm-up succeeded');
        return;
      } catch (_) { /* expected on the first 1-2 cold-start calls */ }
    }
  } catch (err) {
    console.warn('[contract-review] pdf-parse warm-up failed unexpectedly (non-fatal):', err.message);
  }
}
warmUpExtractor();

async function extractPdfOrDocxWithRetry(buffer, doc, reviewId) {
  await warmUpExtractor(); // no-op after the first call
  let lastErr;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_RETRIES; attempt++) {
    try {
      return await extractForTranslate({ buffer, filename: doc.filename, mimetype: doc.mimeType });
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
