#!/usr/bin/env node
/**
 * Topic Research (milestone 3): the database side of reading, grouping and ranking a search. An in-memory stand-in for the pool (queries
 * matched by shape and given the SQL's meaning) and a stand-in page reader, so it needs no database and no network.
 *
 * Run: node server/services/topicResearch/analyse.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const { analyseRun, rescoreRun, isStale, needsReading, loadRunArticles } = require('./analyse');
const { FIXTURES, gradeGrouping } = require('./clusterFixtures');
const { DEFAULT_WEIGHTS } = require('./score');

const NOW = Date.UTC(2026, 9, 25, 0, 0, 0);
const HOUR = 3600000;
const MARK = 'PAGE-TEXT-MARKER-9f3a'; // appears only in stored page text: it must never reach a returned value

function fakePool() {
  const db = { settings: new Map(), sourceWeights: [], articles: [], runArticles: [], runs: [], updates: { articleReads: 0, runArticleBatches: 0 } };
  const pool = {
    db,
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT value FROM settings/.test(s)) { const v = db.settings.get(`${p[0]}|${p[1]}`); return { rows: v === undefined ? [] : [{ value: v }] }; }
      if (/^SELECT domain, weight, note FROM topic_research_source_weights/.test(s)) return { rows: db.sourceWeights.filter((w) => w.userId === p[0]) };
      if (/^SELECT ra\.id AS "raId"/.test(s)) {
        const rows = db.runArticles.filter((ra) => ra.runId === p[0]).map((ra) => ({ ...db.articles.find((a) => a.id === ra.articleId), raId: ra.id, articleId: ra.articleId, clusterId: ra.clusterId, signalsJson: ra.signalsJson, extractedText: db.articles.find((a) => a.id === ra.articleId).extractedText }))
          .filter((r) => r.userId === p[1]).sort((a, b) => a.articleId - b.articleId);
        return { rows };
      }
      if (/^SELECT "heatJson" FROM topic_research_runs WHERE "topicId"/.test(s)) {
        const prev = db.runs.filter((r) => r.topicId === p[0] && r.userId === p[1] && r.id !== p[2] && r.heatJson).sort((a, b) => b.id - a.id)[0];
        return { rows: prev ? [{ heatJson: prev.heatJson }] : [] };
      }
      if (/^UPDATE topic_research_articles SET "extractedText"/.test(s)) {
        const a = db.articles.find((x) => x.id === p[4] && x.userId === p[5]);
        if (a) { a.extractedText = p[0]; a.wordCount = p[1]; a.extractStatus = p[2]; a.extractedAt = new Date(NOW); a.publishedAt = a.publishedAt || p[3]; db.updates.articleReads += 1; }
        return { rows: [] };
      }
      if (/^UPDATE topic_research_run_articles ra SET/.test(s)) {
        db.updates.runArticleBatches += 1;
        p[0].forEach((id, i) => {
          const ra = db.runArticles.find((x) => x.id === id && x.runId === p[5]);
          if (ra) { ra.clusterId = p[1][i]; ra.score = p[2][i]; ra.isOriginal = p[3][i]; ra.breakdownJson = JSON.parse(p[4][i]); }
        });
        return { rows: [] };
      }
      if (/^UPDATE topic_research_runs SET "weightsJson"/.test(s)) {
        const r = db.runs.find((x) => x.id === p[2] && x.userId === p[3]);
        if (r) { r.weightsJson = JSON.parse(p[0]); r.heatJson = JSON.parse(p[1]); }
        return { rows: [] };
      }
      throw new Error(`unhandled SQL: ${s.slice(0, 100)}`);
    },
  };
  return pool;
}

/** Load a fixture set into a fake database as one run for user 1: returns { pool, runId, ids } (ids[i] = run-article id of fixture row i). */
function load(pool, name, { hoursAgo = (i) => 10 + i * 5, signals = () => ({}), userId = 1, runId = 1, topicId = 7 } = {}) {
  const db = pool.db;
  if (!db.runs.find((r) => r.id === runId)) db.runs.push({ id: runId, userId, topicId, weightsJson: null, heatJson: null });
  const ids = [];
  FIXTURES[name].forEach(([label, domain, title, snippet], i) => {
    const articleId = db.articles.length + 1;
    db.articles.push({ id: articleId, userId, url: `https://${domain}/${name}-${i}`, title, domain, snippet, publishedAt: hoursAgo(i) == null ? null : new Date(NOW - hoursAgo(i) * HOUR), extractedText: null, extractStatus: null, extractedAt: null });
    const id = db.runArticles.length + 1;
    db.runArticles.push({ id, runId, articleId, signalsJson: signals(i), clusterId: null, score: null, isOriginal: false, breakdownJson: null });
    ids.push(id);
  });
  return { runId, ids, topic: { id: topicId, keyword: name } };
}

