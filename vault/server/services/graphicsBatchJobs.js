'use strict';

// Graphics batches with an AI step (remove background, upscale) run as background jobs: the page starts one (answered at once with an id),
// then checks on it every couple of seconds. No web request ever stays open for minutes, so the hosting gateway's five-minute cut-off can no
// longer end a request while the server carries on, spends the money, and the results are lost. Results are held for 30 minutes.
//
// In memory, like Video Tools' jobs (services/videoBackgroundJobs.js): a server restart loses a running job. One running job per person.
// A job whose page has stopped checking in (tab closed, laptop shut) stops after ABANDON_MS instead of spending on pictures nobody will see.

const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;
const ABANDON_MS = 90 * 1000;
const MAX_RESULT_BYTES = 300 * 1024 * 1024;

const jobs = new Map();

const sizeOf = (j) => j.results.reduce((n, r) => n + (r?.imageDataUrl?.length || 0), 0);

function prune(now = Date.now()) {
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > TTL_MS) jobs.delete(id);
  let total = 0;
  for (const j of jobs.values()) total += sizeOf(j);
  for (const [id, j] of jobs) { // results live in RAM: past the budget the oldest finished ones go
    if (total <= MAX_RESULT_BYTES) break;
    if (j.finishedAt) { total -= sizeOf(j); jobs.delete(id); }
  }
}

const isActive = (j) => j.status === 'queued' || j.status === 'running';
const hasActiveJob = (userId) => [...jobs.values()].some((j) => j.userId === userId && isActive(j));

function summary(j) {
  return { id: j.id, status: j.status, total: j.total, done: j.results.filter(Boolean).length, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error || '' };
}

/**
 * Run `work` in the background. `work({ report, shouldStop })` does the pictures one after another: it calls report(index, result) as each one
 * finishes and checks shouldStop() between pictures (cancelled, or the page went away). `release` is called once when the job ends, whatever
 * way (it gives back the person's job slot and the money set aside for it).
 * @returns {string} the job id; throws an error with status 409 if the person already has a job running
 */
function startJob(userId, total, work, { release = () => {}, now = Date.now, abandonMs = ABANDON_MS } = {}) {
  prune(now());
  if (hasActiveJob(userId)) {
    release();
    const err = new Error('You already have a batch running. Wait for it to finish, or cancel it, then start the next one.');
    err.status = 409;
    err.code = 'JOB_RUNNING';
    throw err;
  }
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, userId, status: 'running', total, results: new Array(total).fill(null), startedAt: now(), finishedAt: null, error: '', lastSeenAt: now() };
  jobs.set(id, job);
  const stopReason = () => (job.status === 'cancelled' ? 'cancelled' : now() - job.lastSeenAt > abandonMs ? 'abandoned' : null);
  const report = (index, result) => { job.results[index] = result; };
  const shouldStop = () => Boolean(stopReason());

  Promise.resolve()
    .then(() => work({ report, shouldStop }))
    .then(() => {
      if (job.status === 'cancelled') return;
      const why = stopReason();
      if (why === 'abandoned') { job.status = 'cancelled'; job.error = 'Stopped: the page stopped checking in, so the remaining pictures were not processed.'; }
      else job.status = 'done';
    })
    .catch((err) => {
      if (job.status === 'cancelled') return;
      job.status = 'error';
      job.error = err?.message || 'The batch failed';
    })
    .finally(() => {
      job.finishedAt = now();
      try { release(); } catch { /* giving back the slot must never break the job */ }
      prune(now());
    });
  return id;
}

/** The person's own job, or null (someone else's id looks exactly like a missing one). Asking about a job counts as "the page is still there". */
function getJob(userId, id, now = Date.now) {
  const j = jobs.get(String(id));
  if (!j || j.userId !== userId) return null;
  j.lastSeenAt = now();
  return { ...summary(j), results: undefined };
}

/** The per-picture results so far (same shape as the batch route's results; null for a picture not done yet). */
function getResults(userId, id) {
  const j = jobs.get(String(id));
  if (!j || j.userId !== userId) return null;
  return j.results.slice();
}

function cancelJob(userId, id) {
  const j = jobs.get(String(id));
  if (!j || j.userId !== userId) return false;
  if (isActive(j)) { j.status = 'cancelled'; j.error = 'Cancelled.'; }
  return true;
}

const _reset = () => jobs.clear(); // tests

module.exports = { startJob, getJob, getResults, cancelJob, hasActiveJob, ABANDON_MS, TTL_MS, _reset };
