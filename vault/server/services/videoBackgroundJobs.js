'use strict';

// Long Video Tools jobs run in the background so that no single web request has to stay open for minutes.
//
// Why: the hosting gateway cuts a request off after about five minutes. The video job kept running on the server regardless, so the
// person saw "failed", pressed the button again, and then TWO encodes shared the processor and both ran slower. Now the page starts
// a job (answered at once with an id) and checks on it every few seconds; the gateway never sees a long request, the page can show
// how long it has been running, and a second job from the same person is refused while one is still going.
//
// In memory only: a server restart loses running jobs (the page says so). Results are kept for 30 minutes.

const crypto = require('crypto');
const { videoJobGate } = require('./videoJobGate');

const TTL_MS = 30 * 60 * 1000;
const MAX_RESULT_BYTES = 300 * 1024 * 1024;

const jobs = new Map();

function prune(now = Date.now()) {
  for (const [id, j] of jobs) {
    if (j.finishedAt && now - j.finishedAt > TTL_MS) jobs.delete(id);
  }
  // Results live in RAM: past the budget, drop the oldest finished ones.
  let total = 0;
  for (const j of jobs.values()) total += j.result?.buffer?.length || 0;
  for (const [id, j] of jobs) {
    if (total <= MAX_RESULT_BYTES) break;
    if (j.finishedAt && j.result) { total -= j.result.buffer.length; jobs.delete(id); }
  }
}

function hasActiveJob(userId) {
  for (const j of jobs.values()) {
    if (j.userId === userId && (j.status === 'queued' || j.status === 'running')) return true;
  }
  return false;
}

/**
 * Start `work` (an async function returning { buffer, fileName, mime }) in the background.
 * @param {number} userId
 * @param {string} label  short name for logs ("extend-ending")
 * @param {() => Promise<{buffer: Buffer, fileName: string, mime?: string}>} work
 * @param {{ gate?: object, describeError?: (err: Error) => string, onError?: (err: Error) => void }} [deps]
 * @returns {string} the job id
 */
function startJob(userId, label, work, { gate = videoJobGate, describeError = (e) => e.message, onError = () => {}, onEvent = () => {} } = {}) {
  prune();
  if (hasActiveJob(userId)) {
    const err = new Error('You already have a video job running. Wait for it to finish (it can take a few minutes), then start the next one.');
    err.status = 409;
    err.code = 'JOB_RUNNING';
    throw err;
  }
  const id = crypto.randomBytes(8).toString('hex');
  const controller = new AbortController();
  const job = { id, userId, label, status: 'queued', startedAt: Date.now(), finishedAt: null, result: null, error: '', controller };
  jobs.set(id, job);
  const say = (m) => { try { onEvent(`job ${id} ${m}`); } catch { /* logging must never break the runner */ } };
  say('queued');
  Promise.resolve()
    .then(() => gate.run(async () => {
      if (job.status === 'cancelled') return null; // cancelled while waiting for a free slot
      job.status = 'running';
      job.runStartedAt = Date.now();
      say(`started after waiting ${Math.round((job.runStartedAt - job.startedAt) / 1000)}s`);
      return work(controller.signal);
    }))
    .then((result) => {
      if (job.status === 'cancelled') return;
      job.result = result;
      job.status = 'done';
      job.finishedAt = Date.now();
      say(`done in ${Math.round((job.finishedAt - (job.runStartedAt || job.startedAt)) / 1000)}s`);
      prune();
    })
    .catch((err) => {
      if (job.status === 'cancelled') return; // the abort error is expected
      job.status = 'error';
      job.error = describeError(err) || 'Something went wrong.';
      job.finishedAt = Date.now();
      say(`failed after ${Math.round((job.finishedAt - (job.runStartedAt || job.startedAt)) / 1000)}s: ${job.error}`);
      try { onError(err); } catch { /* logging must never break the runner */ }
    });
  return id;
}

/** What the page needs to show progress. null if the job is unknown, expired, or someone else's. */
function getJobStatus(id, userId) {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  return {
    status: j.status, // 'queued' | 'running' | 'done' | 'error' | 'cancelled'
    error: j.error,
    label: j.label,
    elapsedSec: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000),
    fileName: j.result?.fileName || null,
  };
}

/** Stop a job (kills the running ffmpeg). Returns false if it is not theirs or is already finished. */
function cancelJob(id, userId) {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return false;
  if (j.status !== 'queued' && j.status !== 'running') return false;
  j.status = 'cancelled';
  j.error = 'Cancelled.';
  j.finishedAt = Date.now();
  try { j.controller.abort(); } catch { /* already stopping */ }
  return true;
}

function getJobResult(id, userId) {
  const j = jobs.get(id);
  if (!j || j.userId !== userId || j.status !== 'done') return null;
  return j.result;
}

module.exports = { startJob, getJobStatus, getJobResult, cancelJob, hasActiveJob, _reset: () => jobs.clear(), TTL_MS };
