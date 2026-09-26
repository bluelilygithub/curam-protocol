'use strict';

/**
 * Contract Review's own tesseract.js worker pool — mirrors server/routes/
 * translate.js's getScheduler() (same 4-worker shape, same OCR_LANGS) but is
 * NOT the same singleton. translate.js's scheduler is module-private (not
 * exported) and out of bounds to touch for this feature — duplicating a
 * second small pool is a deliberate tradeoff over reaching into translate.js
 * internals or a riskier shared-module refactor. See docs/contract-review-
 * spec.md's Decisions Log, Stage 2.
 *
 * Lazily initialized on first use (not at module load) — Contract Review's
 * OCR only runs inside the async ingest pipeline job, not on every server
 * boot, unlike translate.js which initializes at module load since its
 * upload route is hit immediately.
 */

const OCR_LANGS = 'eng+fra+deu+spa+ita+por+chi_sim+jpn';

let schedulerPromise = null;

async function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const { createScheduler, createWorker } = require('tesseract.js');
      const scheduler = createScheduler();
      const workers = await Promise.all(
        Array.from({ length: 4 }, () => createWorker(OCR_LANGS))
      );
      workers.forEach((w) => scheduler.addWorker(w));
      console.log('[contract-review] Tesseract worker pool ready (4 workers)');
      return scheduler;
    })();
  }
  return schedulerPromise;
}

/** Recognizes text in an image buffer, returning { text, confidence }. */
async function recognize(imageBuffer) {
  const scheduler = await getScheduler();
  const result = await scheduler.addJob('recognize', imageBuffer);
  return { text: result.data.text, confidence: result.data.confidence };
}

module.exports = {
  getScheduler,
  recognize,
  OCR_LANGS,
};
