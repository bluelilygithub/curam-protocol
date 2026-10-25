'use strict';

// Topic Research: saved topics, search runs and the articles each run found, plus the person's site profile and feed list.
// Mounted at /api/topic-research behind requireFeature('topicResearch') (server/index.js). Takes the pool as an argument so
// topicResearch.test.js runs without a database. Every query filters by "userId". Docs: docs/topic-research.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getLogger } = require('../middleware/requestContext');
const { loadSettings, saveSettings, validateSettings } = require('../services/topicResearch/settings');
const { DEFAULT_DAYS } = require('../services/topicResearch/collect');
const { searchTopic, sourcesFor: sourcesForSettings } = require('../services/topicResearch/runSearch');
const { monthSpend, overBudgetMessage } = require('../services/topicResearch/spend');
const modelResolver = require('../services/topicResearch/modelResolver');
const { topicTerms } = require('../services/topicResearch/matchTopic');
const { validateSourceWeights, loadSourceWeights, saveSourceWeights } = require('../services/topicResearch/sourceWeights');
const { briefToMarkdown, briefFileName } = require('../services/topicResearch/brief/markdown');
const { draftToMarkdown, draftFileName } = require('../services/topicResearch/draft/markdown');
const { LENGTHS: DRAFT_LENGTHS, DEFAULT_LENGTH: DEFAULT_DRAFT_LENGTH } = require('../services/topicResearch/draft/schema');
const { aiLimiter } = require('../middleware/aiRateLimit');

const MAX_TOPICS_PER_USER = 200;
const DRAFT_BIN_TYPE = 'topic-research-draft';
const MAX_STEER = 200;
const DRAFTS_PER_HOUR = 10;
const MAX_KEYWORD = 120;
const BIN_TYPE = 'topic-research-topic'; // the shared recycle bin kind (server/services/recycleBin/adapters/topicResearch.js)
const BRIEF_BIN_TYPE = 'topic-research-brief';
const MAX_INT = 2147483647;
const MAX_BRIEF_ARTICLES = 12;
const MAX_ANGLE = 200;
const BRIEFS_PER_HOUR = 20;
const HISTORY_LIMIT = 100;
const REFRESH_CHOICES = [6, 12, 24, 48, 168]; // hours a watchlist topic waits between searches (168 = weekly)

const iso = (d) => (d ? new Date(d).toISOString() : null);
const parseId = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_INT ? n : null;
};
const cleanKeyword = (raw) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_KEYWORD) : '');

const topicWire = (r) => ({
  id: r.id, keyword: r.keyword, region: r.region, language: r.language, onWatchlist: r.onWatchlist === true, refreshHours: r.refreshHours, createdAt: iso(r.createdAt),
});

