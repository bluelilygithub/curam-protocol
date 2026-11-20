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

// ── Kinds. A kind says which files to review, how to ask about one file (one or more model calls) and how to count and raise the answers.
// Results keep the same shape for every kind: { files: [{ file, tool, hash, reused, error, sites: [items] }] } ("sites" holds the items).

const PLAIN = {
  id: 'plainCode',
  feature: FEATURE,
  system: SYSTEM,
  find: findSites,
  calls: (entry) => Math.ceil(entry.sites.length / SITES_PER_CALL),
  async reviewFile(file, entry, { ask, gather }) {
    const items = [];
    // a few sites per call, so each keeps its excerpt inside gatherExcerpts' 800-line cap (chat.js has a dozen)
    for (let i = 0; i < entry.sites.length; i += SITES_PER_CALL) {
      const part = { ...entry, sites: entry.sites.slice(i, i + SITES_PER_CALL) };
      const { excerpts } = gather(part.sites.map((s) => ({ file, line: s.line })));
      items.push(...normalizeAnswer(await ask(buildPrompt(file, part, excerpts)), file, part, excerpts));
    }
    return items;
  },
  failedItems: (file, entry) => entry.sites.map((s) => ({ file, line: s.line, text: s.text, key: keyOf(file, s.text), verdict: 'unclear', confidence: 'low', does: '', why: 'Not reviewed: the model call failed.', alternative: '', saving: 'low', refs: [] })),
  summarize: (result) => summarize(result),
  inbox: (s, id) => (s.verdict === 'replace' && s.confidence === 'high' ? {
    source: 'codeMapAi', category: 'other',
    title: `AI review: plain code could replace the model call in ${s.file}`,
    body: [`${s.file}:${s.line}  ${s.text}`, s.does, s.why, s.alternative ? `Instead: ${s.alternative}` : ''].filter(Boolean).join('\n\n'),
    context: `Code Map AI review #${id}. Open Code Map → AI review for every verdict.`,
  } : null),
};

// AI security review (Security tab, layer 2): every route file, in chunks, read for concrete security problems.
const SEC_FEATURE = 'code_map_ai_security';
const SEC_PROMPT_VERSION = 1;
const SEC_CHUNK = 500; // lines per call
const SEC_HEADER = 40; // the file's first lines (requires, helpers) go with every later chunk
const SEC_CATEGORIES = ['access', 'injection', 'ssrf', 'upload', 'xss', 'secrets', 'validation', 'other'];

const SEC_SYSTEM = `You are a security reviewer for Vault, a Node/Express + PostgreSQL web app, reviewing one route file (or part of one) for its administrator.

How Vault works (use this, do not report it as missing):
- Sign-in: app.use('/api', requireAuth) in server/index.js protects every /api route mounted after it; req.user is the signed-in user. Routes mounted before it are public on purpose and must check their own token or signature. You are told how this file is mounted.
- Admin: requireAdmin on the mount or the route. Feature flags: requireFeature.
- Data ownership: every table with user data has a "userId" column; a query that reads, changes or deletes a row by id must also filter by "userId" (or by a parent the user owns), otherwise one user can reach another's data (IDOR).
- SQL: the pg library with $1 parameters. Text pasted into SQL (template strings with request values) is injection.
- Fetching a web address a person typed must go through safeFetch or htmlFetch.checkSsrf (SSRF guard).
- Uploads: multer into uploads/<projectId>/.

Report only concrete problems you can see in the code shown, each with the line number:
- access: missing ownership check (IDOR), missing admin check on an admin action, a public route without its own check
- injection: SQL, shell command or file path built from request values
- ssrf: a typed web address fetched without the guard
- upload: unchecked file type, size, name or path
- xss: HTML built from user text and sent to a browser
- secrets: keys, tokens or passwords written in code, logged or sent to the client
- validation: missing input checks that lead to real harm (not style)
- other: anything else concrete
Do not report style, missing tests, or things you cannot see (code in other files). If a check might be done in a helper you cannot see, say so in "why" and use confidence "low". An empty list is a good answer.

Reply with JSON only, no other text:
{"findings": [{"line": 123, "severity": "high|medium|low", "category": "access|injection|ssrf|upload|xss|secrets|validation|other", "title": "short summary", "why": "1 to 3 sentences: what an attacker could do", "fix": "the concrete change", "confidence": "high|medium|low"}]}`;

