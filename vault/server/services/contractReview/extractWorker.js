'use strict';

/**
 * Long-lived forked child process dedicated to extractForTranslate calls.
 * NEVER runs any DB query or anything else — its only job, for its entire
 * lifetime, is extraction requests received over the IPC channel. This is
 * the actual fix for pdf-parse's bundled pdfjs bug (see docs/contract-
 * review-spec.md's Decisions Log for the full investigation): confirmed
 * directly on the real production runtime (Node 20 in the Railway
 * container) that BOTH a cold-start failure mode (first 1-2 calls in any
 * fresh process) AND a separate DB-adjacency failure mode (a DB query
 * awaited immediately before extraction, even in an already-warm process —
 * 9/20 failures measured) are real. A warm-up-only fix (burn the cold-start
 * calls, then extract in the same process as ingestDocument's own DB
 * calls) only fixes the first mode. A fresh-child-process-per-call fix
 * (tried first, reverted) only fixes the second mode by accident while
 * guaranteeing the first one on every call. This worker fixes both by
 * construction: it warms up once, then handles every real request in a
 * process that never does anything else — no DB call is ever adjacent to
 * an extraction in this process, for as long as it stays alive.
 */

const { extractForTranslate } = require('../translateExtract');

async function warmUp() {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 200]);
  page.drawText('warm-up', { x: 20, y: 100, size: 12, font });
  const buffer = Buffer.from(await doc.save());
  const maxAttempts = 8;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await extractForTranslate({ buffer, filename: 'warmup.pdf', mimetype: 'application/pdf' });
      return;
    } catch (_) { /* expected on the first 1-2 cold-start calls, sometimes more */ }
  }
}

let ready = warmUp();

process.on('message', async (msg) => {
  const { id, bufferB64, filename, mimetype } = msg;
  try {
    await ready;
    const buffer = Buffer.from(bufferB64, 'base64');
    const result = await extractForTranslate({ buffer, filename, mimetype });
    process.send({ id, result });
  } catch (err) {
    process.send({ id, error: err.message });
  }
});

process.send({ workerBooted: true });
