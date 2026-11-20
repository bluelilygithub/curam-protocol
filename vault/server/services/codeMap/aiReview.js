'use strict';

// Code Map "AI review": for every place the server calls a model, asks the workspace's standard model whether a deterministic approach
// (plain code: regex, parsing, lookups, arithmetic, rules) would do the job as well or better. Runs only when an admin presses the button,
// never on a schedule. See docs/code-map.md "AI review".
//
//   call sites: lines in server/ (not tests) matching SITE_RE, found by plain text search, so a call built some other way is missed
//   one model call per FILE (its call sites and up to 800 lines around them, read through explain.js gatherExcerpts: server/ and
//   client/src/ only), so a file with several calls shares one excerpt
//   a file whose content has not changed since the last finished review reuses that review's verdicts (no model call)
//   the answer is untrusted JSON: verdicts are matched to the real call-site lines, unknown lines are dropped, missing ones are "unclear"
//   one review at a time; the last 10 are kept (deleted outright: analysis output, not user content); high-confidence "replace" verdicts
//   go to the Suggestions inbox once per call site (fingerprint codeMapAi:<file>:<call text>)
//   model: getModelsForUser(userId).standard via callModel; usage logged as code_map_ai_review. No hardcoded model id.
// Injectable (pool, collect, latestRun, getModels, callModel, logUsage, captureIf, gather) so the test needs no database, disk or model.

const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const FEATURE = 'code_map_ai_review';
const KEEP = 10;
const CONCURRENCY = 3;
const SITES_PER_CALL = 4;
const PROMPT_VERSION = 1; // bump when SYSTEM changes, so unchanged files are reviewed again with the new prompt
const SITE_RE = /\bcallModel\s*\(|\.messages\s*\.\s*(create|stream)\s*\(|\.generateContent(Stream)?\s*\(/;
const VERDICTS = ['replace', 'hybrid', 'keep', 'unclear'];
const LEVELS = ['high', 'medium', 'low'];

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const keyOf = (file, text) => `${file}:${sha(String(text).replace(/\s+/g, ' ').trim()).slice(0, 12)}`;

/** Every model call site in server code: { file: [{ line, text }] }, plus each file's hash. Pure. */
function findSites(files) {
  const byFile = {};
  for (const [file, src] of Object.entries(files)) {
    if (!file.startsWith('server/') || /\.(test|spec)\.m?js$/.test(file) || file === 'server/services/callModel.js') continue;
    const lines = String(src).split('\n');
    const sites = [];
    lines.forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || /^(async\s+)?function\s+callModel\b/.test(t) || !SITE_RE.test(l)) return;
      sites.push({ line: i + 1, text: t.slice(0, 200) });
    });
    if (sites.length) byFile[file] = { hash: sha(`${PROMPT_VERSION}\n${src}`), sites };
  }
  return byFile;
}

/** file -> tool id, from a Code Map run's ownership (files no single tool owns come back as null). */
function fileOwners(runResult) {
  const out = {};
  for (const t of (runResult && runResult.tools) || []) for (const f of t.ownedServer || []) out[f] = out[f] ? 'shared' : t.id;
  return out;
}

const SYSTEM = `You review the source code of Vault, a Node/Express web app, for its administrator. Each place listed calls a large language model (LLM). For each one, decide whether the LLM is needed, or whether a deterministic approach (plain code: regex, parsing, a date or number library, a lookup table, arithmetic, sorting, fixed rules, a template) would do the job as well or better.

How to judge:
- "replace": plain code would be as good or better: the output is a fixed set of values, a format, a calculation, a parse of structured or predictable text, a lookup, or text built from a template.
- "hybrid": plain code can handle the common cases and the LLM only the rest (for example a regex first, the LLM when it does not match).
- "keep": the task needs language understanding or writing: open-ended text, summaries, judgement on messy or unpredictable input, conversation.
- "unclear": the excerpt does not show enough (for example the prompt is built in another file). Say what you would need to see.
- Messy input (OCR text, emails, free text typed by people) usually needs the LLM even when the output looks simple. Say so when it applies.
- Use ONLY the code shown. Cite lines as file:line from the excerpts. Never guess at code you were not shown.

Reply with JSON only, no other text, one entry per call site line listed:
{"sites": [{"line": 123, "does": "one sentence: what this call is used for", "verdict": "replace|hybrid|keep|unclear", "confidence": "high|medium|low", "why": "1 to 3 sentences", "alternative": "the deterministic approach, concrete enough to act on, or an empty string for keep", "saving": "high|medium|low", "refs": ["file:line"]}]}
"saving" is how much cost and delay replacing it would save, judged from how often the code looks like it runs and how big the prompt is.`;

