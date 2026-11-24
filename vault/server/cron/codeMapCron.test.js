#!/usr/bin/env node
/**
 * Code Map weekly run (codeMapCron.js) with a fake pool, job service and live check: runs the analysis as the first admin and waits for it,
 * then the live site check against APP_URL (skipped when unset or local); skips when a run is already going or there is no admin; one part
 * failing never stops the other; other analysis errors are passed on. The schedule is Sunday 03:17 Brisbane.
 * Run: node server/cron/codeMapCron.test.js
 */
'use strict';

const assert = require('assert');
const cron = require('node-cron');
const { runWeeklyCodeMap, SCHEDULE, TIMEZONE } = require('./codeMapCron');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const pool = (adminId) => ({ async query(sql) { assert.match(sql, /"isAdmin" = TRUE ORDER BY id ASC LIMIT 1/); return { rows: adminId ? [{ id: adminId }] : [] }; } });
const quiet = { error() {} };
const APP = 'https://vault.example.com';

function fakeJobs({ busy = false, crash = false, order = [] } = {}) {
  const log = [];
  let done = false;
  return {
    log,
    async start(userId) {
      log.push(['start', userId]); order.push('analysis');
      if (busy) throw Object.assign(new Error('busy'), { status: 409 });
      if (crash) throw new Error('db down');
      return 31;
    },
    whenDone(id) { log.push(['whenDone', id]); return new Promise((r) => setImmediate(() => { done = true; r(); })); },
    async get(id) { log.push(['get', id, done]); return { id, status: 'done' }; },
  };
}

function fakeLive({ crash = false, order = [] } = {}) {
  const calls = [];
  return {
    calls,
    async check(userId, base) {
      calls.push([userId, base]); order.push('live');
      if (crash) throw new Error('site down');
      return { id: 5, counts: { pass: 12, fail: 1 }, checks: [] };
    },
  };
}

const MODELS = { id: 9, counts: { high: 1, medium: 0, low: 2 } };
function fakeModels({ crash = false, order = [] } = {}) {
  const calls = [];
  const fn = async (o) => { calls.push(o); order.push('models'); if (crash) throw new Error('no run yet'); return { id: 9, report: { counts: MODELS.counts } }; };
  fn.calls = calls;
  return fn;
}

(async () => {
  await t('runs the analysis as the first admin, waits for it, then the live check against APP_URL', async () => {
    const order = [];
    const jobs = fakeJobs({ order });
    const live = fakeLive({ order });
    const models = fakeModels({ order });
    const r = await runWeeklyCodeMap({ pool: pool(7), jobs, modelsCheck: models, liveChecks: live, appUrl: `${APP}/`, log: quiet });
    assert.deepStrictEqual(r, { runId: 31, status: 'done', models: MODELS, live: { id: 5, counts: { pass: 12, fail: 1 } } });
    assert.deepStrictEqual(jobs.log, [['start', 7], ['whenDone', 31], ['get', 31, true]]);
    assert.deepStrictEqual(live.calls, [[7, APP]], 'as the same admin, trailing slash dropped');
    assert.deepStrictEqual(order, ['analysis', 'models', 'live']);
    assert.deepStrictEqual(models.calls, [{ userId: 7 }], 'the models check runs as the same admin');
  });

  await t('a running analysis skips the weekly analysis, but the live check still runs', async () => {
    const live = fakeLive();
    const r = await runWeeklyCodeMap({ pool: pool(7), modelsCheck: fakeModels(), jobs: fakeJobs({ busy: true }), liveChecks: live, appUrl: APP, log: quiet });
    assert.deepStrictEqual(r, { skipped: 'a run is already going', models: MODELS, live: { id: 5, counts: { pass: 12, fail: 1 } } });
    assert.strictEqual(live.calls.length, 1);
  });

  await t('the live check is skipped without APP_URL or with a local address', async () => {
    for (const [appUrl, why] of [[undefined, 'APP_URL is not set'], ['', 'APP_URL is not set'], ['http://localhost:5173', 'APP_URL is a local address'], ['http://127.0.0.1:3001/', 'APP_URL is a local address']]) {
      const live = fakeLive();
      const r = await runWeeklyCodeMap({ pool: pool(7), modelsCheck: fakeModels(), jobs: fakeJobs(), liveChecks: live, appUrl, log: quiet });
      assert.deepStrictEqual(r.live, { skipped: why }, String(appUrl));
      assert.strictEqual(live.calls.length, 0);
    }
  });

  await t('a failing live check is recorded and logged, and does not fail the run', async () => {
    const errors = [];
    const r = await runWeeklyCodeMap({ pool: pool(7), modelsCheck: fakeModels(), jobs: fakeJobs(), liveChecks: fakeLive({ crash: true }), appUrl: APP, log: { error: (o, m) => errors.push(m) } });
    assert.deepStrictEqual(r, { runId: 31, status: 'done', models: MODELS, live: { error: 'site down' } });
    assert.deepStrictEqual(errors, ['[codeMap] weekly live check failed']);
  });

  await t('skips everything when there is no admin', async () => {
    const jobs = fakeJobs();
    const live = fakeLive();
    const r = await runWeeklyCodeMap({ pool: pool(null), jobs, modelsCheck: fakeModels(), liveChecks: live, appUrl: APP, log: quiet });
    assert.deepStrictEqual(r, { skipped: 'no admin' });
    assert.deepStrictEqual(jobs.log, []);
    assert.strictEqual(live.calls.length, 0);
  });

  await t('other analysis errors are passed on (the scheduler logs them) after the live check has run', async () => {
    const live = fakeLive();
    await assert.rejects(runWeeklyCodeMap({ pool: pool(7), modelsCheck: fakeModels(), jobs: fakeJobs({ crash: true }), liveChecks: live, appUrl: APP, log: quiet }),
      (err) => /db down/.test(err.message) && err.live.id === 5);
    assert.strictEqual(live.calls.length, 1);
  });

  await t('a failed models check is logged and recorded; the live check still runs', async () => {
    const errors = [];
    const live = fakeLive();
    const r = await runWeeklyCodeMap({ pool: pool(7), jobs: fakeJobs(), modelsCheck: fakeModels({ crash: true }), liveChecks: live, appUrl: APP, log: { error: (o, m) => errors.push(m) } });
    assert.deepStrictEqual(r.models, { error: 'no run yet' });
    assert.strictEqual(live.calls.length, 1);
    assert.deepStrictEqual(errors, ['[codeMap] weekly models check failed']);
  });

  await t('the schedule is Sunday 03:17 Australia/Brisbane', async () => {
    assert.strictEqual(SCHEDULE, '17 3 * * 0');
    assert.strictEqual(TIMEZONE, 'Australia/Brisbane');
    assert.ok(cron.validate(SCHEDULE));
  });

  console.log(`codeMapCron.test.js: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