/** Every route file in chunks: { file: { hash, chunks: [{ from, to }] } }. Pure. */
function findRouteFiles(files) {
  const out = {};
  for (const [file, src] of Object.entries(files)) {
    if (!file.startsWith('server/routes/') || /\.(test|spec)\.m?js$/.test(file)) continue;
    const n = String(src).split('\n').length;
    const chunks = [];
    for (let from = 1; from <= n; from += SEC_CHUNK) chunks.push({ from, to: Math.min(n, from + SEC_CHUNK - 1) });
    out[file] = { hash: sha(`${SEC_PROMPT_VERSION}\n${src}`), chunks };
  }
  return out;
}

/** How a route file is mounted in server/index.js, in words for the prompt. */
function mountNote(file, mounts, indexSrc = '') {
  const idx = String(indexSrc).split('\n');
  const mine = mounts.filter((m) => m.modules.includes(file));
  if (!mine.length) return 'Not mounted directly in server/index.js (used by another route file, or mounted through a factory). Assume it sits behind the sign-in unless the code shows otherwise.';
  return mine.map((m) => {
    // a module can export several routers (pcHealth.js .helperRouter): say which one this mount uses, or the model blames the wrong routes
    const pick = /require\([^)]*\)\s*\.\s*(\w+)/.exec(idx[m.line - 1] || '');
    return `${pick ? `Only its ${pick[1]} export is mounted` : 'Mounted'} at ${m.path}: ${m.public ? 'PUBLIC (before the sign-in check)' : 'behind the sign-in check'}${m.admin ? ', admin only' : ''}${m.features.length ? `, feature flag ${m.features.join('/')}` : ''}${m.aiLimiter ? ', AI rate limit' : ''}.`;
  }).join('\n');
}

function numbered(lines, from, to) {
  return lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join('\n');
}

function buildSecurityPrompt(file, src, chunk, mounts, indexSrc = '') {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  return [
    `FILE ${file} (${lines.length} lines; this part: lines ${chunk.from}-${chunk.to})`,
    mountNote(file, mounts, indexSrc),
    ...(chunk.from > 1 ? ['', `--- lines 1-${Math.min(SEC_HEADER, lines.length)} (the top of the file, for context) ---`, numbered(lines, 1, Math.min(SEC_HEADER, lines.length))] : []),
    '', `--- lines ${chunk.from}-${chunk.to} (review these) ---`, numbered(lines, chunk.from, chunk.to),
  ].join('\n');
}

/** The model's findings for one chunk, checked: the line must be inside the chunk; unknown values fall back to safe defaults. */
function normalizeSecurity(raw, file, src, chunk) {
  let j = null;
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { j = JSON.parse(s); } catch {
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; } }
  }
  if (!j || !Array.isArray(j.findings)) throw new Error('The answer could not be read.');
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const str = (v, n) => String(v || '').slice(0, n).trim();
  return j.findings.slice(0, 20).filter((x) => x && Number.isInteger(x.line) && x.line >= chunk.from && x.line <= chunk.to && str(x.title, 200)).map((x) => {
    const text = (lines[x.line - 1] || '').trim().slice(0, 200);
    const title = str(x.title, 200);
    return {
      file, line: x.line, text, title,
      severity: LEVELS.includes(x.severity) ? x.severity : 'low',
      category: SEC_CATEGORIES.includes(x.category) ? x.category : 'other',
      why: str(x.why, 1200), fix: str(x.fix, 1200),
      confidence: LEVELS.includes(x.confidence) ? x.confidence : 'low',
      key: keyOf(file, `${title}|${text}`),
    };
  });
}

const SECURITY = {
  id: 'security',
  feature: SEC_FEATURE,
  system: SEC_SYSTEM,
  find: findRouteFiles,
  calls: (entry) => entry.chunks.length,
  async reviewFile(file, entry, { ask, files, mounts }) {
    const items = [];
    for (const chunk of entry.chunks) items.push(...normalizeSecurity(await ask(buildSecurityPrompt(file, files[file], chunk, mounts, files['server/index.js'])), file, files[file], chunk));
    return items;
  },
  failedItems: () => [],
  summarize: (result) => {
    const all = result.files.flatMap((f) => f.sites);
    return {
      files: result.files.length, findings: all.length,
      high: all.filter((x) => x.severity === 'high').length, medium: all.filter((x) => x.severity === 'medium').length, low: all.filter((x) => x.severity === 'low').length,
      reusedFiles: result.files.filter((f) => f.reused).length, failedFiles: result.files.filter((f) => f.error).length,
    };
  },
  inbox: (x, id) => (x.severity === 'high' && x.confidence === 'high' ? {
    source: 'codeMapAiSec', category: 'alert',
    title: `AI security review: ${x.title} (${x.file})`,
    body: [`${x.file}:${x.line}  ${x.text}`, x.why, x.fix ? `Fix: ${x.fix}` : ''].filter(Boolean).join('\n\n'),
    context: `Code Map AI security review #${id}. Open Code Map → Security for every finding. It is a model's reading of the code: check before changing.`,
  } : null),
};

