#!/usr/bin/env node
/**
 * Topic Research (milestone 1): address clean-up, topic matching, the RSS source, one search run, settings rules and the
 * /api/topic-research routes (ownership, de-duplication, one failing feed, the recycle bin). Runs against an in-memory stand-in for the
 * pool (queries matched by shape and given the SQL's meaning), so it needs no database and no network. The SQL itself is exercised
 * on a real database by crossUserOwnership.test.js and by hand (docs/topic-research.md).
 *
 * Run: node server/routes/topicResearch.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { normaliseUrl, domainOf } = require('../services/topicResearch/urlNormalise');
const { topicTerms, makeMatcher } = require('../services/topicResearch/matchTopic');
const { makeItem } = require('../services/topicResearch/sources/base');
const { createRssSource } = require('../services/topicResearch/sources/rss');
const { mergeItems, runCollect, clampDays } = require('../services/topicResearch/collect');
const { validateSettings, MAX_FEEDS } = require('../services/topicResearch/settings');
const { createRouter } = require('./topicResearchRouter');

// ---------------------------------------------------------------- addresses
{
  assert.strictEqual(normaliseUrl('https://www.Example.com/a/b/?utm_source=x&utm_medium=y&id=7#top'), 'https://www.example.com/a/b?id=7');
  assert.strictEqual(normaliseUrl('https://example.com/a/'), 'https://example.com/a');
  assert.strictEqual(normaliseUrl('https://example.com/'), 'https://example.com/');
  assert.strictEqual(normaliseUrl('https://example.com:443/a'), 'https://example.com/a');
  assert.strictEqual(normaliseUrl('https://example.com/a?b=2&a=1&fbclid=zzz'), 'https://example.com/a?a=1&b=2');
  assert.strictEqual(normaliseUrl('https://example.com/a?ref=nav&source=feed'), 'https://example.com/a?ref=nav&source=feed', 'ref and source can be real page ids, so they stay');
  assert.strictEqual(normaliseUrl('https://u:p@example.com/a'), 'https://example.com/a', 'a login in the address is dropped');
  assert.strictEqual(normaliseUrl('ftp://example.com/a'), null);
  assert.strictEqual(normaliseUrl('javascript:alert(1)'), null);
  assert.strictEqual(normaliseUrl('not a url'), null);
  assert.strictEqual(normaliseUrl(''), null);
  assert.strictEqual(normaliseUrl('https://example.com/a?utm_source=1'), normaliseUrl('https://example.com/a/'));
  assert.strictEqual(domainOf('https://www.abc.net.au/news/x'), 'abc.net.au');
}

// ---------------------------------------------------------------- topic matching
{
  assert.deepStrictEqual(topicTerms('Heat pumps Queensland'), ['heat', 'pump', 'queensland']);
  assert.deepStrictEqual(topicTerms('the cost of glass'), ['cost', 'glass'], 'filler words and a trailing ss are left alone');
  assert.deepStrictEqual(topicTerms('  '), []);
  const m = makeMatcher('heat pumps Queensland');
  assert.ok(m('Heat pump rebates arrive in Queensland'));
  assert.ok(m('QUEENSLAND households fit heat pumps'));
  assert.ok(!m('Heat pump rebates arrive in Victoria'), 'every word must appear');
  assert.ok(!m('Cheatpumps in Queensland'), 'a word matches at the start of a word, not in the middle ("cheat" is not "heat")');
  assert.ok(!makeMatcher('')('anything'), 'a topic with no words matches nothing');
  assert.ok(makeMatcher('c++ 2026')('Learning c++ in 2026'), 'symbols in a topic are not treated as a pattern');
  assert.ok(makeMatcher('a.b')('see a.b here') && !makeMatcher('a.b')('see axb here'), 'a dot is a dot');
}

// ---------------------------------------------------------------- items
{
  assert.strictEqual(makeItem({ url: 'ftp://x/y', title: 'T' }), null);
  assert.strictEqual(makeItem({ url: 'https://x.com/y', title: '   ' }), null);
  const it = makeItem({ url: 'https://www.x.com/y/?utm_campaign=1', title: ' A   B ', publishedAt: 'garbage', snippet: '' });
  assert.deepStrictEqual([it.url, it.title, it.domain, it.publishedAt, it.snippet], ['https://www.x.com/y', 'A B', 'x.com', null, null]);
  assert.ok(makeItem({ url: 'https://x.com/y', title: 't', publishedAt: '2026-10-01T00:00:00Z' }).publishedAt instanceof Date);
}

// ---------------------------------------------------------------- the RSS source
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate><description>${i.desc || ''}</description></item>`).join('')}</channel></rss>`;
const day = (n) => new Date(Date.UTC(2026, 9, 25, 0, 0, 0) - n * 86400000).toUTCString();
const FEED_A = rss([
  { title: 'Heat pump rebates in Queensland', link: 'https://news.example.com/heat-pumps/?utm_source=rss', date: day(1), desc: '<p>Rebates &amp; grants</p>' },
  { title: 'Cricket scores', link: 'https://news.example.com/cricket', date: day(1) },
  { title: 'Old heat pump story, Queensland', link: 'https://news.example.com/old', date: day(60) },
  { title: 'Heat pumps for Queensland homes, no date', link: 'https://news.example.com/undated', date: '' },
]);
const FEED_B = rss([
  { title: 'Queensland heat pump guide', link: 'https://www.news.example.com/heat-pumps', date: day(2), desc: 'The same article via a second feed' },
  { title: 'Queensland heat pump installers', link: 'https://other.example.org/installers', date: day(3) },
]);
const stubFetch = (files) => async (url) => {
  if (url in files) {
    if (files[url] instanceof Error) throw files[url];
    return { buffer: Buffer.from(files[url]), contentType: 'application/rss+xml', finalUrl: url };
  }
  throw new Error('no such feed');
};
const NOW = Date.UTC(2026, 9, 25, 0, 0, 0);

async function main() {
  {
    const src = createRssSource({ feeds: [{ url: 'https://a.example.com/feed' }], fetchFile: stubFetch({ 'https://a.example.com/feed': FEED_A }) });
    const out = await src.search('heat pumps Queensland', new Date(NOW - 30 * 86400000));
    assert.deepStrictEqual(out.errors, []);
    assert.strictEqual(out.answered, 1);
    const titles = out.items.map((i) => i.title).sort();
    assert.deepStrictEqual(titles, ['Heat pump rebates in Queensland', 'Heat pumps for Queensland homes, no date'], 'matching and recent, or undated; cricket and the 60-day-old story are out');
    const first = out.items.find((i) => /rebates/.test(i.title));
    assert.strictEqual(first.url, 'https://news.example.com/heat-pumps', 'tracking removed');
    assert.strictEqual(first.snippet, 'Rebates & grants', 'tags removed, entities decoded');
    assert.strictEqual(out.items.find((i) => /no date/.test(i.title)).publishedAt, null);
  }
  {
    // one bad feed is reported, the good one still counts
    const src = createRssSource({
      feeds: [{ url: 'https://a.example.com/feed', name: 'Good' }, { url: 'https://bad.example.com/feed', name: 'Bad' }, { url: 'https://junk.example.com/feed' }],
      fetchFile: stubFetch({ 'https://a.example.com/feed': FEED_A, 'https://junk.example.com/feed': '<html>not a feed</html>' }),
    });
    const out = await src.search('heat pumps Queensland', null);
    assert.strictEqual(out.answered, 1);
    assert.strictEqual(out.errors.length, 2);
    assert.ok(out.errors.some((e) => e.source === 'rss: Bad') && out.errors.some((e) => e.source === 'rss: junk.example.com'));
    assert.ok(out.items.length >= 2);
  }
  {
    // the real safe fetcher refuses a private address (no network is touched: an address literal needs no lookup)
    const src = createRssSource({ feeds: [{ url: 'http://127.0.0.1/feed.xml' }, { url: 'http://169.254.169.254/latest/meta-data' }, { url: 'http://10.0.0.5/feed' }] });
    const out = await src.search('heat pumps', null);
    assert.strictEqual(out.answered, 0);
    assert.strictEqual(out.items.length, 0);
    assert.strictEqual(out.errors.length, 3, 'all three are refused and said so');
    assert.ok(out.errors.every((e) => /not allowed/.test(e.message)), 'the refusal is the safe fetcher\'s plain sentence, not a stack or a resolver detail');
  }

  // ---------------------------------------------------------------- merging
  {
    const a = makeItem({ url: 'https://x.com/1', title: 'One', snippet: null });
    const b = makeItem({ url: 'https://x.com/1/', title: 'One', publishedAt: '2026-10-01', snippet: 'snip', signals: { hn_points: 5 } });
    const c = makeItem({ url: 'https://x.com/2', title: 'Two', publishedAt: '2026-10-02' });
    const merged = mergeItems([a, b, c]);
    assert.strictEqual(merged.length, 2, 'the same address once');
    assert.strictEqual(merged[0].title, 'Two', 'newest first');
    const one = merged.find((m) => m.title === 'One');
    assert.ok(one.publishedAt && one.snippet === 'snip' && one.signals.hn_points === 5, 'what the second copy knew is kept');
    assert.strictEqual(clampDays(0), 30);
    assert.strictEqual(clampDays(500), 90);
    assert.strictEqual(clampDays('7'), 7);
  }

  // ---------------------------------------------------------------- settings rules
  {
    assert.ok(validateSettings({ region: 'australia' }).error);
    assert.ok(validateSettings({ serpProvider: 'bing' }).error);
    assert.ok(validateSettings({ feeds: 'x' }).error);
    assert.ok(validateSettings({ feeds: ['nope'] }).error);
    assert.ok(validateSettings({ feeds: ['ftp://x.com/feed'] }).error);
    assert.ok(validateSettings({ feeds: ['javascript:alert(1)'] }).error);
    assert.ok(validateSettings({ feeds: Array.from({ length: MAX_FEEDS + 1 }, (_, i) => `https://x.com/${i}`) }).error);
    const ok = validateSettings({ niche: '  heat pumps ', region: 'au', feeds: ['https://a.com/f', { url: 'https://a.com/f', name: 'dupe' }, { url: 'https://b.com/f', name: ' B ' }] });
    assert.deepStrictEqual(ok.value.feeds, [{ url: 'https://a.com/f' }, { url: 'https://b.com/f', name: 'B' }], 'duplicates dropped');
    assert.strictEqual(ok.value.niche, 'heat pumps');
    assert.strictEqual(ok.value.region, 'AU');
    const kept = validateSettings({ tone: 'plain' }, ok.value);
    assert.strictEqual(kept.value.feeds.length, 2, 'a partial update keeps the rest');
  }

  // ---------------------------------------------------------------- fake pool
  function fakePool() {
    const db = { settings: new Map(), topics: [], runs: [], articles: [], runArticles: [] };
    const seq = { topic: 0, run: 0, article: 0, ra: 0 };
    const pool = {
      db, bin: [], binFail: false,
      async connect() { return { query: (sql, params) => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) ? Promise.resolve({ rows: [] }) : pool.query(sql, params)), release() {} }; },
      async query(sql, params = []) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (/^SELECT value FROM settings/.test(s)) { const v = db.settings.get(`${params[0]}|${params[1]}`); return { rows: v === undefined ? [] : [{ value: v }] }; }
        if (/^INSERT INTO settings/.test(s)) { db.settings.set(`${params[0]}|${params[1]}`, params[2]); return { rows: [] }; }
        if (/^SELECT \* FROM topic_research_topics WHERE "userId" = \$1 AND lower\(keyword\)/.test(s)) return { rows: db.topics.filter((t) => t.userId === params[0] && t.keyword.toLowerCase() === params[1].toLowerCase()) };
        if (/^SELECT COUNT\(\*\) AS n FROM topic_research_topics/.test(s)) return { rows: [{ n: String(db.topics.filter((t) => t.userId === params[0]).length) }] };
        if (/^INSERT INTO topic_research_topics/.test(s)) {
          const t = { id: (seq.topic += 1), userId: params[0], keyword: params[1], region: params[2], language: 'en', onWatchlist: false, refreshHours: 24, createdAt: new Date(NOW + seq.topic * 1000), extraQueries: params[3] ? JSON.parse(params[3]) : [] };
          db.topics.push(t); return { rows: [t] };
        }
        if (/^UPDATE topic_research_topics SET "extraQueries" = \$1/.test(s)) { const t = db.topics.find((x) => x.id === params[1] && x.userId === params[2]); if (t) t.extraQueries = JSON.parse(params[0]); return { rows: t ? [t] : [] }; }
        if (/^SELECT \* FROM topic_research_topics WHERE id = \$1 AND "userId" = \$2/.test(s)) return { rows: db.topics.filter((t) => t.id === params[0] && t.userId === params[1]) };
        if (/^INSERT INTO topic_research_runs/.test(s)) {
          const r = { id: (seq.run += 1), userId: params[0], topicId: params[1], startedAt: new Date(NOW + seq.run * 1000), finishedAt: null, status: 'running', errorsJson: [] };
          db.runs.push(r); return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE topic_research_runs SET status = 'failed'/.test(s)) { const r = db.runs.find((x) => x.id === params[1] && x.userId === params[2]); if (r) { r.status = 'failed'; r.errorsJson = JSON.parse(params[0]); } return { rows: [] }; }
        if (/^UPDATE topic_research_runs SET status = \$1/.test(s)) {
          const r = db.runs.find((x) => x.id === params[5] && x.userId === params[6]);
          if (r) { r.status = params[0]; r.errorsJson = JSON.parse(params[1]); r.sourcesJson = JSON.parse(params[2]); r.extrasJson = JSON.parse(params[3]); r.apiCostEstimate = params[4]; r.queriesJson = params[7] ? JSON.parse(params[7]) : null; r.finishedAt = new Date(NOW); }
          return { rows: [] };
        }
        if (/^INSERT INTO topic_research_articles/.test(s)) {
          let a = db.articles.find((x) => x.userId === params[0] && x.url === params[1]);
          if (a) { a.title = params[2]; a.publishedAt = params[4] || a.publishedAt; a.snippet = params[5] || a.snippet; } else {
            a = { id: (seq.article += 1), userId: params[0], url: params[1], title: params[2], domain: params[3], publishedAt: params[4], snippet: params[5] };
            db.articles.push(a);
          }
          return { rows: [{ id: a.id }] };
        }
        if (/^INSERT INTO topic_research_run_articles/.test(s)) {
          if (!db.runArticles.some((x) => x.runId === params[0] && x.articleId === params[1])) db.runArticles.push({ id: (seq.ra += 1), runId: params[0], articleId: params[1], signalsJson: JSON.parse(params[2]), score: null, isOriginal: false, serpRank: null, clusterId: null });
          return { rows: [] };
        }
        if (/^SELECT t\.id, t\.keyword/.test(s)) {
          const rows = db.topics.filter((t) => t.userId === params[0]).sort((a, b) => b.id - a.id).map((t) => {
            const last = db.runs.filter((r) => r.topicId === t.id).sort((a, b) => b.id - a.id)[0];
            return { ...t, lastRunId: last?.id, lastStatus: last?.status, lastRunAt: last?.finishedAt, lastHeat: last?.heatJson, articleCount: String(last ? db.runArticles.filter((ra) => ra.runId === last.id).length : 0) };
          });
          return { rows };
        }
        if (/^SELECT r\.id, r\.status, r\."startedAt"/.test(s)) {
          return { rows: db.runs.filter((r) => r.topicId === params[0] && r.userId === params[1]).sort((a, b) => b.id - a.id).map((r) => ({ ...r, articleCount: String(db.runArticles.filter((ra) => ra.runId === r.id).length) })) };
        }
        if (/^SELECT \* FROM topic_research_runs WHERE "topicId"/.test(s)) return { rows: db.runs.filter((r) => r.topicId === params[0] && r.userId === params[1]) };
        if (/^SELECT \* FROM topic_research_runs WHERE id = \$1 AND "userId" = \$2/.test(s)) return { rows: db.runs.filter((r) => r.id === params[0] && r.userId === params[1]) };
        if (/^SELECT ra\.\* FROM topic_research_run_articles ra JOIN/.test(s)) {
          const ids = new Set(db.runs.filter((r) => r.topicId === params[0] && r.userId === params[1]).map((r) => r.id));
          return { rows: db.runArticles.filter((ra) => ids.has(ra.runId)) };
        }
        // ---- briefs (these start like the run query below, so they come first)
        if (/^SELECT a\.id, a\.url, a\.title, a\.domain, a\."publishedAt", a\.snippet, a\."extractedText" AS text, ra\.score/.test(s)) {
          const rows = db.runArticles.filter((ra) => ra.runId === params[0] && params[2].includes(ra.articleId))
            .map((ra) => ({ ...db.articles.find((a) => a.id === ra.articleId), score: ra.score, text: db.articles.find((a) => a.id === ra.articleId).extractedText || null }))
            .filter((a) => a.userId === params[1]).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id - b.id);
          return { rows };
        }
        if (/^SELECT a\.id, a\.url, a\.title, a\.domain FROM topic_research_articles a WHERE a\.id = ANY/.test(s)) return { rows: db.articles.filter((a) => params[0].includes(a.id) && a.userId === params[1]) };
        if (/^SELECT id FROM topic_research_runs WHERE id = \$1 AND "userId" = \$2/.test(s)) return { rows: db.runs.filter((r) => r.id === params[0] && r.userId === params[1]).map((r) => ({ id: r.id })) };
        if (/^INSERT INTO topic_research_briefs/.test(s)) {
          db.briefs = db.briefs || [];
          const b = { id: db.briefs.length + 1 + (db.briefBase || 0), userId: params[0], runId: params[1], selectedArticleIds: JSON.parse(params[2]), angle: params[3], contentJson: JSON.parse(params[4]), overlapJson: JSON.parse(params[5]), model: params[6], costUsd: params[7], inputTokens: params[8], outputTokens: params[9], createdAt: new Date(NOW + 5000 * (db.briefs.length + 1)) };
          db.briefs.push(b); return { rows: [b] };
        }
        if (/^UPDATE topic_research_runs SET "apiCostEstimate" = "apiCostEstimate" \+ \$1/.test(s)) { const r = db.runs.find((x) => x.id === params[1] && x.userId === params[2]); if (r) r.apiCostEstimate = (Number(r.apiCostEstimate) || 0) + params[0]; return { rows: [] }; }
        if (/^SELECT id, angle, "contentJson", "overlapJson", "createdAt", "costUsd" FROM topic_research_briefs WHERE "runId"/.test(s)) return { rows: (db.briefs || []).filter((b) => b.runId === params[0] && b.userId === params[1]).sort((a, b) => b.id - a.id) };
        if (/^SELECT b\.\*, r\."topicId" AS "topicId" FROM topic_research_briefs b JOIN/.test(s)) {
          const b = (db.briefs || []).find((x) => x.id === params[0] && x.userId === params[1]);
          return { rows: b ? [{ ...b, topicId: db.runs.find((r) => r.id === b.runId).topicId }] : [] };
        }
        if (/^SELECT \* FROM topic_research_briefs WHERE id = \$1 AND "userId" = \$2 FOR UPDATE/.test(s)) return { rows: (db.briefs || []).filter((x) => x.id === params[0] && x.userId === params[1]) };
        if (/^SELECT \* FROM topic_research_briefs WHERE "runId" = ANY/.test(s)) return { rows: (db.briefs || []).filter((b) => params[0].includes(b.runId) && b.userId === params[1]) };
        if (/^DELETE FROM topic_research_briefs WHERE id/.test(s)) { const n = (db.briefs || []).length; db.briefs = (db.briefs || []).filter((b) => !(b.id === params[0] && b.userId === params[1])); return { rowCount: n - db.briefs.length, rows: [] }; }
        if (/^SELECT a\.id, a\.url, a\.title/.test(s)) {
          const rows = db.runArticles.filter((ra) => ra.runId === params[0]).map((ra) => ({ ...ra, ...db.articles.find((a) => a.id === ra.articleId) })).filter((a) => a.userId === params[1]);
          rows.sort((a, b) => (b.publishedAt ? new Date(b.publishedAt).getTime() : -Infinity) - (a.publishedAt ? new Date(a.publishedAt).getTime() : -Infinity) || b.id - a.id);
          return { rows };
        }
        if (/^DELETE FROM topic_research_topics/.test(s)) {
          if (pool.binFail) throw new Error('boom');
          const i = db.topics.findIndex((t) => t.id === params[0] && t.userId === params[1]);
          if (i >= 0) { const [t] = db.topics.splice(i, 1); const runIds = db.runs.filter((r) => r.topicId === t.id).map((r) => r.id); db.runs = db.runs.filter((r) => r.topicId !== t.id); db.runArticles = db.runArticles.filter((ra) => !runIds.includes(ra.runId)); db.briefs = (db.briefs || []).filter((b) => !runIds.includes(b.runId)); }
          return { rowCount: i >= 0 ? 1 : 0, rows: [] };
        }
        if (/^SELECT domain, weight, note FROM topic_research_source_weights/.test(s)) return { rows: (db.sourceWeights || []).filter((w) => w.userId === params[0]).sort((a, b) => (a.domain < b.domain ? -1 : 1)).map(({ domain, weight, note }) => ({ domain, weight, note })) };
        if (/^DELETE FROM topic_research_source_weights/.test(s)) { db.sourceWeights = (db.sourceWeights || []).filter((w) => w.userId !== params[0]); return { rows: [] }; }
        if (/^INSERT INTO topic_research_source_weights/.test(s)) { (db.sourceWeights = db.sourceWeights || []).push({ userId: params[0], domain: params[1], weight: params[2], note: params[3] }); return { rows: [] }; }
        // ---- relevance and suggestion checks cost, from the usage log (M7)
        if (/^SELECT COALESCE\(SUM\(estimated_cost_usd\), 0\) AS total FROM usage_logs/.test(s)) return { rows: [{ total: (db.checks || []).filter((c) => c.userId === params[0] && new Date(c.createdAt) >= params[1]).reduce((t, c) => t + (Number(c.costUsd) || 0), 0) }] };
        // ---- drafts (M6)
        db.drafts = db.drafts || [];
        if (/^SELECT COALESCE\(SUM\("costUsd"\), 0\) AS total FROM topic_research_drafts WHERE "userId" = \$1 AND "createdAt" >= \$2/.test(s)) {
          return { rows: [{ total: db.drafts.filter((d) => d.userId === params[0] && new Date(d.createdAt) >= params[1]).reduce((t, d) => t + (Number(d.costUsd) || 0), 0) }] };
        }
        if (/^SELECT a\.url, a\.title, a\.snippet, a\."extractedText" AS text FROM topic_research_articles a WHERE a\.id = ANY/.test(s)) {
          return { rows: db.articles.filter((a) => params[0].includes(a.id) && a.userId === params[1]).map((a) => ({ url: a.url, title: a.title, snippet: a.snippet, text: a.extractedText || null })) };
        }
        if (/^INSERT INTO topic_research_drafts/.test(s)) {
          const d = { id: db.drafts.length + 1 + (db.draftBase || 0), userId: params[0], briefId: params[1], lengthChoice: params[2], steer: params[3], contentJson: JSON.parse(params[4]), overlapJson: JSON.parse(params[5]), model: params[6], costUsd: params[7], inputTokens: params[8], outputTokens: params[9], createdAt: new Date(NOW) };
          db.drafts.push(d); return { rows: [d] };
        }
        if (/^SELECT id FROM topic_research_briefs WHERE id = \$1 AND "userId" = \$2/.test(s)) return { rows: (db.briefs || []).filter((b) => b.id === params[0] && b.userId === params[1]).map((b) => ({ id: b.id })) };
        if (/^SELECT id, "lengthChoice", "contentJson", "overlapJson", "createdAt", "costUsd" FROM topic_research_drafts WHERE "briefId"/.test(s)) return { rows: db.drafts.filter((d) => d.briefId === params[0] && d.userId === params[1]).sort((a, b) => b.id - a.id) };
        if (/^SELECT d\.\*, b\."selectedArticleIds" AS "selectedArticleIds"/.test(s)) {
          const d = db.drafts.find((x) => x.id === params[0] && x.userId === params[1]);
          const b = d && (db.briefs || []).find((x) => x.id === d.briefId);
          return { rows: d && b ? [{ ...d, selectedArticleIds: b.selectedArticleIds, runId: b.runId, topicId: db.runs.find((r) => r.id === b.runId).topicId }] : [] };
        }
        if (/^SELECT \* FROM topic_research_drafts WHERE id = \$1 AND "userId" = \$2 FOR UPDATE/.test(s)) return { rows: db.drafts.filter((x) => x.id === params[0] && x.userId === params[1]) };
        if (/^SELECT \* FROM topic_research_drafts WHERE "briefId" = ANY/.test(s)) return { rows: db.drafts.filter((d) => params[0].includes(d.briefId) && d.userId === params[1]) };
        if (/^SELECT \* FROM topic_research_drafts WHERE "briefId" = \$1 AND "userId" = \$2/.test(s)) return { rows: db.drafts.filter((d) => d.briefId === params[0] && d.userId === params[1]) };
        if (/^DELETE FROM topic_research_drafts WHERE id/.test(s)) { const n = db.drafts.length; db.drafts = db.drafts.filter((d) => !(d.id === params[0] && d.userId === params[1])); return { rowCount: n - db.drafts.length, rows: [] }; }
        if (/^SELECT d\.id, d\."briefId", b\."runId", r\."topicId", t\.keyword, d\."createdAt", d\."costUsd" AS cost/.test(s)) {
          const needle = params[1] ? params[1].replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase() : null;
          const rows = db.drafts.filter((d) => d.userId === params[0]).map((d) => {
            const b = (db.briefs || []).find((x) => x.id === d.briefId); const run = b && db.runs.find((r) => r.id === b.runId); const t = run && db.topics.find((x) => x.id === run.topicId);
            return t ? { id: d.id, briefId: d.briefId, runId: b.runId, topicId: t.id, keyword: t.keyword, createdAt: d.createdAt, cost: d.costUsd, contentJson: d.contentJson, overlapJson: d.overlapJson, lengthChoice: d.lengthChoice } : null;
          }).filter(Boolean).filter((d) => !needle || [d.keyword, d.contentJson && d.contentJson.title].some((x) => String(x || '').toLowerCase().includes(needle))).sort((a, b) => b.id - a.id).slice(0, 100);
          return { rows };
        }
        // ---- spending, watchlist, history (M5)
        if (/^SELECT COALESCE\(SUM\("apiCostEstimate"\), 0\) AS total FROM topic_research_runs WHERE "userId" = \$1 AND "startedAt" >= \$2/.test(s)) {
          return { rows: [{ total: db.runs.filter((r) => r.userId === params[0] && new Date(r.startedAt) >= params[1]).reduce((t, r) => t + (Number(r.apiCostEstimate) || 0), 0) }] };
        }
        if (/^SELECT COALESCE\(SUM\("costUsd"\), 0\) AS total FROM topic_research_briefs WHERE "userId" = \$1 AND "createdAt" >= \$2/.test(s)) {
          return { rows: [{ total: (db.briefs || []).filter((b) => b.userId === params[0] && new Date(b.createdAt) >= params[1]).reduce((t, b) => t + (Number(b.costUsd) || 0), 0) }] };
        }
        if (/^UPDATE topic_research_topics SET "onWatchlist" = COALESCE/.test(s)) {
          const t = db.topics.find((x) => x.id === params[2] && x.userId === params[3]);
          if (!t) return { rows: [] };
          if (params[0] !== null) t.onWatchlist = params[0];
          if (params[1] !== null) t.refreshHours = params[1];
          return { rows: [t] };
        }
        if (/^SELECT r.id, r."topicId", t.keyword, r."startedAt", r.status, r."apiCostEstimate" AS cost/.test(s)) {
          const needle = params[1] ? params[1].replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase() : null;
          const rows = db.runs.filter((r) => r.userId === params[0]).map((r) => ({ ...r, keyword: (db.topics.find((t) => t.id === r.topicId) || {}).keyword, cost: r.apiCostEstimate || 0 }))
            .filter((r) => r.keyword && (!needle || r.keyword.toLowerCase().includes(needle)))
            .map((r) => ({ id: r.id, topicId: r.topicId, keyword: r.keyword, startedAt: r.startedAt, status: r.status, cost: r.cost, articleCount: String(db.runArticles.filter((ra) => ra.runId === r.id).length) }))
            .sort((a, b) => b.id - a.id).slice(0, 100);
          return { rows };
        }
        if (/^SELECT b.id, b."runId", r."topicId", t.keyword, b."createdAt", b."costUsd" AS cost/.test(s)) {
          const needle = params[1] ? params[1].replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase() : null;
          const rows = (db.briefs || []).filter((b) => b.userId === params[0]).map((b) => {
            const run = db.runs.find((r) => r.id === b.runId); const topic = run && db.topics.find((t) => t.id === run.topicId);
            return topic ? { id: b.id, runId: b.runId, topicId: topic.id, keyword: topic.keyword, createdAt: b.createdAt, cost: b.costUsd, contentJson: b.contentJson, overlapJson: b.overlapJson, angle: b.angle } : null;
          }).filter(Boolean).filter((b) => !needle || [b.keyword, b.angle, b.contentJson && b.contentJson.chosenAngle].some((x) => String(x || '').toLowerCase().includes(needle)))
            .sort((a, b) => b.id - a.id).slice(0, 100);
          return { rows };
        }
        throw new Error(`fakePool: unhandled SQL: ${s.slice(0, 120)}`);
      },
    };
    return pool;
  }

  // ---------------------------------------------------------------- one run
  {
    const pool = fakePool();
    const topic = (await pool.query('INSERT INTO topic_research_topics ("userId", keyword, region) VALUES ($1, $2, $3) RETURNING *', [1, 'heat pumps Queensland', 'AU'])).rows[0];
    const sources = [createRssSource({
      feeds: [{ url: 'https://a.example.com/feed' }, { url: 'https://b.example.com/feed' }, { url: 'https://dead.example.com/feed' }],
      fetchFile: stubFetch({ 'https://a.example.com/feed': FEED_A, 'https://b.example.com/feed': FEED_B }),
    })];
    const out = await runCollect({ pool, userId: 1, topic, sources, days: 30, now: () => NOW });
    assert.strictEqual(out.status, 'partial', 'one feed failed, two worked');
    assert.strictEqual(out.errors.length, 1);
    // A: rebates + undated; B: guide (same address as the A rebates story once the www is dropped? no: www host differs) + installers
    const urls = pool.db.articles.map((a) => a.url).sort();
    assert.strictEqual(new Set(urls).size, urls.length, 'no address stored twice');
    assert.ok(urls.includes('https://news.example.com/heat-pumps') && urls.includes('https://other.example.org/installers'));
    assert.ok(!urls.some((u) => /cricket|\/old/.test(u)));
    assert.strictEqual(pool.db.runs[0].status, 'partial');
    assert.strictEqual(pool.db.runArticles.length, out.count);

    // a second run of the same topic reuses the stored articles
    const before = pool.db.articles.length;
    const again = await runCollect({ pool, userId: 1, topic, sources, days: 30, now: () => NOW });
    assert.strictEqual(pool.db.articles.length, before, 'articles are stored once per person');
    assert.strictEqual(pool.db.runs.length, 2);
    assert.strictEqual(again.count, out.count);

    // nothing configured
    const none = await runCollect({ pool, userId: 1, topic, sources: [], days: 30, now: () => NOW });
    assert.strictEqual(none.status, 'failed');
    assert.ok(/No sources/.test(none.errors[0].message));

    // every source throws
    const boom = await runCollect({ pool, userId: 1, topic, sources: [{ name: 'x', search: async () => { throw new Error('down'); } }], days: 30, now: () => NOW });
    assert.strictEqual(boom.status, 'failed');
    assert.strictEqual(boom.errors[0].source, 'x');

    // all feeds fine but nothing matches: still ok
    const quiet = await runCollect({ pool, userId: 1, topic: { ...topic, keyword: 'volcano' }, sources, days: 30, now: () => NOW });
    assert.strictEqual(quiet.count, 0);
    assert.strictEqual(quiet.status, 'partial', 'the dead feed is still reported');
  }

  // ---------------------------------------------------------------- the routes
  {
    const pool = fakePool();
    const goodSource = (extra = {}) => ({
      name: 'rss',
      async search() {
        return { items: [makeItem({ url: 'https://a.example.com/one?utm_source=z', title: 'Heat pump news', publishedAt: new Date(NOW - 86400000) }), makeItem({ url: 'https://a.example.com/one', title: 'Heat pump news', snippet: 'dup' })], errors: [], answered: 1, ...extra };
      },
    });
    let buildCalls = 0;
    let gate = null;
    const refreshSeen = [];
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: Number(req.headers['x-test-user'] || 1) }; next(); });
    const briefCalls = []; let briefMode = 'ok'; let briefGate = null;
    const relevanceCalls = []; let relevanceMode = 'ok';
    const suggestCalls = []; let suggestMode = 'ok';
    let clockShift = 0; // moved forward to clear the hourly caps
    const draftCalls = []; let draftMode = 'ok'; let draftGate = null;
    const DRAFT = { title: 'A working title', sections: [{ heading: 'Costs', paragraphs: [{ kind: 'fact', text: 'A levy was announced by one outlet.', sources: ['https://a.example.com/one'] }, { kind: 'gap', text: 'Add the dollar figure.', sources: [] }] }] };
    const budgetSeen = []; // whether each source build was told the monthly limit is reached
    const modelStore = new Map(); const MODEL_CHOICES = ['model-a', 'model-b'];
    const BRIEF = {
      summary: 'A levy was announced.', keyFacts: [{ fact: 'A fact.', sources: ['https://a.example.com/one'], outletCount: 1, singleSource: true }], anglesTaken: [], gaps: [],
      suggestedAngles: [{ title: "A renter's guide", why: 'Readers rent.' }], chosenAngle: "A renter's guide", outline: [{ level: 2, heading: 'Who can claim', notes: ['Owners first'] }], keywords: { primary: 'heat pump', related: [] },
    };
    const analysed = []; const rescored = [];
    let stale = false; let analysisBreaks = false;
    app.use('/api/topic-research', createRouter(pool, {
      now: () => NOW + clockShift,
      analyse: async (args) => {
        analysed.push(args);
        if (analysisBreaks) throw new Error('reading pages exploded: secret-host:5432');
        pool.db.runs.find((r) => r.id === args.runId).heatJson = { label: 'Rising', value: 3 };
        return { stories: 1, read: { counts: { ok: 1 }, tried: 1 }, heat: { label: 'Rising', value: 3 } };
      },
      rescore: async (args) => { rescored.push(args.runId); return { stories: 1, heat: { label: 'Steady', value: 3 } }; },
      isStale: async () => stale,
      aiGate: (req, res, next) => next(), // the app-wide 30 a minute would trip this test, which makes hundreds of calls
      limits: { briefsPerHour: 6, draftsPerHour: 4, checksPerHour: 5, perMinute: 100000 }, // the per-minute limit is tested by its own behaviour in production; this run makes hundreds of calls
      makeBrief: async (input) => {
        briefCalls.push(input);
        if (briefGate) await briefGate;
        if (briefMode === 'no-model') throw Object.assign(new Error('No AI model is set up for this workspace yet.'), { status: 503 });
        if (briefMode === 'secret') throw new Error('connect ECONNREFUSED secret-host:5432');
        if (briefMode === 'bad-gateway') throw Object.assign(new Error('The AI model took too long to answer. Try again, or tick fewer articles.'), { status: 502 });
        return { brief: BRIEF, overlap: [], dropped: { facts: 0, sources: 0 }, model: 'claude-test', inputTokens: 1000, outputTokens: 500, costUsd: 0.012 };
      },
      suggestQueriesFn: async (input) => {
        suggestCalls.push(input);
        if (suggestMode === 'no-model') throw Object.assign(new Error('No AI model is set up for this workspace yet.'), { status: 503 });
        return { phrases: ['wine cellar cooling unit', 'wine room refrigeration'], model: 'cheap-test', costUsd: 0.0002 };
      },
      checkRelevanceFn: async (input) => {
        relevanceCalls.push(input);
        if (relevanceMode === 'no-model') throw Object.assign(new Error('No AI model is set up for this workspace yet.'), { status: 503 });
        if (relevanceMode === 'secret') throw new Error('connect ECONNREFUSED secret-host:5432');
        return { scores: input.articles.map((a) => ({ id: a.id, score: relevanceMode === 'poor' ? 0 : 3, why: 'w', missing: false })), verdict: relevanceMode === 'poor' ? 'poor' : 'good', ratio: relevanceMode === 'poor' ? 0 : 1, summary: 'wine racks', message: relevanceMode === 'poor' ? 'Most of the ticked sources are not about it.' : '', model: 'cheap-test', inputTokens: 1, outputTokens: 1, costUsd: 0.0004 };
      },
      makeDraft: async (input) => {
        draftCalls.push(input);
        if (draftGate) await draftGate;
        if (draftMode === 'no-facts') throw Object.assign(new Error('This brief has no sourced facts to write a draft from.'), { status: 400 });
        if (draftMode === 'secret') throw new Error('connect ECONNREFUSED secret-host:5432');
        return { draft: DRAFT, overlap: [{ field: 'section 1 paragraph 1', words: 14, excerpt: 'a copied run', sourceUrl: 'brief', sourceTitle: 'your research brief' }], dropped: { unsourced: 1, sources: 0 }, model: 'claude-test', inputTokens: 900, outputTokens: 700, costUsd: 0.02 };
      },
      getBin: () => ({ moveToBin: async (_db, o) => { pool.bin.push(o); return `bin-${pool.bin.length}`; } }),
      modelApi: {
        getTopicResearchModelConfig: async (u) => ({ modelId: modelStore.get(u) || '', assignmentValid: true, fromAdmin: false, globalStandard: 'model-default', effectiveModel: modelStore.get(u) || 'model-default', choices: MODEL_CHOICES.map((id) => ({ id })) }),
        saveTopicResearchModel: async (u, id) => {
          const v = typeof id === 'string' ? id.trim() : '';
          if (v && !MODEL_CHOICES.includes(v)) throw Object.assign(new Error('Choose one of the models connected in Settings -> AI & Chat.'), { status: 400 });
          if (v) modelStore.set(u, v); else modelStore.delete(u);
          return { modelId: v, choices: MODEL_CHOICES.map((m) => ({ id: m })), effectiveModel: v || 'model-default' };
        },
      },
      buildSources: (settings, depsSeen) => {
        buildCalls += 1;
        budgetSeen.push(!!depsSeen?.budgetOver);
        const status = [
          { id: 'rss', label: 'RSS feeds', enabled: settings.feeds.length > 0, reason: settings.feeds.length ? null : 'No feeds yet. Add some above.' },
          { id: 'reddit', label: 'Reddit', enabled: false, reason: 'Needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.' },
        ];
        const sources = settings.feeds.length
          ? [{
            id: 'rss', name: 'rss', label: 'RSS feeds',
            search: async (k, s, ctx) => {
              refreshSeen.push(ctx.refresh);
              if (gate) await gate;
              const out = await goodSource().search();
              return { ...out, items: out.items.map((i) => ({ ...i, signals: { hn_points: 9 } })), extras: { peopleAlsoAsk: [{ question: 'Why?', snippet: '' }], relatedSearches: ['more'] }, costUsd: 0.01 };
            },
          }]
          : [];
        return { sources, status };
      },
    }));
    const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/topic-research`;
    const call = async (method, path, body, user = 1) => {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-test-user': String(user) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    try {
      // settings
      let r = await call('GET', '/settings');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.settings.feeds, []);
      assert.strictEqual((await call('PUT', '/settings', { feeds: ['nope'] })).status, 400);
      r = await call('PUT', '/settings', { niche: 'Home energy', feeds: ['https://a.example.com/feed'] });
      assert.strictEqual(r.status, 200);
      assert.strictEqual((await call('GET', '/settings')).body.settings.niche, 'Home energy');
      assert.deepStrictEqual((await call('GET', '/settings', undefined, 2)).body.settings.feeds, [], "another person's settings are separate");

      // how results are ranked: weights and how fast news goes stale
      r = await call('GET', '/settings');
      assert.deepStrictEqual([r.body.settings.scoringWeights, r.body.settings.halfLifeHours], [{ rank: 0.25, size: 0.2, engagement: 0.15, recency: 0.15, source: 0.05, match: 0.2 }, 48]);
      assert.strictEqual((await call('PUT', '/settings', { scoringWeights: { rank: -1 } })).status, 400);
      assert.strictEqual((await call('PUT', '/settings', { scoringWeights: { rank: 'lots' } })).status, 400);
      assert.strictEqual((await call('PUT', '/settings', { scoringWeights: { rank: 0, size: 0, engagement: 0, recency: 0, source: 0, match: 0 } })).status, 400, 'at least one weight must count');
      assert.strictEqual((await call('PUT', '/settings', { halfLifeHours: 0 })).status, 400);
      assert.strictEqual((await call('PUT', '/settings', { halfLifeHours: 5000 })).status, 400);
      r = await call('PUT', '/settings', { scoringWeights: { rank: 0.05, recency: 0.9 }, halfLifeHours: 24 });
      assert.deepStrictEqual([r.status, r.body.settings.scoringWeights.rank, r.body.settings.scoringWeights.size, r.body.settings.halfLifeHours, r.body.settings.niche], [200, 0.05, 0.2, 24, 'Home energy'], 'a partial change keeps the rest');
      assert.deepStrictEqual((await call('GET', '/settings', undefined, 2)).body.settings.scoringWeights.rank, 0.25, "someone else's ranking is theirs");
      await call('PUT', '/settings', { scoringWeights: { rank: 0.25, size: 0.2, engagement: 0.15, recency: 0.15, source: 0.05, match: 0.2 }, halfLifeHours: 48 });

      // the owner's own weight for each outlet
      assert.deepStrictEqual((await call('GET', '/source-weights')).body.weights, []);
      assert.strictEqual((await call('PUT', '/source-weights', { weights: 'x' })).status, 400);
      assert.strictEqual((await call('PUT', '/source-weights', { weights: [{ domain: 'not a site', weight: 0.5 }] })).status, 400);
      assert.strictEqual((await call('PUT', '/source-weights', { weights: [{ domain: 'abc.net.au', weight: 1.5 }] })).status, 400);
      assert.strictEqual((await call('PUT', '/source-weights', { weights: [{ domain: 'abc.net.au' }] })).status, 400, 'a weight is needed');
      r = await call('PUT', '/source-weights', { weights: [{ domain: 'https://www.ABC.net.au/news', weight: 0.9, note: ' public broadcaster ' }, { domain: 'blog.example.com', weight: 0 }] });
      assert.deepStrictEqual([r.status, r.body.weights], [200, [{ domain: 'abc.net.au', weight: 0.9, note: 'public broadcaster' }, { domain: 'blog.example.com', weight: 0, note: '' }]]);
      assert.deepStrictEqual((await call('GET', '/source-weights')).body.weights.map((w) => w.domain), ['abc.net.au', 'blog.example.com']);
      assert.deepStrictEqual((await call('GET', '/source-weights', undefined, 2)).body.weights, [], "another person's list is separate");
      await call('PUT', '/source-weights', { weights: [{ domain: 'abc.net.au', weight: 0.7 }] }, 2);
      assert.deepStrictEqual((await call('GET', '/source-weights')).body.weights.map((w) => w.weight), [0.9, 0], 'saving theirs left mine alone');
      await call('PUT', '/source-weights', { weights: [] });
      assert.deepStrictEqual((await call('GET', '/source-weights')).body.weights, [], 'saving an empty list clears it');

      // which sources are on, and why one is off
      r = await call('GET', '/sources');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.sources.map((s) => [s.id, s.enabled]), [['rss', true], ['reddit', false]]);
      assert.ok(/REDDIT_CLIENT_ID/.test(r.body.sources[1].reason));
      assert.strictEqual((await call('GET', '/sources', undefined, 2)).body.sources[0].enabled, false, "another person has their own feeds, so their own list");

      // create + search
      assert.strictEqual((await call('POST', '/topics', { keyword: '   ' })).status, 400);
      assert.strictEqual((await call('POST', '/topics', { keyword: 'the of' })).status, 400, 'no searchable words');
      r = await call('POST', '/topics', { keyword: 'heat pumps' });
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.run.status, 'ok');
      assert.strictEqual(r.body.run.count, 1, 'the two copies of one address are one article');
      assert.deepStrictEqual(refreshSeen, [false], 'typing a topic may use saved answers');
      assert.strictEqual(analysed.length, 1, 'once the sources have answered, pages are read and stories ranked');
      assert.deepStrictEqual([analysed[0].runId, analysed[0].topic.keyword, analysed[0].userId], [r.body.run.id, 'heat pumps', 1]);
      assert.deepStrictEqual(r.body.run.analysis, { stories: 1, read: { counts: { ok: 1 }, tried: 1 }, heat: { label: 'Rising', value: 3 } });
      assert.deepStrictEqual(r.body.run.sources.map((s) => [s.id, s.count]), [['rss', 2]]);
      const topicId = r.body.topic.id;
      const runId = r.body.run.id;

      // the same words again reuse the topic and search again
      r = await call('POST', '/topics', { keyword: 'Heat   Pumps' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.created, false);
      assert.strictEqual(r.body.topic.id, topicId);
      assert.strictEqual(pool.db.topics.length, 1);

      // list, detail, run
      r = await call('GET', '/topics');
      assert.strictEqual(r.body.topics.length, 1);
      assert.strictEqual(r.body.topics[0].lastRun.articleCount, 1);
      assert.deepStrictEqual(r.body.topics[0].lastRun.heat, { label: 'Rising', value: 3 }, 'the list shows how lively the topic is');
      r = await call('GET', `/topics/${topicId}`);
      assert.strictEqual(r.body.runs.length, 2);
      r = await call('GET', `/runs/${runId}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.articles.length, 1);
      assert.strictEqual(r.body.articles[0].url, 'https://a.example.com/one');
      assert.strictEqual(r.body.articles[0].snippet, 'dup');
      assert.ok(!('extractedText' in r.body.articles[0]), 'stored page text is never sent to the browser');
      assert.deepStrictEqual(r.body.articles[0].signals.hn_points, 9, 'each source\'s numbers come with the article');
      assert.deepStrictEqual(r.body.run.sources.map((s) => s.id), ['rss']);
      assert.deepStrictEqual(r.body.run.extras, { peopleAlsoAsk: [{ question: 'Why?', snippet: '' }], relatedSearches: ['more'] });
      assert.strictEqual(r.body.run.costUsd, 0.01);
      assert.deepStrictEqual([r.body.run.weightsStale, r.body.run.ranking, r.body.run.heat], [false, null, { label: 'Rising', value: 3 }]);
      assert.deepStrictEqual(r.body.stories, [], 'a search that was never grouped has no stories yet');
      assert.deepStrictEqual([r.body.articles[0].breakdown, r.body.articles[0].pageRead], [null, null]);
      assert.ok(!JSON.stringify(r.body).includes('extractedText'));

      // out-of-date scores: the page is told, and can ask for a re-rank
      stale = true;
      assert.strictEqual((await call('GET', `/runs/${runId}`)).body.run.weightsStale, true);
      stale = false;
      const rr = await call('POST', `/runs/${runId}/rescore`, {});
      assert.deepStrictEqual([rr.status, rr.body.ok, rescored], [200, true, [runId]]);
      assert.strictEqual((await call('POST', `/runs/${runId}/rescore`, {}, 2)).status, 404, "someone else's search cannot be re-ranked");
      assert.strictEqual((await call('POST', '/runs/abc/rescore', {})).status, 404);
      assert.deepStrictEqual(rescored, [runId], 'and the refused ones did nothing');
      assert.strictEqual(r.body.topic.keyword, 'heat pumps');

      // another person sees none of it
      assert.deepStrictEqual((await call('GET', '/topics', undefined, 2)).body.topics, []);
      for (const [m, p] of [['GET', `/topics/${topicId}`], ['POST', `/topics/${topicId}/run`], ['DELETE', `/topics/${topicId}`], ['GET', `/runs/${runId}`]]) {
        const x = await call(m, p, m === 'POST' ? {} : undefined, 2);
        assert.strictEqual(x.status, 404, `${m} ${p} for someone else's id`);
      }
      assert.strictEqual(pool.db.topics.length, 1, "their delete did nothing");
      for (const bad of ['abc', '0', '-1', '99999999999999']) {
        assert.strictEqual((await call('GET', `/topics/${bad}`)).status, 404);
        assert.strictEqual((await call('GET', `/runs/${bad}`)).status, 404);
      }

      // a fault while reading pages or ranking must not lose the search
      analysisBreaks = true;
      r = await call('POST', `/topics/${topicId}/run`, {});
      assert.strictEqual(r.status, 200, 'the search still comes back');
      assert.strictEqual(r.body.run.analysis, null);
      assert.ok(!JSON.stringify(r.body).includes('secret-host'), 'and the fault itself is not shown');
      analysisBreaks = false;

      // a search already running
      let release; gate = new Promise((res) => { release = res; });
      const slow = call('POST', `/topics/${topicId}/run`, {});
      await new Promise((res) => setTimeout(res, 50));
      const second = await call('POST', `/topics/${topicId}/run`, {});
      assert.strictEqual(second.status, 409);
      release(); gate = null;
      assert.strictEqual((await slow).status, 200);
      assert.strictEqual((await call('POST', `/topics/${topicId}/run`, {})).status, 200, 'free again once the first finished');
      assert.deepStrictEqual(refreshSeen.slice(-2), [true, true], '"Search again" asks every source afresh');
      await call('POST', `/topics/${topicId}/run`, { refresh: false });
      assert.strictEqual(refreshSeen[refreshSeen.length - 1], false, 'unless the caller says saved answers are fine');

      // no feeds: the topic is saved, the run says why it found nothing
      r = await call('POST', '/topics', { keyword: 'solar batteries' }, 2);
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.run.status, 'failed');
      assert.ok(/No sources/.test(r.body.run.errors[0].message));
      const failedRun = await call('GET', `/runs/${r.body.run.id}`, undefined, 2);
      assert.strictEqual(failedRun.body.run.errors.length, 1);
      assert.deepStrictEqual(failedRun.body.articles, []);

      // ---------------------------------------------------------------- research briefs
      {
        const runForBrief = (await call('GET', `/topics/${topicId}`)).body.runs[0].id;
        const detail = (await call('GET', `/runs/${runForBrief}`)).body;
        const articleId = detail.articles[0].id;
        const post = (body, user = 1, runIdArg = runForBrief) => call('POST', `/runs/${runIdArg}/brief`, body, user);

        // what may be asked for
        for (const bad of [undefined, {}, { articleIds: 'x' }, { articleIds: [] }, { articleIds: [0] }, { articleIds: [1.5] }, { articleIds: ['abc'] }, { articleIds: [-3] }, { articleIds: [99999999999] }, { articleIds: Array.from({ length: 13 }, (_, i) => i + 1) }]) {
          assert.strictEqual((await post(bad)).status, 400, `articleIds ${JSON.stringify(bad)}`);
        }
        assert.strictEqual((await post({ articleIds: [articleId], angle: 5 })).status, 400, 'the angle must be text');
        assert.strictEqual((await post({ articleIds: [articleId], angle: 'x'.repeat(201) })).status, 400, 'at most 200 characters');
        assert.strictEqual((await post({ articleIds: [articleId + 1000] })).status, 400, 'an article that is not part of this search');
        assert.strictEqual((await post({ articleIds: [articleId] }, 2)).status, 404, "someone else's search");
        assert.strictEqual((await post({ articleIds: [articleId] }, 1, 'abc')).status, 404);
        assert.strictEqual((await post({ articleIds: [articleId] }, 1, 99999)).status, 404);
        assert.strictEqual(briefCalls.length, 0, 'none of those reached the model');
        // an article of someone else's, even one that exists, cannot be used
        pool.db.articles.push({ id: 5000, userId: 2, url: 'https://theirs.example/x', title: 'Theirs', domain: 'theirs.example', snippet: '', publishedAt: null, extractedText: 'private words' });
        pool.db.runArticles.push({ id: 5000, runId: runForBrief, articleId: 5000, signalsJson: {}, clusterId: null, score: 1, isOriginal: false });
        assert.strictEqual((await post({ articleIds: [5000] })).status, 400, "another person's article is not part of my search");
        assert.strictEqual(briefCalls.length, 0);
        pool.db.runArticles = pool.db.runArticles.filter((ra) => ra.id !== 5000);

        // a brief is written
        r = await post({ articleIds: [articleId, articleId] }); // the same ticked twice counts once
        assert.strictEqual(r.status, 201);
        assert.strictEqual(briefCalls.length, 1);
        assert.deepStrictEqual(briefCalls[0].articles.map((a) => a.url), ['https://a.example.com/one']);
        assert.deepStrictEqual([briefCalls[0].userId, briefCalls[0].topic.keyword, briefCalls[0].settings.niche, briefCalls[0].angle], [1, 'heat pumps', 'Home energy', '']);
        assert.ok(Array.isArray(briefCalls[0].articles) && briefCalls[0].articles[0].snippet === 'dup');
        const b1 = r.body.brief;
        assert.deepStrictEqual([b1.runId, b1.topicId, b1.chosenAngle, b1.model, b1.costUsd, b1.inputTokens, b1.outputTokens], [runForBrief, topicId, 'A renter\'s guide', 'claude-test', 0.012, 1000, 500]);
        assert.deepStrictEqual(b1.sources.map((s) => s.url), ['https://a.example.com/one']);
        assert.ok(b1.markdown.startsWith('# Research brief: heat pumps') && b1.markdown.includes('## Key facts') && b1.markdown.includes('[1]'));
        assert.deepStrictEqual([b1.keyword, /^research-brief-heat-pumps-2026-10-\d\d\.md$/.test(b1.fileName)], ['heat pumps', true], 'the page is given the topic and the file name');
        assert.ok(!('extractedText' in b1) && !JSON.stringify(b1).includes('private words'));
        assert.ok(Math.abs(pool.db.runs.find((x) => x.id === runForBrief).apiCostEstimate - 0.01) < 1e-9, "a brief's cost is NOT added to the search's own estimate (that would count it twice in the monthly total)");

        // with an angle of the owner's own
        r = await post({ articleIds: [articleId], angle: '  The  view from   the roof ' });
        assert.strictEqual(r.status, 201);
        assert.strictEqual(briefCalls[1].angle, 'The view from the roof', 'tidied before it is used');
        const b2 = r.body.brief;

        // reading them back
        r = await call('GET', `/briefs/${b1.id}`);
        assert.deepStrictEqual([r.status, r.body.brief.id, r.body.brief.topicId, r.body.brief.markdown === b1.markdown], [200, b1.id, topicId, true]);
        assert.strictEqual(r.body.brief.content.keyFacts[0].sources[0], 'https://a.example.com/one');
        assert.strictEqual((await call('GET', `/briefs/${b1.id}`, undefined, 2)).status, 404, "someone else's brief");
        assert.strictEqual((await call('GET', '/briefs/abc')).status, 404);
        assert.strictEqual((await call('GET', '/briefs/99999')).status, 404);
        r = await call('GET', `/runs/${runForBrief}/briefs`);
        assert.deepStrictEqual(r.body.briefs.map((b) => b.id), [b2.id, b1.id], 'newest first');
        assert.deepStrictEqual([r.body.briefs[1].factCount, r.body.briefs[1].overlapCount, r.body.briefs[1].chosenAngle], [1, 0, 'A renter\'s guide']);
        assert.strictEqual((await call('GET', `/runs/${runForBrief}/briefs`, undefined, 2)).status, 404);
        assert.strictEqual((await call('GET', '/runs/abc/briefs')).status, 404);

        // when the model or the check finds a problem
        briefMode = 'overlap';
        r = await call('GET', `/briefs/${b1.id}`);
        assert.deepStrictEqual(r.body.brief.overlap, [], 'a stored brief keeps what was found when it was made');
        briefMode = 'no-model';
        r = await post({ articleIds: [articleId] });
        assert.deepStrictEqual([r.status, /No AI model is set up/.test(r.body.error)], [503, true]);
        briefMode = 'secret';
        r = await post({ articleIds: [articleId] });
        assert.strictEqual(r.status, 500);
        assert.ok(!/secret-host|ECONNREFUSED/.test(JSON.stringify(r.body)), 'an unexpected fault is not shown');
        briefMode = 'bad-gateway';
        r = await post({ articleIds: [articleId] });
        assert.deepStrictEqual([r.status, /took too long/.test(r.body.error)], [502, true]);
        briefMode = 'ok';
        assert.strictEqual((await call('GET', `/runs/${runForBrief}/briefs`)).body.briefs.length, 2, 'a failed attempt saves nothing');

        // one at a time for one search
        let release; briefGate = new Promise((res) => { release = res; });
        const slowBrief = post({ articleIds: [articleId] });
        await new Promise((res) => setTimeout(res, 50));
        // (if the lock were missing this second call would wait for the gate too, so a missing answer is reported rather than waited for)
        const second = await Promise.race([post({ articleIds: [articleId] }), new Promise((res) => setTimeout(() => res({ status: 'no answer: it waited behind the first' }), 2000))]);
        assert.strictEqual(second.status, 409);
        release(); briefGate = null;
        assert.strictEqual((await slowBrief).status, 201);

        // an hour's allowance (6 attempts that reached the model: two good, three failures, one slow, and now no more)
        r = await post({ articleIds: [articleId] });
        assert.strictEqual(r.status, 429);
        assert.strictEqual(briefCalls.length, 6, 'the refused one never reached the model');
        assert.strictEqual((await post({ articleIds: [articleId] }, 2)).status, 404, "and someone else's search is still 404, not 429");

        // deleting a brief goes to the recycle bin, and Undo is possible
        const binBefore = pool.bin.length;
        r = await call('DELETE', `/briefs/${b2.id}`);
        assert.deepStrictEqual([r.status, r.body.ok], [200, true]);
        const binned = pool.bin[pool.bin.length - 1];
        assert.strictEqual(pool.bin.length, binBefore + 1);
        assert.deepStrictEqual([binned.type, binned.userId, binned.id, binned.payload.brief.id], ['topic-research-brief', 1, b2.id, b2.id]);
        assert.ok(/^Brief: /.test(binned.title));
        assert.strictEqual((await call('GET', `/briefs/${b2.id}`)).status, 404);
        assert.strictEqual((await call('DELETE', `/briefs/${b2.id}`)).status, 404, 'already gone');
        assert.strictEqual((await call('DELETE', `/briefs/${b1.id}`, undefined, 2)).status, 404, "someone else's brief is not deleted");
        assert.strictEqual((await call('GET', `/briefs/${b1.id}`)).status, 200, 'and is still there');
        assert.strictEqual((await call('DELETE', '/briefs/abc')).status, 404);
        assert.strictEqual((await call('DELETE', `/briefs/${b1.id}`)).status, 200);
        assert.deepStrictEqual(pool.db.briefs.map((b) => b.id), [3], 'only the third brief (the slow one) is left');
        pool.db.briefs = []; // start the topic-delete check below from a known state
        // put one back so the topic's own delete below can be shown to carry it
        r = await post({ articleIds: [articleId] }, 1);
        assert.strictEqual(r.status, 429, 'still within the hour: the cap holds after deletes too');
        pool.db.briefs.push({ id: 900, userId: 1, runId: runForBrief, selectedArticleIds: [articleId], angle: '', contentJson: b1.content, overlapJson: [], model: 'm', costUsd: 0, inputTokens: 0, outputTokens: 0, createdAt: new Date(NOW) });

        // the line at twelve, with thirteen real articles in the search (another person, so this one's hour is its own)
        await call('PUT', '/settings', { feeds: ['https://a.example.com/feed'] }, 3);
        const run3 = (await call('POST', '/topics', { keyword: 'solar batteries' }, 3)).body.run.id;
        for (let i = 0; i < 13; i += 1) {
          pool.db.articles.push({ id: 7000 + i, userId: 3, url: `https://e${i}.example/p`, title: `T${i}`, domain: `e${i}.example`, snippet: 's', publishedAt: null, extractedText: null });
          pool.db.runArticles.push({ id: 7000 + i, runId: run3, articleId: 7000 + i, signalsJson: {}, clusterId: null, score: i, isOriginal: false });
        }
        const calls3 = briefCalls.length;
        assert.strictEqual((await post({ articleIds: Array.from({ length: 13 }, (_, i) => 7000 + i) }, 3, run3)).status, 400, 'thirteen real articles are one too many');
        assert.strictEqual(briefCalls.length, calls3, 'and it never reached the model');
        r = await post({ articleIds: Array.from({ length: 12 }, (_, i) => 7000 + i) }, 3, run3);
        assert.strictEqual(r.status, 201, 'twelve are fine');
        assert.strictEqual(briefCalls[calls3].articles.length, 12);
        assert.deepStrictEqual(briefCalls[calls3].articles.map((a) => a.title).slice(0, 3), ['T11', 'T10', 'T9'], 'the best-ranked article is first, so it is source 1');
      }

      const runForBriefHist = (await call('GET', `/topics/${topicId}`)).body.runs[0].id;
      const detailArticleId = (await call('GET', `/runs/${runForBriefHist}`)).body.articles[0].id;

      // ---------------------------------------------------------------- the model that writes briefs is chosen in Settings, not in the code
      {
        r = await call('GET', '/model-config');
        assert.deepStrictEqual([r.status, r.body.modelId, r.body.effectiveModel, r.body.choices.map((c) => c.id)], [200, '', 'model-default', ['model-a', 'model-b']]);
        r = await call('POST', '/model-config', { modelId: 'model-b' });
        assert.deepStrictEqual([r.status, r.body.modelId, r.body.effectiveModel], [200, 'model-b', 'model-b']);
        assert.strictEqual((await call('GET', '/model-config')).body.modelId, 'model-b');
        assert.strictEqual((await call('GET', '/model-config', undefined, 2)).body.modelId, '', "someone else's choice is theirs");
        r = await call('POST', '/model-config', { modelId: 'not-connected' });
        assert.deepStrictEqual([r.status, /Choose one of the models connected/.test(r.body.error)], [400, true]);
        assert.strictEqual((await call('GET', '/model-config')).body.modelId, 'model-b', 'a refused choice changes nothing');
        assert.strictEqual((await call('POST', '/model-config', { modelId: 42 })).status, 400, 'the model must be text');
        r = await call('POST', '/model-config', { modelId: '' });
        assert.deepStrictEqual([r.status, r.body.modelId, r.body.effectiveModel], [200, '', 'model-default'], 'empty = back to the workspace default');
        assert.strictEqual((await call('POST', '/model-config', {})).status, 200, 'no modelId also clears');
      }

      // ---------------------------------------------------------------- the watchlist
      {
        for (const bad of [{ refreshHours: 7 }, { refreshHours: '24' }, { refreshHours: 0 }, { onWatchlist: 'yes' }, { onWatchlist: 1 }, {}, { other: true }]) {
          assert.strictEqual((await call('PATCH', `/topics/${topicId}`, bad)).status, 400, `PATCH ${JSON.stringify(bad)}`);
        }
        assert.strictEqual((await call('PATCH', `/topics/${topicId}`, { onWatchlist: true }, 2)).status, 404, "someone else's topic");
        assert.strictEqual((await call('PATCH', '/topics/abc', { onWatchlist: true })).status, 404);
        assert.strictEqual((await call('PATCH', '/topics/99999', { onWatchlist: true })).status, 404);
        assert.strictEqual(pool.db.topics.find((t) => t.id === topicId).onWatchlist, false, 'the refused ones changed nothing');
        r = await call('PATCH', `/topics/${topicId}`, { onWatchlist: true });
        assert.deepStrictEqual([r.status, r.body.topic.onWatchlist, r.body.topic.refreshHours], [200, true, 24], 'watching keeps the usual 24 hours');
        r = await call('PATCH', `/topics/${topicId}`, { refreshHours: 12 });
        assert.deepStrictEqual([r.body.topic.onWatchlist, r.body.topic.refreshHours], [true, 12], 'changing the interval keeps it watched');
        for (const h of [6, 24, 48, 168]) assert.strictEqual((await call('PATCH', `/topics/${topicId}`, { refreshHours: h })).body.topic.refreshHours, h);
        r = await call('PATCH', `/topics/${topicId}`, { onWatchlist: false, refreshHours: 6 });
        assert.deepStrictEqual([r.body.topic.onWatchlist, r.body.topic.refreshHours], [false, 6], 'both at once');
        const listed = (await call('GET', '/topics')).body.topics.find((t) => t.id === topicId);
        assert.deepStrictEqual([listed.onWatchlist, listed.refreshHours], [false, 6], 'the list shows it');
        await call('PATCH', `/topics/${topicId}`, { onWatchlist: true, refreshHours: 24 });
      }

      // ---------------------------------------------------------------- history
      const brief900 = pool.db.briefs.filter((b) => b.id === 900); // set aside: the topic-delete check below needs it back afterwards
      pool.db.briefs = pool.db.briefs.filter((b) => b.id !== 900);
      {
        r = await call('GET', '/history');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.runs.length >= 3 && r.body.runs.every((x) => x.keyword === 'heat pumps' && x.status && Number.isInteger(x.articleCount)), 'past searches, with the topic and what they found');
        assert.ok(r.body.runs.every((x, i, a) => i === 0 || a[i - 1].id > x.id), 'newest first');
        const quiet = (await call('GET', '/history', undefined, 2)).body;
        assert.ok(quiet.runs.every((x) => x.keyword !== 'heat pumps') && quiet.briefs.length === 0, "another person's history has only their own: none of mine");
        pool.db.briefs.push({ id: 801, userId: 1, runId: runForBriefHist, selectedArticleIds: [], angle: 'my own angle', contentJson: { chosenAngle: "A renter's guide", keyFacts: [{}, {}] }, overlapJson: [{}], model: 'm', costUsd: 0.07, inputTokens: 1, outputTokens: 1, createdAt: new Date(NOW + 1000) });
        r = await call('GET', '/history');
        assert.deepStrictEqual(r.body.briefs.map((b) => [b.id, b.keyword, b.chosenAngle, b.factCount, b.overlapCount, b.costUsd]), [[801, 'heat pumps', "A renter's guide", 2, 1, 0.07]]);
        assert.deepStrictEqual((await call('GET', '/history?type=runs')).body.briefs, [], 'only searches when asked');
        assert.deepStrictEqual((await call('GET', '/history?type=briefs')).body.runs, [], 'only briefs when asked');
        assert.ok((await call('GET', '/history?q=heat')).body.runs.length >= 3, 'found by the topic');
        assert.deepStrictEqual((await call('GET', '/history?q=zzzz')).body, { runs: [], briefs: [], drafts: [] });
        assert.strictEqual((await call('GET', '/history?q=renter')).body.briefs.length, 1, 'a brief is found by its angle');
        assert.strictEqual((await call('GET', '/history?q=my%20own')).body.briefs.length, 1, 'or the angle the owner typed');
        assert.deepStrictEqual((await call('GET', '/history?q=%25')).body, { runs: [], briefs: [], drafts: [] }, 'a % in the search is a % and not "anything"');
        assert.ok((await call('GET', '/history?type=nonsense')).body.runs.length >= 3, 'an unknown type means all');
        pool.db.briefs = pool.db.briefs.filter((b) => b.id !== 801);
      }

      // ---------------------------------------------------------------- the monthly spending limit
      {
        r = await call('GET', '/usage');
        assert.strictEqual(r.status, 200);
        const u0 = r.body.usage;
        assert.deepStrictEqual([u0.limitUsd, u0.over, u0.pricesSet], [20, false, false], 'the usual limit, not reached; no search prices are set');
        assert.strictEqual(u0.monthStart, '2026-10-01T00:00:00.000Z');
        pool.db.briefs.push({ id: 802, userId: 1, runId: runForBriefHist, selectedArticleIds: [], angle: '', contentJson: {}, overlapJson: [], model: 'm', costUsd: 0.5, inputTokens: 1, outputTokens: 1, createdAt: new Date(NOW) });
        const callsBefore = briefCalls.length;
        // the limit set below what has been spent
        assert.strictEqual((await call('PUT', '/settings', { monthlyBudgetUsd: 0.4 })).status, 200);
        r = (await call('GET', '/usage')).body.usage;
        assert.deepStrictEqual([r.limitUsd, r.over, r.spentUsd >= 0.5, r.briefUsd >= 0.5], [0.4, true, true, true]);
        r = await call('POST', `/runs/${runForBriefHist}/brief`, { articleIds: [detailArticleId] });
        assert.strictEqual(r.status, 402);
        assert.ok(/estimated spend \(\$\d+\.\d\d\) has reached your limit of \$0\.40/.test(r.body.error), r.body.error);
        assert.strictEqual(briefCalls.length, callsBefore, 'the model was never asked');
        const sources = (await call('GET', '/sources')).body;
        assert.ok(sources.sources.length > 0);
        assert.strictEqual(budgetSeen[budgetSeen.length - 1], true, 'the sources were built knowing the limit is reached (the paid ones pause)');
        r = await call('POST', `/topics/${topicId}/run`, {});
        assert.deepStrictEqual([r.status, r.body.run.budgetOver], [200, true], 'a search still runs, and says the limit is reached');
        assert.strictEqual(budgetSeen[budgetSeen.length - 1], true);
        // another person is unaffected
        assert.deepStrictEqual([(await call('GET', '/usage', undefined, 2)).body.usage.over, (await call('GET', '/usage', undefined, 2)).body.usage.spentUsd], [false, 0]);
        // raising it, or turning it off, lifts it
        await call('PUT', '/settings', { monthlyBudgetUsd: 5 });
        assert.strictEqual((await call('GET', '/usage')).body.usage.over, false);
        await call('GET', '/sources');
        assert.strictEqual(budgetSeen[budgetSeen.length - 1], false, 'the paid sources are back');
        await call('PUT', '/settings', { monthlyBudgetUsd: 0.4 });
        await call('PUT', '/settings', { monthlyBudgetUsd: 0 });
        r = (await call('GET', '/usage')).body.usage;
        assert.deepStrictEqual([r.limitUsd, r.over], [0, false], '0 means no limit, however much was spent');
        // exactly at the limit counts as reached
        const spentNow = (await call('GET', '/usage')).body.usage.spentUsd;
        await call('PUT', '/settings', { monthlyBudgetUsd: spentNow });
        assert.strictEqual((await call('GET', '/usage')).body.usage.over, true, 'spent == limit is over');
        for (const bad of [-1, 'lots', null, 10001, true, '']) assert.strictEqual((await call('PUT', '/settings', { monthlyBudgetUsd: bad })).status, 400, `limit ${JSON.stringify(bad)}`);
        assert.strictEqual((await call('GET', '/settings')).body.settings.monthlyBudgetUsd, spentNow, 'a refused limit changes nothing');
        await call('PUT', '/settings', { monthlyBudgetUsd: 20 });
        pool.db.briefs = pool.db.briefs.filter((b) => b.id !== 802);
      }
      pool.db.briefs.push(...brief900);

      // ---------------------------------------------------------------- drafts (M6): a first draft from one brief
      {
        const runArts = (await call('GET', `/runs/${runForBriefHist}`)).body.articles.map((a) => a.id);
        const stash = pool.db.briefs.splice(0, pool.db.briefs.length); // set the real briefs aside: this block needs a known brief
        pool.db.briefs.push({ id: 950, userId: 1, runId: runForBriefHist, selectedArticleIds: runArts.slice(0, 2), angle: 'a', contentJson: BRIEF, overlapJson: [], model: 'm', costUsd: 0, inputTokens: 1, outputTokens: 1, createdAt: new Date(NOW) });
        const callsBefore = draftCalls.length;
        assert.strictEqual((await call('POST', '/briefs/abc/draft', {})).status, 404);
        assert.strictEqual((await call('POST', '/briefs/99999/draft', {})).status, 404);
        assert.strictEqual((await call('POST', '/briefs/950/draft', {}, 2)).status, 404, "someone else's brief");
        for (const bad of [{ lengthChoice: 'huge' }, { lengthChoice: 5 }, { steer: 42 }, { steer: 'x'.repeat(201) }]) assert.strictEqual((await call('POST', '/briefs/950/draft', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
        assert.strictEqual(draftCalls.length, callsBefore, 'the model was never asked for a refused request');

        let r = await call('POST', '/briefs/950/draft', { lengthChoice: 'short', steer: '  stress   cost  ' });
        assert.strictEqual(r.status, 201);
        const d = r.body.draft;
        assert.deepStrictEqual([d.briefId, d.lengthChoice, d.steer, d.model, d.costUsd, d.gapCount, d.words > 0, d.keyword, d.fileName], [950, 'short', 'stress cost', 'claude-test', 0.02, 1, true, 'heat pumps', 'draft-heat-pumps-2026-10-25.md']);
        assert.deepStrictEqual(r.body.dropped, { unsourced: 1, sources: 0 });
        assert.strictEqual(d.overlap.length, 1);
        assert.match(d.markdown, /^# A working title/);
        assert.match(d.markdown, /needs your input: Add the dollar figure\./);
        const input = draftCalls[draftCalls.length - 1];
        assert.deepStrictEqual([input.userId, input.lengthChoice, input.steer, input.topic.keyword], [1, 'short', 'stress cost', 'heat pumps']);
        assert.deepStrictEqual(Object.keys(input.sources[0]).sort(), ['domain', 'title', 'url'], 'the model gets titles and addresses of the sources');
        assert.ok(input.articles.length >= 1 && input.brief === BRIEF, 'the brief goes in; the article text is only for the copy check');
        r = await call('POST', '/briefs/950/draft', {});
        assert.strictEqual(r.body.draft.lengthChoice, 'medium', 'medium is the usual length');

        // list, get, ownership
        r = await call('GET', '/briefs/950/drafts');
        assert.deepStrictEqual(r.body.drafts.map((x) => [x.title, x.lengthChoice]), [['A working title', 'medium'], ['A working title', 'short']], 'newest first');
        assert.strictEqual((await call('GET', '/briefs/950/drafts', undefined, 2)).status, 404);
        r = await call('GET', `/drafts/${d.id}`);
        assert.deepStrictEqual([r.status, r.body.draft.id, r.body.draft.content.title, r.body.draft.sources.length > 0], [200, d.id, 'A working title', true]);
        assert.strictEqual((await call('GET', `/drafts/${d.id}`, undefined, 2)).status, 404);
        assert.strictEqual((await call('GET', '/drafts/xyz')).status, 404);

        // history and spending include drafts
        const h = (await call('GET', '/history')).body;
        assert.deepStrictEqual(h.drafts.map((x) => [x.keyword, x.title, x.briefId]), [['heat pumps', 'A working title', 950], ['heat pumps', 'A working title', 950]]);
        assert.deepStrictEqual((await call('GET', '/history?type=drafts')).body.runs, []);
        assert.strictEqual((await call('GET', '/history?type=runs')).body.drafts.length, 0);
        assert.strictEqual((await call('GET', '/history?q=working')).body.drafts.length, 2, 'found by the draft title');
        assert.strictEqual((await call('GET', '/history?q=zzzz')).body.drafts.length, 0);
        assert.ok(((await call('GET', '/usage')).body.usage.draftUsd) >= 0.04 - 1e-9, 'drafts count towards this month');

        // one at a time, and the hourly cap (4 here; two used)
        let release; draftGate = new Promise((x) => { release = x; });
        const first = call('POST', '/briefs/950/draft', {});
        await new Promise((x) => setTimeout(x, 20));
        assert.strictEqual((await call('POST', '/briefs/950/draft', {})).status, 409, 'a second press while one is being written');
        release(); draftGate = null;
        assert.strictEqual((await first).status, 201);
        assert.strictEqual((await call('POST', '/briefs/950/draft', {})).status, 201);
        r = await call('POST', '/briefs/950/draft', {});
        assert.strictEqual(r.status, 429, 'fifth attempt in an hour');
        assert.ok(/lot of drafts/.test(r.body.error));

        // errors keep their words but never provider text
        const old = draftCalls.length;
        draftMode = 'no-facts';
        pool.db.briefs[0].selectedArticleIds = runArts.slice(0, 2);
        // (the hourly cap is full, so use a second person to reach the model)
        pool.db.briefs.push({ ...pool.db.briefs[0], id: 951, userId: 2 });
        const own2 = pool.db.topics.find((t) => t.userId === 2); const run2 = pool.db.runs.find((x) => x.userId === 2);
        assert.ok(own2 && run2, 'a second person has a search to use');
        {
          pool.db.briefs[1].runId = run2.id;
          r = await call('POST', '/briefs/951/draft', {}, 2);
          assert.strictEqual(r.status, 400);
          draftMode = 'secret';
          r = await call('POST', '/briefs/951/draft', {}, 2);
          assert.deepStrictEqual([r.status, /secret-host|ECONNREFUSED/.test(JSON.stringify(r.body))], [500, false]);
        }
        draftMode = 'ok';
        assert.ok(draftCalls.length >= old);

        // over the monthly limit: refused before the model
        await call('PUT', '/settings', { monthlyBudgetUsd: 0.01 });
        const before = draftCalls.length;
        r = await call('POST', '/briefs/950/draft', {});
        assert.strictEqual(r.status, 402);
        assert.strictEqual(draftCalls.length, before, 'no model call when over the limit');
        await call('PUT', '/settings', { monthlyBudgetUsd: 20 });

        // delete -> the bin, with an id; gone after; undo path is the adapter's
        const binBefore = pool.bin.length;
        const victim = (await call('GET', '/briefs/950/drafts')).body.drafts[0];
        assert.strictEqual((await call('DELETE', `/drafts/${victim.id}`, undefined, 2)).status, 404, "not someone else's");
        r = await call('DELETE', `/drafts/${victim.id}`);
        assert.deepStrictEqual([r.status, r.body.ok, typeof r.body.binId], [200, true, 'string']);
        assert.deepStrictEqual([pool.bin[binBefore].type, /^Draft: A working title/.test(pool.bin[binBefore].title), pool.bin[binBefore].payload.draft.id], ['topic-research-draft', true, victim.id]);
        assert.strictEqual((await call('GET', `/drafts/${victim.id}`)).status, 404);
        assert.strictEqual((await call('DELETE', `/drafts/${victim.id}`)).status, 404, 'a second delete');

        // deleting the brief carries its drafts into the bin payload
        const briefBin = pool.bin.length;
        r = await call('DELETE', '/briefs/950');
        assert.strictEqual(r.status, 200);
        assert.ok(pool.bin[briefBin].payload.drafts.length >= 1 && /draft/.test(pool.bin[briefBin].detail), 'the brief and its drafts travel together');

        pool.db.briefs.splice(0, pool.db.briefs.length, ...stash);
        pool.db.drafts = [];
      }

      // ---------------------------------------------------------------- relevance check before a brief (M7)
      {
        const arts = (await call('GET', `/runs/${runForBriefHist}`)).body.articles.map((a) => a.id);
        assert.strictEqual((await call('POST', '/runs/abc/relevance', { articleIds: arts })).status, 404);
        assert.strictEqual((await call('POST', '/runs/99999/relevance', { articleIds: arts })).status, 404);
        assert.strictEqual((await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts }, 2)).status, 404, "someone else's search");
        for (const bad of [{}, { articleIds: [] }, { articleIds: 'x' }, { articleIds: [0] }, { articleIds: [1.5] }, { articleIds: Array.from({ length: 13 }, (_, i) => i + 1) }]) assert.strictEqual((await call('POST', `/runs/${runForBriefHist}/relevance`, bad)).status, 400, JSON.stringify(bad).slice(0, 40));
        assert.strictEqual((await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: [987654] })).status, 400, 'an article that is not part of the search');
        assert.strictEqual(relevanceCalls.length, 0, 'the model was never asked for a refused request');
        let r = await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts });
        assert.deepStrictEqual([r.status, r.body.relevance.verdict, r.body.relevance.message, r.body.relevance.scores.length], [200, 'good', '', arts.length]);
        const sent = relevanceCalls[relevanceCalls.length - 1];
        assert.deepStrictEqual([sent.userId, sent.topic.keyword, sent.articles.length > 0, Object.keys(sent.articles[0]).sort()], [1, 'heat pumps', true, ['domain', 'id', 'snippet', 'text', 'title']]);
        relevanceMode = 'poor';
        r = await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts });
        assert.deepStrictEqual([r.body.relevance.verdict, /not about/.test(r.body.relevance.message)], ['poor', true]);
        relevanceMode = 'secret';
        r = await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts });
        assert.deepStrictEqual([r.status, /secret-host|ECONNREFUSED/.test(JSON.stringify(r.body))], [500, false], 'provider text never reaches the page');
        relevanceMode = 'no-model';
        assert.strictEqual((await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts })).status, 503);
        relevanceMode = 'ok';
        // the hourly cap (5 here; four attempts so far counted)
        assert.strictEqual((await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts })).status, 200);
        r = await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts });
        assert.strictEqual(r.status, 429);
        assert.ok(/lot of checks/.test(r.body.error));
        // over the monthly limit: refused before the model; the cost of earlier checks counts towards it
        clockShift += 2 * 3600000;
        pool.db.checks = [{ userId: 1, costUsd: 0.6, createdAt: new Date(NOW + clockShift) }];
        assert.ok(((await call('GET', '/usage')).body.usage.checkUsd) >= 0.6 - 1e-9, 'small checks count towards this month');
        await call('PUT', '/settings', { monthlyBudgetUsd: 0.5 });
        const before = relevanceCalls.length;
        assert.strictEqual((await call('POST', `/runs/${runForBriefHist}/relevance`, { articleIds: arts })).status, 402);
        assert.strictEqual(relevanceCalls.length, before, 'no model call when over the limit');
        await call('PUT', '/settings', { monthlyBudgetUsd: 20 });
        pool.db.checks = [];
      }

      // ---------------------------------------------------------------- other ways to word the topic (M7)
      {
        clockShift += 2 * 3600000; // the hourly check cap starts again
        for (const bad of [{}, { keyword: '' }, { keyword: '   ' }, { keyword: 'the of' }, { keyword: 42 }]) assert.strictEqual((await call('POST', '/suggest-queries', bad)).status, 400, JSON.stringify(bad));
        assert.strictEqual(suggestCalls.length, 0, 'the model was never asked for a refused request');
        let r = await call('POST', '/suggest-queries', { keyword: '  motors   for walk in wine cabinets ' });
        assert.deepStrictEqual([r.status, r.body.queries], [200, ['wine cellar cooling unit', 'wine room refrigeration']]);
        assert.deepStrictEqual([suggestCalls[0].userId, suggestCalls[0].keyword, typeof suggestCalls[0].niche], [1, 'motors for walk in wine cabinets', 'string'], 'the cleaned topic and the site description go to the model');
        suggestMode = 'no-model';
        assert.strictEqual((await call('POST', '/suggest-queries', { keyword: 'wine cellars' })).status, 503);
        suggestMode = 'ok';
        for (let i = 0; i < 3; i += 1) assert.strictEqual((await call('POST', '/suggest-queries', { keyword: 'wine cellars' })).status, 200);
        r = await call('POST', '/suggest-queries', { keyword: 'wine cellars' });
        assert.strictEqual(r.status, 429, 'the hourly cap (5, counted with the relevance checks)');
        clockShift += 2 * 3600000;
        await call('PUT', '/settings', { monthlyBudgetUsd: 0.01 });
        pool.db.checks = [{ userId: 1, costUsd: 0.5, createdAt: new Date(NOW + clockShift) }];
        const before = suggestCalls.length;
        assert.strictEqual((await call('POST', '/suggest-queries', { keyword: 'wine cellars' })).status, 402);
        assert.strictEqual(suggestCalls.length, before, 'no model call over the limit');
        await call('PUT', '/settings', { monthlyBudgetUsd: 20 });
        pool.db.checks = [];

        // extra phrasings saved on a topic and used by its searches
        r = await call('POST', '/topics', { keyword: 'wine cellar basics', extraQueries: ['wine cellar cooling unit', 'Wine Cellar Cooling Unit', 'wine cellar basics', '  ', 'wine room refrigeration'] });
        assert.strictEqual(r.status, 201);
        assert.deepStrictEqual(r.body.topic.extraQueries, ['wine cellar cooling unit', 'wine room refrigeration'], 'cleaned: no duplicates, not the topic itself, no blanks');
        assert.deepStrictEqual(r.body.run.id > 0 && (await call('GET', `/runs/${r.body.run.id}`)).body.run.queries, ['wine cellar basics', 'wine cellar cooling unit', 'wine room refrigeration'], 'the run says which phrasings it asked');
        const newId = r.body.topic.id;
        assert.deepStrictEqual((await call('GET', '/topics')).body.topics.find((t) => t.id === newId).extraQueries, ['wine cellar cooling unit', 'wine room refrigeration'], 'the topic list carries them');
        r = await call('POST', `/topics/${newId}/run`, {});
        assert.deepStrictEqual((await call('GET', `/runs/${r.body.run.id}`)).body.run.queries.length, 3, 'Search again asks them too');
        // the same words again without extraQueries keeps the saved set; with a new set replaces it; with an empty list clears it
        r = await call('POST', '/topics', { keyword: 'wine cellar basics' });
        assert.deepStrictEqual([r.status, r.body.topic.extraQueries.length], [200, 2], 'not sent = unchanged');
        r = await call('POST', '/topics', { keyword: 'wine cellar basics', extraQueries: ['wine cooling'] });
        assert.deepStrictEqual(r.body.topic.extraQueries, ['wine cooling'], 'a new set replaces the old');
        r = await call('POST', '/topics', { keyword: 'wine cellar basics', extraQueries: [] });
        assert.deepStrictEqual(r.body.topic.extraQueries, [], 'an empty list clears it');
        for (const bad of ['wine', { a: 1 }, [5], ['a b', null], ['one phrase', 'two phrase', 'three phrase', 'four phrase']]) assert.strictEqual((await call('POST', '/topics', { keyword: 'wine cellar basics', extraQueries: bad })).status, 400, JSON.stringify(bad));
        assert.strictEqual((await call('GET', '/topics', undefined, 2)).body.topics.some((t) => t.id === newId), false, "someone else's topic phrasings are not visible");
        await call('DELETE', `/topics/${newId}`);
      }

      // ---------------------------------------------------------------- progress steps (M7): where a long action has got to
      {
        assert.strictEqual((await call('GET', '/progress/op-nothing1')).status, 404, 'unknown action');
        assert.strictEqual((await call('GET', '/progress/bad')).status, 404, 'bad id');
        let r = await call('POST', `/topics/${topicId}/run`, { opId: 'op-search01' });
        assert.strictEqual(r.status, 200);
        let p = await call('GET', '/progress/op-search01');
        assert.strictEqual(p.status, 200);
        assert.deepStrictEqual(p.body.steps.map((x) => x.id), ['sources', 'save', 'read', 'rank']);
        assert.strictEqual(p.body.finished, true);
        assert.deepStrictEqual(p.body.steps.map((x) => x.status).filter((x) => x === 'pending'), [], 'nothing is left pending once it has finished');
        assert.match(p.body.steps[0].detail, /source/, 'the sources step says how many were asked');
        assert.strictEqual((await call('GET', '/progress/op-search01', undefined, 2)).status, 404, "somebody else's action is invisible");
        // a request with no opId, or a bad one, works exactly as before
        assert.strictEqual((await call('POST', `/topics/${topicId}/run`, {})).status, 200);
        assert.strictEqual((await call('POST', `/topics/${topicId}/run`, { opId: 'x y' })).status, 200);
        assert.strictEqual((await call('GET', '/progress/x y')).status, 404);
        // brief and draft (two hours later: the hourly caps start again)
        clockShift += 2 * 3600000;
        const stash2 = pool.db.briefs.splice(0, pool.db.briefs.length);
        const arts = (await call('GET', `/runs/${runForBriefHist}`)).body.articles.map((a) => a.id);
        r = await call('POST', `/runs/${runForBriefHist}/brief`, { articleIds: arts.slice(0, 2), opId: 'op-brief001' });
        assert.strictEqual(r.status, 201);
        p = await call('GET', '/progress/op-brief001');
        assert.deepStrictEqual([p.body.steps.map((x) => x.id), p.body.steps[0].status, p.body.finished], [['prepare', 'write', 'check'], 'done', true]);
        assert.match(p.body.steps[0].detail, /^\d+ articles?$/);
        r = await call('POST', `/briefs/${r.body.brief.id}/draft`, { opId: 'op-draft001' });
        assert.strictEqual(r.status, 201);
        p = await call('GET', '/progress/op-draft001');
        assert.deepStrictEqual([p.body.steps.map((x) => x.id), p.body.finished], [['prepare', 'write', 'check'], true]);
        pool.db.briefs.splice(0, pool.db.briefs.length, ...stash2);
        pool.db.drafts = [];
      }

      // delete -> the recycle bin gets the topic, its runs, links and briefs, then the topic is gone
      const binAtStart = pool.bin.length;
      pool.binFail = true;
      assert.strictEqual((await call('DELETE', `/topics/${topicId}`)).status, 500);
      assert.strictEqual(pool.db.topics.filter((t) => t.userId === 1).length, 1, 'a failed delete keeps the topic');
      pool.binFail = false;
      r = await call('DELETE', `/topics/${topicId}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(pool.bin.length - binAtStart, 2, 'one bin entry per attempt that got as far as the bin (the failed attempt rolled back its transaction)');
      const entry = pool.bin[pool.bin.length - 1];
      assert.strictEqual(entry.type, 'topic-research-topic');
      assert.strictEqual(entry.userId, 1);
      assert.strictEqual(entry.title, 'heat pumps');
      assert.strictEqual(entry.payload.topic.id, topicId);
      assert.ok(entry.payload.runs.length >= 2 && entry.payload.runArticles.length >= 2);
      assert.deepStrictEqual(entry.payload.briefs.map((b) => b.id), [900], 'the briefs of a topic go with it');
      assert.ok(/1 brief/.test(entry.detail));
      assert.strictEqual(pool.db.briefs.filter((b) => b.userId === 1).length, 0, 'and are gone from the live table');
      assert.ok(pool.db.articles.length >= 1, 'the articles stay');
      assert.strictEqual((await call('GET', '/topics')).body.topics.length, 0);
      assert.strictEqual((await call('DELETE', `/topics/${topicId}`)).status, 404);
    } finally {
      await new Promise((res) => server.close(res));
    }
    assert.ok(buildCalls > 0);
  }

  console.log('topicResearch: all passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
