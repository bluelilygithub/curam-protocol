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

const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

const { pool } = require('../../db');
const { rasterizePages, isPdftoppmAvailable } = require('./pdfRasterize');
const { recognize } = require('./ocrScheduler');

const MAX_PAGES = 300;
const MAX_CHARS = 2_000_000;

// pdf-parse's bundled pdfjs (v1.10.100, inside translateExtract.js's
// extractForTranslate) has TWO confirmed failure modes, both tested
// directly against the real deployed runtime (Node 20 in the Railway
// container — this dev machine runs Node 24, which behaves differently; an
// earlier fix here was reasoned from Node 24 behavior alone and was wrong):
//   1. Cold-start: the first 1-2 extraction calls in any freshly-started
//      process fail reliably.
//   2. DB-adjacency: even in an already-warm process, a DB query awaited
//      immediately before the extraction call fails at a real, material
//      rate (measured 9/20 = 45% on Node 20, warm, matching
//      ingestDocument's own real shape).
// A "run each call in a fresh child process" fix (tried first) only avoids
// mode 2 while guaranteeing mode 1 on every single call (measured 10/10
// fails). A "warm up once, then extract in the same process as
// ingestDocument's own DB calls" fix (tried second) only avoids mode 1 and
// leaves mode 2 fully exposed. The actual fix needs a process that is BOTH
// warm AND never shares an event loop with DB I/O, for its entire
// lifetime — a persistent, long-lived worker process (extractWorker.js,
// forked once via child_process.fork, kept alive and reused for every
// extraction) does both: it warms up once at fork time, then handles every
// real request in a process whose only job, ever, is extraction — no DB
// call is ever adjacent to one there. The bounded retry below is a backstop
// for whatever residual rate remains (none observed once both modes are
// addressed), not the primary defense. Every failure observed, across both
// investigations and every trial, was a loud thrown exception — never a
// silent, successfully-returned-but-wrong extractedText — so a corrupted
// extraction could never silently become "ground truth" for spans/lineage/
// corrections regardless of which fix was in place. Logged as a
// Suggestions-inbox alert against translateExtract.js itself (shared with
// Translate's live production route — translate.js calls extractForTranslate
// directly, in-process, with its own DB work immediately around each
// extraction on every real upload, the exact shape that reproduces mode 2
// at a real rate; the same persistent-worker fix would apply there). Not
// fixed in translate.js — out of scope for this feature. See docs/contract-
// review-spec.md's Decisions Log for the full investigation, including
// both earlier fixes that were tried, measured, and found wrong before
// this one.
const KNOWN_PDF_PARSE_FLAKE = /Invalid PDF structure|Unknown compression method/;
const MAX_EXTRACTION_RETRIES = 3;
const EXTRACT_WORKER_SCRIPT = path.join(__dirname, 'extractWorker.js');
const EXTRACT_TIMEOUT_MS = 60_000;

let worker = null;
const pending = new Map();

function getExtractWorker() {
  if (worker) return worker;
  worker = fork(EXTRACT_WORKER_SCRIPT, { silent: false });
  worker.on('message', (msg) => {
    const entry = pending.get(msg.id);
    if (!entry) return; // workerBooted message, or a response after its own timeout already rejected
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.result);
  });
  worker.on('exit', (code) => {
    console.warn(`[contract-review] extraction worker exited (code ${code}) — will fork a new one on next use`);
    worker = null;
    for (const { reject } of pending.values()) reject(new Error('Extraction worker exited before responding'));
    pending.clear();
  });
  return worker;
}

async function extractViaWorker(buffer, filename, mimetype) {
  const w = getExtractWorker();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Extraction worker timed out after ${EXTRACT_TIMEOUT_MS / 1000}s`));
    }, EXTRACT_TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    w.send({ id, bufferB64: buffer.toString('base64'), filename, mimetype });
  });
}

async function extractPdfOrDocxWithRetry(buffer, doc, reviewId) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_RETRIES; attempt++) {
    try {
      return await extractViaWorker(buffer, doc.filename, doc.mimeType);
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