const KINDS = { plainCode: PLAIN, security: SECURITY };
const kindOf = (id) => {
  const k = KINDS[id || 'plainCode'];
  if (!k) throw httpError(400, 'Unknown review kind.');
  return k;
};

/**
 * Review every file of a kind. `prev` is the last finished review of that kind (unchanged files reuse it). `ask(prompt)` -> answer text.
 * Returns { files, usage }. A failed file is recorded with its error and the rest carry on.
 */
async function reviewFiles({ kind, units, prev, owners = {}, call, gather, files = {}, mounts = [], onProgress = () => {}, concurrency = CONCURRENCY }) {
  const before = new Map(((prev && prev.files) || []).filter((f) => !f.error).map((f) => [f.file, f]));
  const names = Object.keys(units);
  const out = [];
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const ask = async (prompt) => {
    const r = await call(prompt);
    usage.inputTokens += Number(r.inputTokens) || 0;
    usage.outputTokens += Number(r.outputTokens) || 0;
    usage.calls++;
    return r.text;
  };
  let done = 0;
  await eachLimit(names, concurrency, async (file) => {
    const entry = units[file];
    const old = before.get(file);
    const rec = { file, tool: owners[file] || null, hash: entry.hash, reused: false, error: null, sites: [] };
    if (old && old.hash === entry.hash) {
      Object.assign(rec, { reused: true, sites: old.sites });
    } else {
      try {
        rec.sites = await kind.reviewFile(file, entry, { ask, gather, files, mounts });
      } catch (err) {
        rec.error = String((err && err.message) || 'The review of this file failed.').slice(0, 300);
        rec.sites = kind.failedItems(file, entry);
      }
    }
    out.push(rec);
    onProgress(++done, names.length);
  });
  out.sort((a, b) => a.file.localeCompare(b.file));
  return { files: out, usage };
}

