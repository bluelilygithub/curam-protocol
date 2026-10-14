'use strict';
const assert = require('assert');
const { startJob, getJobStatus, getJobResult, hasActiveJob, _reset } = require('./videoBackgroundJobs');
const { createJobGate } = require('./videoJobGate');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await tick(); } throw new Error('timed out waiting'); };

(async () => {
  // ---- a job answers at once and finishes in the background ----
  _reset();
  let release;
  const gate = createJobGate({ maxConcurrent: 1, maxQueue: 4 });
  const id = startJob(1, 'test', () => new Promise((resolve) => { release = () => resolve({ buffer: Buffer.from('video'), fileName: 'a.mp4', mime: 'video/mp4' }); }), { gate });
  assert.strictEqual(typeof id, 'string');
  await wait(() => getJobStatus(id, 1).status === 'running');
  assert.strictEqual(getJobResult(id, 1), null, 'no result until it is done');
  release();
  await wait(() => getJobStatus(id, 1).status === 'done');
  assert.strictEqual(getJobStatus(id, 1).fileName, 'a.mp4');
  assert.strictEqual(getJobResult(id, 1).buffer.toString(), 'video');

  // ---- jobs belong to the person who started them ----
  assert.strictEqual(getJobStatus(id, 2), null);
  assert.strictEqual(getJobResult(id, 2), null);
  assert.strictEqual(getJobStatus('nope', 1), null);

  // ---- the production problem: pressing the button again while the first run is still going ----
  _reset();
  let release2;
  const first7 = startJob(7, 'a', () => new Promise((resolve) => { release2 = () => resolve({ buffer: Buffer.alloc(1), fileName: 'x.mp4' }); }), { gate: createJobGate() });
  assert.strictEqual(hasActiveJob(7), true);
  assert.throws(() => startJob(7, 'b', async () => ({ buffer: Buffer.alloc(1), fileName: 'y.mp4' })), (e) => e.status === 409 && e.code === 'JOB_RUNNING' && /already have a video job running/.test(e.message));
  // someone else is not blocked
  assert.doesNotThrow(() => startJob(8, 'c', async () => ({ buffer: Buffer.alloc(1), fileName: 'z.mp4' }), { gate: createJobGate() }));
  await wait(() => getJobStatus(first7, 7).status === 'running');
  release2();
  await wait(() => !hasActiveJob(7));
  assert.doesNotThrow(() => startJob(7, 'again', async () => ({ buffer: Buffer.alloc(1), fileName: 'w.mp4' }), { gate: createJobGate() }), 'free to start again once the first has finished');

  // ---- a failure is reported in plain words, and logged ----
  _reset();
  let logged = null;
  const bad = startJob(3, 'boom', async () => { throw Object.assign(new Error('raw ffmpeg dump'), { stderr: 'x' }); }, {
    gate: createJobGate(),
    describeError: () => 'ffmpeg could not process this file.',
    onError: (e) => { logged = e; },
  });
  await wait(() => getJobStatus(bad, 3).status === 'error');
  assert.strictEqual(getJobStatus(bad, 3).error, 'ffmpeg could not process this file.', 'the raw error is never what the person sees');
  assert.ok(logged && logged.stderr === 'x', 'but the real error reached the logger');
  assert.strictEqual(hasActiveJob(3), false, 'a failed job does not block the next attempt');
  // a logger that throws cannot take the runner down
  const bad2 = startJob(4, 'boom2', async () => { throw new Error('x'); }, { gate: createJobGate(), onError: () => { throw new Error('logger down'); } });
  await wait(() => getJobStatus(bad2, 4).status === 'error');

  // ---- waiting for a free slot shows as queued, not as stuck ----
  _reset();
  const g = createJobGate({ maxConcurrent: 1, maxQueue: 4 });
  let r1;
  const first10 = startJob(10, 'first', () => new Promise((resolve) => { r1 = () => resolve({ buffer: Buffer.alloc(1), fileName: '1.mp4' }); }), { gate: g });
  const second = startJob(11, 'second', async () => ({ buffer: Buffer.alloc(1), fileName: '2.mp4' }), { gate: g });
  await tick(20);
  assert.strictEqual(getJobStatus(second, 11).status, 'queued');
  await wait(() => getJobStatus(first10, 10).status === 'running');
  r1();
  await wait(() => getJobStatus(second, 11).status === 'done');

  console.log('videoBackgroundJobs tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
