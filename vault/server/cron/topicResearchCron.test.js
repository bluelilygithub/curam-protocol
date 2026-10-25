#!/usr/bin/env node
/**
 * Topic Research background jobs + monthly spend + the shared search. Fake pool and fake search: no database, network or model.
 * Run: node server/cron/topicResearchCron.test.js
 */
'use strict';

const assert = require('assert');
const { runDueTopics, purgeOld, MAX_PER_TICK } = require('./topicResearchCron');
const { monthSpend, monthStartUtc } = require('../services/topicResearch/spend');
const { buildSources, PAUSED } = require('../services/topicResearch/sources');
const { searchTopic, running } = require('../services/topicResearch/runSearch');

const H = 3600000;
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

function world({ topics = [], runs = [], briefs = [], drafts = [], articles = [], cache = [] } = {}) {
  const w = { topics, runs, briefs, drafts, articles, cache };
  w.pool = {
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT t\.\*, \(SELECT MAX/.test(s)) {
        return { rows: w.topics.filter((t) => t.onWatchlist).map((t) => { const rs = w.runs.filter((r) => r.topicId === t.id); return { ...t, lastStarted: rs.length ? new Date(Math.max(...rs.map((r) => +new Date(r.startedAt)))) : null }; }) };
      }
      if (/^SELECT status FROM topic_research_runs WHERE "topicId"/.test(s)) {
        return { rows: w.runs.filter((r) => r.topicId === p[0]).sort((a, b) => (+new Date(b.startedAt) - +new Date(a.startedAt)) || b.id - a.id).slice(0, 4).map((r) => ({ status: r.status })) };
      }
      if (/^SELECT COALESCE\(SUM\("apiCostEstimate"\)/.test(s)) return { rows: [{ total: w.runs.filter((r) => r.userId === p[0] && new Date(r.startedAt) >= p[1]).reduce((t, r) => t + (r.apiCostEstimate || 0), 0) }] };
      if (/^SELECT COALESCE\(SUM\("costUsd"\), 0\) AS total FROM topic_research_briefs/.test(s)) return { rows: [{ total: w.briefs.filter((b) => b.userId === p[0] && new Date(b.createdAt) >= p[1]).reduce((t, b) => t + (b.costUsd || 0), 0) }] };
      if (/^SELECT COALESCE\(SUM\("costUsd"\), 0\) AS total FROM topic_research_drafts/.test(s)) return { rows: [{ total: (w.drafts || []).filter((d) => d.userId === p[0] && new Date(d.createdAt) >= p[1]).reduce((t, d) => t + (d.costUsd || 0), 0) }] };
      if (/^UPDATE topic_research_articles SET "extractedText" = NULL/.test(s)) {
        let n = 0;
        for (const a of w.articles) if (a.extractedText != null && new Date(a.extractedAt || a.fetchedAt) < p[0]) { a.extractedText = null; a.wordCount = null; n += 1; }
        return { rowCount: n, rows: [] };
      }
      if (/^DELETE FROM topic_research_cache/.test(s)) { const before = w.cache.length; w.cache = w.cache.filter((c) => new Date(c.createdAt) >= p[0]); return { rowCount: before - w.cache.length, rows: [] }; }
      throw new Error(`unhandled SQL: ${s.slice(0, 90)}`);
    },
  };
  return w;
}
const topic = (id, o = {}) => ({ id, userId: 1, keyword: `topic ${id}`, onWatchlist: true, refreshHours: 24, ...o });
const run = (id, topicId, hoursAgo, o = {}) => ({ id, topicId, userId: 1, startedAt: new Date(NOW - hoursAgo * H), status: 'ok', apiCostEstimate: 0, ...o });

function deps(w, o = {}) {
  const calls = []; const alerts = [];
  return {
    calls, alerts,
    d: {
      pool: w.pool, now: () => NOW,
      searchTopic: async (a) => { calls.push(a.topic.id); if (o.throwFor?.includes(a.topic.id)) throw new Error('boom'); return { status: o.statusFor?.[a.topic.id] || 'ok' }; },
      isRunning: (u, t) => (o.busy || []).includes(t),
      mayUse: async (u) => !(o.noFeature || []).includes(u),
      capture: async (x) => { alerts.push(x); },
      makeFingerprint: (a, b) => `${a}:${b}`,
      ...(o.max ? { maxPerTick: o.max } : {}),
    },
  };
}

