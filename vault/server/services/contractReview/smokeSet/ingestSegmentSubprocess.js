'use strict';

/**
 * Runs pipeline stages 1+2 (ingest + segment) for ONE document in its own
 * process, invoked by milestone2.test.js. Isolates each fixture's PDF
 * extraction into a fresh process — pdf-parse's bundled pdfjs has a real
 * cross-call state-corruption bug (confirmed via direct repro: extracting
 * two image-embedded PDFs, then any unrelated typed PDF, corrupts the third
 * call's flate-stream decoding) triggered only when 2+ image-bearing PDFs are
 * extracted in the same process before a later one. Flagged as a Suggestions-
 * inbox item against translateExtract.js/pdf-parse (shared production code,
 * out of bounds to fix here) — this subprocess isolation is the test-side
 * workaround, not a fix to the underlying dependency.
 *
 * Usage: node ingestSegmentSubprocess.js <documentId> <outputFilePath>
 * DATABASE_URL must already be set in the environment (inherited from the
 * parent test process, which already validated it via the TEST_DATABASE_URL
 * safety gate — this script does not re-validate it). The result is written
 * to outputFilePath as JSON, not to stdout — db.js's pino logger also writes
 * to stdout, and line-splitting to find "our" JSON among its output proved
 * fragile (confirmed while debugging: a pino line without its own trailing
 * newline merged with our payload on one "line"). A dedicated file sidesteps
 * that entirely.
 */

const fs = require('fs');
const { ingestDocument } = require('../ingest');
const { segmentDocument } = require('../segmentation');

async function main() {
  const documentId = Number(process.argv[2]);
  const outputFilePath = process.argv[3];
  if (!Number.isInteger(documentId)) throw new Error('documentId argument required');
  if (!outputFilePath) throw new Error('outputFilePath argument required');

  // Deliberately does NOT call initSchema() here. The parent test process
  // (milestone2.test.js) already awaits it once before spawning any
  // subprocess, which guarantees every table this script needs already
  // exists — re-running the entire ~150-statement app migration (every
  // Vault table, not just Contract Review's) on every single fixture/retry
  // is unnecessary network round-trip work and was the actual cause of this
  // script timing out under load (confirmed while debugging: a subprocess
  // invocation was killed by execFileAsync's timeout mid-migration, not by
  // any real extraction problem). db.js's own module-level auto-init chain
  // still fires on require regardless — that's pre-existing app boot
  // behavior, unrelated to this script's own logic.
  //
  // Also deliberately never calls pool.end() — a fresh, short-lived
  // subprocess's connections are torn down by process exit either way, and
  // explicitly ending the pool is what previously raced db.js's own
  // background chain into "Cannot use a pool after calling end on the pool".

  const ingestResult = await ingestDocument(documentId);
  let segResult = null;
  if (ingestResult.outcome === 'complete') {
    segResult = await segmentDocument(ingestResult.reviewId, ingestResult.extractedText, ingestResult.pageMap);
  }
  fs.writeFileSync(outputFilePath, JSON.stringify({
    reviewId: ingestResult.reviewId,
    outcome: ingestResult.outcome,
    extractedText: ingestResult.extractedText ?? null,
    pageMap: ingestResult.pageMap ?? null,
    segResult,
  }));
  process.exit(0);
}

main().catch((err) => {
  const outputFilePath = process.argv[3];
  try {
    if (outputFilePath) fs.writeFileSync(outputFilePath, JSON.stringify({ error: err.message }));
  } catch (_) { /* best-effort */ }
  process.exit(1);
});
