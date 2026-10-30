'use strict';

// DATABASE_URL=... node server/utils/cronLock.test.js   (any scratch Postgres; creates no tables)
// Two "instances" (two pools) race for the same job name: only one may run; the lock is freed after success, after a throw,
// and the job still runs if the lock cannot be taken.

const assert = require('assert');
const { Pool } = require('pg');
const { withCronLock } = require('./cronLock');

const url = process.env.DATABASE_URL;
if (!url) { console.log('cronLock tests skipped: DATABASE_URL not set'); process.exit(0); }
if (/railway|rlwy\.net/.test(url)) { console.error('Refusing to run against a Railway host.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = new Pool({ connectionString: url, max: 3 });
  const b = new Pool({ connectionString: url, max: 3 });
  try {
    // 1. overlapping runs: the second instance is skipped, the first completes with its value
    let ran = 0;
    const slow = async () => { ran++; await sleep(300); return 'done'; };
    const [r1, r2] = await Promise.all([
      withCronLock('t-overlap', slow, { pool: a }),
      sleep(50).then(() => withCronLock('t-overlap', slow, { pool: b })),
    ]);
    assert.strictEqual(r1, 'done');
    assert.strictEqual(r2, undefined, 'second instance must be skipped');
    assert.strictEqual(ran, 1, 'job body ran exactly once');

    // 2. the lock is released after success: the next run goes ahead
    assert.strictEqual(await withCronLock('t-overlap', async () => 'again', { pool: b }), 'again');

    // 3. different job names never block each other
    const [x, y] = await Promise.all([
      withCronLock('t-one', async () => { await sleep(100); return 1; }, { pool: a }),
      withCronLock('t-two', async () => { await sleep(100); return 2; }, { pool: b }),
    ]);
    assert.deepStrictEqual([x, y], [1, 2]);

    // 4. a throwing job propagates its error and still frees the lock
    await assert.rejects(() => withCronLock('t-throw', async () => { throw new Error('boom'); }, { pool: a }), /boom/);
    assert.strictEqual(await withCronLock('t-throw', async () => 'ok', { pool: b }), 'ok', 'lock freed after a throw');

    // 5. no connection is leaked: all of pool a's clients are back
    assert.strictEqual(a.waitingCount, 0);
    assert.strictEqual(a.idleCount, a.totalCount, 'every connection returned to the pool');

    // 6. lock cannot be taken (connect fails): the job runs unguarded instead of being lost
    const broken = { connect: async () => { throw new Error('no db'); } };
    assert.strictEqual(await withCronLock('t-broken', async () => 'ran-anyway', { pool: broken }), 'ran-anyway');

    console.log('cronLock tests passed');
  } finally {
    await a.end(); await b.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