function createRouter(pool, {
  // the sources for one run, built from the person's settings and the server's keys (services/topicResearch/sources/index.js). May return
  // { sources, status } or just the list of sources (tests do).
  buildSources = undefined, // default (runSearch.js): services/topicResearch/sources buildSources
  getBin = () => { require('../services/recycleBin/adapters'); return require('../services/recycleBin'); },
  now = () => Date.now(),
  limits = {},
  // after the sources answer: read the best pages, group the stories, rank (analyse.js). Injected so the route tests need no pages or SQL for it.
  analyse = undefined, // default (runSearch.js): the shared page reader + analyseRun
  rescore = (args) => require('../services/topicResearch/analyse').rescoreRun(args),
  isStale = (...args) => require('../services/topicResearch/analyse').isStale(...args),
  // write a research brief (brief/generate.js). Injected so the route tests need no model.
  makeBrief = (input) => require('../services/topicResearch/brief/generate').generateBrief(input),
  // write a first draft from a brief (draft/generate.js). Injected so the route tests need no model.
  makeDraft = (input) => require('../services/topicResearch/draft/generate').generateDraft(input),
  // the per-person limit on model-cost routes (30 a minute for the whole app); tests that make hundreds of calls pass their own
  aiGate = aiLimiter,
  // which model writes briefs: the owner's choice in Settings -> Topic Research (modelResolver.js). Injected so tests need no database.
  modelApi = modelResolver,
} = {}) {
  const router = express.Router();
  const briefsRunning = new Set(); // "brief:userId:runId" / "draft:userId:briefId" with one being written: a second press answers 409 instead of writing two

  // A run asks many feeds and writes many rows, so keep one person from hammering it.
  router.use(rateLimit({
    windowMs: 60 * 1000, max: limits.perMinute ?? 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: 'Too many requests, please wait a minute.' },
  }));

  // the same search the watchlist job runs (services/topicResearch/runSearch.js), with this router's injected pieces for tests
  const search = async (userId, topic, days, refresh) => {
    const out = await searchTopic({ pool, userId, topic, days, refresh, now, buildSources, analyse });
    const { spend, ...wire } = out;
    return { ...wire, budgetOver: spend.over };
  };
  /** This person's spending this month against their limit (the banner, the paused sources, refused briefs). */
  const spendFor = async (userId) => monthSpend(pool, userId, (await loadSettings(pool, userId)).monthlyBudgetUsd, { now });

  async function ownTopic(userId, id) {
    const { rows } = await pool.query(`SELECT * FROM topic_research_topics WHERE id = $1 AND "userId" = $2`, [id, userId]);
    return rows[0] || null;
  }

  function fail(res, err, what) {
    // errors we raised ourselves carry a status and a message written for the person (never provider text, a prompt or article text)
    if (err && [400, 402, 409, 502, 503].includes(err.status)) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err }, `topic research ${what} failed`); // never the topic words
    return res.status(500).json({ error: `Could not ${what}.` });
  }

  // GET /settings, PUT /settings: site profile + feed list
  router.get('/settings', async (req, res) => {
    try { res.json({ settings: await loadSettings(pool, req.user.id) }); } catch (err) { fail(res, err, 'load your settings'); }
  });
  router.put('/settings', async (req, res) => {
    try {
      const current = await loadSettings(pool, req.user.id);
      const out = validateSettings(req.body, current);
      if (out.error) return res.status(400).json({ error: out.error });
      await saveSettings(pool, req.user.id, out.value);
      res.json({ settings: out.value });
    } catch (err) { fail(res, err, 'save your settings'); }
  });

  // GET /source-weights, PUT /source-weights { weights: [{ domain, weight, note }] }: the owner's own weight for each outlet (replaces the whole list)
  router.get('/source-weights', async (req, res) => {
    try { res.json({ weights: await loadSourceWeights(pool, req.user.id) }); } catch (err) { fail(res, err, 'load your outlet weights'); }
  });
  router.put('/source-weights', async (req, res) => {
    try {
      const out = validateSourceWeights(req.body?.weights);
      if (out.error) return res.status(400).json({ error: out.error });
      await saveSourceWeights(pool, req.user.id, out.value);
      res.json({ weights: out.value });
    } catch (err) { fail(res, err, 'save your outlet weights'); }
  });

  // GET /sources: which sources are on for this person, and for each that is off, why (the Sources box in Settings)
  router.get('/sources', async (req, res) => {
    try {
      const settings = await loadSettings(pool, req.user.id);
      const spend = await monthSpend(pool, req.user.id, settings.monthlyBudgetUsd, { now });
      res.json({ sources: (await sourcesForSettings(settings, { buildSources, budgetOver: spend.over })).status });
    } catch (err) { fail(res, err, 'check the sources'); }
  });

  // GET /topics: newest first, each with its latest run
  router.get('/topics', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT t.id, t.keyword, t.region, t.language, t."onWatchlist", t."refreshHours", t."createdAt",
                r.id AS "lastRunId", r.status AS "lastStatus", r."finishedAt" AS "lastRunAt", r."heatJson" AS "lastHeat",
                (SELECT COUNT(*) FROM topic_research_run_articles ra WHERE ra."runId" = r.id) AS "articleCount"
           FROM topic_research_topics t
           LEFT JOIN LATERAL (SELECT id, status, "finishedAt", "heatJson" FROM topic_research_runs WHERE "topicId" = t.id ORDER BY "startedAt" DESC, id DESC LIMIT 1) r ON TRUE
          WHERE t."userId" = $1 ORDER BY t."createdAt" DESC, t.id DESC LIMIT ${MAX_TOPICS_PER_USER}`,
        [req.user.id],
      );
      const heatWire = (v) => { const h = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v; return h && h.label ? { label: h.label, value: Number(h.value) || 0 } : null; };
      res.json({ topics: rows.map((r) => ({ ...topicWire(r), lastRun: r.lastRunId ? { id: r.lastRunId, status: r.lastStatus, finishedAt: iso(r.lastRunAt), articleCount: Number(r.articleCount), heat: heatWire(r.lastHeat) } : null })) });
    } catch (err) { fail(res, err, 'load your topics'); }
  });

  // POST /topics { keyword, days? }: save the topic (or reuse it if the same words are already saved) and search it now
  router.post('/topics', async (req, res) => {
    const keyword = cleanKeyword(req.body?.keyword);
    if (!keyword) return res.status(400).json({ error: 'Type a topic to search for, for example: heat pumps Queensland.' });
    if (!topicTerms(keyword).length) return res.status(400).json({ error: 'That topic has no searchable words. Try something more specific.' });
    try {
      let topic = (await pool.query(`SELECT * FROM topic_research_topics WHERE "userId" = $1 AND lower(keyword) = lower($2)`, [req.user.id, keyword])).rows[0];
      let created = false;
      if (!topic) {
        const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*) AS n FROM topic_research_topics WHERE "userId" = $1`, [req.user.id]);
        if (Number(n) >= MAX_TOPICS_PER_USER) return res.status(409).json({ error: `You have ${MAX_TOPICS_PER_USER} saved topics. Delete some to add more.` });
        const settings = await loadSettings(pool, req.user.id);
        topic = (await pool.query(
          `INSERT INTO topic_research_topics ("userId", keyword, region) VALUES ($1, $2, $3) RETURNING *`,
          [req.user.id, keyword, settings.region],
        )).rows[0];
        created = true;
      }
      // typing the same words again may use saved answers; only "Search again" asks everything afresh
      const run = await search(req.user.id, topic, req.body?.days ?? DEFAULT_DAYS, false);
      res.status(created ? 201 : 200).json({ topic: topicWire(topic), run, created });
    } catch (err) { fail(res, err, 'search that topic'); }
  });

  // GET /topics/:id: the topic and its recent runs
  router.get('/topics/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Topic not found.' });
    try {
      const topic = await ownTopic(req.user.id, id);
      if (!topic) return res.status(404).json({ error: 'Topic not found.' });
      const { rows } = await pool.query(
        `SELECT r.id, r.status, r."startedAt", r."finishedAt",
                (SELECT COUNT(*) FROM topic_research_run_articles ra WHERE ra."runId" = r.id) AS "articleCount"
           FROM topic_research_runs r WHERE r."topicId" = $1 AND r."userId" = $2 ORDER BY r."startedAt" DESC, r.id DESC LIMIT 20`,
        [id, req.user.id],
      );
      res.json({ topic: topicWire(topic), runs: rows.map((r) => ({ id: r.id, status: r.status, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), articleCount: Number(r.articleCount) })) });
    } catch (err) { fail(res, err, 'load that topic'); }
  });

  // POST /topics/:id/run { days? }: search the topic again
  router.post('/topics/:id/run', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Topic not found.' });
    try {
      const topic = await ownTopic(req.user.id, id);
      if (!topic) return res.status(404).json({ error: 'Topic not found.' });
      // "Search again" is a manual refresh: saved answers are skipped (send refresh:false to allow them)
      res.json({ run: await search(req.user.id, topic, req.body?.days ?? DEFAULT_DAYS, req.body?.refresh !== false) });
    } catch (err) { fail(res, err, 'search that topic'); }
  });

  // DELETE /topics/:id: into the shared 30-day recycle bin with its runs; the articles stay (they may belong to other topics' runs too)
  router.delete('/topics/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Topic not found.' });
    let db;
    try {
      const bin = getBin();
      db = await pool.connect();
      await db.query('BEGIN');
      const { rows: [topic] } = await db.query(`SELECT * FROM topic_research_topics WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [id, req.user.id]);
      if (!topic) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Topic not found.' }); }
      const { rows: runs } = await db.query(`SELECT * FROM topic_research_runs WHERE "topicId" = $1 AND "userId" = $2`, [id, req.user.id]);
      const { rows: runArticles } = await db.query(
        `SELECT ra.* FROM topic_research_run_articles ra JOIN topic_research_runs r ON r.id = ra."runId" WHERE r."topicId" = $1 AND r."userId" = $2`,
        [id, req.user.id],
      );
      const { rows: briefs } = runs.length
        ? await db.query(`SELECT * FROM topic_research_briefs WHERE "runId" = ANY($1::int[]) AND "userId" = $2`, [runs.map((r) => r.id), req.user.id])
        : { rows: [] };
      const { rows: drafts } = briefs.length
        ? await db.query(`SELECT * FROM topic_research_drafts WHERE "briefId" = ANY($1::int[]) AND "userId" = $2`, [briefs.map((b) => b.id), req.user.id])
        : { rows: [] };
      const binId = await bin.moveToBin(db, {
        userId: req.user.id, type: BIN_TYPE, id: topic.id, title: topic.keyword,
        detail: `${runs.length} search${runs.length === 1 ? '' : 'es'}${briefs.length ? `, ${briefs.length} brief${briefs.length === 1 ? '' : 's'}` : ''}${drafts.length ? `, ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : ''}`,
        payload: { topic, runs, runArticles, briefs, drafts },
      });
      await db.query(`DELETE FROM topic_research_topics WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      await db.query('COMMIT');
      res.json({ ok: true, binId });
    } catch (err) {
      if (db) await db.query('ROLLBACK').catch(() => {});
      fail(res, err, 'delete that topic');
    } finally { if (db) db.release(); }
  });

  // POST /runs/:id/rescore: rank a stored search again with the settings as they are now (no fetching). Groups it first if it never was.
  router.post('/runs/:id/rescore', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Search not found.' });
    try {
      const { rows: [run] } = await pool.query(`SELECT * FROM topic_research_runs WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      if (!run) return res.status(404).json({ error: 'Search not found.' });
      const topic = await ownTopic(req.user.id, run.topicId);
      const out = await rescore({ pool, userId: req.user.id, runId: id, topic, now });
      res.json({ ok: true, stories: out.stories, heat: out.heat });
    } catch (err) { fail(res, err, 're-rank that search'); }
  });

  // GET /runs/:id: one search: its stories and articles best first (with each score's breakdown), how each source went, the topic's heat.
  // Page text is never sent, only whether the page was read.
  router.get('/runs/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Search not found.' });
    try {
      const { rows: [run] } = await pool.query(`SELECT * FROM topic_research_runs WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      if (!run) return res.status(404).json({ error: 'Search not found.' });
      const topic = await ownTopic(req.user.id, run.topicId);
      const { rows } = await pool.query(
        `SELECT a.id, a.url, a.title, a.domain, a."publishedAt", a.snippet, a."extractStatus", ra.score, ra."isOriginal", ra."serpRank", ra."clusterId", ra."signalsJson", ra."breakdownJson"
           FROM topic_research_run_articles ra JOIN topic_research_articles a ON a.id = ra."articleId"
          WHERE ra."runId" = $1 AND a."userId" = $2
          ORDER BY ra.score DESC NULLS LAST, a."publishedAt" DESC NULLS LAST, a.id DESC LIMIT 300`,
        [id, req.user.id],
      );
      const json = (v, fallback) => {
        if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
        return v ?? fallback;
      };
      const errors = json(run.errorsJson, []);
      const sources = json(run.sourcesJson, []);
      const extras = json(run.extrasJson, null);
      const articles = rows.map((a) => ({
        id: a.id, url: a.url, title: a.title, domain: a.domain, publishedAt: iso(a.publishedAt), snippet: a.snippet,
        score: a.score == null ? null : Number(a.score), isOriginal: a.isOriginal === true, serpRank: a.serpRank, clusterId: a.clusterId,
        signals: json(a.signalsJson, {}), breakdown: json(a.breakdownJson, null), pageRead: a.extractStatus || null,
      }));
      // stories: the groups the articles were put into, best first (the articles are already best first)
      const byStory = new Map();
      for (const a of articles) {
        if (a.clusterId == null) continue;
        if (!byStory.has(a.clusterId)) byStory.set(a.clusterId, []);
        byStory.get(a.clusterId).push(a);
      }
      const stories = [...byStory.entries()].sort(([x], [y]) => x - y).map(([storyId, list]) => ({
        id: storyId, outlets: new Set(list.map((a) => a.domain)).size, bestScore: Math.max(...list.map((a) => a.score ?? 0)),
        originalId: list.find((a) => a.isOriginal)?.id ?? null, articleIds: list.map((a) => a.id),
      }));
      res.json({
        run: {
          id: run.id, topicId: run.topicId, status: run.status, startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt),
          errors: Array.isArray(errors) ? errors : [], sources: Array.isArray(sources) ? sources : [],
          extras: extras && typeof extras === 'object' ? extras : { peopleAlsoAsk: [], relatedSearches: [] },
          costUsd: Number(run.apiCostEstimate) || 0,
          ranking: json(run.weightsJson, null), heat: json(run.heatJson, null),
          // true when the stored scores came from different settings (or were never made): the page asks for a re-rank
          weightsStale: await isStale(pool, req.user.id, run),
        },
        topic: topic ? topicWire(topic) : null,
        stories,
        articles,
      });
    } catch (err) { fail(res, err, 'load that search'); }
  });

  // ---- research briefs -------------------------------------------------------------------------------------------------------------------
  const asJson = (v, fallback) => {
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
    return v ?? fallback;
  };
  const briefHits = new Map(); // userId -> timestamps of this hour's brief requests (a model call costs money, so the cap counts attempts)
  const draftHits = new Map(); // the same for drafts

  /** The articles a brief cites, in citation order (the order they were given to the model); articles since deleted are simply missing. */
  async function sourcesOf(userId, ids) {
    if (!ids.length) return [];
    const { rows } = await pool.query(
      `SELECT a.id, a.url, a.title, a.domain FROM topic_research_articles a WHERE a.id = ANY($1::int[]) AND a."userId" = $2`,
      [ids, userId],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => ({ id: r.id, url: r.url, title: r.title, domain: r.domain }));
  }

  async function briefWire(row, keyword, sources) {
    const content = asJson(row.contentJson, null);
    const overlap = asJson(row.overlapJson, []);
    return {
      id: row.id, runId: row.runId, topicId: row.topicId ?? null, keyword, fileName: briefFileName(keyword, row.createdAt), angle: row.angle, chosenAngle: content?.chosenAngle || '',
      content, overlap, sources, model: row.model, costUsd: Number(row.costUsd) || 0,
      inputTokens: row.inputTokens, outputTokens: row.outputTokens, createdAt: iso(row.createdAt),
      markdown: content ? briefToMarkdown(content, { keyword, createdAt: row.createdAt, overlap, sources }) : '',
    };
  }

  // POST /runs/:id/brief { articleIds, angle? }: write a research brief from the ticked articles of one search
  router.post('/runs/:id/brief', aiGate, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Search not found.' });
    const rawIds = Array.isArray(req.body?.articleIds) ? req.body.articleIds : null;
    const ids = rawIds ? [...new Set(rawIds.map(Number))] : [];
    if (!rawIds || !ids.length || ids.length > MAX_BRIEF_ARTICLES || !ids.every((n) => Number.isInteger(n) && n > 0 && n <= MAX_INT)) {
      return res.status(400).json({ error: `Tick between 1 and ${MAX_BRIEF_ARTICLES} articles to write a brief from.` });
    }
    const angleRaw = req.body?.angle;
    if (angleRaw !== undefined && angleRaw !== null && typeof angleRaw !== 'string') return res.status(400).json({ error: 'The angle must be text.' });
    const angle = typeof angleRaw === 'string' ? angleRaw.replace(/\s+/g, ' ').trim() : '';
    if (angle.length > MAX_ANGLE) return res.status(400).json({ error: `Keep the angle to ${MAX_ANGLE} characters or fewer.` });

    const key = `brief:${req.user.id}:${id}`;
    let held = false;
    try {
      const { rows: [run] } = await pool.query(`SELECT * FROM topic_research_runs WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      if (!run) return res.status(404).json({ error: 'Search not found.' });
      if (briefsRunning.has(key)) return res.status(409).json({ error: 'A brief for this search is already being written.' });
      const spend = await spendFor(req.user.id);
      if (spend.over) return res.status(402).json({ error: overBudgetMessage(spend), spend });
      const t = now();
      const mine = (briefHits.get(req.user.id) || []).filter((x) => t - x < 3600000);
      if (mine.length >= (limits.briefsPerHour ?? BRIEFS_PER_HOUR)) { res.set('Retry-After', '600'); return res.status(429).json({ error: 'That is a lot of briefs in an hour. Wait a while and try again.' }); }
      const { rows } = await pool.query(
        `SELECT a.id, a.url, a.title, a.domain, a."publishedAt", a.snippet, a."extractedText" AS text, ra.score
           FROM topic_research_run_articles ra JOIN topic_research_articles a ON a.id = ra."articleId"
          WHERE ra."runId" = $1 AND a."userId" = $2 AND a.id = ANY($3::int[])
          ORDER BY ra.score DESC NULLS LAST, a.id`,
        [id, req.user.id, ids],
      );
      if (rows.length !== ids.length) return res.status(400).json({ error: 'One of those articles is not part of this search.' });
      const topic = await ownTopic(req.user.id, run.topicId);
      if (!topic) return res.status(404).json({ error: 'Search not found.' });
      briefsRunning.add(key); held = true;
      mine.push(t); briefHits.set(req.user.id, mine);
      const settings = await loadSettings(pool, req.user.id);
      const out = await makeBrief({
        userId: req.user.id, topic: { keyword: topic.keyword, region: topic.region }, settings, heat: asJson(run.heatJson, null), extras: asJson(run.extrasJson, null), angle,
        articles: rows.map((r) => ({ url: r.url, title: r.title, domain: r.domain, publishedAt: r.publishedAt, score: r.score == null ? null : Number(r.score), snippet: r.snippet || '', text: r.text || '' })),
      });
      const { rows: [saved] } = await pool.query(
        `INSERT INTO topic_research_briefs ("userId", "runId", "selectedArticleIds", angle, "contentJson", "overlapJson", model, "costUsd", "inputTokens", "outputTokens")
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [req.user.id, id, JSON.stringify(rows.map((r) => r.id)), angle, JSON.stringify(out.brief), JSON.stringify(out.overlap), out.model, out.costUsd, out.inputTokens, out.outputTokens],
      );
      const sources = await sourcesOf(req.user.id, rows.map((r) => r.id));
      res.status(201).json({ brief: await briefWire({ ...saved, topicId: run.topicId }, topic.keyword, sources), dropped: out.dropped });
    } catch (err) { fail(res, err, 'write that brief'); } finally { if (held) briefsRunning.delete(key); }
  });

  // GET /runs/:id/briefs: the briefs already written for one search, newest first
  router.get('/runs/:id/briefs', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Search not found.' });
    try {
      const { rows: [run] } = await pool.query(`SELECT id FROM topic_research_runs WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      if (!run) return res.status(404).json({ error: 'Search not found.' });
      const { rows } = await pool.query(
        `SELECT id, angle, "contentJson", "overlapJson", "createdAt", "costUsd" FROM topic_research_briefs WHERE "runId" = $1 AND "userId" = $2 ORDER BY "createdAt" DESC, id DESC LIMIT 50`,
        [id, req.user.id],
      );
      res.json({ briefs: rows.map((r) => {
        const c = asJson(r.contentJson, null);
        return { id: r.id, angle: r.angle, chosenAngle: c?.chosenAngle || '', factCount: c?.keyFacts?.length || 0, overlapCount: asJson(r.overlapJson, []).length, costUsd: Number(r.costUsd) || 0, createdAt: iso(r.createdAt) };
      }) });
    } catch (err) { fail(res, err, 'load the briefs'); }
  });

  // GET /briefs/:id: one brief with its Markdown and the sources it cites
  router.get('/briefs/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Brief not found.' });
    try {
      const { rows: [row] } = await pool.query(
        `SELECT b.*, r."topicId" AS "topicId" FROM topic_research_briefs b JOIN topic_research_runs r ON r.id = b."runId" WHERE b.id = $1 AND b."userId" = $2`,
        [id, req.user.id],
      );
      if (!row) return res.status(404).json({ error: 'Brief not found.' });
      const topic = await ownTopic(req.user.id, row.topicId);
      const sources = await sourcesOf(req.user.id, asJson(row.selectedArticleIds, []));
      res.json({ brief: await briefWire(row, topic?.keyword || '', sources) });
    } catch (err) { fail(res, err, 'load that brief'); }
  });

  // DELETE /briefs/:id: into the shared 30-day recycle bin
  router.delete('/briefs/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Brief not found.' });
    let db;
    try {
      const bin = getBin();
      db = await pool.connect();
      await db.query('BEGIN');
      const { rows: [row] } = await db.query(`SELECT * FROM topic_research_briefs WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [id, req.user.id]);
      if (!row) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Brief not found.' }); }
      const c = asJson(row.contentJson, null);
      const { rows: drafts } = await db.query(`SELECT * FROM topic_research_drafts WHERE "briefId" = $1 AND "userId" = $2`, [id, req.user.id]);
      const binId = await bin.moveToBin(db, {
        userId: req.user.id, type: BRIEF_BIN_TYPE, id: row.id, title: `Brief: ${c?.chosenAngle || row.angle || 'research brief'}`.slice(0, 200),
        detail: `${c?.keyFacts?.length || 0} facts${drafts.length ? `, ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : ''}`, payload: { brief: row, drafts },
      });
      await db.query(`DELETE FROM topic_research_briefs WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      await db.query('COMMIT');
      res.json({ ok: true, binId });
    } catch (err) {
      if (db) await db.query('ROLLBACK').catch(() => {});
      fail(res, err, 'delete that brief');
    } finally { if (db) db.release(); }
  });

  // ---- drafts: a first draft written from one brief ---------------------------------------------------------------------------------------
  const draftWords = (c) => (c?.sections || []).reduce((n, s) => n + s.paragraphs.reduce((m, p) => m + (p.kind === 'gap' ? 0 : String(p.text).split(/\s+/).filter(Boolean).length), 0), 0);
  const draftGaps = (c) => (c?.sections || []).reduce((n, s) => n + s.paragraphs.filter((p) => p.kind === 'gap').length, 0);

  function draftWire(row, keyword, sources, context = {}) {
    const content = asJson(row.contentJson, null);
    const overlap = asJson(row.overlapJson, []);
    return {
      id: row.id, briefId: row.briefId, runId: context.runId ?? null, topicId: context.topicId ?? null, keyword, fileName: draftFileName(keyword, row.createdAt),
      lengthChoice: row.lengthChoice, steer: row.steer, content, overlap, sources, words: draftWords(content), gapCount: draftGaps(content),
      model: row.model, costUsd: Number(row.costUsd) || 0, createdAt: iso(row.createdAt),
      markdown: content ? draftToMarkdown(content, { createdAt: row.createdAt, overlap, sources }) : '',
    };
  }

  // POST /briefs/:id/draft { lengthChoice?, steer? }: write a first draft from one brief (the brief only, never the article text)
  router.post('/briefs/:id/draft', aiGate, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Brief not found.' });
    const lc = req.body?.lengthChoice;
    if (lc !== undefined && lc !== null && !DRAFT_LENGTHS[lc]) return res.status(400).json({ error: 'Choose a short, medium or long draft.' });
    const lengthChoice = lc || DEFAULT_DRAFT_LENGTH;
    const steerRaw = req.body?.steer;
    if (steerRaw !== undefined && steerRaw !== null && typeof steerRaw !== 'string') return res.status(400).json({ error: 'The note must be text.' });
    const steer = typeof steerRaw === 'string' ? steerRaw.replace(/\s+/g, ' ').trim() : '';
    if (steer.length > MAX_STEER) return res.status(400).json({ error: `Keep the note to ${MAX_STEER} characters or fewer.` });

    const key = `draft:${req.user.id}:${id}`;
    let held = false;
    try {
      const { rows: [brief] } = await pool.query(
        `SELECT b.*, r."topicId" AS "topicId" FROM topic_research_briefs b JOIN topic_research_runs r ON r.id = b."runId" WHERE b.id = $1 AND b."userId" = $2`,
        [id, req.user.id],
      );
      if (!brief) return res.status(404).json({ error: 'Brief not found.' });
      if (briefsRunning.has(key)) return res.status(409).json({ error: 'A draft for this brief is already being written.' });
      const spend = await spendFor(req.user.id);
      if (spend.over) return res.status(402).json({ error: overBudgetMessage(spend), spend });
      const t = now();
      const mine = (draftHits.get(req.user.id) || []).filter((x) => t - x < 3600000);
      if (mine.length >= (limits.draftsPerHour ?? DRAFTS_PER_HOUR)) { res.set('Retry-After', '600'); return res.status(429).json({ error: 'That is a lot of drafts in an hour. Wait a while and try again.' }); }
      const topic = await ownTopic(req.user.id, brief.topicId);
      if (!topic) return res.status(404).json({ error: 'Brief not found.' });
      const content = asJson(brief.contentJson, null);
      const ids = asJson(brief.selectedArticleIds, []);
      const sources = await sourcesOf(req.user.id, ids);
      const { rows: articles } = ids.length
        ? await pool.query(`SELECT a.url, a.title, a.snippet, a."extractedText" AS text FROM topic_research_articles a WHERE a.id = ANY($1::int[]) AND a."userId" = $2`, [ids, req.user.id])
        : { rows: [] };
      briefsRunning.add(key); held = true;
      mine.push(t); draftHits.set(req.user.id, mine);
      const settings = await loadSettings(pool, req.user.id);
      const out = await makeDraft({
        userId: req.user.id, topic: { keyword: topic.keyword, region: topic.region }, settings, brief: content, lengthChoice, steer,
        sources: sources.map((s) => ({ url: s.url, title: s.title, domain: s.domain })),
        articles: articles.map((a) => ({ url: a.url, title: a.title, snippet: a.snippet || '', text: a.text || '' })),
      });
      const { rows: [saved] } = await pool.query(
        `INSERT INTO topic_research_drafts ("userId", "briefId", "lengthChoice", steer, "contentJson", "overlapJson", model, "costUsd", "inputTokens", "outputTokens")
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [req.user.id, id, lengthChoice, steer, JSON.stringify(out.draft), JSON.stringify(out.overlap), out.model, out.costUsd, out.inputTokens, out.outputTokens],
      );
      res.status(201).json({ draft: draftWire(saved, topic.keyword, sources, { topicId: brief.topicId, runId: brief.runId }), dropped: out.dropped });
    } catch (err) { fail(res, err, 'write that draft'); } finally { if (held) briefsRunning.delete(key); }
  });

  // GET /briefs/:id/drafts: the drafts already written from this brief, newest first
  router.get('/briefs/:id/drafts', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Brief not found.' });
    try {
      const { rows: [brief] } = await pool.query(`SELECT id FROM topic_research_briefs WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      if (!brief) return res.status(404).json({ error: 'Brief not found.' });
      const { rows } = await pool.query(
        `SELECT id, "lengthChoice", "contentJson", "overlapJson", "createdAt", "costUsd" FROM topic_research_drafts WHERE "briefId" = $1 AND "userId" = $2 ORDER BY "createdAt" DESC, id DESC LIMIT 50`,
        [id, req.user.id],
      );
      res.json({ drafts: rows.map((r) => {
        const c = asJson(r.contentJson, null);
        return { id: r.id, title: c?.title || '', lengthChoice: r.lengthChoice, words: draftWords(c), gapCount: draftGaps(c), overlapCount: asJson(r.overlapJson, []).length, costUsd: Number(r.costUsd) || 0, createdAt: iso(r.createdAt) };
      }) });
    } catch (err) { fail(res, err, 'load the drafts'); }
  });

  // GET /drafts/:id: one draft with its Markdown and the sources it cites
  router.get('/drafts/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Draft not found.' });
    try {
      const { rows: [row] } = await pool.query(
        `SELECT d.*, b."selectedArticleIds" AS "selectedArticleIds", b."runId" AS "runId", r."topicId" AS "topicId"
           FROM topic_research_drafts d JOIN topic_research_briefs b ON b.id = d."briefId" JOIN topic_research_runs r ON r.id = b."runId"
          WHERE d.id = $1 AND d."userId" = $2`,
        [id, req.user.id],
      );
      if (!row) return res.status(404).json({ error: 'Draft not found.' });
      const topic = await ownTopic(req.user.id, row.topicId);
      const sources = await sourcesOf(req.user.id, asJson(row.selectedArticleIds, []));
      res.json({ draft: draftWire(row, topic?.keyword || '', sources, { topicId: row.topicId, runId: row.runId }) });
    } catch (err) { fail(res, err, 'load that draft'); }
  });

  // DELETE /drafts/:id: into the shared 30-day recycle bin
  router.delete('/drafts/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Draft not found.' });
    let db;
    try {
      const bin = getBin();
      db = await pool.connect();
      await db.query('BEGIN');
      const { rows: [row] } = await db.query(`SELECT * FROM topic_research_drafts WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [id, req.user.id]);
      if (!row) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Draft not found.' }); }
      const c = asJson(row.contentJson, null);
      const binId = await bin.moveToBin(db, {
        userId: req.user.id, type: DRAFT_BIN_TYPE, id: row.id, title: `Draft: ${c?.title || 'article draft'}`.slice(0, 200),
        detail: `${draftWords(c)} words`, payload: { draft: row },
      });
      await db.query(`DELETE FROM topic_research_drafts WHERE id = $1 AND "userId" = $2`, [id, req.user.id]);
      await db.query('COMMIT');
      res.json({ ok: true, binId });
    } catch (err) {
      if (db) await db.query('ROLLBACK').catch(() => {});
      fail(res, err, 'delete that draft');
    } finally { if (db) db.release(); }
  });

  // ---- model, spending, watchlist, history -----------------------------------------------------------------------------------------------
  // GET/POST /model-config { modelId }: which of the workspace's connected models writes briefs ('' = use the workspace default)
  router.get('/model-config', async (req, res) => {
    try { res.json(await modelApi.getTopicResearchModelConfig(req.user.id)); } catch (err) { fail(res, err, 'load the model setting'); }
  });
  router.post('/model-config', async (req, res) => {
    try {
      const id = req.body?.modelId;
      if (id !== undefined && id !== null && typeof id !== 'string') return res.status(400).json({ error: 'The model must be text.' });
      res.json(await modelApi.saveTopicResearchModel(req.user.id, id));
    } catch (err) { fail(res, err, 'save the model setting'); }
  });

  // GET /usage: this month's estimated spend against the limit (the banner, the Settings box)
  router.get('/usage', async (req, res) => {
    try { res.json({ usage: await spendFor(req.user.id) }); } catch (err) { fail(res, err, 'load your spending'); }
  });

  // PATCH /topics/:id { onWatchlist?, refreshHours? }: put a topic on the watchlist (it then refreshes by itself) or take it off
  router.patch('/topics/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Topic not found.' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (b.onWatchlist !== undefined && typeof b.onWatchlist !== 'boolean') return res.status(400).json({ error: 'The watchlist choice must be on or off.' });
    if (b.refreshHours !== undefined && !REFRESH_CHOICES.includes(b.refreshHours)) return res.status(400).json({ error: `Refresh every ${REFRESH_CHOICES.join(', ')} hours.` });
    if (b.onWatchlist === undefined && b.refreshHours === undefined) return res.status(400).json({ error: 'Nothing to change.' });
    try {
      const topic = await ownTopic(req.user.id, id);
      if (!topic) return res.status(404).json({ error: 'Topic not found.' });
      const { rows: [saved] } = await pool.query(
        `UPDATE topic_research_topics SET "onWatchlist" = COALESCE($1, "onWatchlist"), "refreshHours" = COALESCE($2, "refreshHours") WHERE id = $3 AND "userId" = $4 RETURNING *`,
        [b.onWatchlist ?? null, b.refreshHours ?? null, id, req.user.id],
      );
      res.json({ topic: topicWire(saved) });
    } catch (err) { fail(res, err, 'change that topic'); }
  });

  // GET /history?q=&type=all|runs|briefs: past searches and briefs, newest first (each list capped at 100)
  router.get('/history', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    const type = ['runs', 'briefs', 'drafts'].includes(req.query.type) ? req.query.type : 'all';
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    try {
      let runs = [];
      let briefs = [];
      let drafts = [];
      if (type === 'all' || type === 'runs') {
        const { rows } = await pool.query(
          `SELECT r.id, r."topicId", t.keyword, r."startedAt", r.status, r."apiCostEstimate" AS cost,
                  (SELECT COUNT(*) FROM topic_research_run_articles ra WHERE ra."runId" = r.id) AS "articleCount"
             FROM topic_research_runs r JOIN topic_research_topics t ON t.id = r."topicId"
            WHERE r."userId" = $1 ${like ? `AND t.keyword ILIKE $2 ESCAPE '\\'` : ''}
            ORDER BY r."startedAt" DESC, r.id DESC LIMIT ${HISTORY_LIMIT}`,
          like ? [req.user.id, like] : [req.user.id],
        );
        runs = rows.map((r) => ({ id: r.id, topicId: r.topicId, keyword: r.keyword, startedAt: iso(r.startedAt), status: r.status, articleCount: Number(r.articleCount), costUsd: Number(r.cost) || 0 }));
      }
      if (type === 'all' || type === 'briefs') {
        const { rows } = await pool.query(
          `SELECT b.id, b."runId", r."topicId", t.keyword, b."createdAt", b."costUsd" AS cost, b."contentJson", b."overlapJson"
             FROM topic_research_briefs b JOIN topic_research_runs r ON r.id = b."runId" JOIN topic_research_topics t ON t.id = r."topicId"
            WHERE b."userId" = $1 ${like ? `AND (t.keyword ILIKE $2 ESCAPE '\\' OR b.angle ILIKE $2 ESCAPE '\\' OR b."contentJson"->>'chosenAngle' ILIKE $2 ESCAPE '\\')` : ''}
            ORDER BY b."createdAt" DESC, b.id DESC LIMIT ${HISTORY_LIMIT}`,
          like ? [req.user.id, like] : [req.user.id],
        );
        briefs = rows.map((r) => {
          const c = asJson(r.contentJson, null);
          return { id: r.id, runId: r.runId, topicId: r.topicId, keyword: r.keyword, chosenAngle: c?.chosenAngle || '', createdAt: iso(r.createdAt), factCount: c?.keyFacts?.length || 0, overlapCount: asJson(r.overlapJson, []).length, costUsd: Number(r.cost) || 0 };
        });
      }
      if (type === 'all' || type === 'drafts') {
        const { rows } = await pool.query(
          `SELECT d.id, d."briefId", b."runId", r."topicId", t.keyword, d."createdAt", d."costUsd" AS cost, d."contentJson", d."overlapJson", d."lengthChoice"
             FROM topic_research_drafts d JOIN topic_research_briefs b ON b.id = d."briefId" JOIN topic_research_runs r ON r.id = b."runId" JOIN topic_research_topics t ON t.id = r."topicId"
            WHERE d."userId" = $1 ${like ? `AND (t.keyword ILIKE $2 ESCAPE '\\' OR d."contentJson"->>'title' ILIKE $2 ESCAPE '\\')` : ''}
            ORDER BY d."createdAt" DESC, d.id DESC LIMIT ${HISTORY_LIMIT}`,
          like ? [req.user.id, like] : [req.user.id],
        );
        drafts = rows.map((r) => {
          const c = asJson(r.contentJson, null);
          return { id: r.id, briefId: r.briefId, runId: r.runId, topicId: r.topicId, keyword: r.keyword, title: c?.title || '', lengthChoice: r.lengthChoice, createdAt: iso(r.createdAt), words: draftWords(c), gapCount: draftGaps(c), overlapCount: asJson(r.overlapJson, []).length, costUsd: Number(r.cost) || 0 };
        });
      }
      res.json({ runs, briefs, drafts });
    } catch (err) { fail(res, err, 'load the history'); }
  });

  return router;
}

module.exports = { createRouter, BIN_TYPE, BRIEF_BIN_TYPE, MAX_TOPICS_PER_USER, MAX_BRIEF_ARTICLES, REFRESH_CHOICES };
