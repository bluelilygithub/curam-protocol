'use strict';

// Global limiter for heavy ffmpeg jobs. aiLimiter caps requests per user, but nothing
// capped how many encodes run at once across all users — a few parallel /join or
// /convert calls (each with up to 240MB buffered in RAM) can starve a small host.
// Jobs beyond the concurrency limit wait in a bounded queue; past that, callers get
// a clear "busy" error instead of piling up memory.

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUE = 8;

function createJobGate({
  maxConcurrent = Number(process.env.VIDEO_MAX_CONCURRENT_JOBS) || DEFAULT_MAX_CONCURRENT,
  maxQueue = Number(process.env.VIDEO_MAX_QUEUED_JOBS) || DEFAULT_MAX_QUEUE,
} = {}) {
  let active = 0;
  const waiting = [];

  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  }

  function acquire() {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    if (waiting.length >= maxQueue) {
      const err = new Error('The video server is busy with other jobs — try again in a minute.');
      err.code = 'VIDEO_BUSY';
      return Promise.reject(err);
    }
    return new Promise((resolve) => waiting.push(resolve));
  }

  async function run(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { run, stats: () => ({ active, queued: waiting.length, maxConcurrent, maxQueue }) };
}

module.exports = { createJobGate, videoJobGate: createJobGate() };
