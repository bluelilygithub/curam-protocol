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

    // ================= Lookup =================
    const bin = require('../services/recycleBin');
    require('../services/recycleBin/adapters');
    const { saveLookup, purgeRaw } = require('../services/serpTracker/lookups');
    const { DataForSeoError } = require('../services/serpTracker/dataforseo');
    const organic = (g, a, url, domain) => ({ type: 'organic', rank_group: g, rank_absolute: a, url, domain, title: 't' });
    const FAKE_RESULT = { keyword: 'walk in wine cabinets', items: [
      { type: 'ai_overview', rank_group: 1, rank_absolute: 1, references: [{ url: 'https://www.wiwc.com.au/cabinets/', domain: 'www.wiwc.com.au', title: 'x' }] },
      organic(1, 2, 'https://rival.com.au/', 'rival.com.au'), organic(2, 3, 'https://www.wiwc.com.au/cabinets/', 'www.wiwc.com.au'),
    ] };
    let liveCalls = 0;
    let liveImpl = async () => ({ costUsd: 0.0123, result: FAKE_RESULT, raw: { tasks: [{ result: [FAKE_RESULT] }] } });
    const lsrv = await serve(createRouter(pool, { deps: okDeps, live: async (...a) => { liveCalls++; return liveImpl(...a); }, env: { MAX_MONTHLY_SPEND_USD: '50' }, now: () => NOW, lookupsPerHour: 500 }));
    servers.push(lsrv);
    const lbase = `http://127.0.0.1:${lsrv.address().port}/api/serp-tracker`;
    const lcallJson = async (user, method, path, body) => {
      const r2 = await fetch(lbase + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r2.status, body: await r2.json() };
    };

    // validation: nothing is searched or charged
    assert.equal((await lcallJson(A, 'POST', '/lookups', { keyword: '   ' })).status, 400);
    assert.equal((await lcallJson(A, 'POST', '/lookups', { keyword: 'x', depth: 15 })).status, 400);
    assert.equal(liveCalls, 0);

    // a lookup: parsed with A's own domain, saved, cost logged
    r = await lcallJson(A, 'POST', '/lookups', { keyword: 'walk in wine cabinets', device: 'mobile', depth: 20 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const look1 = r.body.lookup;
    assert.equal(look1.myPosition, 2);
    assert.equal(look1.myStatus, 'ranked');
    assert.equal(look1.device, 'mobile');
    assert.equal(look1.depth, 20);
    assert.equal(look1.costUsd, 0.0123);
    assert.equal(look1.summary.aiOverview.mineCited, true);
    assert.equal(look1.summary.mine.itemsAboveMe, 1);
    assert.equal(look1.rawKept, true);
    const lcost = (await pool.query(`SELECT endpoint, "costUsd"::float AS c FROM serp_api_costs WHERE "userId" = $1 AND endpoint LIKE '%live/advanced%'`, [A])).rows;
    assert.equal(lcost.length, 1);
    assert.equal(lcost[0].c, 0.0123);
    assert.match(lcost[0].endpoint, /depth=20 mobile/);

    // another person sees none of it and cannot open or delete it
    assert.deepEqual((await lcallJson(B, 'GET', '/lookups')).body.lookups, []);
    assert.equal((await lcallJson(B, 'GET', `/lookups/${look1.id}`)).status, 404);
    assert.equal((await lcallJson(B, 'DELETE', '/lookups', { ids: [look1.id] })).body.deleted, 0);
    assert.equal((await lcallJson(B, 'DELETE', '/lookups', { all: true })).body.deleted, 0);
    assert.equal((await lcallJson(A, 'GET', `/lookups/${look1.id}`)).status, 200);
    assert.equal((await lcallJson(A, 'GET', '/lookups')).body.lookups.length, 1);

    // an answer that cannot be read is still CHARGED, so it is logged, and nothing is saved
    liveImpl = async () => ({ costUsd: 0.5, result: { keyword: 'k', items: [] }, raw: {} });
    r = await lcallJson(A, 'POST', '/lookups', { keyword: 'empty serp' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /no organic results/);
    assert.match(r.body.error, /charged: US\$0\.5/);
    assert.equal((await lcallJson(A, 'GET', '/lookups')).body.lookups.length, 1);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM serp_api_costs WHERE "userId" = $1 AND "costUsd" = 0.5`, [A])).rows[0].count), 1);

    // DataForSEO refusing (account not verified): its reason is shown, nothing saved, nothing charged
    liveImpl = async () => { throw new DataForSeoError('DataForSEO answered HTTP 403. It said: Please verify your account before using the API.', { status: 403, code: 'HTTP' }); };
    r = await lcallJson(A, 'POST', '/lookups', { keyword: 'refused' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /verify your account/);
    assert.equal((await lcallJson(A, 'GET', '/lookups')).body.lookups.length, 1);
    liveImpl = async () => ({ costUsd: 0.0123, result: FAKE_RESULT, raw: { tasks: [] } });

    // not connected, and the spending cap: neither calls DataForSEO
    const before = liveCalls;
    const off = await serve(createRouter(pool, { deps: { ...okDeps, hasCredentials: () => false }, live: async () => { liveCalls++; return liveImpl(); }, now: () => NOW }));
    servers.push(off);
    assert.equal((await fetch(`http://127.0.0.1:${off.address().port}/api/serp-tracker/lookups`, { method: 'POST', headers: { 'x-test-user': String(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: 'x' }) })).status, 503);
    const capped = await serve(createRouter(pool, { deps: okDeps, live: async () => { liveCalls++; return liveImpl(); }, env: { MAX_MONTHLY_SPEND_USD: '1' }, now: () => NOW }));
    servers.push(capped);
    const capRes = await fetch(`http://127.0.0.1:${capped.address().port}/api/serp-tracker/lookups`, { method: 'POST', headers: { 'x-test-user': String(A), 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: 'x' }) });
    assert.equal(capRes.status, 402);
    assert.match((await capRes.json()).error, /spending limit \(US\$1\.00\)/);
    assert.equal(liveCalls, before);

    // several lookups; delete SOME (to the recycle bin), the rest stay
    const made = [look1.id];
    for (const kw of ['second search', 'third search']) made.push((await lcallJson(A, 'POST', '/lookups', { keyword: kw })).body.lookup.id);
    assert.equal((await lcallJson(A, 'GET', '/lookups')).body.lookups.length, 3);
    assert.equal((await lcallJson(A, 'DELETE', '/lookups', { ids: [] })).status, 400);
    assert.equal((await lcallJson(A, 'DELETE', '/lookups', {})).status, 400);
    assert.equal((await lcallJson(A, 'DELETE', '/lookups', { ids: ['x'] })).status, 400);
    r = await lcallJson(A, 'DELETE', '/lookups', { ids: [made[0], made[1]] });
    assert.equal(r.body.deleted, 2);
    assert.equal(r.body.binIds.length, 2);
    const left = (await lcallJson(A, 'GET', '/lookups')).body.lookups;
    assert.deepEqual(left.map((l) => l.id), [made[2]]);
    assert.equal((await bin.list(A, { types: ['serp-lookup'] })).length, 2);
    assert.equal((await bin.list(B, { types: ['serp-lookup'] })).length, 0); // the bin is private too

    // Undo: the lookup comes back with its parsed summary (not the raw answer, which is never put in the bin)
    await bin.restoreItem(A, r.body.binIds[0]);
    const back = (await lcallJson(A, 'GET', '/lookups')).body.lookups;
    assert.equal(back.length, 2);
    const restored = back.find((l) => l.id === made[0] || l.id === made[1]);
    assert.ok(restored);
    assert.equal(restored.rawKept, false);
    assert.equal((await lcallJson(A, 'GET', `/lookups/${restored.id}`)).body.lookup.summary.top10.length, 2);

    // delete ALL of one person's; the other person's are untouched
    const bId = (await lcallJson(B, 'POST', '/lookups', { keyword: 'bs search' })).body.lookup.id;
    r = await lcallJson(A, 'DELETE', '/lookups', { all: true });
    assert.equal(r.body.deleted, 2);
    assert.deepEqual((await lcallJson(A, 'GET', '/lookups')).body.lookups, []);
    assert.deepEqual((await lcallJson(B, 'GET', '/lookups')).body.lookups.map((l) => l.id), [bId]);
    assert.equal((await lcallJson(B, 'GET', '/lookups')).body.lookups[0].myStatus, null); // B has no site, so no "mine"

    // only the latest 50 are kept
    for (let i = 0; i < 52; i++) await saveLookup(pool, { userId: A, keyword: `k${i}`, locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10, costUsd: 0, summary: { top10: [] } });
    const fifty = (await lcallJson(A, 'GET', '/lookups')).body.lookups;
    assert.equal(fifty.length, 50);
    assert.equal(fifty[0].keyword, 'k51');
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM serp_lookups WHERE "userId" = $1', [A])).rows[0].count), 50);

    // raw answers are emptied after 90 days; the parsed lookup stays
    const raw1 = await saveLookup(pool, { userId: B, keyword: 'old', locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10, costUsd: 0, summary: { top10: [] }, raw: { a: 1 } });
    await pool.query(`UPDATE serp_lookups SET "createdAt" = '2026-07-01T00:00:00Z' WHERE id = $1`, [raw1.id]);
    const fresh = await saveLookup(pool, { userId: B, keyword: 'fresh', locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10, costUsd: 0, summary: { top10: [] }, raw: { a: 1 } });
    assert.ok(await purgeRaw(pool) >= 1);
    const rawState = (await pool.query('SELECT id, ("rawGz" IS NULL) AS gone FROM serp_lookups WHERE id = ANY($1)', [[raw1.id, fresh.id]])).rows;
    assert.equal(rawState.find((x) => x.id === raw1.id).gone, true);
    assert.equal(rawState.find((x) => x.id === fresh.id).gone, false);

    // lookups are rate limited per person
    const lim = await serve(createRouter(pool, { deps: okDeps, live: async () => liveImpl(), now: () => NOW, lookupsPerHour: 1 }));
    servers.push(lim);
    const lp = (u) => fetch(`http://127.0.0.1:${lim.address().port}/api/serp-tracker/lookups`, { method: 'POST', headers: { 'x-test-user': String(u), 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: 'rl' }) });
    assert.equal((await lp(B)).status, 200);
    assert.equal((await lp(B)).status, 429);

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
