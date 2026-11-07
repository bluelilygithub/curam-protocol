'use strict';

// node server/services/translateOcrPool.test.js   (no tesseract, no network: a fake stands in)
const assert = require('assert');
const { createOcrPool, workerCountFromEnv, DEFAULT_WORKERS } = require('./translateOcrPool');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeTesseract({ failFirst = 0, jobMs = 0 } = {}) {
  const t = { schedulersCreated: 0, workersCreated: 0, terminated: 0, jobs: [], failsLeft: failFirst, langs: [] };
  t.module = {
    createScheduler() {
      t.schedulersCreated += 1;
      const ws = [];
      return {
        addWorker: (w) => ws.push(w),
        async addJob(type, data) { t.jobs.push([type, data]); if (jobMs) await wait(jobMs); return { data: { text: `read ${data}`, confidence: 90 } }; },
        async terminate() { t.terminated += 1; },
        _ws: ws,
      };
    },
    async createWorker(langs) {
      if (t.failsLeft > 0) { t.failsLeft -= 1; throw new Error('could not load language data'); }
      t.workersCreated += 1; t.langs.push(langs);
      return { id: t.workersCreated };
    },
  };
  return t;
}

(async () => {
  // the worker count: 2 by default, from OCR_WORKERS when it is a sensible number
  assert.strictEqual(DEFAULT_WORKERS, 2);
  assert.strictEqual(workerCountFromEnv({}), 2);
  assert.strictEqual(workerCountFromEnv({ OCR_WORKERS: '3' }), 3);
  assert.strictEqual(workerCountFromEnv({ OCR_WORKERS: '0' }), 2);
  assert.strictEqual(workerCountFromEnv({ OCR_WORKERS: '99' }), 2);
  assert.strictEqual(workerCountFromEnv({ OCR_WORKERS: 'x' }), 2);

  // nothing is built until it is used (this is the whole point: nothing at boot)
  let t = fakeTesseract();
  let pool = createOcrPool({ loadTesseract: () => t.module, idleMs: 60, log: () => {} });
  assert.deepStrictEqual(pool.status(), { running: false, inFlight: 0, workers: 2 });
  assert.strictEqual(t.workersCreated, 0, 'creating the pool builds no workers');

  // first use builds the pool once, even when several callers arrive together; every worker gets all the languages
  const [a, b] = await Promise.all([pool.getScheduler(), pool.getScheduler()]);
  assert.strictEqual(t.schedulersCreated, 1);
  assert.strictEqual(t.workersCreated, 2);
  assert.ok(t.langs.every((l) => l === 'eng+fra+deu+spa+ita+por+chi_sim+jpn'), 'all eight languages are kept');
  assert.strictEqual(pool.status().running, true);
  const r = await a.addJob('recognize', 'page1');
  assert.deepStrictEqual(r, { data: { text: 'read page1', confidence: 90 } }, 'the job result comes back untouched');
  assert.deepStrictEqual(t.jobs[0], ['recognize', 'page1']);
  assert.strictEqual(b, a, 'one shared handle');

  // it shuts itself down after the idle time, and starts again by itself on the next scan
  await wait(160);
  assert.strictEqual(t.terminated, 1, 'terminated after idle');
  assert.strictEqual(pool.status().running, false);
  await (await pool.getScheduler()).addJob('recognize', 'page2');
  assert.strictEqual(t.schedulersCreated, 2, 'a new pool is built for the next scan');
  assert.strictEqual(pool.status().running, true);
  await pool.close();
  assert.strictEqual(t.terminated, 2);

  // a long job is never cut off: the pool is not shut down while a job is running, even past the idle time
  t = fakeTesseract({ jobMs: 200 });
  pool = createOcrPool({ loadTesseract: () => t.module, idleMs: 50, log: () => {} });
  const sched = await pool.getScheduler();
  const slow = sched.addJob('recognize', 'long');
  await wait(120); // twice the idle time while the job is still running
  assert.strictEqual(t.terminated, 0, 'not terminated mid-job');
  assert.strictEqual(pool.status().inFlight, 1);
  await slow;
  assert.strictEqual(pool.status().inFlight, 0);
  await wait(130);
  assert.strictEqual(t.terminated, 1, 'terminated once the work is done and it has been idle');

  // many jobs keep it alive and the idle clock restarts after each
  t = fakeTesseract();
  pool = createOcrPool({ loadTesseract: () => t.module, idleMs: 80, log: () => {} });
  const s2 = await pool.getScheduler();
  for (let i = 0; i < 4; i++) { await wait(40); await s2.addJob('recognize', `p${i}`); }
  assert.strictEqual(t.terminated, 0, 'steady work keeps the pool up');
  assert.strictEqual(t.schedulersCreated, 1);
  await pool.close();

  // a failed start is reported, is not kept, and the next scan tries again
  t = fakeTesseract({ failFirst: 2 });
  pool = createOcrPool({ loadTesseract: () => t.module, idleMs: 60, log: () => {} });
  await assert.rejects(() => pool.getScheduler(), /could not load language data/);
  assert.strictEqual(pool.status().running, false, 'the failure is not kept as a pool');
  const again = await pool.getScheduler();
  await again.addJob('recognize', 'x');
  assert.strictEqual(pool.status().running, true);
  await pool.close();

  // a job arriving while the pool shuts down gets a fresh pool, not a dead one
  t = fakeTesseract();
  pool = createOcrPool({ loadTesseract: () => t.module, idleMs: 30, log: () => {} });
  const s3 = await pool.getScheduler();
  await wait(70);
  assert.strictEqual(pool.status().running, false);
  const res = await s3.addJob('recognize', 'late'); // the old handle still works: it builds a new pool
  assert.strictEqual(res.data.text, 'read late');
  assert.strictEqual(t.schedulersCreated, 2);
  await pool.close();

  // requiring the module (as translate.js now does at boot) builds nothing
  const real = require('./translateOcrPool');
  assert.strictEqual(real.status().running, false, 'the shared pool is idle until a scan needs it');

  console.log('translateOcrPool.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
