'use strict';

// BIP's small in-memory job registry, following the same pattern as Video Tools' background jobs: POST answers immediately with a
// job id, the page polls every couple of seconds, and the long work happens off the request so the hosting gateway never cuts it
// off. The profile itself is in Postgres; losing this map on a restart only loses the progress ticker, not saved results.

const crypto = require('crypto');

const TTL_MS = 60 * 60 * 1000;
const jobs = new Map();

function prune(now = Date.now()) {
  for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > TTL_MS) jobs.delete(id);
}

/** Start background work. Returns the job id immediately. */
function startJob(userId, label, work) {
  prune();
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id, userId, label, status: 'queued', startedAt: Date.now(), finishedAt: null,
    progress: { phase: 'queued', current: 0, total: 1, module: null }, error: '', result: null,
  };
  jobs.set(id, job);
  Promise.resolve()
    .then(() => { job.status = 'running'; return work((p) => { job.progress = p; }); })
    .then((result) => {
      job.result = result || null;
      job.status = 'done';
      job.finishedAt = Date.now();
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err?.message || 'Something went wrong.';
      job.finishedAt = Date.now();
    });
  return id;
}

function getJob(id, userId) {
  const job = jobs.get(String(id || ''));
  if (!job || job.userId !== userId) return null;
  return {
    id: job.id,
    status: job.status,
    label: job.label,
    error: job.error,
    progress: job.progress,
    result: job.result,
    elapsedSec: Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000),
  };
}

module.exports = { startJob, getJob, _reset: () => jobs.clear(), TTL_MS };
