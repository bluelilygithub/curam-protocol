'use strict';

// Code Map → Models, milestone 5: a test set for News digest. Replays saved inputs (topics from the admin's own past digests: the articles
// and the prior-week context are already in the database) through the current model and a candidate, scores both, and says whether the
// candidate gives the same quality. Run only when an admin presses the button, never on a schedule. Recommends only; changes no setting.
//
//   cases     up to 20 topic-days from the last 60 days with at least 3 articles, newest first, one per topic before any topic repeats
//   per case  the exact News digest prompt (newsAnalysisService buildPrompt) to the current model and to the candidate, then one call to
//             the workspace standard model as a blind judge (answers labelled A and B in random order). About 3 calls a case.
//   scoring   code checks (readable JSON, required sections, source numbers point at real articles, summary length) and the judge's
//             better / same / worse. "Same quality" needs at least MIN_JUDGED judged cases, the candidate passing at least as many code
//             checks as the current model, and the judge rating it as good or better on at least GOOD_SHARE of the judged cases.
//   storage   code_map_model_tests, last 10 kept (analysis output, deleted outright). The next Models check attaches the newest result to
//             the tool row and to a "worth trialling" or "newer model" finding for the same pair of models (check.js attachTests).
//   usage     logged as code_map_models_test (Code Map in Usage), so each run's cost shows there too.
// Injectable (pool, getModels, getCatalog, newsModels, context, callModel, logUsage, cost, rand) so the test needs no database or model.
// See docs/code-map.md "Models".

const TOOL = 'newsDigest';
const FEATURE = 'code_map_models_test';
const KEEP = 10;
const MIN_CASES = 3;
const MAX_CASES = 20;
const DEFAULT_CASES = 10;
const MIN_JUDGED = 5;
const GOOD_SHARE = 0.8;
const CONCURRENCY = 2;
const CALL_TIMEOUT_MS = 120000;

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const templateOf = (analysis) => (analysis && analysis.keyStorylines ? 'digest' : 'perspectives');

/** Up to n cases, newest first, one per topic before any topic repeats. rows: [{ id, topicId, date, ... }] newest first. Pure. */
function pickCases(rows, n) {
  const first = [];
  const rest = [];
  const seen = new Set();
  for (const r of rows) (seen.has(r.topicId) ? rest : first).push(r), seen.add(r.topicId);
  return [...first, ...rest].slice(0, n);
}

/** Code checks on one News digest answer. Pure. Returns { ok, passed, total, problems }. */
function codeChecks(analysis, template, articleCount) {
  const problems = [];
  const check = (cond, problem) => { if (!cond) problems.push(problem); };
  const a = analysis && typeof analysis === 'object' ? analysis : null;
  check(a, 'no readable JSON');
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  const summary = a && a.unbiased && a.unbiased.summary;
  check(a && str(summary), 'no unbiased summary');
  check(!str(summary) || (summary.length >= 80 && summary.length <= 1500), 'unbiased summary too short or too long');
  if (template === 'digest') {
    check(a && a.keyStorylines && Array.isArray(a.keyStorylines.keyPoints) && a.keyStorylines.keyPoints.length > 0, 'no key storylines');
  } else {
    check(a && a.left && str(a.left.summary), 'no left summary');
    check(a && a.right && str(a.right.summary), 'no right summary');
    check(a && a.commonGround && typeof a.commonGround === 'object', 'no common ground');
  }
  const max = Math.min(15, articleCount); // the prompt numbers at most 15 articles
  const sections = a ? Object.values(a).filter((s) => s && typeof s === 'object' && 'sourceIndices' in s) : [];
  check(sections.length > 0, 'no source numbers');
  check(sections.every((s) => Array.isArray(s.sourceIndices) && s.sourceIndices.length > 0
    && s.sourceIndices.every((i) => Number.isInteger(i) && i >= 1 && i <= max)), 'a source number does not match an article');
  const total = template === 'digest' ? 6 : 8;
  return { ok: problems.length === 0, passed: total - problems.length, total, problems };
}