// a page reader whose "pages" say what their own article says (as a real page does), at more length; `byId` finds an article's own words
const okReader = (log = [], byId = () => '') => ({
  async readPages(candidates, opts) {
    log.push({ candidates, opts });
    return candidates.map((c) => ({ id: c.id, status: 'ok', text: `${MARK} ${byId(c.id)} ${byId(c.id)} ${byId(c.id)} The report goes on to give the background and the detail.`, wordCount: 70, published: c.publishedAt ? null : new Date(NOW - 3 * HOUR) }));
  },
});
const groupingOf = (pool, ids) => new Map(ids.map((id, i) => [i, pool.db.runArticles.find((r) => r.id === id).clusterId]));

async function main() {
  // ------------------------------------------------------------ when a page needs reading
  {
    const at = (status, ageHours, text = 'x') => ({ extractStatus: status, extractedAt: status ? new Date(NOW - ageHours * HOUR) : null, text });
    assert.strictEqual(needsReading({ ...at(null, 0) }, NOW), true, 'never tried');
    assert.strictEqual(needsReading(at('ok', 24 * 6), NOW), false, 'read within the week');
    assert.strictEqual(needsReading(at('ok', 24 * 8), NOW), true, 'read more than a week ago');
    assert.strictEqual(needsReading(at('ok', 1, ''), NOW), true, 'marked read but the text is gone (cleared after 30 days)');
    assert.strictEqual(needsReading(at('thin', 24 * 6), NOW), false);
    assert.strictEqual(needsReading(at('not-html', 24 * 6), NOW), false);
    for (const st of ['robots', 'blocked', 'error']) {
      assert.strictEqual(needsReading(at(st, 23), NOW), false, `${st} a few hours ago`);
      assert.strictEqual(needsReading(at(st, 25), NOW), true, `${st} over a day ago: try again`);
    }
  }

  // ------------------------------------------------------------ a whole search: group, read the best, rank, save
  {
    const pool = fakePool();
    const sameSignals = (i) => (i === 0 ? { hn_points: 120, hn_comments: 40, seenIn: ['hackernews'] } : i === 3 ? { serp_rank: 2, serp_provider: 'brave' } : {});
    const { runId, ids, topic } = load(pool, 'heatPumps', { signals: sameSignals });
    const log = [];
    const ownWords = (raId) => { const ra = pool.db.runArticles.find((r) => r.id === raId); const a = pool.db.articles.find((x) => x.id === ra.articleId); return `${a.title}. ${a.snippet}`; };
    const out = await analyseRun({ pool, userId: 1, runId, topic, extractor: okReader(log, ownWords), limit: 4, budgetMs: 9999, now: () => NOW });

    assert.strictEqual(log.length, 1, 'pages are read once');
    assert.strictEqual(typeof log[0].opts.onEach, 'function', 'the reader is given a way to report each page');
    {
      const notes = []; const report = { start: (id, d) => notes.push(['start', id, d]), detail: (id, d) => notes.push(['detail', id, d]), done: (id, d) => notes.push(['done', id, d]), fail() {}, finish() {} };
      const pool2 = fakePool();
      const loaded = load(pool2, 'heatPumps', { signals: sameSignals });
      await analyseRun({ pool: pool2, userId: 1, runId: loaded.runId, topic: loaded.topic, extractor: okReader([], ownWords), limit: 4, budgetMs: 9999, now: () => NOW, report });
      assert.deepStrictEqual([...new Set(notes.map((n) => n[1]))], ['read', 'rank'], 'reading then ranking are reported');
      assert.ok(notes.some((n) => n[0] === 'start' && n[1] === 'read' && /^0 of 4 pages read/.test(n[2])));
      assert.ok(notes.filter((n) => n[0] === 'done').length === 2);
      const none = []; const rep2 = { start: (id) => none.push(id), detail() {}, done: (id, d) => none.push(id + ':' + d), fail() {}, finish() {} };
      await analyseRun({ pool: pool2, userId: 1, runId: loaded.runId, topic: loaded.topic, extractor: null, now: () => NOW, report: rep2 });
      assert.ok(none.includes('read:Nothing new to read') && none.includes('rank'), 'with nothing to read the read step says so');
    }
    assert.strictEqual(log[0].candidates.length, 4, 'only the best few');
    assert.strictEqual(log[0].opts.budgetMs, 9999);
    assert.ok(log[0].candidates.every((c) => /^https:\/\//.test(c.url)));
    const read = pool.db.articles.filter((a) => a.extractStatus === 'ok');
    assert.strictEqual(read.length, 4);
    assert.ok(read.every((a) => a.extractedText.includes(MARK) && a.wordCount === 70), 'the text is stored for analysis');
    assert.ok(pool.db.articles.filter((a) => !a.extractStatus).every((a) => a.extractedText === null));
    assert.deepStrictEqual(out.read, { counts: { ok: 4 }, tried: 4 });
    assert.ok(!JSON.stringify(out).includes(MARK), 'page text is never part of what comes back');

    // every article has a story, a score and a breakdown; the grouping is right
    const ras = pool.db.runArticles;
    assert.ok(ras.every((r) => Number.isInteger(r.clusterId) && r.clusterId >= 1 && typeof r.score === 'number' && r.breakdownJson.length >= 5));
    assert.deepStrictEqual(gradeGrouping('heatPumps', groupingOf(pool, ids)), [], 'stories grouped as a person would');
    assert.strictEqual(out.stories, new Set(ras.map((r) => r.clusterId)).size);
    const numbers = [...new Set(ras.map((r) => r.clusterId))].sort((a, b) => a - b);
    assert.deepStrictEqual(numbers, numbers.map((_, i) => i + 1), 'stories are numbered 1, 2, 3 ... with no gaps');
    // story 1 holds the best-scoring article
    const best = ras.reduce((m, r) => (r.score > m.score ? r : m));
    assert.strictEqual(best.clusterId, 1, 'story 1 is the story with the best article');
    // an Original is flagged only in a story with two outlets or more, once per story
    const byStory = new Map();
    for (const r of ras) { if (!byStory.has(r.clusterId)) byStory.set(r.clusterId, []); byStory.get(r.clusterId).push(r); }
    for (const [, list] of byStory) {
      const outlets = new Set(list.map((r) => pool.db.articles.find((a) => a.id === r.articleId).domain)).size;
      assert.strictEqual(list.filter((r) => r.isOriginal).length, outlets >= 2 ? 1 : 0);
    }
    // the settings used and the heat are recorded on the run
    const run = pool.db.runs[0];
    assert.strictEqual(run.weightsJson.halfLifeHours, 48);
    assert.ok(/^[0-9a-f]{12}$/.test(run.weightsJson.fingerprint));
    assert.deepStrictEqual(run.weightsJson.dropped.map((d) => d.id), ['source', 'match'], 'a search rank, story sizes, engagement and dates all existed; the outlet weights (none set) and topic match (the fixture topic is one made-up word that no article contains, so nothing is told apart) were left out');
    assert.strictEqual(run.heatJson.label, 'New');
    assert.strictEqual(await isStale(pool, 1, run), false, 'scores just made are up to date');

    // a second search of the same topic compares its heat with the first
    const again = load(pool, 'heatPumps', { runId: 2, signals: sameSignals });
    const second = await analyseRun({ pool, userId: 1, runId: 2, topic: again.topic, extractor: okReader(), limit: 0, now: () => NOW });
    assert.strictEqual(second.heat.previous, out.heat.value, 'compared with the previous search of this topic');
    assert.strictEqual(second.heat.label, 'Steady', 'the same stories as last time');
  }

  // ------------------------------------------------------------ a weight change re-orders results, without fetching anything
  {
    const pool = fakePool();
    const { runId, topic } = load(pool, 'cyclone', { hoursAgo: (i) => (i === 0 ? 100 : 5 + i), signals: (i) => (i === 0 ? { serp_rank: 1, serp_provider: 'brave' } : {}) });
    await analyseRun({ pool, userId: 1, runId, topic, extractor: null, now: () => NOW });
    const rankOf = () => pool.db.runArticles.slice().sort((a, b) => b.score - a.score).map((r) => r.id);
    const before = rankOf();
    assert.strictEqual(before[0], 1, 'with the default weights the article with the top search position leads, though it is the oldest');
    const run = pool.db.runs[0];
    assert.strictEqual(await isStale(pool, 1, run), false);
    const readsBefore = JSON.stringify(pool.db.articles);

    // the owner makes search rank nearly worthless and freshness everything
    pool.db.settings.set('1|topic_research_settings', JSON.stringify({ scoringWeights: { rank: 0.01, size: 0, engagement: 0, recency: 1, source: 0 }, halfLifeHours: 12, feeds: [] }));
    assert.strictEqual(await isStale(pool, 1, run), true, 'the stored scores no longer match the settings');
    await rescoreRun({ pool, userId: 1, runId, topic, now: () => NOW });
    const after = rankOf();
    assert.notStrictEqual(after[0], 1, 'the order changed');
    assert.notDeepStrictEqual(before, after);
    assert.strictEqual(await isStale(pool, 1, pool.db.runs[0]), false, 'and the new scores are marked as current');
    assert.strictEqual(pool.db.runs[0].weightsJson.halfLifeHours, 12);
    assert.strictEqual(JSON.stringify(pool.db.articles), readsBefore, 're-ranking fetches and changes no article');

    // changing an outlet's weight changes the fingerprint too
    pool.db.sourceWeights.push({ userId: 1, domain: 'abc.net.au', weight: 1, note: '' });
    assert.strictEqual(await isStale(pool, 1, pool.db.runs[0]), true);
  }

  // ------------------------------------------------------------ an older search that was never grouped is grouped by a re-rank
  {
    const pool = fakePool();
    const { runId, ids, topic } = load(pool, 'apple');
    assert.ok(pool.db.runArticles.every((r) => r.clusterId == null));
    assert.strictEqual(await isStale(pool, 1, pool.db.runs[0]), true, 'never scored counts as out of date');
    const r = await rescoreRun({ pool, userId: 1, runId, topic, now: () => NOW });
    assert.deepStrictEqual(gradeGrouping('apple', groupingOf(pool, ids)), []);
    assert.strictEqual(r.stories, 3);
  }

  // ------------------------------------------------------------ reading is optional and can fail without losing the ranking
  {
    const none = fakePool();
    const a = load(none, 'heatPumps');
    const withoutReader = await analyseRun({ pool: none, userId: 1, runId: a.runId, topic: a.topic, extractor: null, now: () => NOW });
    assert.deepStrictEqual(withoutReader.read, { counts: {}, tried: 0 });
    assert.ok(none.db.runArticles.every((r) => r.score != null));

    const broken = fakePool();
    const b = load(broken, 'heatPumps');
    const survived = await analyseRun({ pool: broken, userId: 1, runId: b.runId, topic: b.topic, extractor: { readPages: async () => { throw new Error('reader fell over'); } }, limit: 3, now: () => NOW });
    assert.deepStrictEqual(survived.read.counts, { error: 3 });
    assert.ok(broken.db.runArticles.every((r) => r.score != null), 'still ranked');
    assert.ok(broken.db.articles.every((x) => !x.extractStatus), 'and nothing is recorded as read');

    // pages that were not read in time are not marked, so the next search tries them; refusals are recorded
    const mixed = fakePool();
    const m = load(mixed, 'heatPumps');
    await analyseRun({
      pool: mixed, userId: 1, runId: m.runId, topic: m.topic, limit: 3, now: () => NOW,
      extractor: { readPages: async (cs) => cs.map((c, i) => ({ id: c.id, status: ['robots', 'skipped', 'thin'][i], published: i === 2 ? new Date(NOW - HOUR) : null })) },
    });
    const statuses = mixed.db.articles.map((x) => x.extractStatus).filter(Boolean).sort();
    assert.deepStrictEqual(statuses, ['robots', 'thin'], 'a skipped page is left to be tried next time');
    assert.ok(mixed.db.articles.every((x) => x.extractedText === null));

    // limit 0 never reads
    const zero = fakePool();
    const z = load(zero, 'heatPumps');
    let called = false;
    await analyseRun({ pool: zero, userId: 1, runId: z.runId, topic: z.topic, extractor: { readPages: async () => { called = true; return []; } }, limit: 0, now: () => NOW });
    assert.strictEqual(called, false);

    // pages read a short while ago are not fetched again
    const fresh = fakePool();
    const f = load(fresh, 'heatPumps');
    const log = [];
    await analyseRun({ pool: fresh, userId: 1, runId: f.runId, topic: f.topic, extractor: okReader(log), limit: 12, now: () => NOW });
    assert.strictEqual(log[0].candidates.length, 9, 'a full set is read the first time');
    await analyseRun({ pool: fresh, userId: 1, runId: f.runId, topic: f.topic, extractor: okReader(log), limit: 12, now: () => NOW });
    assert.strictEqual(log.length, 1, 'the second search finds nothing that needs reading, so the reader is not even asked');
  }

  // ------------------------------------------------------------ one person's articles are never mixed into another's
  {
    const pool = fakePool();
    const { runId, topic } = load(pool, 'apple');
    // an article that belongs to someone else sits in the same run (it should never happen; the query must not trust that)
    pool.db.articles.push({ id: 999, userId: 2, url: 'https://x.com/other', title: 'Someone else', domain: 'x.com', snippet: '', publishedAt: null, extractedText: 'private', extractStatus: null, extractedAt: null });
    pool.db.runArticles.push({ id: 999, runId, articleId: 999, signalsJson: {}, clusterId: null, score: null, isOriginal: false, breakdownJson: null });
    const rows = await loadRunArticles(pool, 1, runId);
    assert.ok(!rows.some((r) => r.articleId === 999), "another person's article is not loaded");
    const reads = [];
    await analyseRun({ pool, userId: 1, runId, topic, extractor: { readPages: async (cs) => { reads.push(...cs); return []; } }, now: () => NOW });
    assert.ok(!reads.some((c) => c.url.includes('other')));
    assert.strictEqual(pool.db.runArticles.find((r) => r.id === 999).score, null, "and it is not scored or changed");
  }

  assert.deepStrictEqual(Object.keys(DEFAULT_WEIGHTS), ['rank', 'size', 'engagement', 'recency', 'source', 'match']);
  console.log('topicResearch analyse: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
