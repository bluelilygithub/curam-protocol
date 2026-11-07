'use strict';

// DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/services/serpTracker/rankCollect.test.js
// Real database, fake DataForSEO. Daily tracking: off by default, the standard queue, a miss read again (best position wins, "not found" only when every
// read missed), a failed search saved as failed (never "not found"), the monthly limit checked before every round, a re-run replacing today's rows.
const assert = require('assert');
if (!process.env.DATABASE_URL) { console.log('SKIP rankCollect.test.js: DATABASE_URL is not set'); process.exit(0); }
const { pool } = require('../../db');
const { collectRankings } = require('./rankCollect');
const { validateProfile } = require('./siteProfile');
const { createSite } = require('./store');
const costs = require('./costs');

const organic = (g, url, domain) => ({ type: 'organic', rank_group: g, rank_absolute: g, url, domain, title: 't' });
const result = (kw, sitePos) => ({ keyword: kw, location_code: 2036, language_code: 'en', se_domain: 'google.com.au', items: Array.from({ length: 12 }, (_, i) => (i + 1 === sitePos ? organic(i + 1, 'https://www.track.test.com.au/p', 'www.track.test.com.au') : organic(i + 1, `https://s${i}.com/`, `s${i}.com`))) });

(async () => {
  const tag = `rankcollect${Date.now()}`;
  const A = (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-a@example.test`])).rows[0].id;
  try {
    const mkProfile = (over = {}) => {
      const v = validateProfile({ domain: 'track.test.com.au', dailyTracking: true, keywords: [{ term: 'alpha' }, { term: 'beta' }], devices: ['desktop', 'mobile'], serpDepth: 100, ...over });
      assert.ok(v.ok, v.errors.join('; '));
      return v.profile;
    };
    const site = await createSite(pool, A, mkProfile());
    const runDate = '2026-11-08';
    const ctxFor = (s) => ({ pool, site: { id: s.id, userId: A, profile: s.profile }, runId: null, runDate, logCost: (e) => costs.logCost(pool, { userId: A, siteId: s.id, runId: null, costDate: runDate, ...e }) });
    const rows = async (s) => (await pool.query(`SELECT keyword, device, status, position, url, depth, "readsJson", "organicCount", "costUsd"::float AS cost, error FROM serp_rankings WHERE "siteId" = $1 AND "runDate" = $2 ORDER BY keyword, device`, [s.id, runDate])).rows;
    const costRows = async (s) => (await pool.query(`SELECT endpoint, "costUsd"::float AS c FROM serp_api_costs WHERE "siteId" = $1 AND endpoint LIKE '%task_post%' ORDER BY id`, [s.id])).rows;

    // a scripted DataForSEO: script(keyword, device, read) -> a position for the site | null (missed) | 'bad' (unreadable) | 'late' (never ready) | 'refuse'
    const fake = (script, price = 0.0018) => {
      const posted = []; let n = 0; const tasks = new Map();
      return {
        posted,
        deps: {
          hasCredentials: () => true, now: () => Date.now(),
          async postTask(t) {
            const read = posted.filter((p) => p.keyword === t.keyword && p.device === t.device).length + 1;
            const what = script(t.keyword, t.device, read);
            posted.push({ ...t, read });
            if (what === 'refuse') { const e = new Error('DataForSEO refused the task'); e.code = 'TASK_REJECTED'; throw e; }
            const id = `task-${++n}`; tasks.set(id, { t, what });
            return { taskId: id, costUsd: price };
          },
          async waitTask(id) {
            const { t, what } = tasks.get(id);
            if (what === 'late') return { ready: false, timedOut: true };
            if (what === 'bad') return { ready: true, result: { keyword: t.keyword, items: [] } };
            return { ready: true, result: result(t.keyword, what) };
          },
        },
      };
    };

    // ---- off by default: nothing is posted, nothing is charged, nothing is saved
    const offSite = await createSite(pool, A, mkProfile({ domain: 'off.test.com.au', dailyTracking: undefined }));
    assert.strictEqual(offSite.profile.dailyTracking, false, 'a new site has daily tracking off');
    let f = fake(() => 5);
    assert.match(await collectRankings(ctxFor(offSite), { deps: f.deps }), /off for this site/);
    assert.strictEqual(f.posted.length, 0);
    assert.strictEqual((await rows(offSite)).length, 0);
    // a stray value must not switch it on
    assert.strictEqual(validateProfile({ domain: 'x.test.com.au', dailyTracking: 'true' }).profile.dailyTracking, false, 'only a real true switches it on');
    assert.strictEqual(validateProfile({ domain: 'x.test.com.au', dailyTracking: 1 }).profile.dailyTracking, false);
    const empty = await createSite(pool, A, mkProfile({ domain: 'empty.test.com.au', keywords: [] }));
    assert.match(await collectRankings(ctxFor(empty), { deps: fake(() => 1).deps }), /No keywords to track/);

    // ---- found at once: one read each, depth capped at 30, every post logged
    f = fake((kw) => (kw === 'alpha' ? 3 : 7));
    let detail = await collectRankings(ctxFor(site), { deps: f.deps });
    assert.match(detail, /4 searches \(2 keywords x 2 devices, top 30\): found 4, not found 0, failed 0\. 4 reads/);
    assert.strictEqual(f.posted.length, 4, 'a find is trusted: no second read');
    assert.ok(f.posted.every((p) => p.depth === 30), 'daily tracking reads at most the top 30 even when the profile says 100');
    assert.ok(f.posted.every((p) => p.searchDomain === 'google.com.au' && p.locationName === 'Australia'), "the site's place and Google site are used");
    let r = await rows(site);
    assert.deepStrictEqual(r.map((x) => [x.keyword, x.device, x.status, x.position]), [['alpha', 'desktop', 'found', 3], ['alpha', 'mobile', 'found', 3], ['beta', 'desktop', 'found', 7], ['beta', 'mobile', 'found', 7]]);
    assert.strictEqual(r[0].url, 'https://www.track.test.com.au/p');
    assert.deepStrictEqual(r[0].readsJson, [{ position: 3, organic: 12 }]);
    assert.strictEqual((await costRows(site)).length, 4, 'every post is logged as a cost');
    assert.ok(Math.abs(r[0].cost - 0.0018) < 1e-9);

    // ---- a miss is read again: found on the second read; every read missed (three reads, "not found"); a re-run replaces today's rows
    await pool.query(`DELETE FROM serp_api_costs WHERE "siteId" = $1`, [site.id]);
    f = fake((kw, dev, read) => {
      if (kw === 'alpha' && dev === 'desktop') return read === 1 ? null : 5; // missed, then found at 5
      if (kw === 'alpha' && dev === 'mobile') return null; // never found
      return 2; // beta: found at once
    });
    detail = await collectRankings(ctxFor(site), { deps: f.deps });
    assert.match(detail, /found 3, not found 1, failed 0\. 7 reads/, detail);
    assert.strictEqual(f.posted.length, 7, '4 first reads + 2 second reads + 1 third read');
    r = await rows(site);
    assert.strictEqual(r.length, 4, 'a second run on the same day replaces the rows, it does not add');
    const byKey = Object.fromEntries(r.map((x) => [`${x.keyword}/${x.device}`, x]));
    assert.deepStrictEqual([byKey['alpha/desktop'].status, byKey['alpha/desktop'].position], ['found', 5], 'found on the second read: that find is kept');
    assert.deepStrictEqual(byKey['alpha/desktop'].readsJson.map((x) => x.position), [null, 5]);
    assert.deepStrictEqual([byKey['alpha/mobile'].status, byKey['alpha/mobile'].position], ['not_found', null], 'never found: not found, and the position is null, never 0');
    assert.strictEqual(byKey['alpha/mobile'].readsJson.length, 3, 'three reads all missed before it was called not found');
    assert.deepStrictEqual([byKey['beta/desktop'].status, byKey['beta/desktop'].readsJson.length], ['found', 1]);
    assert.ok(Math.abs(byKey['alpha/mobile'].cost - 0.0054) < 1e-9, 'every read of a keyword is charged to it');
    assert.strictEqual((await costRows(site)).length, 7, 'seven posts, seven logged costs');
    assert.match((await costRows(site))[4].endpoint, /\(read 2\)/);

    // ---- failures are failures, never "not found": a refused post, a search that is never ready, an unreadable answer
    await pool.query(`DELETE FROM serp_rankings WHERE "siteId" = $1`, [site.id]);
    f = fake((kw, dev, read) => {
      if (kw === 'alpha' && dev === 'desktop') return 'refuse';
      if (kw === 'alpha' && dev === 'mobile') return 'late';
      if (kw === 'beta' && dev === 'desktop') return read === 1 ? 'bad' : 4; // unreadable once, then fine
      return 6;
    });
    await assert.rejects(() => collectRankings(ctxFor(site), { deps: f.deps }), (e) => /failed 2/.test(e.message) && /never as "not found"/.test(e.message), 'the step fails so the run, the page and the inbox say so');
    r = await rows(site);
    const rk = Object.fromEntries(r.map((x) => [`${x.keyword}/${x.device}`, x]));
    assert.strictEqual(rk['alpha/desktop'].status, 'failed');
    assert.match(rk['alpha/desktop'].error, /refused/);
    assert.strictEqual(rk['alpha/desktop'].position, null);
    assert.strictEqual(rk['alpha/mobile'].status, 'failed');
    assert.match(rk['alpha/mobile'].error, /did not finish this search in time/);
    assert.deepStrictEqual([rk['beta/desktop'].status, rk['beta/desktop'].position], ['found', 4], 'an unreadable answer is read again, and the good read is kept');
    assert.strictEqual(rk['beta/mobile'].status, 'found', 'the rows that worked are saved even though the step failed');

    // ---- the monthly limit is checked before every round: only what fits is posted, the rest is saved as not searched, and the step fails
    await pool.query(`DELETE FROM serp_rankings WHERE "siteId" = $1`, [site.id]);
    const spent = await costs.monthSpend(pool, runDate, 0);
    const perTask = costs.estimateTrackingUsd({ keywords: 1, devices: 1, depth: 30 });
    f = fake(() => 5);
    await assert.rejects(
      () => collectRankings(ctxFor(site), { env: { MAX_MONTHLY_SPEND_USD: String(spent + perTask * 2.5) }, deps: f.deps }),
      (e) => /monthly spending limit stopped some searches/.test(e.message),
    );
    assert.strictEqual(f.posted.length, 2, 'room for two searches, so two were posted');
    r = await rows(site);
    assert.strictEqual(r.filter((x) => x.status === 'found').length, 2);
    const notDone = r.filter((x) => x.status === 'failed');
    assert.strictEqual(notDone.length, 2);
    assert.ok(notDone.every((x) => /spending limit/.test(x.error)), 'a search that was not made says why, and is not "not found"');
    f = fake(() => 5);
    await assert.rejects(() => collectRankings(ctxFor(site), { env: { MAX_MONTHLY_SPEND_USD: '0' }, deps: f.deps }), /spending limit/);
    assert.strictEqual(f.posted.length, 0, 'a limit already reached posts nothing');

    // ---- no credentials: nothing posted, a failure with a plain reason
    await assert.rejects(() => collectRankings(ctxFor(site), { deps: { ...fake(() => 1).deps, hasCredentials: () => false } }), /not set up/);

    // ---- the estimate the page shows before the job is switched on
    assert.ok(Math.abs(costs.estimateTrackingUsd({ keywords: 20, devices: 2, depth: 100 }) - 20 * 2 * 3 * 0.0006) < 1e-9, 'depth is capped at 30 (three pages)');
    assert.ok(Math.abs(costs.estimateTrackingUsd({ keywords: 10, devices: 1, depth: 10, reads: 3 }) - 10 * 1 * 1 * 0.0006 * 3) < 1e-9);

    console.log('rankCollect.test.js: all passed');
  } finally {
    for (let i = 0; i < 3; i++) { try { await pool.query('DELETE FROM users WHERE id = $1', [A]); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
    await pool.end().catch(() => {});
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
