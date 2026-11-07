'use strict';
// DATABASE_URL=... node server/routes/serpTrackerRouter.db.test.js
// Real database, fake DataForSEO, fake sign-in. Proves, for several sites per person:
//   - one person's sites, runs, lookups and the CRM client link are invisible to (and cannot be changed by) another person;
//   - saving validates; the same domain cannot be tracked twice; at most 20 sites; a client link must be the person's own;
//   - a run is per site, records the balance and cost, never overlaps itself, and a failed step is a failed run;
//   - Lookup works for a site (its place, language and domain) and as a Quick lookup (none); deep searches up to 200; the spending cap
//     refuses before DataForSEO is called; an unreadable answer is still charged; delete (some, all, one list) goes to the recycle bin with Undo;
//   - deleting a whole site moves it and its lookups to the bin, Undo brings both back, and its spending stays in the cost log.
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
const { createSite, MAX_SITES } = require('../services/serpTracker/store');
const { saveLookup, purgeRaw } = require('../services/serpTracker/lookups');
const { DataForSeoError } = require('../services/serpTracker/dataforseo');

const NOW = new Date('2026-11-05T20:00:00Z'); // 06:00 Friday 6 Nov 2026 in Brisbane
const GOOD = { name: 'Acme Wines', domain: 'https://www.wiwc.com.au', brandTerms: ['wiwc'], keywords: [{ term: 'walk in wine cabinets', targetUrl: 'https://www.wiwc.com.au/cabinets/' }], competitors: [{ domain: 'rival.com.au', pages: [] }] };
const SECOND = { name: 'Second Client', domain: 'second-client.com.au', locationName: 'Sydney,New South Wales,Australia', languageCode: 'en', keywords: [{ term: 'second search' }] };

const organic = (g, a, url, domain) => ({ type: 'organic', rank_group: g, rank_absolute: a, url, domain, title: 't' });
const FAKE_RESULT = { keyword: 'walk in wine cabinets', se_domain: 'google.com', location_code: 2036, language_code: 'en', items: [
  { type: 'ai_overview', rank_group: 1, rank_absolute: 1, references: [{ url: 'https://www.wiwc.com.au/cabinets/', domain: 'www.wiwc.com.au', title: 'x' }] },
  organic(1, 2, 'https://rival.com.au/', 'rival.com.au'), organic(2, 3, 'https://www.wiwc.com.au/cabinets/', 'www.wiwc.com.au'),
] };
// 130 organic results with the owner's site at position 118 (page 12)
const DEEP_RESULT = { keyword: 'deep', items: Array.from({ length: 130 }, (_, i) => organic(i + 1, i + 1, i + 1 === 118 ? 'https://www.wiwc.com.au/deep' : `https://s${i}.com/`, i + 1 === 118 ? 'www.wiwc.com.au' : `s${i}.com`)) };

