'use strict';
// DATABASE_URL=... node server/routes/serpTrackerRouter.db.test.js
// Real database, fake DataForSEO, fake sign-in. Proves: one person's site, runs and cost attribution are invisible to another person; saving
// validates; a run records the balance and its cost; two runs never overlap; a dead run does not block a site; a failed step is a failed run.
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP serpTrackerRouter.db.test.js: DATABASE_URL is not set'); process.exit(0); }

// db.js builds the schema in the background as soon as it is required and exports no "ready" signal, so wait for its own log line.
// Touching the users table while that runs can deadlock with its ALTER TABLE statements.
let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const { createRouter } = require('./serpTrackerRouter');
const { logCost } = require('../services/serpTracker/costs');

const NOW = new Date('2026-11-05T20:00:00Z'); // 06:00 Friday 6 Nov 2026 in Brisbane
const GOOD = { domain: 'https://www.wiwc.com.au', brandTerms: ['wiwc'], keywords: [{ term: 'walk in wine cabinets', targetUrl: 'https://www.wiwc.com.au/cabinets/' }], competitors: [{ domain: 'rival.com.au', pages: [] }] };

async function waitForSchema() {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000));
  await Promise.race([schemaDone, timeout]);
  console.log = realLog;
}

function serve(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/api/serp-tracker', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

(async () => {
  await waitForSchema();
  const tag = `serp-test-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  const servers = [];
  try {
    const okDeps = { getBalance: async () => ({ balanceUsd: 8.5, costUsd: 0 }), hasCredentials: () => true, logCost };
    const srv = await serve(createRouter(pool, { deps: okDeps, env: { MAX_MONTHLY_SPEND_USD: '7' }, now: () => NOW }));
    servers.push(srv);
    const base = `http://127.0.0.1:${srv.address().port}/api/serp-tracker`;
    const call = async (user, method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };

    // nothing yet
    assert.equal((await call(B, 'GET', '/site')).body.site, null);
    assert.deepEqual((await call(B, 'GET', '/runs')).body.runs, []);

    // saving validates and saves nothing when wrong
    let r = await call(A, 'PUT', '/site', { profile: { domain: 'nope', serpDepth: 15 } });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.length >= 2);
    assert.equal((await call(A, 'GET', '/site')).body.site, null);

    // A saves; B still sees nothing; saving again replaces (still one row)
    r = await call(A, 'PUT', '/site', { profile: GOOD });
    assert.equal(r.status, 200);
    assert.equal(r.body.site.profile.domain, 'wiwc.com.au');
    assert.equal(r.body.site.profile.serpDepth, 100);
    assert.equal((await call(B, 'GET', '/site')).body.site, null);
    await call(A, 'PUT', '/site', { profile: { ...GOOD, serpDepth: 20 } });
    assert.equal((await call(A, 'GET', '/site')).body.site.profile.serpDepth, 20);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM serp_sites WHERE "userId" = $1', [A])).rows[0].count), 1);

    // B cannot run without a site of their own, and cannot reach A's
    assert.equal((await call(B, 'POST', '/run')).status, 400);

    // A runs: balance and a cost row recorded, Brisbane date used
    r = await call(A, 'POST', '/run');
    assert.equal(r.status, 200);
    assert.equal(r.body.run.status, 'ok');
    assert.equal(r.body.run.balanceUsd, 8.5);
    const runs = (await call(A, 'GET', '/runs')).body.runs;
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runDate, '2026-11-06');
    assert.equal(runs[0].trigger, 'manual');
    assert.equal(runs[0].status, 'ok');
    assert.equal(runs[0].balanceUsd, 8.5);
    assert.equal(runs[0].steps[0].name, 'Account balance');
    assert.deepEqual((await call(B, 'GET', '/runs')).body.runs, []);
    const costRows = (await pool.query('SELECT endpoint, "costDate"::text AS d FROM serp_api_costs WHERE "userId" = $1', [A])).rows;
    assert.deepEqual(costRows, [{ endpoint: '/v3/appendix/user_data', d: '2026-11-06' }]);

    // a run in progress blocks a second one (409); one that died hours ago does not
    const site = (await pool.query('SELECT id FROM serp_sites WHERE "userId" = $1', [A])).rows[0].id;
    await pool.query(`INSERT INTO serp_runs ("userId","siteId","runDate",status,"startedAt") VALUES ($1,$2,'2026-11-06','running','2026-11-05T19:30:00Z')`, [A, site]);
    assert.equal((await call(A, 'POST', '/run')).status, 409);
    await pool.query(`UPDATE serp_runs SET "startedAt" = '2026-11-05T10:00:00Z' WHERE "siteId" = $1 AND status = 'running'`, [site]);
    r = await call(A, 'POST', '/run');
    assert.equal(r.status, 200);
    const dead = (await pool.query(`SELECT status, "errorsJson" FROM serp_runs WHERE "siteId" = $1 AND "startedAt" = '2026-11-05T10:00:00Z'`, [site])).rows[0];
    assert.equal(dead.status, 'failed');
    assert.match(JSON.stringify(dead.errorsJson), /did not finish/);

    // spend: workspace-wide, calendar months of the Brisbane date, cap from the environment
    await logCost(pool, { userId: A, costDate: '2026-11-02', endpoint: '/test', costUsd: 1.25 });
    await logCost(pool, { userId: B, costDate: '2026-10-30', endpoint: '/test', costUsd: 0.5 });
    await logCost(pool, { userId: B, costDate: '2026-12-01', endpoint: '/test', costUsd: 9 }); // another month: not counted
    for (const who of [A, B]) {
      const s = (await call(who, 'GET', '/status')).body;
      assert.equal(s.capUsd, 7);
      assert.equal(s.dataForSeoConfigured, true);
      assert.ok(s.spentThisMonthUsd >= 1.25 && s.spentThisMonthUsd < 9, `this month ${s.spentThisMonthUsd}`);
      assert.ok(s.spentLastMonthUsd >= 0.5 && s.spentLastMonthUsd < 9, `last month ${s.spentLastMonthUsd}`);
    }

    // a failed balance check is a FAILED run, shown with the reason, never an empty success
    const bad = await serve(createRouter(pool, {
      deps: { getBalance: async () => { throw new Error('DataForSEO answered HTTP 401. The login or password was refused.'); }, hasCredentials: () => true, logCost },
      now: () => NOW, runsPerHour: 100,
    }));
    servers.push(bad);
    const res = await fetch(`http://127.0.0.1:${bad.address().port}/api/serp-tracker/run`, { method: 'POST', headers: { 'x-test-user': String(A), 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.run.status, 'failed');
    assert.match(body.run.errors[0], /refused/);
    const failed = (await call(A, 'GET', '/runs')).body.runs[0];
    assert.equal(failed.status, 'failed');
    assert.equal(failed.balanceUsd, null);

    // manual runs are rate limited per person
    const limited = await serve(createRouter(pool, { deps: okDeps, now: () => NOW, runsPerHour: 1 }));
    servers.push(limited);
    const lcall = (u) => fetch(`http://127.0.0.1:${limited.address().port}/api/serp-tracker/run`, { method: 'POST', headers: { 'x-test-user': String(u), 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await lcall(A)).status, 200);
    assert.equal((await lcall(A)).status, 429);

    console.log('serpTrackerRouter.db.test.js: all passed');
  } finally {
    for (const s of servers) s.close();
    // runs, sites and costs go with the users. A failed cleanup must never hide the real failure above, so it only warns.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]]); break; } catch (e) {
        if (attempt === 2) console.warn(`cleanup of test users ${A}, ${B} failed: ${e.message}`);
        else await new Promise((r) => setTimeout(r, 500));
      }
    }
    await pool.end().catch(() => {});
  }
  process.exit(0); // db.js keeps timers alive
})().catch((e) => { console.error(e); process.exit(1); });
