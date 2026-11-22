'use strict';

// node server/services/presentations/jobs.test.js

const assert = require('node:assert/strict');
const jobs = require('./jobs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function run() {
  jobs._clear();
  let attempts = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = jobs.startJob({
    userId: 3, kind: 'create', input: {},
    runner: async ({ signal, setProgress }) => {
      attempts += 1;
      setProgress(20, 'Working');
      await gate;
      if (signal.aborted) throw new Error('aborted');
      return { attempt: attempts };
    },
  });
  await tick();
  assert.equal(jobs.getJob(3, started.id).status, 'running');
  assert.equal(jobs.getJob(3, started.id).progress, 20);
  assert.throws(() => jobs.startJob({ userId: 3, kind: 'create', runner: () => {} }), /already running/);
  assert.equal(jobs.cancelJob(3, started.id), true);
  release();
  await tick();
  assert.equal(jobs.getJob(3, started.id).status, 'cancelled');

  const resumed = jobs.resumeJob(3, started.id);
  assert.equal(resumed.id, started.id, 'resume keeps the same job id');
  await tick();
  assert.equal(jobs.getJob(3, started.id).status, 'done');
  assert.equal(jobs.getResult(3, started.id).result.attempt, 2);
  assert.equal(jobs.getJob(4, started.id), null, 'another member cannot see the job');
  jobs._clear();
}

run().then(() => console.log('presentations job tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