function buildPrompt(file, entry, excerpts) {
  return [
    `FILE ${file}`,
    'CALL SITES (line and code)',
    ...entry.sites.map((s) => `- line ${s.line}: ${s.text}`),
    '',
    'EXCERPTS',
    ...(excerpts.length ? excerpts.map((x) => `--- ${x.file} lines ${x.from}-${x.to} ---\n${x.text}`) : ['(the file could not be read)']),
  ].join('\n');
}

/** The model's answer for one file, checked against the real call sites. Untrusted input. */
function normalizeAnswer(raw, file, entry, excerpts) {
  let j = null;
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { j = JSON.parse(s); } catch {
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; } }
  }
  const got = new Map();
  for (const x of (j && Array.isArray(j.sites) ? j.sites : [])) if (x && Number.isInteger(x.line)) got.set(x.line, x);
  const inside = (f, ln) => excerpts.some((x) => x.file === f && ln >= x.from && ln <= x.to);
  const str = (v, n) => String(v || '').slice(0, n).trim();
  return entry.sites.map((site) => {
    const x = got.get(site.line);
    const base = { file, line: site.line, text: site.text, key: keyOf(file, site.text) };
    if (!x) return { ...base, verdict: 'unclear', confidence: 'low', does: '', why: j ? 'The review gave no verdict for this line.' : 'The answer could not be read.', alternative: '', saving: 'low', refs: [] };
    const refs = (Array.isArray(x.refs) ? x.refs : []).map((r) => String(r).trim()).filter((r) => {
      const m = /^((?:server|client\/src)\/[\w./-]+\.\w+):(\d+)$/.exec(r);
      return m && inside(m[1], Number(m[2]));
    }).slice(0, 6);
    return {
      ...base,
      verdict: VERDICTS.includes(x.verdict) ? x.verdict : 'unclear',
      confidence: LEVELS.includes(x.confidence) ? x.confidence : 'low',
      does: str(x.does, 400), why: str(x.why, 1200), alternative: str(x.alternative, 1200),
      saving: LEVELS.includes(x.saving) ? x.saving : 'low',
      refs,
    };
  });
}

async function eachLimit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/**
 * Review every call site. `prev` is the last finished review's result (for reuse). `call(prompt)` -> { text, inputTokens, outputTokens, model }.
 * Returns the result object stored on the review row. A failed file is recorded and the rest carry on.
 */
async function reviewSites({ sites, prev, owners = {}, call, gather, onProgress = () => {}, concurrency = CONCURRENCY }) {
  const before = new Map(((prev && prev.files) || []).filter((f) => !f.error).map((f) => [f.file, f]));
  const files = Object.keys(sites);
  const out = [];
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let done = 0;
  await eachLimit(files, concurrency, async (file) => {
    const entry = sites[file];
    const old = before.get(file);
    const rec = { file, tool: owners[file] || null, hash: entry.hash, reused: false, error: null, sites: [] };
    if (old && old.hash === entry.hash) {
      Object.assign(rec, { reused: true, sites: old.sites });
    } else {
      try {
        // a few sites per call, so each keeps its excerpt inside gatherExcerpts' 800-line cap (chat.js has a dozen)
        for (let i = 0; i < entry.sites.length; i += SITES_PER_CALL) {
          const part = { ...entry, sites: entry.sites.slice(i, i + SITES_PER_CALL) };
          const { excerpts } = gather(part.sites.map((s) => ({ file, line: s.line })));
          const r = await call(buildPrompt(file, part, excerpts));
          usage.inputTokens += Number(r.inputTokens) || 0;
          usage.outputTokens += Number(r.outputTokens) || 0;
          usage.calls++;
          rec.sites.push(...normalizeAnswer(r.text, file, part, excerpts));
        }
      } catch (err) {
        rec.error = String((err && err.message) || 'The review of this file failed.').slice(0, 300);
        rec.sites = entry.sites.map((s) => ({ file, line: s.line, text: s.text, key: keyOf(file, s.text), verdict: 'unclear', confidence: 'low', does: '', why: 'Not reviewed: the model call failed.', alternative: '', saving: 'low', refs: [] }));
      }
    }
    out.push(rec);
    onProgress(++done, files.length);
  });
  out.sort((a, b) => a.file.localeCompare(b.file));
  return { files: out, usage };
}

