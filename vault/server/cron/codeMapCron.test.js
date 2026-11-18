#!/usr/bin/env node
/**
 * Code Map weekly run (codeMapCron.js) with a fake pool and fake job service: runs as the first admin and waits for the run to end,
 * skips when a run is already going or there is no admin, passes other errors on. The schedule is Sunday 03:17 Brisbane.
 * Run: node server/cron/codeMapCron.test.js
 */
'use strict';

const assert = require('assert');
const cron = require('node-cron');
const { runWeeklyCodeMap, SCHEDULE, TIMEZONE } = require('./codeMapCron');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const pool = (adminId) => ({ async query(sql) { assert.match(sql, /"isAdmin" = TRUE ORDER BY id ASC LIMIT 1/); return { rows: adminId ? [{ id: adminId }] : [] }; } });

function fakeJobs({ busy = false, crash = false } = {}) {
  const log = [];
  let done = false;
  return {
    log,
    async start(userId) {
      log.push(['start', userId]);
      if (busy) throw Object.assign(new Error('busy'), { status: 409 });
      if (crash) throw new Error('db down');
      return 31;
    },
    whenDone(id) { log.push(['whenDone', id]); return new Promise((r) => setImmediate(() => { done = true; r(); })); },
    async get(id) { log.push(['get', id, done]); return { id, status: 'done' }; },
  };
}

(async () => {
  await t('runs as the first admin and waits for the run to finish', async () => {
    const jobs = fakeJobs();
    const r = await runWeeklyCodeMap({ pool: pool(7), jobs });
    assert.deepStrictEqual(r, { runId: 31, status: 'done' });
    assert.deepStrictEqual(jobs.log, [['start', 7], ['whenDone', 31], ['get', 31, true]]);
  });

  await t('skips when an analysis is already running', async () => {
    const r = await runWeeklyCodeMap({ pool: pool(7), jobs: fakeJobs({ busy: true }) });
    assert.deepStrictEqual(r, { skipped: 'a run is already going' });
  });

  await t('skips when there is no admin', async () => {
    const jobs = fakeJobs();
    const r = await runWeeklyCodeMap({ pool: pool(null), jobs });
    assert.deepStrictEqual(r, { skipped: 'no admin' });
    assert.deepStrictEqual(jobs.log, []);
  });

  await t('other errors are passed on (the scheduler logs them)', async () => {
    await assert.rejects(runWeeklyCodeMap({ pool: pool(7), jobs: fakeJobs({ crash: true }) }), /db down/);
  });

  await t('the schedule is Sunday 03:17 Australia/Brisbane', async () => {
    assert.strictEqual(SCHEDULE, '17 3 * * 0');
    assert.strictEqual(TIMEZONE, 'Australia/Brisbane');
    assert.ok(cron.validate(SCHEDULE));
  });

  console.log(`codeMapCron.test.js: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
