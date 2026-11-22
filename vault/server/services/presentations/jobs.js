'use strict';

// Small in-memory background-job store for Presentations, following the Video Tools pattern: a POST answers immediately with
// an id, the browser polls, long work never holds an HTTP request open, one active job per person, Cancel and Resume both work.
// Restarting the server forgets running jobs; finished results live for 30 minutes.

const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;
const ACTIVE = new Set(['queued', 'running']);
const jobs = new Map();

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function prune(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > TTL_MS) jobs.delete(id);
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    result: job.status === 'done' ? job.result : null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

function getJob(userId, id) {
  prune();
  const job = jobs.get(String(id));
  return job && job.userId === userId ? publicJob(job) : null;
}

/** Internal use only (the download route needs the file path). Never sent to the browser. */
function getInternal(userId, id) {
  prune();
  const job = jobs.get(String(id));
  return job && job.userId === userId ? job : null;
}

function hasActive(userId) {
  return [...jobs.values()].some((j) => j.userId === userId && ACTIVE.has(j.status));
}

function queueRun(job) {
  job.status = 'queued';
  job.progress = 0;
  job.stage = 'Waiting to start';
  job.error = null;
  job.result = null;
  job.finishedAt = null;
  job.controller = new AbortController();
  setImmediate(async () => {
    if (job.status !== 'queued') return;
    job.status = 'running';
    job.stage = 'Working';
    const setProgress = (value, stage) => {
      if (job.status !== 'running') return;
      const n = Number(value);
      if (Number.isFinite(n)) job.progress = Math.max(0, Math.min(99, Math.round(n)));
      if (stage) job.stage = String(stage).slice(0, 120);
    };
    try {
      const result = await job.runner({ job, signal: job.controller.signal, setProgress });
      if (job.status === 'cancelled' || job.controller.signal.aborted) return;
      job.result = result || null;
      job.status = 'done';
      job.progress = 100;
      job.stage = 'Done';
    } catch (err) {
      if (job.status === 'cancelled' || job.controller.signal.aborted) return;
      job.status = 'failed';
      job.error = String(err?.message || 'The job failed.').slice(0, 500);
      job.stage = 'Failed';
    } finally {
      job.finishedAt = Date.now();
      prune();
    }
  });
}

/** Start one job. `runner` receives { job, signal, setProgress } and returns the result object. */
function startJob({ userId, kind, input, runner }) {
  if (!userId) throw fail('Sign in to start a job.', 401);
  if (typeof runner !== 'function') throw fail('This job has no runner.', 500);
  if (hasActive(userId)) throw fail('Finish or cancel the job that is already running before starting another.', 409);
  prune();
  const id = crypto.randomUUID();
  const job = {
    id, userId, kind: String(kind || 'job').slice(0, 40), input: input || {},
    status: 'queued', progress: 0, stage: 'Waiting to start', error: null, result: null,
    createdAt: Date.now(), finishedAt: null, controller: null, runner,
  };
  jobs.set(id, job);
  queueRun(job);
  return publicJob(job);
}

function cancelJob(userId, id) {
  const job = jobs.get(String(id));
  if (!job || job.userId !== userId) return false;
  if (!ACTIVE.has(job.status)) return false;
  job.status = 'cancelled';
  job.stage = 'Cancelled';
  job.finishedAt = Date.now();
  job.controller?.abort();
  return true;
}

function resumeJob(userId, id) {
  const job = jobs.get(String(id));
  if (!job || job.userId !== userId) return null;
  if (ACTIVE.has(job.status)) throw fail('That job is already running.', 409);
  if (!['failed', 'cancelled'].includes(job.status)) throw fail('Only a cancelled or failed job can be resumed.', 409);
  if (hasActive(userId)) throw fail('Finish or cancel the job that is already running before starting another.', 409);
  queueRun(job);
  return publicJob(job);
}

function getResult(userId, id) {
  const job = jobs.get(String(id));
  if (!job || job.userId !== userId) return null;
  if (job.status !== 'done') throw fail(job.status === 'failed' ? (job.error || 'That job failed.') : 'That job is not finished yet.', 409);
  return { kind: job.kind, result: job.result };
}

function _clear() { jobs.clear(); }

module.exports = { TTL_MS, jobs, getJob, getInternal, startJob, cancelJob, resumeJob, getResult, publicJob, _clear };
