'use strict';

// node server/services/graphicsBatchJobs.test.js   (npm run test:graphics-jobs)
const assert = require('assert');
const jobsApi = require('./graphicsBatchJobs');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 1000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await tick(); } };

(async () => {
  jobsApi._reset();

  // ── a normal job: answered at once, finishes later, results arrive per picture ────────
  let released = 0;
  const id = jobsApi.startJob(1, 3, async ({ report }) => {
    for (let i = 0; i < 3; i += 1) { await tick(10); report(i, { ok: true, n: i, imageDataUrl: `data:image/png;base64,${'A'.repeat(10)}` }); }
  }, { release: () => { released += 1; } });
  assert.strictEqual(jobsApi.getJob(1, id).status, 'running');
  await until(() => jobsApi.getJob(1, id).status === 'done');
  const s = jobsApi.getJob(1, id);
  assert.deepStrictEqual([s.total, s.done], [3, 3]);
  assert.deepStrictEqual(jobsApi.getResults(1, id).map((r) => r.n), [0, 1, 2]);
  assert.strictEqual(released, 1, 'the slot and reserved money are given back exactly once');

  // ── owner only ───────────────────────────────────────────────────────────────────────
  assert.strictEqual(jobsApi.getJob(2, id), null);
  assert.strictEqual(jobsApi.getResults(2, id), null);
  assert.strictEqual(jobsApi.cancelJob(2, id), false);
  assert.strictEqual(jobsApi.getJob(1, 'nope'), null);

  // ── one running job per person; a refused start still gives back what it was holding ──
  let rel2 = 0;
  const slow = jobsApi.startJob(3, 1, async () => { await tick(60); });
  assert.throws(() => jobsApi.startJob(3, 1, async () => {}, { release: () => { rel2 += 1; } }), (e) => e.status === 409 && e.code === 'JOB_RUNNING');
  assert.strictEqual(rel2, 1);
  jobsApi.startJob(4, 1, async () => {}); // another person is not blocked
  await until(() => jobsApi.getJob(3, slow).status === 'done');
  assert.ok(jobsApi.startJob(3, 1, async () => {}), 'free again once the first has finished');

  // ── cancel stops between pictures; finished pictures are kept ────────────────────────
  let rel3 = 0;
  let processed = 0;
  const cid = jobsApi.startJob(5, 6, async ({ report, shouldStop }) => {
    for (let i = 0; i < 6; i += 1) {
      if (shouldStop()) return;
      await tick(15);
      processed += 1;
      report(i, { ok: true, n: i });
    }
  }, { release: () => { rel3 += 1; } });
  await until(() => processed >= 2);
  assert.strictEqual(jobsApi.cancelJob(5, cid), true);
  await until(() => rel3 === 1);
  const cs = jobsApi.getJob(5, cid);
  assert.strictEqual(cs.status, 'cancelled');
  assert.ok(processed < 6 && cs.done >= 2, 'it stopped part way and kept what was done');
  assert.ok(jobsApi.getResults(5, cid).filter(Boolean).length === cs.done);

  // ── a page that stops checking in: the job stops by itself ───────────────────────────
  let clock = 1_000_000;
  const now = () => clock;
  let rel4 = 0;
  let done4 = 0;
  const aid = jobsApi.startJob(6, 5, async ({ report, shouldStop }) => {
    for (let i = 0; i < 5; i += 1) {
      if (shouldStop()) return;
      await tick(10);
      done4 += 1; report(i, { ok: true });
      if (i === 1) clock += 200_000; // time passes and nobody asks about the job
    }
  }, { release: () => { rel4 += 1; }, now, abandonMs: 90_000 });
  await until(() => rel4 === 1);
  const as = jobsApi.getJob(6, aid, now);
  assert.strictEqual(as.status, 'cancelled');
  assert.match(as.error, /stopped checking in/);
  assert.strictEqual(done4, 2, 'no more pictures were paid for once nobody was watching');

  // ── asking about the job counts as being there ───────────────────────────────────────
  clock = 5_000_000;
  let done5 = 0;
  const wid = jobsApi.startJob(7, 4, async ({ report, shouldStop }) => {
    for (let i = 0; i < 4; i += 1) {
      if (shouldStop()) return;
      await tick(10);
      done5 += 1; report(i, { ok: true });
      clock += 60_000;
      jobsApi.getJob(7, wid, now); // the page polls
    }
  }, { now, abandonMs: 90_000 });
  await until(() => jobsApi.getJob(7, wid, now).status !== 'running');
  assert.strictEqual(jobsApi.getJob(7, wid, now).status, 'done');
  assert.strictEqual(done5, 4);

  // ── a crash is reported, not thrown, and still releases ──────────────────────────────
  let rel6 = 0;
  const eid = jobsApi.startJob(8, 1, async () => { throw new Error('service down'); }, { release: () => { rel6 += 1; } });
  await until(() => jobsApi.getJob(8, eid).status === 'error');
  assert.strictEqual(jobsApi.getJob(8, eid).error, 'service down');
  await until(() => rel6 === 1);

  console.log('graphicsBatchJobs: ok');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