function serve(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/api/serp-tracker', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;

  const tag = `serp-test-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  const clientA = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, 'Acme Client') RETURNING id`, [A])).rows[0].id;
  const clientB = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, 'Bs Client') RETURNING id`, [B])).rows[0].id;
  const servers = [];
  const bin = require('../services/recycleBin');
  require('../services/recycleBin/adapters');
  try {
    const okDeps = { getBalance: async () => ({ balanceUsd: 8.5, costUsd: 0 }), hasCredentials: () => true, logCost };
    let liveCalls = 0;
    let liveImpl = async () => ({ costUsd: 0.0123, result: FAKE_RESULT, raw: { tasks: [{ result: [FAKE_RESULT] }] } });
    let lastTask = null;
    const liveFn = async (task) => { liveCalls++; lastTask = task; return liveImpl(task); };
    const mkApp = async (opts) => {
      const srv = await serve(createRouter(pool, { deps: okDeps, live: liveFn, env: { MAX_MONTHLY_SPEND_USD: '50' }, now: () => NOW, lookupsPerHour: 500, runsPerHour: 500, ...opts }));
      servers.push(srv);
      const base = `http://127.0.0.1:${srv.address().port}/api/serp-tracker`;
      return async (user, method, path, body) => {
        const res = await fetch(base + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json() };
      };
    };
    const call = await mkApp();

    // ================= Sites =================
    assert.deepEqual((await call(B, 'GET', '/sites')).body.sites, []);

    // saving validates and saves nothing when wrong
    let r = await call(A, 'POST', '/sites', { profile: { domain: 'nope', serpDepth: 15 } });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.length >= 2);
    assert.deepEqual((await call(A, 'GET', '/sites')).body.sites, []);

    // A adds a site (no client yet); B sees nothing
    r = await call(A, 'POST', '/sites', { profile: GOOD });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const site1 = r.body.site;
    assert.equal(site1.profile.domain, 'wiwc.com.au');
    assert.equal(site1.profile.name, 'Acme Wines');
    assert.equal(site1.clientId, null);
    assert.deepEqual((await call(B, 'GET', '/sites')).body.sites, []);
    assert.equal((await call(B, 'GET', `/sites/${site1.id}`)).status, 404);

    // the same domain twice is refused (with or without www), a second DIFFERENT site is fine
    assert.equal((await call(A, 'POST', '/sites', { profile: { domain: 'www.WIWC.com.au' } })).status, 409);
    r = await call(A, 'POST', '/sites', { profile: SECOND, clientId: clientA });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const site2 = r.body.site;
    assert.equal(site2.clientId, clientA);
    assert.equal(site2.clientName, 'Acme Client'); // the CRM client's name comes with it
    assert.equal((await call(A, 'GET', '/sites')).body.sites.length, 2);
    // the same domain can be tracked by ANOTHER person (the rule is per person)
    assert.equal((await call(B, 'POST', '/sites', { profile: { domain: 'wiwc.com.au' } })).status, 200);

    // a client link must be the person's own: B's client cannot be linked by A, nor A's by B; a bad id is refused
    assert.equal((await call(A, 'PUT', `/sites/${site1.id}`, { profile: GOOD, clientId: clientB })).status, 400);
    assert.equal((await call(A, 'POST', '/sites', { profile: { domain: 'third.com.au' }, clientId: clientB })).status, 400);
    assert.equal((await call(A, 'PUT', `/sites/${site1.id}`, { profile: GOOD, clientId: 'x' })).status, 400);
    assert.equal((await call(A, 'GET', `/sites/${site1.id}`)).body.site.clientId, null); // nothing changed

    // update: edit keeps the link when clientId is not sent, changes it when sent, removes it with null
    r = await call(A, 'PUT', `/sites/${site2.id}`, { profile: { ...SECOND, serpDepth: 20 } });
    assert.equal(r.body.site.profile.serpDepth, 20);
    assert.equal(r.body.site.clientId, clientA);
    r = await call(A, 'PUT', `/sites/${site2.id}`, { profile: SECOND, clientId: null });
    assert.equal(r.body.site.clientId, null);
    r = await call(A, 'PUT', `/sites/${site2.id}`, { profile: SECOND, clientId: clientA });
    assert.equal(r.body.site.clientId, clientA);
    // changing a site to a domain A already tracks is refused; B cannot edit or delete A's
    assert.equal((await call(A, 'PUT', `/sites/${site2.id}`, { profile: { ...GOOD, domain: 'wiwc.com.au' } })).status, 409);
    assert.equal((await call(B, 'PUT', `/sites/${site1.id}`, { profile: GOOD })).status, 404);
    assert.equal((await call(B, 'DELETE', `/sites/${site1.id}`)).status, 404);
    assert.equal((await call(A, 'GET', '/sites')).body.sites.length, 2);

    // deleting a CRM client only unlinks it
    const tmpClient = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, 'Temp') RETURNING id`, [A])).rows[0].id;
    const site3 = (await call(A, 'POST', '/sites', { profile: { domain: 'temp-site.com.au' }, clientId: tmpClient })).body.site;
    await pool.query('DELETE FROM clients WHERE id = $1', [tmpClient]);
    assert.equal((await call(A, 'GET', `/sites/${site3.id}`)).body.site.clientId, null);
    assert.equal((await call(A, 'DELETE', `/sites/${site3.id}`)).status, 200);

    // at most 20 sites per person
    for (let i = 0; i < MAX_SITES - 2; i++) await createSite(pool, A, { domain: `filler${i}.com.au`, name: '', brandTerms: [], keywords: [], competitors: [], healthCheckUrls: [], locationName: 'Australia', languageCode: 'en', devices: ['desktop'], serpDepth: 10, timezone: 'Australia/Brisbane' });
    assert.equal((await call(A, 'GET', '/sites')).body.sites.length, MAX_SITES);
    r = await call(A, 'POST', '/sites', { profile: { domain: 'one-too-many.com.au' } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /most/);
    await pool.query(`DELETE FROM serp_sites WHERE "userId" = $1 AND "profileJson"->>'domain' LIKE 'filler%'`, [A]);

    // ================= Runs (per site) =================
    assert.equal((await call(B, 'POST', `/sites/${site1.id}/run`)).status, 404);
    assert.equal((await call(B, 'GET', `/sites/${site1.id}/runs`)).status, 404);
    r = await call(A, 'POST', `/sites/${site1.id}/run`);
    assert.equal(r.status, 200);
    assert.equal(r.body.run.status, 'ok');
    assert.equal(r.body.run.balanceUsd, 8.5);
    let runs = (await call(A, 'GET', `/sites/${site1.id}/runs`)).body.runs;
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runDate, '2026-11-06');
    assert.equal(runs[0].steps[0].name, 'Account balance');
    assert.deepEqual((await call(A, 'GET', `/sites/${site2.id}/runs`)).body.runs, []); // another site's runs are separate
    const costRows = (await pool.query(`SELECT endpoint, "costDate"::text AS d, "siteId" FROM serp_api_costs WHERE "userId" = $1 AND "runId" IS NOT NULL`, [A])).rows;
    assert.deepEqual(costRows, [{ endpoint: '/v3/appendix/user_data', d: '2026-11-06', siteId: site1.id }]);

    // a run in progress blocks a second one (409) for THAT site only; one that died hours ago does not block
    await pool.query(`INSERT INTO serp_runs ("userId","siteId","runDate",status,"startedAt") VALUES ($1,$2,'2026-11-06','running','2026-11-05T19:30:00Z')`, [A, site1.id]);
    assert.equal((await call(A, 'POST', `/sites/${site1.id}/run`)).status, 409);
    assert.equal((await call(A, 'POST', `/sites/${site2.id}/run`)).status, 200);
    await pool.query(`UPDATE serp_runs SET "startedAt" = '2026-11-05T10:00:00Z' WHERE "siteId" = $1 AND status = 'running'`, [site1.id]);
    assert.equal((await call(A, 'POST', `/sites/${site1.id}/run`)).status, 200);
    const dead = (await pool.query(`SELECT status, "errorsJson" FROM serp_runs WHERE "siteId" = $1 AND "startedAt" = '2026-11-05T10:00:00Z'`, [site1.id])).rows[0];
    assert.equal(dead.status, 'failed');
    assert.match(JSON.stringify(dead.errorsJson), /did not finish/);

    // a failed balance check is a FAILED run with the reason; manual runs are rate limited per person
    const bad = await mkApp({ deps: { getBalance: async () => { throw new Error('DataForSEO answered HTTP 401. The login or password was refused.'); }, hasCredentials: () => true, logCost } });
    r = await bad(A, 'POST', `/sites/${site1.id}/run`);
    assert.equal(r.body.run.status, 'failed');
    assert.match(r.body.run.errors[0], /refused/);
    const limited = await mkApp({ runsPerHour: 1 });
    assert.equal((await limited(A, 'POST', `/sites/${site2.id}/run`)).status, 200);
    assert.equal((await limited(A, 'POST', `/sites/${site2.id}/run`)).status, 429);

    // ================= Spend =================
    await logCost(pool, { userId: A, costDate: '2026-11-02', endpoint: '/test', costUsd: 1.25 });
    await logCost(pool, { userId: B, costDate: '2026-10-30', endpoint: '/test', costUsd: 0.5 });
    await logCost(pool, { userId: B, costDate: '2026-12-01', endpoint: '/test', costUsd: 9 }); // another month: not counted
    for (const who of [A, B]) {
      const s = (await call(who, 'GET', '/status')).body;
      assert.equal(s.capUsd, 50);
      assert.equal(s.dataForSeoConfigured, true);
      assert.equal(s.maxSites, 20);
      assert.equal(s.maxLookupDepth, 200);
      assert.deepEqual(s.pricing, { perTenResultsUsd: 0.002, aiOverviewUsd: 0.002 });
      assert.ok(s.spentThisMonthUsd >= 1.25 && s.spentThisMonthUsd < 9, `this month ${s.spentThisMonthUsd}`);
      assert.ok(s.spentLastMonthUsd >= 0.5 && s.spentLastMonthUsd < 9, `last month ${s.spentLastMonthUsd}`);
    }

    // ================= Lookup =================
    // validation: nothing is searched or charged
    assert.equal((await call(A, 'POST', '/lookups', { keyword: '   ' })).status, 400);
    assert.equal((await call(A, 'POST', '/lookups', { keyword: 'x', depth: 15 })).status, 400);
    assert.equal((await call(A, 'POST', '/lookups', { keyword: 'x', depth: 210 })).status, 400);
    assert.equal((await call(A, 'POST', '/lookups', { keyword: 'x', siteId: 'abc' })).status, 400);
    assert.equal((await call(A, 'POST', '/lookups', { keyword: 'x', siteId: site1.id + 100000 })).status, 400); // not a site of theirs
    assert.equal(liveCalls, 0);

    // for a SITE: its domain, place and language are used and the result is read against that domain
    r = await call(A, 'POST', '/lookups', { keyword: 'walk in wine cabinets', device: 'mobile', depth: 20, siteId: site1.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const look1 = r.body.lookup;
    assert.equal(look1.siteId, site1.id);
    assert.equal(look1.myPosition, 2);
    assert.equal(look1.myPage, 1);
    assert.equal(look1.domain, 'wiwc.com.au');
    assert.equal(lastTask.locationName, 'Australia');
    assert.equal(look1.summary.aiOverview.mineCited, true);
    assert.equal(look1.rawKept, true);
    // for a DIFFERENT site: that site's place (Sydney), and its own domain (so nothing is "mine" in this result)
    r = await call(A, 'POST', '/lookups', { keyword: 'second search', siteId: site2.id });
    assert.equal(lastTask.locationName, 'Sydney,New South Wales,Australia');
    assert.equal(r.body.lookup.domain, 'second-client.com.au');
    assert.equal(r.body.lookup.myStatus, 'not_in_top_10');
    // a QUICK lookup: no site, the default place, nothing is "mine"
    r = await call(A, 'POST', '/lookups', { keyword: 'quick one' });
    assert.equal(r.status, 200);
    const quick1 = r.body.lookup;
    assert.equal(quick1.siteId, null);
    assert.equal(quick1.myStatus, null);
    assert.equal(lastTask.locationName, 'Australia');

    // lists are per site; the Quick lookups are their own list; no parameter = everything
    assert.deepEqual((await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups.map((l) => l.id), [look1.id]);
    assert.equal((await call(A, 'GET', `/lookups?siteId=${site2.id}`)).body.lookups.length, 1);
    assert.deepEqual((await call(A, 'GET', '/lookups?siteId=quick')).body.lookups.map((l) => l.id), [quick1.id]);
    assert.equal((await call(A, 'GET', '/lookups')).body.lookups.length, 3);
    assert.equal((await call(A, 'GET', '/lookups?siteId=zz')).status, 400);

    // another person sees none of it and cannot open or delete it
    assert.deepEqual((await call(B, 'GET', '/lookups')).body.lookups, []);
    assert.deepEqual((await call(B, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups, []);
    assert.equal((await call(B, 'GET', `/lookups/${look1.id}`)).status, 404);
    assert.equal((await call(B, 'DELETE', '/lookups', { ids: [look1.id] })).body.deleted, 0);
    assert.equal((await call(B, 'DELETE', '/lookups', { all: true })).body.deleted, 0);
    assert.equal((await call(B, 'POST', '/lookups', { keyword: 'x', siteId: site1.id })).status, 400); // B cannot search "as" A's site
    assert.equal((await call(A, 'GET', `/lookups/${look1.id}`)).status, 200);

    // FIND MY SITE: a deep search (top 200 allowed); the site is found at #118, about page 12, and the 130 results are read
    liveImpl = async () => ({ costUsd: 0.026, result: DEEP_RESULT, raw: { tasks: [] } });
    r = await call(A, 'POST', '/lookups', { keyword: 'deep', depth: 200, aiOverview: false, siteId: site1.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(lastTask.depth, 200);
    assert.equal(lastTask.loadAiOverview, false);
    assert.equal(r.body.lookup.myPosition, 118);
    assert.equal(r.body.lookup.myPage, 12);
    assert.equal(r.body.lookup.summary.mine.bestPage, 12);
    assert.equal(r.body.lookup.summary.top10.length, 10);
    const deepId = r.body.lookup.id;
    liveImpl = async () => ({ costUsd: 0.0123, result: FAKE_RESULT, raw: { tasks: [{ result: [FAKE_RESULT] }] } });

    // SHORT ANSWERS: asking for 100 often returns only ~13 results, which cost a fraction of a cent. A deep search is retried (4 attempts at most).
    const shortAnswer = (n, sitePos) => ({ keyword: 'k', items: Array.from({ length: n }, (_, i) => organic(i + 1, i + 1, i + 1 === sitePos ? 'https://www.wiwc.com.au/p' : `https://s${i}.com/`, i + 1 === sitePos ? 'www.wiwc.com.au' : `s${i}.com`)) });
    const attemptCosts = async (siteId) => (await pool.query(`SELECT endpoint, "costUsd"::float AS c FROM serp_api_costs WHERE "siteId" = $1 AND endpoint LIKE '%depth=100 desktop%' ORDER BY id`, [siteId])).rows;
    await pool.query(`DELETE FROM serp_api_costs WHERE "siteId" = $1 AND endpoint LIKE '%depth=100%'`, [site1.id]);

    // 1. short, short, then a full answer with the site at #118: three attempts, all three paid and logged, the full one kept
    let n = 0;
    liveImpl = async () => { n++; return n < 3 ? { costUsd: 0.004, result: shortAnswer(13), raw: { try: n } } : { costUsd: 0.02, result: DEEP_RESULT, raw: { try: n } }; };
    r = await call(A, 'POST', '/lookups', { keyword: 'retry until full', depth: 100, aiOverview: false, siteId: site1.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(n, 3);
    assert.equal(r.body.lookup.summary.attempts, 3);
    assert.equal(r.body.lookup.summary.coverage.complete, true);
    assert.equal(r.body.lookup.myPosition, 118);
    assert.ok(Math.abs(r.body.lookup.costUsd - 0.028) < 1e-9, `cost is the sum of the attempts: ${r.body.lookup.costUsd}`);
    const costs1 = await attemptCosts(site1.id);
    assert.deepEqual(costs1.map((c) => c.c), [0.004, 0.004, 0.02]);
    assert.match(costs1[1].endpoint, /\(try 2\)/);
    assert.match(costs1[2].endpoint, /\(try 3\)/);
    await pool.query(`DELETE FROM serp_api_costs WHERE "siteId" = $1 AND endpoint LIKE '%depth=100%'`, [site1.id]);

    // 2. every attempt short and the site not found: four attempts, the fullest answer kept, and it says it is NOT complete (never "checked the top 100")
    n = 0;
    liveImpl = async () => { n++; return { costUsd: 0.004, result: shortAnswer(10 + n), raw: { try: n } }; }; // 11, 12, 13, 14 results
    r = await call(A, 'POST', '/lookups', { keyword: 'always short', depth: 100, aiOverview: false, siteId: site1.id });
    assert.equal(n, 4);
    assert.equal(r.body.lookup.summary.attempts, 4);
    assert.deepEqual(r.body.lookup.summary.coverage, { asked: 100, returned: 14, complete: false }); // the fullest of the four
    assert.equal(r.body.lookup.checked, 14);
    assert.equal(r.body.lookup.complete, false);
    assert.equal(r.body.lookup.myStatus, 'not_in_top_100');
    assert.ok(Math.abs(r.body.lookup.costUsd - 0.016) < 1e-9);
    await pool.query(`DELETE FROM serp_api_costs WHERE "siteId" = $1 AND endpoint LIKE '%depth=100%'`, [site1.id]);

    // 3. a short answer that already has the site is accepted at once (no pointless retries)
    n = 0;
    liveImpl = async () => { n++; return { costUsd: 0.004, result: shortAnswer(13, 5), raw: {} }; };
    r = await call(A, 'POST', '/lookups', { keyword: 'found on a short page', depth: 100, aiOverview: false, siteId: site1.id });
    assert.equal(n, 1);
    assert.equal(r.body.lookup.myPosition, 5);
    assert.equal(r.body.lookup.summary.attempts, 1);
    await pool.query(`DELETE FROM serp_api_costs WHERE "siteId" = $1 AND endpoint LIKE '%depth=100%'`, [site1.id]);

    // 4. shallow searches are never retried, even when short (a 10-result page is normally 8 to 10)
    n = 0;
    liveImpl = async () => { n++; return { costUsd: 0.002, result: shortAnswer(6), raw: {} }; };
    r = await call(A, 'POST', '/lookups', { keyword: 'shallow', depth: 20, aiOverview: false, siteId: site1.id });
    assert.equal(n, 1);
    assert.equal(r.body.lookup.summary.attempts, 1);

    // 5. the monthly limit stops the retries (the answer so far is still kept and shown): cap just above what is spent + one search
    const spentBefore = (await call(A, 'GET', '/status')).body.spentThisMonthUsd;
    n = 0;
    liveImpl = async () => { n++; return { costUsd: 0.5, result: shortAnswer(13), raw: {} }; }; // the first attempt itself costs 0.5
    const capLimited = await mkApp({ env: { MAX_MONTHLY_SPEND_USD: String(spentBefore + 0.1) } }); // room for the estimate of one search, not for a 0.5 attempt plus another
    r = await capLimited(A, 'POST', '/lookups', { keyword: 'cap stops retries', depth: 100, aiOverview: false, siteId: site1.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(n, 1); // the second attempt was not made: that 0.5 put the month over the limit
    assert.equal(r.body.lookup.summary.attempts, 1);
    assert.equal(r.body.lookup.summary.coverage.complete, false);
    await pool.query(`DELETE FROM serp_api_costs WHERE "siteId" = $1 AND "costUsd" = 0.5 AND endpoint LIKE '%depth=100%'`, [site1.id]);
    liveImpl = async () => ({ costUsd: 0.0123, result: FAKE_RESULT, raw: { tasks: [{ result: [FAKE_RESULT] }] } });

    // an answer that cannot be read is still CHARGED, so it is logged, and nothing is saved
    const before = (await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups.length;
    liveImpl = async () => ({ costUsd: 0.5, result: { keyword: 'k', items: [] }, raw: {} });
    r = await call(A, 'POST', '/lookups', { keyword: 'empty serp', siteId: site1.id });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /no organic results/);
    assert.match(r.body.error, /charged: US\$0\.5/);
    assert.equal((await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups.length, before);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM serp_api_costs WHERE "userId" = $1 AND "costUsd" = 0.5 AND "siteId" = $2`, [A, site1.id])).rows[0].count), 1); // charged to that site

    // DataForSEO refusing (account not verified): its reason is shown, nothing saved, nothing charged
    liveImpl = async () => { throw new DataForSeoError('DataForSEO answered HTTP 403. It said: Please verify your account before using the API.', { status: 403, code: 'HTTP' }); };
    r = await call(A, 'POST', '/lookups', { keyword: 'refused' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /verify your account/);
    liveImpl = async () => ({ costUsd: 0.0123, result: FAKE_RESULT, raw: { tasks: [] } });

    // not connected; the spending cap (already over, and "would pass it"): none of them calls DataForSEO
    const calls0 = liveCalls;
    const off = await mkApp({ deps: { ...okDeps, hasCredentials: () => false } });
    assert.equal((await off(A, 'POST', '/lookups', { keyword: 'x' })).status, 503);
    const capped = await mkApp({ env: { MAX_MONTHLY_SPEND_USD: '1' } });
    r = await capped(A, 'POST', '/lookups', { keyword: 'x' });
    assert.equal(r.status, 402);
    assert.match(r.body.error, /spending limit \(US\$1\.00\)/);
    // spent is about 1.25 + 0.5 + lookups; with a cap just above what is spent, a 200-deep search WOULD pass it and is refused up front
    const spentNow = (await call(A, 'GET', '/status')).body.spentThisMonthUsd;
    const tight = await mkApp({ env: { MAX_MONTHLY_SPEND_USD: String(spentNow + 0.01) } });
    r = await tight(A, 'POST', '/lookups', { keyword: 'x', depth: 200 });
    assert.equal(r.status, 402);
    assert.match(r.body.error, /expected to cost about US\$0\.042/); // 20 x 0.002 + 0.002 AI
    assert.match(r.body.error, /would pass/);
    assert.equal((await tight(A, 'POST', '/lookups', { keyword: 'cheap', depth: 10, aiOverview: false })).status, 200); // 0.002 still fits
    assert.equal(liveCalls, calls0 + 1);

    // select and delete: some, then all of ONE list, then everything
    const siteLookups = (await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups.map((l) => l.id);
    assert.ok(siteLookups.length >= 2);
    assert.equal((await call(A, 'DELETE', '/lookups', { ids: [] })).status, 400);
    assert.equal((await call(A, 'DELETE', '/lookups', { ids: ['x'] })).status, 400);
    assert.equal((await call(A, 'DELETE', '/lookups', { all: true, siteId: 'zz' })).status, 400);
    r = await call(A, 'DELETE', '/lookups', { ids: [look1.id, deepId] });
    assert.equal(r.body.deleted, 2);
    assert.equal(r.body.binIds.length, 2);
    assert.equal((await bin.list(B, { types: ['serp-lookup'] })).length, 0); // the bin is private too
    await bin.restoreItem(A, r.body.binIds[0]); // Undo: the readable result comes back, the raw answer does not
    const back = (await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups;
    assert.ok(back.some((l) => l.id === look1.id || l.id === deepId));
    assert.equal(back.find((l) => l.id === look1.id || l.id === deepId).rawKept, false);
    // "delete all" with a site deletes only that site's list; the Quick lookups and the other site's are untouched
    r = await call(A, 'DELETE', '/lookups', { all: true, siteId: site1.id });
    assert.ok(r.body.deleted >= 1);
    assert.deepEqual((await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups, []);
    assert.equal((await call(A, 'GET', `/lookups?siteId=${site2.id}`)).body.lookups.length, 1);
    assert.equal((await call(A, 'GET', '/lookups?siteId=quick')).body.lookups.length, 2); // 'quick one' and the 'cheap' one made with no site
    // everything
    const bLook = (await call(B, 'POST', '/lookups', { keyword: 'bs search' })).body.lookup.id;
    r = await call(A, 'DELETE', '/lookups', { all: true });
    assert.ok(r.body.deleted >= 2);
    assert.deepEqual((await call(A, 'GET', '/lookups')).body.lookups, []);
    assert.deepEqual((await call(B, 'GET', '/lookups')).body.lookups.map((l) => l.id), [bLook]);

    // only the latest 50 are kept PER LIST: 52 for site 1 leaves 50 there, and does not touch site 2's or the Quick lookups
    await call(A, 'POST', '/lookups', { keyword: 'keep me on site 2', siteId: site2.id });
    await call(A, 'POST', '/lookups', { keyword: 'keep me quick' });
    for (let i = 0; i < 52; i++) await saveLookup(pool, { userId: A, siteId: site1.id, keyword: `k${i}`, locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10, costUsd: 0, summary: { top10: [] } });
    const fifty = (await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups;
    assert.equal(fifty.length, 50);
    assert.equal(fifty[0].keyword, 'k51');
    assert.equal((await call(A, 'GET', `/lookups?siteId=${site2.id}`)).body.lookups.length, 1);
    assert.equal((await call(A, 'GET', '/lookups?siteId=quick')).body.lookups.length, 1);

    // raw answers are emptied after 90 days; the parsed lookup stays
    const raw1 = await saveLookup(pool, { userId: B, keyword: 'old', locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10, costUsd: 0, summary: { top10: [] }, raw: { a: 1 } });
    await pool.query(`UPDATE serp_lookups SET "createdAt" = '2026-07-01T00:00:00Z' WHERE id = $1`, [raw1.id]);
    const fresh = await saveLookup(pool, { userId: B, keyword: 'fresh', locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10, costUsd: 0, summary: { top10: [] }, raw: { a: 1 } });
    assert.ok(await purgeRaw(pool) >= 1);
    const rawState = (await pool.query('SELECT id, ("rawGz" IS NULL) AS gone FROM serp_lookups WHERE id = ANY($1)', [[raw1.id, fresh.id]])).rows;
    assert.equal(rawState.find((x) => x.id === raw1.id).gone, true);
    assert.equal(rawState.find((x) => x.id === fresh.id).gone, false);

    // lookups are rate limited per person
    const lim = await mkApp({ lookupsPerHour: 1 });
    assert.equal((await lim(B, 'POST', '/lookups', { keyword: 'rl' })).status, 200);
    assert.equal((await lim(B, 'POST', '/lookups', { keyword: 'rl' })).status, 429);

    // ================= Delete a whole site (to the recycle bin) and Undo =================
    const spendBefore = Number((await pool.query(`SELECT COALESCE(SUM("costUsd"),0) AS s FROM serp_api_costs WHERE "siteId" = $1`, [site1.id])).rows[0].s);
    assert.ok(spendBefore > 0);
    const lookupCount = (await call(A, 'GET', `/lookups?siteId=${site1.id}`)).body.lookups.length;
    assert.equal(lookupCount, 50);
    r = await call(A, 'DELETE', `/sites/${site1.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.retentionDays, 30);
    const siteBinId = r.body.binId;
    assert.equal((await call(A, 'GET', `/sites/${site1.id}`)).status, 404);
    assert.equal((await call(A, 'GET', '/sites')).body.sites.length, 1);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM serp_lookups WHERE "siteId" = $1', [site1.id])).rows[0].count), 0); // its lookups went with it
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM serp_api_costs WHERE "userId" = $1 AND endpoint LIKE $2', [A, '%live/advanced%'])).rows[0].count) > 0, true); // spending stays in the log
    assert.equal(Number((await pool.query(`SELECT COALESCE(SUM("costUsd"),0) AS s FROM serp_api_costs WHERE "siteId" IS NULL AND "userId" = $1`, [A])).rows[0].s) >= spendBefore, true); // ...now attached to no site
    const siteBin = await bin.list(A, { types: ['serp-site'] }); // the temp site deleted earlier is in the bin too
    assert.equal(siteBin.length, 2);
    assert.ok(siteBin.some((b) => b.id === siteBinId && b.title === 'Acme Wines'));
    assert.equal((await bin.list(B, { types: ['serp-site'] })).length, 0);

    // while it is gone, tracking the same domain again blocks the Undo (and says why); once that one is deleted, Undo works
    const again = (await call(A, 'POST', '/sites', { profile: { domain: 'wiwc.com.au' } })).body.site;
    await assert.rejects(bin.restoreItem(A, siteBinId), (e) => /already track wiwc\.com\.au/.test(e.message));
    await call(A, 'DELETE', `/sites/${again.id}`);
    await bin.restoreItem(A, siteBinId);
    const restored = (await call(A, 'GET', '/sites')).body.sites.find((s) => s.profile.domain === 'wiwc.com.au');
    assert.ok(restored);
    assert.equal(restored.profile.name, 'Acme Wines');
    assert.equal((await call(A, 'GET', `/lookups?siteId=${restored.id}`)).body.lookups.length, 50); // its lookups came back with it
    assert.equal((await call(A, 'GET', `/lookups?siteId=${restored.id}`)).body.lookups[0].rawKept, false);

    // ---- Keywords tab (Search Console history): two fresh people, a fake Search Console
    const K1 = await mk('k1');
    const K2 = await mk('k2');
    try {
      let connected = false;
      const fakeRows = async (_uid, _siteUrl, { startDate, endDate, startRow }) => {
        if (startRow) return [];
        const out = [];
        for (let d = startDate; d <= endDate; d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) out.push({ keys: [d, 'walk in wine cabinets'], clicks: 1, impressions: 10, position: 6 });
        return out;
      };
      const gscApi = {
        connection: async () => ({ connected, email: 'o@example.test' }),
        listProperties: async () => [{ siteUrl: 'sc-domain:kwtest.com.au', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:unverified.com.au', permissionLevel: 'siteUnverifiedUser' }],
        queryRows: fakeRows,
      };
      const ck = await mkApp({ gscApi });
      const mine = (await ck(K1, 'POST', '/sites', { profile: { name: 'KW', domain: 'www.kwtest.com.au' } })).body.site;
      assert.ok(mine && mine.id);

      assert.deepEqual((await ck(K1, 'GET', `/sites/${mine.id}/gsc`)).body, { connected: false }, 'not connected says so');
      connected = true;
      const st = (await ck(K1, 'GET', `/sites/${mine.id}/gsc`)).body;
      assert.equal(st.connected, true);
      assert.equal(st.suggested, 'sc-domain:kwtest.com.au', 'the property is matched to the site by its domain');
      assert.equal(st.selected, null);

      // another person cannot see, choose, load or read anything of this site
      for (const [m, p, b] of [['GET', `/sites/${mine.id}/gsc`], ['PUT', `/sites/${mine.id}/gsc`, { siteUrl: 'sc-domain:kwtest.com.au' }], ['POST', `/sites/${mine.id}/gsc/sync`, {}], ['GET', `/sites/${mine.id}/keywords`], ['POST', `/sites/${mine.id}/keywords/history`, { query: 'x' }]]) {
        assert.equal((await ck(K2, m, p, b)).status, 404, `${m} ${p} is not theirs`);
      }
      assert.equal((await ck(K1, 'PUT', `/sites/${mine.id}/gsc`, { siteUrl: 'sc-domain:someone-elses.com' })).status, 400, 'a property the person cannot see is refused');
      assert.equal((await ck(K1, 'PUT', `/sites/${mine.id}/gsc`, { siteUrl: 'sc-domain:unverified.com.au' })).status, 400, 'an unverified property is refused');
      assert.equal((await ck(K1, 'PUT', `/sites/${mine.id}/gsc`, {})).status, 400);
      assert.equal((await ck(K1, 'POST', `/sites/${mine.id}/gsc/sync`, {})).status, 400, 'no property chosen yet: nothing to load');
      assert.deepEqual((await ck(K1, 'GET', `/sites/${mine.id}/keywords`)).body, { keywords: [], total: 0 });

      assert.equal((await ck(K1, 'PUT', `/sites/${mine.id}/gsc`, { siteUrl: 'sc-domain:kwtest.com.au' })).body.selected, 'sc-domain:kwtest.com.au');
      assert.equal((await ck(K1, 'POST', `/sites/${mine.id}/gsc/sync`, {})).status, 202);
      let prog = null;
      for (let i = 0; i < 100; i++) { // the load runs in the background; the page polls for it
        prog = (await ck(K1, 'GET', `/sites/${mine.id}/gsc`)).body.progress;
        if (prog && prog.status === 'ok') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(prog && prog.status, 'ok');
      assert.equal(prog.percent, 100);
      const kw = (await ck(K1, 'GET', `/sites/${mine.id}/keywords?days=all`)).body;
      assert.equal(kw.keywords.length, 1);
      assert.equal(kw.keywords[0].query, 'walk in wine cabinets');
      assert.equal(kw.keywords[0].position, 6);
      assert.equal((await ck(K1, 'GET', `/sites/${mine.id}/keywords?days=all&q=zzz`)).body.keywords.length, 0);
      assert.equal((await ck(K1, 'GET', `/sites/${mine.id}/keywords?days=all&striking=1`)).body.keywords.length, 0, 'position 6 is not in striking distance');
      const hist = (await ck(K1, 'POST', `/sites/${mine.id}/keywords/history`, { query: 'walk in wine cabinets', days: 'all' })).body.days;
      assert.ok(hist.length > 400, `a daily series came back (${hist.length} days)`);
      assert.ok(hist[0].day < hist[hist.length - 1].day, 'oldest first');
      assert.equal((await ck(K1, 'POST', `/sites/${mine.id}/keywords/history`, {})).status, 400);
      assert.equal((await ck(K1, 'PUT', `/sites/${mine.id}/gsc`, { siteUrl: null })).body.selected, null, 'the choice can be cleared');
      assert.equal((await ck(K2, 'GET', `/sites/${mine.id}/keywords`)).status, 404);
    } finally {
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[K1, K2]]).catch(() => {});
    }

    console.log('serpTrackerRouter.db.test.js: all passed');
  } finally {
    for (const s of servers) s.close();
    // runs, sites, lookups and costs go with the users. A failed cleanup must never hide the real failure above, so it only warns.
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