// What the judge sees of an answer: the content without the resolved source objects (the numbers are enough, and it saves tokens).
const forJudge = (analysis) => JSON.stringify(analysis, (k, v) => (k === 'sources' ? undefined : v));

function judgePrompt(c, a, b) {
  const list = (c.articles || []).slice(0, 15).map((x, i) => `[${i + 1}] ${x.title} (${x.source || ''})\n    ${String(x.summary || '').slice(0, 400)}`).join('\n');
  return `You are checking two AI-written news briefings about "${c.title}", written from the same articles with the same instructions. Decide which is better, or whether they are about the same.

Judge on: every claim is supported by the articles (anything not in them is a serious fault); it reports the specific development in these articles rather than general background; it fills the requested sections; its source numbers point at articles that support it. Ignore style and length unless they hide content. Call it "same" when the differences are minor.

Articles:
${list}

Answer A:
${a}

Answer B:
${b}

Return ONLY JSON, no fences: {"better": "A" | "B" | "same", "scoreA": 1-5, "scoreB": 1-5, "reason": "one sentence"}`;
}

/** The judge's reply, or null when it is not usable. Pure. */
function parseJudge(text) {
  try {
    const j = JSON.parse(String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim());
    if (!['A', 'B', 'same'].includes(j.better)) return null;
    const score = (v) => (Number.isFinite(Number(v)) ? Math.min(5, Math.max(1, Math.round(Number(v)))) : null);
    return { better: j.better, scoreA: score(j.scoreA), scoreB: score(j.scoreB), reason: String(j.reason || '').slice(0, 400) };
  } catch {
    return null;
  }
}

/** The candidate's rating for one case from the judge's answer and which slot the candidate had. Pure. */
function rateCandidate(judge, candidateSlot) {
  if (!judge) return null;
  if (judge.better === 'same') return 'same';
  return judge.better === candidateSlot ? 'better' : 'worse';
}

/** The verdict over all cases. Pure. cases: [{ current: { checks }, candidate: { checks }, rating }]. */
function verdict(cases, { current, candidate, costCurrent = null, costCandidate = null } = {}) {
  const pass = (side) => cases.filter((c) => c[side] && c[side].checks && c[side].checks.ok).length;
  const curPass = pass('current');
  const candPass = pass('candidate');
  const judged = cases.filter((c) => c.rating);
  const good = judged.filter((c) => c.rating !== 'worse').length;
  const n = cases.length;
  const costShare = costCurrent > 0 && costCandidate != null ? costCandidate / costCurrent : null;
  let label;
  if (judged.length < MIN_JUDGED) label = 'notEnough';
  else if (candPass < curPass) label = 'worse';
  else label = good / judged.length >= GOOD_SHARE ? 'same' : 'worse';
  const head = { same: 'Same quality', worse: 'Worse quality', notEnough: 'Not enough evidence' }[label];
  const cost = costShare == null ? '' : ` It cost ${Math.round(costShare * 100)}% as much as ${current} on these cases.`;
  const text = `${head}: ${candidate} passed the code checks on ${candPass} of ${n} cases (${current}: ${curPass} of ${n}), and the judge rated it as good or better on ${good} of ${judged.length} judged cases.${label === 'notEnough' ? ` At least ${MIN_JUDGED} judged cases are needed.` : ''}${cost}`;
  return { label, text, cases: n, currentPassed: curPass, candidatePassed: candPass, judged: judged.length, goodOrBetter: good, costShare, minJudged: MIN_JUDGED, goodShare: GOOD_SHARE };
}

// Rough tokens for one case: characters / 4 for the articles plus the prompt's fixed text, and a typical answer per template.
function caseTokens(c) {
  const articles = (c.articles || []).slice(0, 15).reduce((n, a) => n + String(a.title || '').length + Math.min(600, String(a.summary || '').length) + 40, 0);
  const output = c.template === 'digest' ? 900 : 1600;
  const input = Math.round((articles + 3500) / 4);
  return { input, output, judgeIn: Math.round(input * 0.8 + output * 2 + 300), judgeOut: 120 };
}

async function eachLimit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

