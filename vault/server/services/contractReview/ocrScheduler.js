'use strict';

/**
 * Contract Review's own tesseract.js worker pool — NOT the same singleton as
 * server/routes/translate.js's getScheduler() (module-private there, not
 * exported, out of bounds to touch for this feature). A deliberate small
 * duplication over reaching into translate.js internals. See docs/contract-
 * review-spec.md's Decisions Log, Stage 2.
 *
 * Deliberately 'eng' only, not translate.js's full eng+fra+deu+spa+ita+por+
 * chi_sim+jpn — Contract Review only handles English-language contracts
 * (per this feature's scope; multi-language support isn't part of the spec).
 * Loading 7 unused language models per worker was pure overhead.
 *
 * Idle shutdown: workers are terminated after a period of no OCR activity,
 * rather than held open for the process's entire lifetime — Contract
 * Review's ingest is bursty (uploads, not constant traffic), so an idle
 * pool just holds memory for no benefit. Lazily re-initialized on next use.
 */

const OCR_LANGS = 'eng';
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000; // 5 minutes of no OCR activity

let schedulerPromise = null;
let idleTimer = null;

function armIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const promise = schedulerPromise;
    schedulerPromise = null;
    idleTimer = null;
    if (!promise) return;
    try {
      const scheduler = await promise;
      await scheduler.terminate();
      console.log('[contract-review] Tesseract worker pool terminated after idle timeout');
    } catch (err) {
      console.warn('[contract-review] Tesseract idle-shutdown terminate failed (non-fatal):', err.message);
    }
  }, IDLE_SHUTDOWN_MS);
  idleTimer.unref?.(); // never keep the process alive just for this timer
}

async function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const { createScheduler, createWorker } = require('tesseract.js');
      const scheduler = createScheduler();
      const workers = await Promise.all(
        Array.from({ length: 4 }, () => createWorker(OCR_LANGS))
      );
      workers.forEach((w) => scheduler.addWorker(w));
      console.log('[contract-review] Tesseract worker pool ready (4 workers, eng only)');
      return scheduler;
    })();
  }
  armIdleShutdown();
  return schedulerPromise;
}

/** Recognizes text in an image buffer, returning { text, confidence }. */
async function recognize(imageBuffer) {
  const scheduler = await getScheduler();
  const result = await scheduler.addJob('recognize', imageBuffer);
  armIdleShutdown(); // reset the idle window — activity just happened
  return { text: result.data.text, confidence: result.data.confidence };
}

module.exports = {
  getScheduler,
  recognize,
  OCR_LANGS,
};
