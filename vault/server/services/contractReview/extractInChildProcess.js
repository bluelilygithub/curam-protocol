'use strict';

/**
 * Runs extractForTranslate for ONE document in its own child process,
 * invoked by ingest.js. This is the structural fix for pdf-parse's bundled
 * pdfjs corruption bug (confirmed via direct repro — see docs/contract-
 * review-spec.md's Decisions Log): the failure rate correlates specifically
 * with a DB query being awaited immediately, synchronously adjacent to the
 * extraction call in the SAME process (up to 80% in that exact shape,
 * matching ingestDocument's own real usage) — an event-loop tick-timing
 * collision, not pure randomness. Isolating extraction in a dedicated child
 * process with nothing else running removes the collision entirely (0
 * failures observed across ~75 combined trials with no other work sharing
 * that process). ingest.js still wraps this in a bounded retry as a
 * backstop, not the primary fix.
 *
 * Usage: node extractInChildProcess.js <inputFilePath> <filename> <mimetype> <outputFilePath>
 */

const fs = require('fs');
const { extractForTranslate } = require('../translateExtract');

async function main() {
  const [inputFilePath, filename, mimetype, outputFilePath] = process.argv.slice(2);
  if (!inputFilePath || !outputFilePath) throw new Error('inputFilePath and outputFilePath arguments required');

  const buffer = fs.readFileSync(inputFilePath);
  const result = await extractForTranslate({ buffer, filename, mimetype });
  fs.writeFileSync(outputFilePath, JSON.stringify(result));
  process.exit(0);
}

main().catch((err) => {
  const outputFilePath = process.argv[5];
  try {
    if (outputFilePath) fs.writeFileSync(outputFilePath, JSON.stringify({ error: err.message }));
  } catch (_) { /* best-effort */ }
  process.exit(1);
});
