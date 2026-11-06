'use strict';
// node server/services/serpTracker/runner.test.js   (fake pool and fake DataForSEO, no database, no network)
const assert = require('node:assert/strict');
const { runSite, RunAlreadyActive } = require('./runner');
const { runAllSites } = require('../../cron/serpTrackerCron');

const profile = { domain: 'wiwc.com.au', timezone: 'Australia/Brisbane' };
const site = (id = 1, userId = 10) => ({ id, userId, profile });

/** Just enough of the pool for runner.js: it recognises the four statements the runner makes. */
function fakePool({ active = false } = {}) {
  const st = { runs: [], costs: [], closed: null, stale: 0 };
  return {
    st,
    async query(sql, params) {
      if (/UPDATE serp_runs SET status = 'failed'/.test(sql)) { st.stale += 1; return { rowCount: 0, rows: [] }; }
      if (/SELECT 1 FROM serp_runs/.test(sql)) return { rows: active ? [{}] : [] };
      if (/INSERT INTO serp_runs/.test(sql)) { st.runs.push({ params }); return { rows: [{ id: st.runs.length }] }; }
      if (/SUM\("costUsd"\)/.test(sql)) return { rows: [{ total: st.costs.filter((c) => c.runId === params[0]).reduce((a, c) => a + c.costUsd, 0) }] };
      if (/UPDATE serp_runs SET status = \$2/.test(sql)) { st.closed = { status: params[1], balance: params[2], total: params[3], steps: JSON.parse(params[4]), errors: JSON.parse(params[5]) }; return { rows: [] }; }
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    },
  };
}

function deps(pool, over = {}) {
  const captured = [];
  return {
    captured,
    now: () => new Date('2026-11-05T20:00:00Z'), // 06:00 Friday 6 Nov in Brisbane
    getBalance: async () => ({ balanceUsd: 9.87, costUsd: 0 }),
    logCost: async (_p, e) => { pool.st.costs.push(e); },
    capture: async (c) => { captured.push(c); },
    makeFingerprint: (...a) => a.join(':'),
    ...over,
  };
}

(async () => {
  // --- a good run: balance recorded, cost row logged for the run, status ok, Brisbane date used
  let pool = fakePool();
  let d = deps(pool);
  let r = await runSite({ pool, site: site(), trigger: 'manual', deps: d });
  assert.equal(r.status, 'ok');
  assert.equal(r.balanceUsd, 9.87);
  assert.equal(pool.st.runs[0].params[2], '2026-11-06'); // runDate is the Brisbane date, not the UTC one
  assert.equal(pool.st.runs[0].params[3], 'manual');
  assert.equal(pool.st.costs.length, 1);
  assert.equal(pool.st.costs[0].endpoint, '/v3/appendix/user_data');
  assert.equal(pool.st.costs[0].runId, 1);
  assert.equal(pool.st.closed.status, 'ok');
  assert.equal(d.captured.length, 0);

  // --- the balance check fails (bad login): the run is FAILED with the reason, not quietly empty; one inbox alert
  pool = fakePool();
  d = deps(pool, { getBalance: async () => { throw new Error('DataForSEO answered HTTP 401. The login or password was refused.'); } });
  r = await runSite({ pool, site: site(), deps: d });
  assert.equal(r.status, 'failed');
  assert.equal(r.balanceUsd, null);
  assert.match(r.errors[0], /Account balance: .*refused/);
  assert.equal(pool.st.closed.status, 'failed');
  assert.equal(d.captured.length, 1);
  assert.equal(d.captured[0].userId, 10);
  assert.equal(d.captured[0].fingerprint, 'serpTracker:site:1:run-failed'); // no date in it: a broken site is one inbox item

  // --- modules run independently: one throws, the next still runs, the run is failed, the cost of a module is counted
  pool = fakePool();
  d = deps(pool);
  const order = [];
  r = await runSite({
    pool, site: site(), deps: d,
    modules: [
      { name: 'First', run: async () => { order.push('first'); throw new Error('first broke'); } },
      { name: 'Second', run: async ({ logCost, isWeekly, runDate }) => { order.push('second'); assert.equal(isWeekly, false); assert.equal(runDate, '2026-11-06'); await logCost({ endpoint: '/serp', costUsd: 0.25 }); return 'done'; } },
    ],
  });
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(r.status, 'failed');
  assert.equal(r.steps.length, 3);
  assert.equal(r.steps[2].status, 'ok');
  assert.equal(r.totalCostUsd, 0.25);

  // --- weekly flag follows the Brisbane Monday (Sunday 20:00 UTC = Monday 06:00 Brisbane)
  pool = fakePool();
  let weekly = null;
  await runSite({ pool, site: site(), deps: deps(pool, { now: () => new Date('2026-11-08T20:00:00Z') }), modules: [{ name: 'W', run: async ({ isWeekly }) => { weekly = isWeekly; } }] });
  assert.equal(weekly, true);

  // --- only one run per site at a time
  pool = fakePool({ active: true });
  await assert.rejects(runSite({ pool, site: site(), deps: deps(pool) }), (e) => e instanceof RunAlreadyActive && e.status === 409);
  assert.equal(pool.st.runs.length, 0);
  assert.equal(pool.st.stale, 1); // dead runs are closed before the check

  // --- an alert that cannot be raised does not break the run
  pool = fakePool();
  r = await runSite({ pool, site: site(), deps: deps(pool, { getBalance: async () => { throw new Error('x'); }, capture: async () => { throw new Error('inbox down'); } }) });
  assert.equal(r.status, 'failed');

  // --- the daily job: every site once, a person who lost the feature is skipped, a running site is skipped, one failure does not stop the rest
  const sites = [site(1, 10), site(2, 11), site(3, 12), site(4, 10)];
  const ran = [];
  const out = await runAllSites({
    pool: {}, loadAllSites: async () => sites,
    mayUse: async (uid) => uid !== 11,
    deps: {}, modules: [],
    runSite: async ({ site: s }) => {
      ran.push(s.id);
      if (s.id === 3) { const e = new Error('busy'); e.status = 409; throw e; }
      if (s.id === 4) return { status: 'failed' };
      return { status: 'ok' };
    },
  });
  assert.deepEqual(ran, [1, 3, 4]); // site 2's owner has no access
  assert.deepEqual(out, { sites: 4, ran: 2, failed: 1, skipped: 2 });

  console.log('runner.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
