'use strict';

// Translate's OCR (tesseract.js) worker pool. Before 8 Nov 2026 server/routes/translate.js built it at BOOT: four workers, each holding eight
// language models, kept for as long as the server ran. Measured locally that was ~575 MB of the app's ~860 MB resting memory (283 MB without
// it), and Railway bills RAM by the minute. Now the pool is built on first use, kept while it is busy, and shut down after IDLE_SHUTDOWN_MS of no
// OCR work (the same approach as services/contractReview/ocrScheduler.js). The first scanned document after an idle spell waits a few seconds
// for the workers to start. Two workers instead of four by default (OCR_WORKERS to change); translate.js sends pages four at a time and the
// scheduler queues the extra ones.
//
// `getScheduler()` hands back a thin scheduler with `addJob(type, data)`. Every job re-arms the idle timer and counts as in flight, so a long
// document is never cut off by the idle shutdown (translate.js keeps one scheduler for a whole document, and OCR can take minutes).

const OCR_LANGS = 'eng+fra+deu+spa+ita+por+chi_sim+jpn';
const DEFAULT_WORKERS = 2;
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

function workerCountFromEnv(env = process.env) {
  const n = Number(env.OCR_WORKERS);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : DEFAULT_WORKERS;
}

function createOcrPool({
  langs = OCR_LANGS,
  workers = workerCountFromEnv(),
  idleMs = IDLE_SHUTDOWN_MS,
  loadTesseract = () => require('tesseract.js'),
  log = (m) => console.log(m),
} = {}) {
  let pool = null; // promise of the real scheduler, null while no pool exists
  let timer = null;
  let inFlight = 0;

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function armIdleShutdown() {
    clearTimer();
    if (inFlight > 0) return; // busy: it is armed again when the last job ends
    timer = setTimeout(async () => {
      timer = null;
      if (inFlight > 0 || !pool) return;
      const p = pool;
      pool = null; // a job arriving while it shuts down starts a fresh pool
      try {
        await (await p).terminate();
        log('[translate] OCR worker pool shut down after idle');
      } catch (err) {
        log(`[translate] OCR idle shutdown failed (non-fatal): ${err.message}`);
      }
    }, idleMs);
    if (timer.unref) timer.unref(); // never keep the process alive for this timer
  }

  function ensure() {
    if (!pool) {
      const made = (async () => {
        const { createScheduler, createWorker } = loadTesseract();
        const scheduler = createScheduler();
        const ws = await Promise.all(Array.from({ length: workers }, () => createWorker(langs)));
        ws.forEach((w) => scheduler.addWorker(w));
        log(`[translate] OCR worker pool ready (${workers} workers)`);
        return scheduler;
      })();
      pool = made;
      made.catch(() => { if (pool === made) pool = null; }); // a failed start is not kept: the next scan tries again
    }
    return pool;
  }

  const handle = {
    async addJob(type, data) {
      inFlight += 1;
      clearTimer();
      try {
        const scheduler = await ensure();
        return await scheduler.addJob(type, data);
      } finally {
        inFlight -= 1;
        armIdleShutdown();
      }
    },
  };

  return {
    /** Starts the pool if needed (so a start-up failure shows here) and returns the job handle. */
    async getScheduler() {
      await ensure();
      armIdleShutdown();
      return handle;
    },
    /** For the memory log and tests. */
    status() { return { running: pool !== null, inFlight, workers }; },
    /** Stops the pool now (tests, shutdown). */
    async close() {
      clearTimer();
      const p = pool;
      pool = null;
      if (p) await (await p).terminate();
    },
  };
}

const shared = createOcrPool();

module.exports = { createOcrPool, getScheduler: () => shared.getScheduler(), status: () => shared.status(), OCR_LANGS, DEFAULT_WORKERS, IDLE_SHUTDOWN_MS, workerCountFromEnv };