async function main() {
  // ---------------- due logic
  {
    const w = world({ topics: [topic(1), topic(2), topic(3, { onWatchlist: false }), topic(4, { refreshHours: 6 }), topic(5, { refreshHours: 168 })],
      runs: [run(1, 1, 23.9), run(2, 2, 24), run(3, 3, 1000), run(4, 4, 6), run(5, 5, 100)] });
    const { calls, d } = deps(w);
    const r = await runDueTopics(d);
    assert.deepStrictEqual(calls.sort(), [2, 4], 'due at exactly the interval, not a minute before; unwatched never; weekly waits');
    assert.deepStrictEqual([r.checked, r.due, r.ran], [4, 2, 2]);
  }
  {
    const w = world({ topics: [topic(1)] });
    const { calls, d } = deps(w);
    await runDueTopics(d);
    assert.deepStrictEqual(calls, [1], 'never searched = due');
  }
  // ---------------- cap, order, sequential
  {
    const ts = []; const rs = [];
    for (let i = 1; i <= 8; i += 1) { ts.push(topic(i)); rs.push(run(i, i, 100 + i)); } // 8 is waiting longest
    const w = world({ topics: ts, runs: rs });
    const { calls, d } = deps(w);
    const r = await runDueTopics(d);
    assert.strictEqual(MAX_PER_TICK, 5);
    assert.deepStrictEqual(calls, [8, 7, 6, 5, 4], 'five at most, longest-waiting first');
    assert.deepStrictEqual([r.due, r.ran], [5, 5]);
    let live = 0; let peak = 0;
    const d2 = { ...d, searchTopic: async () => { live += 1; peak = Math.max(peak, live); await new Promise((x) => setTimeout(x, 5)); live -= 1; return { status: 'ok' }; } };
    await runDueTopics(d2);
    assert.strictEqual(peak, 1, 'one at a time');
  }
  // ---------------- skips
  {
    const w = world({ topics: [topic(1), topic(2, { userId: 2 }), topic(3)], runs: [] });
    const { calls, d } = deps(w, { busy: [1], noFeature: [2] });
    const r = await runDueTopics(d);
    assert.deepStrictEqual([calls, r.skipped, r.ran], [[3], 2, 1], 'a topic being searched and a member without the feature are skipped');
    const e = deps(w); e.d.searchTopic = async () => { const x = new Error('busy'); x.status = 409; throw x; };
    const r2 = await runDueTopics(e.d);
    assert.deepStrictEqual([r2.skipped, r2.failed, r2.ran], [3, 0, 0], 'a 409 from the shared lock is a skip, not a failure');
  }
  // ---------------- one failing search does not stop the rest
  {
    const w = world({ topics: [topic(1), topic(2)] });
    const { calls, d } = deps(w, { throwFor: [1] });
    const r = await runDueTopics(d);
    assert.deepStrictEqual([calls, r.ran, r.failed], [[1, 2], 1, 1]);
  }
  // ---------------- three failures in a row = one alert, no date in the fingerprint
  {
    const fail = (id, h) => run(id, 1, h, { status: 'failed' });
    let w = world({ topics: [topic(1)], runs: [run(1, 1, 90), fail(2, 80), fail(3, 60), fail(4, 30)] });
    let x = deps(w, { statusFor: { 1: 'failed' } });
    w.runs.push(fail(5, 25)); // the just-finished search is recorded by the real search; simulate it
    let r = await runDueTopics(x.d);
    // runs now: ok, F, F, F, F -> the fourth in a row: no new alert
    assert.deepStrictEqual([r.failed, r.alerts, x.alerts.length], [1, 0, 0], 'the fourth failure does not alert again');
    w = world({ topics: [topic(1)], runs: [run(1, 1, 90), fail(2, 60), fail(3, 40), fail(4, 25)] });
    x = deps(w, { statusFor: { 1: 'failed' } });
    r = await runDueTopics(x.d);
    assert.deepStrictEqual([r.alerts, x.alerts.length], [1, 1], 'the third in a row alerts once');
    assert.strictEqual(x.alerts[0].fingerprint, 'topicResearchCron:topic:1:failing');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(x.alerts[0].fingerprint), 'no date in the fingerprint');
    assert.deepStrictEqual([x.alerts[0].userId, x.alerts[0].category, x.alerts[0].source], [1, 'alert', 'topicResearchCron']);
    w = world({ topics: [topic(1)], runs: [run(1, 1, 90), fail(2, 60), run(3, 1, 40), fail(4, 25)] });
    x = deps(w, { statusFor: { 1: 'failed' } });
    r = await runDueTopics(x.d);
    assert.strictEqual(r.alerts, 0, 'a success in between breaks the streak');
    w = world({ topics: [topic(1)], runs: [run(1, 1, 90), fail(2, 60), fail(3, 40), fail(4, 25)] });
    x = deps(w, { statusFor: { 1: 'failed' } });
    x.d.capture = async () => { throw new Error('inbox down'); };
    r = await runDueTopics(x.d);
    assert.deepStrictEqual([r.failed, r.alerts], [1, 0], 'an inbox fault never breaks the job');
  }

  // ---------------- purge
  {
    const old = new Date(NOW - 31 * 86400000); const fresh = new Date(NOW - 29 * 86400000);
    const w = world({
      articles: [
        { id: 1, extractedText: 'old', wordCount: 5, extractedAt: old, fetchedAt: fresh, score: 0.9 },
        { id: 2, extractedText: 'new', wordCount: 5, extractedAt: fresh, fetchedAt: old, score: 0.8 },
        { id: 3, extractedText: null, wordCount: null, extractedAt: old, fetchedAt: old },
        { id: 4, extractedText: 'never read, fetched long ago', wordCount: 3, extractedAt: null, fetchedAt: old },
      ],
      cache: [{ key: 'a', createdAt: new Date(NOW - 8 * 86400000) }, { key: 'b', createdAt: new Date(NOW - 6 * 86400000) }],
    });
    const r = await purgeOld(w.pool, () => NOW);
    assert.deepStrictEqual(r, { textCleared: 2, cacheCleared: 1 });
    assert.deepStrictEqual(w.articles.map((a) => a.extractedText), [null, 'new', null, null]);
    assert.strictEqual(w.articles[0].score, 0.9, 'scores stay');
    assert.deepStrictEqual(w.cache.map((c) => c.key), ['b']);
    assert.deepStrictEqual(await purgeOld(w.pool, () => NOW), { textCleared: 0, cacheCleared: 0 }, 'runs twice safely');
  }

  // ---------------- spend
  {
    assert.strictEqual(monthStartUtc(Date.UTC(2026, 0, 31, 23, 59, 59)).toISOString(), '2026-01-01T00:00:00.000Z');
    assert.strictEqual(monthStartUtc(Date.UTC(2026, 1, 1, 0, 0, 0)).toISOString(), '2026-02-01T00:00:00.000Z');
    const m = Date.UTC(2026, 9, 1);
    const w = world({
      runs: [run(1, 1, 0, { apiCostEstimate: 0.5, startedAt: new Date(m) }), run(2, 1, 0, { apiCostEstimate: 9, startedAt: new Date(m - 1) }), run(3, 1, 0, { userId: 2, apiCostEstimate: 7, startedAt: new Date(m + 5) })],
      briefs: [{ userId: 1, costUsd: 0.25, createdAt: new Date(m + 10) }, { userId: 1, costUsd: 4, createdAt: new Date(m - 10) }, { userId: 2, costUsd: 6, createdAt: new Date(m + 10) }],
      drafts: [{ userId: 1, costUsd: 0.1, createdAt: new Date(m + 20) }, { userId: 1, costUsd: 3, createdAt: new Date(m - 20) }, { userId: 2, costUsd: 5, createdAt: new Date(m + 20) }],
    });
    const env = {};
    let s = await monthSpend(w.pool, 1, 20, { now: () => NOW, env });
    assert.deepStrictEqual([s.searchUsd, s.briefUsd, s.draftUsd, s.spentUsd, s.over, s.pricesSet], [0.5, 0.25, 0.1, 0.85, false, false], 'this month only, this person only, search + brief + draft');
    assert.strictEqual((await monthSpend(w.pool, 1, 0.85, { now: () => NOW, env })).over, true, 'exactly at the limit is over');
    assert.strictEqual((await monthSpend(w.pool, 1, 0.86, { now: () => NOW, env })).over, false);
    assert.strictEqual((await monthSpend(w.pool, 1, 0, { now: () => NOW, env })).over, false, '0 = no limit');
    assert.strictEqual((await monthSpend(w.pool, 1, -3, { now: () => NOW, env })).over, false);
    assert.strictEqual((await monthSpend(w.pool, 1, 20, { now: () => NOW, env: { BRAVE_PRICE_PER_QUERY_USD: '0.005' } })).pricesSet, true);
    s = await monthSpend(w.pool, 3, 20, { now: () => NOW, env });
    assert.strictEqual(s.spentUsd, 0, 'a person with nothing');
  }

  // ---------------- paid sources pause over budget
  {
    const env = { SERP_API_KEY: 'k', SERP_PROVIDER: 'serper' }; // Serper from its own key
    const getConfig = async () => ({ provider: 'brave', apiKey: 'k' }); // Brave from the workspace search key
    const open = await buildSources({ feeds: [], serpProvider: 'serper' }, { env, getConfig, budgetOver: false });
    const closed = await buildSources({ feeds: [], serpProvider: 'serper' }, { env, getConfig, budgetOver: true });
    const paid = (res) => res.status.filter((x) => ['brave', 'serper'].includes(x.id));
    assert.strictEqual(paid(open).filter((p) => p.enabled).length, 2, 'both paid sources are on when under the limit');
    for (const p of paid(closed)) assert.deepStrictEqual([p.enabled, p.reason], [false, PAUSED]);
    assert.ok(closed.status.find((x) => x.id === 'hackernews').enabled && closed.status.find((x) => x.id === 'gdelt').enabled, 'free sources carry on');
    assert.ok(closed.sources.length < open.sources.length || paid(open).every((p) => !p.enabled), 'paid ones are not built when over');
    const was = paid(open).filter((p) => p.enabled).length;
    assert.strictEqual(open.sources.length - closed.sources.length, was, 'exactly the paid ones dropped');
  }

  // ---------------- shared search: lock, budget, analysis fault
  {
    const w = world({ topics: [topic(1)] });
    w.pool.query = (orig => async (sql, p) => {
      const s = sql.replace(/\s+/g, ' ');
      if (/FROM settings/.test(s)) return { rows: [] };
      return orig(sql, p);
    })(w.pool.query);
    // collect is real: give it no sources so it saves an (empty) run through a fake that we replace
    const collectPath = require.resolve('../services/topicResearch/collect');
    const real = require(collectPath);
    const savedRun = real.runCollect;
    let builtWith = null; let hold = null;
    real.runCollect = async () => { if (hold) await hold; return { runId: 77, status: 'ok', errors: [], count: 0, sources: [], extras: {} }; };
    delete require.cache[require.resolve('../services/topicResearch/runSearch')];
    const rs = require('../services/topicResearch/runSearch');
    const buildSourcesFake = async (s, dd) => { builtWith = dd; return { sources: [], status: [] }; };
    try {
      let out = await rs.searchTopic({ pool: w.pool, userId: 1, topic: topic(1), now: () => NOW, buildSources: buildSourcesFake, analyse: async () => ({ stories: 2, read: 1, heat: 3 }) });
      assert.deepStrictEqual([out.id, out.analysis, builtWith.budgetOver, out.spend.over], [77, { stories: 2, read: 1, heat: 3 }, false, false]);
      out = await rs.searchTopic({ pool: w.pool, userId: 1, topic: topic(1), now: () => NOW, buildSources: buildSourcesFake, analyse: async () => { throw new Error('page reader broke'); }, log: () => {} });
      assert.deepStrictEqual([out.id, out.analysis], [77, null], 'an analysis fault keeps the search');
      assert.strictEqual(rs.running.size, 0, 'lock released');
      let release; hold = new Promise((x) => { release = x; });
      const first = rs.searchTopic({ pool: w.pool, userId: 1, topic: topic(1), now: () => NOW, buildSources: buildSourcesFake, analyse: async () => null });
      await new Promise((x) => setTimeout(x, 5));
      assert.strictEqual(rs.isRunning(1, 1), true);
      await assert.rejects(() => rs.searchTopic({ pool: w.pool, userId: 1, topic: topic(1), now: () => NOW, buildSources: buildSourcesFake }), (e) => e.status === 409);
      const other = rs.searchTopic({ pool: w.pool, userId: 1, topic: topic(2), now: () => NOW, buildSources: buildSourcesFake, analyse: async () => null });
      release(); await first; await other;
      assert.strictEqual(rs.running.size, 0);
      // over budget is passed to the sources
      hold = null;
      w.briefs.push({ userId: 1, costUsd: 50, createdAt: new Date(NOW) });
      w.pool.query = (orig => async (sql, p) => (/FROM settings/.test(sql) ? { rows: [{ value: JSON.stringify({ monthlyBudgetUsd: 10 }) }] } : orig(sql, p)))(w.pool.query);
      out = await rs.searchTopic({ pool: w.pool, userId: 1, topic: topic(1), now: () => NOW, buildSources: buildSourcesFake, analyse: async () => null });
      assert.deepStrictEqual([builtWith.budgetOver, out.spend.over], [true, true], 'over the limit: the sources are told to pause the paid ones');
    } finally { real.runCollect = savedRun; delete require.cache[require.resolve('../services/topicResearch/runSearch')]; }
  }

  console.log('topicResearch cron/spend/search: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