function createModelTests(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../../db').pool),
    getModels: deps.getModels || ((u) => require('../../modelResolver').getModelsForUser(u)),
    getCatalog: deps.getCatalog || (async (u) => {
      const r = require('../../modelResolver');
      const { models } = await r.getVaultModelsConfigForUser(u);
      return models.filter((m) => !r.isNonTextModel(m)).map((m) => String(m.id).trim()).filter(Boolean);
    }),
    newsModels: deps.newsModels || (() => require('../../../cron/newsDigestCron').getConfiguredModels()),
    context: deps.context || ((u, topicId, date) => require('../../../cron/newsDigestCron').fetchTopicContext(u, topicId, date)),
    callModel: deps.callModel || ((...a) => require('../../callModel').callModel(...a)),
    logUsage: deps.logUsage || ((x) => require('../../../utils/logUsage').logUsage(x)),
    cost: deps.cost || ((m, i, o) => require('../../costCalculator').calculateCost(m, i, o)),
    news: deps.news || (() => require('../../newsAnalysisService')),
    rand: deps.rand || Math.random,
    log: deps.log || (() => require('../../../middleware/requestContext').getLogger()),
  };
  const q = (sql, params) => (typeof d.pool === 'function' ? d.pool() : d.pool).query(sql, params);
  const active = new Map(); // test id -> { done, total }
  const running = new Map();

  async function loadRows(userId) {
    const { rows } = await q(
      `SELECT ndt.id, ndt."topicId", nt.title, nd.date::text AS date, ndt.articles, ndt.analysis
         FROM news_digest_topics ndt
         JOIN news_digests nd ON nd.id = ndt."digestId"
         JOIN news_topics nt ON nt.id = ndt."topicId"
        WHERE nd."userId" = $1 AND nd.date >= CURRENT_DATE - 60 AND jsonb_array_length(ndt.articles) >= 3
        ORDER BY nd.date DESC, ndt.id DESC LIMIT 200`, [userId]);
    return rows.map((r) => {
      const articles = parse(r.articles) || [];
      return { id: r.id, topicId: r.topicId, title: r.title, date: r.date, articles, template: templateOf(parse(r.analysis)) };
    });
  }

  /** What a test would run now: the models, how many saved cases there are, calls and approximate cost. */
  async function estimate(userId, { candidate, cases } = {}) {
    const [{ primaryModelId, fallbackModelId }, catalog, tiers, rows] = await Promise.all([d.newsModels(), d.getCatalog(userId), d.getModels(userId), loadRows(userId)]);
    const current = primaryModelId || fallbackModelId || null;
    const judge = (tiers || {}).standard || null;
    const candidates = catalog.filter((m) => m !== current);
    const suggested = (tiers || {}).light && candidates.includes(tiers.light) ? tiers.light : (candidates[0] || null);
    const pick = candidate && candidates.includes(candidate) ? candidate : suggested;
    const n = Math.min(clampCases(cases), rows.length);
    const chosen = pickCases(rows, n);
    let approxCostUsd = null;
    if (current && pick && judge && chosen.length) {
      approxCostUsd = chosen.reduce((sum, c) => {
        const t = caseTokens(c);
        return sum + (d.cost(current, t.input, t.output) || 0) + (d.cost(pick, t.input, t.output) || 0) + (d.cost(judge, t.judgeIn, t.judgeOut) || 0);
      }, 0);
    }
    const latest = await latestDone();
    return {
      tool: TOOL, current, candidate: pick, candidates, suggested, judge, casesAvailable: rows.length, cases: chosen.length,
      calls: chosen.length * 3, approxCostUsd, minCases: MIN_CASES, maxCases: MAX_CASES, defaultCases: DEFAULT_CASES,
      judgeIsTested: Boolean(judge && (judge === current || judge === pick)), lastTestAt: latest ? latest.finishedAt : null,
    };
  }

  async function start(userId, { candidate, cases } = {}) {
    if (active.size) throw httpError(409, 'A model test is already running. Wait for it to finish.', { runningId: [...active.keys()][0] });
    const e = await estimate(userId, { candidate, cases });
    if (!e.current) throw httpError(503, 'News digest has no model set, so there is nothing to compare against.');
    if (!e.judge) throw httpError(503, 'No standard model is set, so nothing can judge the answers.');
    if (!candidate || !e.candidates.includes(candidate)) throw httpError(400, 'Pick a candidate model from the model list (not the current one).');
    if (e.cases < MIN_CASES) throw httpError(409, `News digest needs at least ${MIN_CASES} saved topics with 3 or more articles in the last 60 days; there are ${e.casesAvailable}.`);
    const { rows } = await q(`INSERT INTO code_map_model_tests ("userId", tool, status, current, candidate, judge) VALUES ($1, $2, 'running', $3, $4, $5) RETURNING id`,
      [userId, TOOL, e.current, candidate, e.judge]);
    const id = rows[0].id;
    active.set(id, { done: 0, total: e.cases });
    const p = new Promise((r) => setImmediate(r)).then(() => run(id, userId, { current: e.current, candidate, judge: e.judge, cases: e.cases, judgeIsTested: e.judgeIsTested }))
      .catch((err) => d.log().error({ err, testId: id }, '[codeMapModels] model test crashed'))
      .finally(() => { active.delete(id); running.delete(id); });
    running.set(id, p);
    return id;
  }

  async function run(id, userId, { current, candidate, judge, cases: n, judgeIsTested }) {
    const t0 = Date.now();
    const news = d.news();
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0, cost: { [current]: 0, [candidate]: 0 } };
    const call = async (model, prompt, maxTokens) => {
      const r = await d.callModel(model, prompt, { maxTokens, returnUsage: true, timeoutMs: CALL_TIMEOUT_MS });
      usage.calls += 1;
      usage.inputTokens += r.inputTokens || 0;
      usage.outputTokens += r.outputTokens || 0;
      const c = d.cost(model, r.inputTokens || 0, r.outputTokens || 0) || 0;
      usage.costUsd += c;
      if (model in usage.cost) usage.cost[model] += c; // judge cost is not part of either side's cost
      d.logUsage({ userId, model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, feature: FEATURE });
      return r;
    };
    try {
      const chosen = pickCases(await loadRows(userId), n);
      const results = [];
      let done = 0;
      await eachLimit(chosen, CONCURRENCY, async (c, k) => {
        const context = await d.context(userId, c.topicId, c.date).catch(() => []);
        const prompt = news.buildPrompt(c.title, c.articles, context, c.template);
        const answer = async (model) => {
          try {
            const r = await call(model, prompt, news.maxTokensFor(c.template));
            let analysis = null;
            try { analysis = news.parseJSON(r.text || ''); } catch { /* unreadable: the code checks fail it */ }
            return { analysis, checks: codeChecks(analysis, c.template, c.articles.length), latencyMs: r.latencyMs ?? null };
          } catch (err) {
            return { analysis: null, checks: { ok: false, passed: 0, total: 0, problems: [`call failed: ${String(err.message || err).slice(0, 200)}`] }, error: true };
          }
        };
        const [cur, cand] = await Promise.all([answer(current), answer(candidate)]);
        let judgeOut = null;
        let candidateSlot = null;
        if (cur.analysis && cand.analysis) {
          candidateSlot = d.rand() < 0.5 ? 'A' : 'B';
          const [a, b] = candidateSlot === 'A' ? [cand, cur] : [cur, cand];
          try {
            const r = await call(judge, judgePrompt(c, forJudge(a.analysis), forJudge(b.analysis)), 400);
            judgeOut = parseJudge(r.text);
          } catch (err) {
            d.log().warn({ err, testId: id }, '[codeMapModels] judge call failed');
          }
        }
        results[k] = {
          digestTopicId: c.id, topic: c.title, date: c.date, template: c.template, articles: c.articles.length,
          current: { checks: cur.checks, latencyMs: cur.latencyMs ?? null, summary: cur.analysis?.unbiased?.summary || null },
          candidate: { checks: cand.checks, latencyMs: cand.latencyMs ?? null, summary: cand.analysis?.unbiased?.summary || null },
          candidateSlot, judge: judgeOut, rating: rateCandidate(judgeOut, candidateSlot),
        };
        active.set(id, { done: ++done, total: chosen.length });
      });
      if (!usage.calls) throw new Error('No model call succeeded.');
      const v = verdict(results, { current, candidate, costCurrent: usage.cost[current], costCandidate: usage.cost[candidate] });
      const summary = { ...v, current, candidate, judge, judgeIsTested, tool: TOOL };
      await q(`UPDATE code_map_model_tests SET status = 'done', summary = $2, result = $3, "inputTokens" = $4, "outputTokens" = $5, "costUsd" = $6,
                 "durationMs" = $7, "finishedAt" = NOW() WHERE id = $1`,
      [id, JSON.stringify(summary), JSON.stringify({ cases: results, modelCalls: usage.calls, costBySide: usage.cost }), usage.inputTokens, usage.outputTokens, usage.costUsd, Date.now() - t0]);
    } catch (err) {
      d.log().error({ err, testId: id }, '[codeMapModels] model test failed');
      await q(`UPDATE code_map_model_tests SET status = 'failed', error = $2, "durationMs" = $3, "finishedAt" = NOW() WHERE id = $1`,
        [id, String((err && err.message) || 'The test failed.').slice(0, 1000), Date.now() - t0]);
      return;
    }
    try {
      await q(`DELETE FROM code_map_model_tests WHERE status <> 'running' AND id NOT IN (SELECT id FROM code_map_model_tests ORDER BY id DESC LIMIT $1)`, [KEEP]);
    } catch (err) { d.log().error({ err }, '[codeMapModels] trimming old model tests failed'); }
  }

  const shape = (r) => ({
    ...r, summary: parse(r.summary), ...(r.result !== undefined ? { result: parse(r.result) } : {}),
    costUsd: r.costUsd == null ? null : Number(r.costUsd), progress: active.get(r.id) || null,
  });

  async function latestDone() {
    const { rows } = await q(`SELECT * FROM code_map_model_tests WHERE status = 'done' ORDER BY id DESC LIMIT 1`);
    return rows[0] ? shape(rows[0]) : null;
  }

  async function list() {
    const { rows } = await q(`SELECT id, "userId", tool, status, current, candidate, judge, summary, error, "inputTokens", "outputTokens", "costUsd", "durationMs", "createdAt", "finishedAt"
                                FROM code_map_model_tests ORDER BY id DESC LIMIT $1`, [KEEP]);
    return rows.map(shape);
  }

  async function get(id) {
    const { rows } = await q(`SELECT * FROM code_map_model_tests WHERE id = $1`, [id]);
    return rows[0] ? shape(rows[0]) : null;
  }

  /** The newest finished test per (tool, current, candidate) in the last 90 days, summaries only: for check.js attachTests. */
  async function recent() {
    const { rows } = await q(`SELECT DISTINCT ON (tool, current, candidate) id, tool, current, candidate, summary, "finishedAt"
                                FROM code_map_model_tests WHERE status = 'done' AND "finishedAt" > NOW() - INTERVAL '90 days'
                               ORDER BY tool, current, candidate, id DESC`);
    return rows.map((r) => ({ ...r, summary: parse(r.summary) }));
  }

  return { estimate, start, list, latest: latestDone, get, recent, whenDone: (id) => running.get(id) || Promise.resolve() };
}

function clampCases(n) {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? Math.min(MAX_CASES, Math.max(MIN_CASES, v)) : DEFAULT_CASES;
}

let shared = null;
const instance = () => (shared || (shared = createModelTests()));

module.exports = {
  createModelTests, pickCases, codeChecks, judgePrompt, parseJudge, rateCandidate, verdict, caseTokens, clampCases, templateOf,
  TOOL, FEATURE, MIN_JUDGED, GOOD_SHARE, MIN_CASES, MAX_CASES,
  estimate: (...a) => instance().estimate(...a), start: (...a) => instance().start(...a), list: () => instance().list(),
  latest: () => instance().latest(), get: (id) => instance().get(id), recent: () => instance().recent(),
};