function summarize(result) {
  const all = result.files.flatMap((f) => f.sites);
  const count = Object.fromEntries(VERDICTS.map((v) => [v, all.filter((s) => s.verdict === v).length]));
  return {
    sites: all.length, files: result.files.length, ...count,
    reusedFiles: result.files.filter((f) => f.reused).length, failedFiles: result.files.filter((f) => f.error).length,
  };
}

function createAiReview(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    // shortcut: reads the source on the main thread (well under a second, admin only); move into worker.js if it ever shows up in latency
    collect: deps.collect || (() => require('./files').collectFiles(ROOT)),
    latestRun: deps.latestRun || (() => require('./jobs').latest()),
    getModels: deps.getModels || ((u) => require('../modelResolver').getModelsForUser(u)),
    callModel: deps.callModel || ((...a) => require('../callModel').callModel(...a)),
    logUsage: deps.logUsage || ((x) => require('../../utils/logUsage').logUsage(x)),
    cost: deps.cost || ((m, i, o) => require('../costCalculator').calculateCost(m, i, o)),
    captureIf: deps.captureIf || ((c, p) => require('../SuggestionService').captureIf(c, p)),
    makeFingerprint: deps.makeFingerprint || ((s, k) => require('../SuggestionService').makeFingerprint(s, k)),
    gather: deps.gather || ((ev) => require('./explain').gatherExcerpts(ev)),
    log: deps.log || (() => require('../../middleware/requestContext').getLogger()),
  };
  const q = (sql, params) => (typeof d.pool === 'function' ? d.pool() : d.pool).query(sql, params);
  const active = new Map(); // review id -> { done, total }
  const running = new Map();
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const busy = (id) => httpError(409, 'An AI review is already running. Wait for it to finish.', { runningId: id || null });

  async function latestDone(withResult = true) {
    const { rows } = await q(`SELECT id, "userId", status, model, summary, ${withResult ? 'result,' : ''} error, "inputTokens", "outputTokens", "costUsd", "durationMs", "createdAt", "finishedAt"
                                FROM code_map_ai_reviews WHERE status = 'done' ORDER BY id DESC LIMIT 1`);
    return rows[0] ? shape(rows[0]) : null;
  }

  const shape = (r) => ({
    ...r, summary: parse(r.summary), ...(r.result !== undefined ? { result: parse(r.result) } : {}),
    costUsd: r.costUsd == null ? null : Number(r.costUsd), progress: active.get(r.id) || null,
  });

  /** What a review would do now: call sites, files, and how many files need a model call (the rest reuse the last review). */
  async function estimate() {
    const sites = findSites(d.collect());
    const prev = await latestDone();
    const before = new Map(((prev && prev.result && prev.result.files) || []).filter((f) => !f.error).map((f) => [f.file, f.hash]));
    const files = Object.keys(sites);
    const changed = files.filter((f) => before.get(f) !== sites[f].hash);
    return {
      files: files.length,
      sites: files.reduce((n, f) => n + sites[f].sites.length, 0),
      toReview: changed.length,
      calls: changed.reduce((n, f) => n + Math.ceil(sites[f].sites.length / SITES_PER_CALL), 0),
      lastReviewAt: prev ? prev.finishedAt : null,
    };
  }

  async function start(userId) {
    if (active.size) throw busy([...active.keys()][0]);
    const modelId = ((await d.getModels(userId)) || {}).standard;
    if (!modelId) throw httpError(503, 'No AI model is set up for this workspace yet.');
    let id;
    try {
      const { rows } = await q(`INSERT INTO code_map_ai_reviews ("userId", status, model) VALUES ($1, 'running', $2) RETURNING id`, [userId, modelId]);
      id = rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw busy();
      throw err;
    }
    active.set(id, { done: 0, total: 0 });
    const p = new Promise((r) => setImmediate(r)).then(() => run(id, userId, modelId))
      .catch((err) => d.log().error({ err, reviewId: id }, '[codeMap] AI review crashed'))
      .finally(() => { active.delete(id); running.delete(id); });
    running.set(id, p);
    return id;
  }

  async function run(id, userId, modelId) {
    const t0 = Date.now();
    let result;
    try {
      const sites = findSites(d.collect());
      const prev = await latestDone();
      const run0 = await d.latestRun().catch(() => null);
      const reviewed = await reviewSites({
        sites, prev: prev && prev.result, owners: fileOwners(run0 && run0.result), gather: d.gather,
        onProgress: (done, total) => active.set(id, { done, total }),
        call: async (prompt) => {
          const r = await d.callModel(modelId, prompt, { system: SYSTEM, maxTokens: 3000, returnUsage: true, timeoutMs: 120000 });
          d.logUsage({ userId, model: r.model || modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens, feature: FEATURE });
          return r;
        },
      });
      const { usage } = reviewed;
      result = { files: reviewed.files, promptVersion: PROMPT_VERSION, modelCalls: usage.calls };
      const summary = summarize(result);
      if (usage.calls === 0 && summary.failedFiles > 0) throw new Error(result.files.find((f) => f.error).error);
      await q(`UPDATE code_map_ai_reviews SET status = 'done', summary = $2, result = $3, "inputTokens" = $4, "outputTokens" = $5, "costUsd" = $6,
                 "durationMs" = $7, "finishedAt" = NOW() WHERE id = $1`,
      [id, JSON.stringify(summary), JSON.stringify(result), usage.inputTokens, usage.outputTokens, d.cost(modelId, usage.inputTokens, usage.outputTokens) || 0, Date.now() - t0]);
    } catch (err) {
      d.log().error({ err, reviewId: id }, '[codeMap] AI review failed');
      await q(`UPDATE code_map_ai_reviews SET status = 'failed', error = $2, "durationMs" = $3, "finishedAt" = NOW() WHERE id = $1`,
        [id, String((err && err.message) || 'The review failed.').slice(0, 1000), Date.now() - t0]);
      return;
    }
    // the review is saved; neither of these may turn it into a failure
    try {
      await q(`DELETE FROM code_map_ai_reviews WHERE status <> 'running' AND id NOT IN (SELECT id FROM code_map_ai_reviews ORDER BY id DESC LIMIT $1)`, [KEEP]);
    } catch (err) { d.log().error({ err }, '[codeMap] trimming old AI reviews failed'); }
    try {
      for (const s of result.files.flatMap((f) => f.sites)) {
        await d.captureIf(s.verdict === 'replace' && s.confidence === 'high', {
          userId, source: 'codeMap', category: 'other',
          fingerprint: d.makeFingerprint('codeMapAi', s.key),
          title: `AI review: plain code could replace the model call in ${s.file}`,
          body: [`${s.file}:${s.line}  ${s.text}`, s.does, s.why, s.alternative ? `Instead: ${s.alternative}` : ''].filter(Boolean).join('\n\n'),
          context: `Code Map AI review #${id}. Open Code Map → AI review for every verdict.`,
        });
      }
    } catch (err) { d.log().error({ err }, '[codeMap] raising AI review items in the inbox failed'); }
  }

  async function list() {
    const { rows } = await q(`SELECT id, "userId", status, model, summary, error, "inputTokens", "outputTokens", "costUsd", "durationMs", "createdAt", "finishedAt"
                                FROM code_map_ai_reviews ORDER BY id DESC LIMIT $1`, [KEEP]);
    return rows.map(shape);
  }

  async function get(id) {
    const { rows } = await q(`SELECT * FROM code_map_ai_reviews WHERE id = $1`, [id]);
    return rows[0] ? shape(rows[0]) : null;
  }

  return { estimate, start, list, latest: () => latestDone(true), get, whenDone: (id) => running.get(id) || Promise.resolve() };
}

module.exports = { createAiReview, findSites, fileOwners, normalizeAnswer, reviewSites, summarize, buildPrompt, keyOf, SYSTEM, FEATURE, SITE_RE, ...createAiReview() };