/** The plain-code review over call sites (kept for its tests and callers). */
const reviewSites = ({ sites, ...rest }) => reviewFiles({ kind: PLAIN, units: sites, ...rest });

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
    mounts: deps.mounts || ((files) => require('./mounts').parseMounts(files)),
    log: deps.log || (() => require('../../middleware/requestContext').getLogger()),
  };
  const q = (sql, params) => (typeof d.pool === 'function' ? d.pool() : d.pool).query(sql, params);
  const active = new Map(); // review id -> { done, total }
  const running = new Map();
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const busy = (id) => httpError(409, id && active.get(id) && active.get(id).kind === 'security' ? 'The AI security review is running. Wait for it to finish.' : 'An AI review is already running. Wait for it to finish.', { runningId: id || null, runningKind: (id && active.get(id) && active.get(id).kind) || null });

  async function latestDone(kind, withResult = true) {
    const { rows } = await q(`SELECT id, "userId", kind, status, model, summary, ${withResult ? 'result,' : ''} error, "inputTokens", "outputTokens", "costUsd", "durationMs", "createdAt", "finishedAt"
                                FROM code_map_ai_reviews WHERE status = 'done' AND kind = $1 ORDER BY id DESC LIMIT 1`, [kind.id]);
    return rows[0] ? shape(rows[0]) : null;
  }

  const shape = (r) => ({
    ...r, summary: parse(r.summary), ...(r.result !== undefined ? { result: parse(r.result) } : {}),
    costUsd: r.costUsd == null ? null : Number(r.costUsd), progress: active.get(r.id) || null,
  });

  /** What a review of this kind would do now: files, items, how many files changed since its last review and the model calls that means. */
  async function estimate(kindId) {
    const kind = kindOf(kindId);
    const files = d.collect();
    const units = kind.find(files);
    const prev = await latestDone(kind);
    const before = new Map(((prev && prev.result && prev.result.files) || []).filter((f) => !f.error).map((f) => [f.file, f.hash]));
    const names = Object.keys(units);
    const changed = names.filter((f) => before.get(f) !== units[f].hash);
    return {
      kind: kind.id,
      files: names.length,
      sites: names.reduce((n, f) => n + (units[f].sites ? units[f].sites.length : 0), 0),
      toReview: changed.length,
      calls: changed.reduce((n, f) => n + kind.calls(units[f]), 0),
      approxInputTokens: Math.round(changed.reduce((n, f) => n + String(files[f] || '').length, 0) / 4), // characters / 4, before prompt overhead
      lastReviewAt: prev ? prev.finishedAt : null,
    };
  }

  async function start(userId, kindId) {
    const kind = kindOf(kindId);
    if (active.size) throw busy([...active.keys()][0]);
    const modelId = ((await d.getModels(userId)) || {}).standard;
    if (!modelId) throw httpError(503, 'No AI model is set up for this workspace yet.');
    let id;
    try {
      const { rows } = await q(`INSERT INTO code_map_ai_reviews ("userId", kind, status, model) VALUES ($1, $2, 'running', $3) RETURNING id`, [userId, kind.id, modelId]);
      id = rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw busy();
      throw err;
    }
    active.set(id, { done: 0, total: 0, kind: kind.id });
    const p = new Promise((r) => setImmediate(r)).then(() => run(id, userId, modelId, kind))
      .catch((err) => d.log().error({ err, reviewId: id }, '[codeMap] AI review crashed'))
      .finally(() => { active.delete(id); running.delete(id); });
    running.set(id, p);
    return id;
  }

  async function run(id, userId, modelId, kind) {
    const t0 = Date.now();
    let result;
    try {
      const files = d.collect();
      const prev = await latestDone(kind);
      const run0 = await d.latestRun().catch(() => null);
      const reviewed = await reviewFiles({
        kind, units: kind.find(files), files, mounts: d.mounts(files), prev: prev && prev.result, owners: fileOwners(run0 && run0.result), gather: d.gather,
        onProgress: (done, total) => active.set(id, { done, total, kind: kind.id }),
        call: async (prompt) => {
          const r = await d.callModel(modelId, prompt, { system: kind.system, maxTokens: 3000, returnUsage: true, timeoutMs: 120000 });
          d.logUsage({ userId, model: r.model || modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens, feature: kind.feature });
          return r;
        },
      });
      const { usage } = reviewed;
      result = { files: reviewed.files, promptVersion: kind === PLAIN ? PROMPT_VERSION : SEC_PROMPT_VERSION, modelCalls: usage.calls };
      const summary = kind.summarize(result);
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
      await q(`DELETE FROM code_map_ai_reviews WHERE status <> 'running' AND kind = $2 AND id NOT IN (
                 SELECT id FROM code_map_ai_reviews WHERE kind = $2 ORDER BY id DESC LIMIT $1)`, [KEEP, kind.id]);
    } catch (err) { d.log().error({ err }, '[codeMap] trimming old AI reviews failed'); }
    try {
      for (const s of result.files.flatMap((f) => f.sites)) {
        const it = kind.inbox(s, id);
        await d.captureIf(!!it, it && { userId, source: 'codeMap', category: it.category, fingerprint: d.makeFingerprint(it.source, s.key), title: it.title, body: it.body, context: it.context });
      }
    } catch (err) { d.log().error({ err }, '[codeMap] raising AI review items in the inbox failed'); }
  }

  async function list(kindId) {
    const kind = kindOf(kindId);
    const { rows } = await q(`SELECT id, "userId", kind, status, model, summary, error, "inputTokens", "outputTokens", "costUsd", "durationMs", "createdAt", "finishedAt"
                                FROM code_map_ai_reviews WHERE kind = $2 ORDER BY id DESC LIMIT $1`, [KEEP, kind.id]);
    return rows.map(shape);
  }

  async function get(id) {
    const { rows } = await q(`SELECT * FROM code_map_ai_reviews WHERE id = $1`, [id]);
    return rows[0] ? shape(rows[0]) : null;
  }

  return { estimate, start, list, latest: (kindId) => latestDone(kindOf(kindId), true), get, whenDone: (id) => running.get(id) || Promise.resolve() };
}

module.exports = {
  createAiReview, findSites, findRouteFiles, fileOwners, normalizeAnswer, normalizeSecurity, buildSecurityPrompt, mountNote, reviewSites, reviewFiles, summarize,
  buildPrompt, keyOf, SYSTEM, SEC_SYSTEM, FEATURE, SEC_FEATURE, SITE_RE, KINDS, SEC_CHUNK, ...createAiReview(),
};
