#!/usr/bin/env node
/**
 * /api/code-map routes with a fake job service: start (202, 409 passed through), list, latest before /:id, compare,
 * bad and unknown ids. Who may call them (admin only) is checked by crossUser.test.js against server/testing/routeManifest.json.
 * Run: node server/routes/codeMap.test.js
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createCodeMapRouter } = require('./codeMap');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

function fakeJobs() {
  const calls = [];
  return {
    calls,
    busy: false,
    async start(userId) { calls.push(['start', userId]); if (this.busy) throw Object.assign(new Error('A Code Map analysis is already running.'), { status: 409, runningId: 4 }); return 12; },
    async list() { calls.push(['list']); return [{ id: 12, status: 'done' }]; },
    async latest() { calls.push(['latest']); return this.none ? null : { id: 12, status: 'done', result: { findings: [] } }; },
    async get(id) {
      calls.push(['get', id]);
      if (id === 500) throw new Error('db down');
      if (id === 12) return { id: 12, status: 'running', stage: 'rules' };
      const notes = (score) => ({ id: 'notes', label: 'Notes', score, checks: {} });
      if (id === 20) return { id: 20, status: 'done', result: { tools: [notes(90)], findings: [] } };
      if (id === 21) {
        return { id: 21, status: 'done', result: { tools: [notes(80)], findings: [{ kind: 'rule', ruleId: 'docs', sev: 'low', tools: ['notes'], toolNotes: [{ tool: 'notes', status: 'fail', note: 'No docs file found.' }], evidence: [] }] } };
      }
      return null;
    },
  };
}

const explained = [];
const limited = [];
async function serve(jobs) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 3, isAdmin: true }; next(); }); // requireAdmin runs before this router in server/index.js
  const explain = async (userId, input) => {
    explained.push([userId, input]);
    if (input.ruleId === 'gone') throw Object.assign(new Error('That finding is not in this run for that tool.'), { status: 404 });
    if (input.ruleId === 'nomodel') throw Object.assign(new Error('No AI model is set up for this workspace yet.'), { status: 503 });
    return { explanation: 'ok', steps: [] };
  };
  const limiter = (req, res, next) => { limited.push(req.path); next(); };
  // Context tab: a fake store for briefings and notes; CLAUDE.md and the docs are read from disk by the real service
  // the settings table in memory, enough for the docs choice (SELECT value / INSERT ... ON CONFLICT / DELETE by userId and key)
  const settings = new Map();
  const pool = {
    async query(sql, params) {
      const k = `${params[0]}:${params[1]}`;
      if (/^SELECT value FROM settings/.test(sql)) return { rows: settings.has(k) ? [{ value: settings.get(k) }] : [] };
      if (/^INSERT INTO settings/.test(sql)) { settings.set(k, params[2]); return { rows: [] }; }
      if (/^DELETE FROM settings/.test(sql)) { settings.delete(k); return { rows: [] }; }
      throw new Error(`unexpected query in this test: ${sql.slice(0, 40)}`);
    },
  };
  serve.settings = settings;
  const real = require('../services/codeMap/briefing').createBriefingService({ pool });
  const briefing = {
    built: [], notes: '',
    async build(userId) { this.built.push(userId); return { briefing: { id: 7, chars: 10, markdown: '<vault_briefing>x</vault_briefing>' }, sections: [], stats: { chars: 10, tokens: 3 }, rulesStale: [] }; },
    async list() { return [{ id: 7, chars: 10 }]; },
    async get(userId, id) { return id === 7 ? { id: 7, markdown: 'x' } : null; },
    async getNotes() { return this.notes; },
    async saveNotes(userId, text) { if (text.length > 5) throw Object.assign(new Error('Notes can be up to 5 characters.'), { status: 400 }); this.notes = text; return text; },
    claudeMd: (userId) => real.claudeMd(userId),
    saveDocs: (userId, paths) => real.saveDocs(userId, paths),
    resetDocs: (userId) => real.resetDocs(userId),
    docsCopy: (userId, paths) => real.docsCopy(userId, paths),
  };
  serve.briefing = briefing;
  const aiReview = {
    async estimate(kind) { return { kind, files: 2, sites: 3, toReview: 1, calls: 1 }; },
    async start(userId, kind) { if (userId !== 3) throw new Error('wrong user'); serve.startedKind = kind; return 7; },
    async list(kind) { return [{ id: 7, status: 'done', kind }]; },
    async latest(kind) { return { id: 7, status: 'done', kind, result: { files: [] } }; },
    async get(id) { return id === 7 ? { id: 7, status: 'running', progress: { done: 1, total: 2 } } : null; },
  };
  const liveChecks = {
    async check(userId, base) { serve.liveBase = base; return { id: 2, userId, base, checks: [], counts: {} }; },
    async latest() { return { id: 2, checks: [] }; },
  };
  const knowledgeGraph = () => {
    if (serve.kg === 'broken') throw Object.assign(new Error('.ua/knowledge-graph.json is not valid JSON. Run /understand again.'), { status: 422 });
    return serve.kg || null;
  };
  const models = {
    async latestReport() { return serve.modelsReport || null; },
    async runNow(userId) {
      if (serve.modelsBusy) throw Object.assign(new Error('A models check is already running. It takes a few seconds.'), { status: 409 });
      if (serve.modelsNoRun) throw Object.assign(new Error('Run the Code Map analysis first: the Models check reads tool ownership from the latest run.'), { status: 409 });
      serve.modelsRanBy = userId;
      return { id: 4, createdAt: '2026-11-24T00:00:00.000Z', durationMs: 900, result: { counts: { high: 1, medium: 0, low: 0 }, tools: [] } };
    },
  };
  const modelTests = {
    async estimate(userId, opts) { serve.testEstimate = [userId, opts]; return { current: 'a', candidate: opts.candidate || 'b', cases: 10 }; },
    async start(userId, opts) {
      if (opts.candidate === 'a') throw Object.assign(new Error('Pick a candidate model from the model list (not the current one).'), { status: 400 });
      serve.testStarted = [userId, opts];
      return 9;
    },
    async list() { return [{ id: 9, status: 'running' }]; },
    async get(id) { return id === 9 ? { id: 9, status: 'done' } : null; },
  };
  app.use('/api/code-map', createCodeMapRouter({ jobs, explain, limiter, briefing, aiReview, liveChecks, knowledgeGraph, models, modelTests }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

(async () => {
  const jobs = fakeJobs();
  const s = await serve(jobs);
  try {
    await t('Models: null before the first check, then the report; run as the signed-in admin; 409s pass their message; run behind aiLimiter', async () => {
      assert.deepStrictEqual((await s.call('GET', '/api/code-map/models')).body, { report: null });
      const before = limited.length;
      const r = await s.call('POST', '/api/code-map/models/run');
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.report.id, 4);
      assert.strictEqual(serve.modelsRanBy, 3);
      assert.strictEqual(limited.length, before + 1, 'the run asks the light model for a summary, so it is behind the AI rate limit');
      const reads = limited.length;
      serve.modelsReport = { id: 4, result: { tools: [] } };
      assert.strictEqual((await s.call('GET', '/api/code-map/models')).body.report.id, 4);
      assert.strictEqual(limited.length, reads, 'reading the report is not rate limited');
      serve.modelsBusy = true;
      const busy = await s.call('POST', '/api/code-map/models/run');
      assert.strictEqual(busy.status, 409);
      assert.match(busy.body.error, /already running/);
      serve.modelsBusy = false;
      serve.modelsNoRun = true;
      assert.match((await s.call('POST', '/api/code-map/models/run')).body.error, /Run the Code Map analysis first/);
      serve.modelsNoRun = false;
    });

    await t('Model tests: estimate passes candidate and cases; start is 202 behind aiLimiter; 400 passes its message; list; get and bad ids', async () => {
      const e = await s.call('GET', '/api/code-map/models/tests/estimate?candidate=b&cases=5');
      assert.strictEqual(e.status, 200);
      assert.deepStrictEqual(serve.testEstimate, [3, { candidate: 'b', cases: '5' }]);
      const before = limited.length;
      const r = await s.call('POST', '/api/code-map/models/tests', { candidate: 'b', cases: 10 });
      assert.strictEqual(r.status, 202);
      assert.strictEqual(r.body.id, 9);
      assert.deepStrictEqual(serve.testStarted, [3, { candidate: 'b', cases: 10 }]);
      assert.strictEqual(limited.length, before + 1, 'starting a test makes model calls, so it is rate limited');
      const bad = await s.call('POST', '/api/code-map/models/tests', { candidate: 'a' });
      assert.strictEqual(bad.status, 400);
      assert.match(bad.body.error, /not the current one/);
      assert.strictEqual((await s.call('GET', '/api/code-map/models/tests')).body.tests[0].id, 9);
      assert.strictEqual((await s.call('GET', '/api/code-map/models/tests/9')).body.test.status, 'done');
      assert.strictEqual((await s.call('GET', '/api/code-map/models/tests/8')).status, 404);
      assert.strictEqual((await s.call('GET', '/api/code-map/models/tests/x')).status, 400);
    });

    await t('live checks: run against the app\'s own address (APP_URL), never one from the request body; latest', async () => {
      const prev = process.env.APP_URL;
      process.env.APP_URL = 'https://vault.example.com/';
      try {
        const r = await s.call('POST', '/api/code-map/live-checks', { base: 'http://169.254.169.254' });
        assert.strictEqual(r.status, 201);
        assert.strictEqual(serve.liveBase, 'https://vault.example.com', 'the body is ignored');
      } finally {
        if (prev === undefined) delete process.env.APP_URL; else process.env.APP_URL = prev;
      }
      assert.strictEqual((await s.call('GET', '/api/code-map/live-checks/latest')).body.check.id, 2);
    });

    await t('AI review: start is behind aiLimiter, the reads are not; named routes before /:id', async () => {
      const before = limited.length;
      assert.deepStrictEqual((await s.call('GET', '/api/code-map/ai-reviews/estimate')).body.calls, 1);
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews/latest')).body.review.id, 7);
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews')).body.reviews.length, 1);
      assert.strictEqual(limited.length, before, 'reads skip the limiter');
      const r = await s.call('POST', '/api/code-map/ai-reviews');
      assert.strictEqual(r.status, 202);
      assert.deepStrictEqual(r.body, { id: 7 });
      assert.strictEqual(limited.length, before + 1);
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews/7')).body.review.progress.done, 1);
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews/8')).status, 404);
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews/x')).status, 400);
    });

    await t('AI reviews: ?kind= is passed through (security review on the Security tab); none means the plain-code review', async () => {
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews/estimate?kind=security')).body.kind, 'security');
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews/latest?kind=security')).body.review.kind, 'security');
      assert.strictEqual((await s.call('GET', '/api/code-map/ai-reviews?kind=security')).body.reviews[0].kind, 'security');
      assert.strictEqual((await s.call('POST', '/api/code-map/ai-reviews?kind=security')).status, 202);
      assert.strictEqual(serve.startedKind, 'security');
      await s.call('POST', '/api/code-map/ai-reviews');
      assert.strictEqual(serve.startedKind, undefined);
    });

    await t('Knowledge graph: null before one is committed, the graph after, 422 with its message when the file is broken', async () => {
      assert.deepStrictEqual((await s.call('GET', '/api/code-map/knowledge-graph')).body, { graph: null });
      serve.kg = { file: '.ua/knowledge-graph.json', nodes: [{ id: 'a' }], edges: [] };
      assert.strictEqual((await s.call('GET', '/api/code-map/knowledge-graph')).body.graph.nodes[0].id, 'a');
      serve.kg = 'broken';
      const r = await s.call('GET', '/api/code-map/knowledge-graph');
      assert.strictEqual(r.status, 422);
      assert.match(r.body.error, /not valid JSON/);
      serve.kg = null;
    });

    await t('POST /runs starts a run for the signed-in admin', async () => {
      const r = await s.call('POST', '/api/code-map/runs');
      assert.strictEqual(r.status, 202);
      assert.deepStrictEqual(r.body, { id: 12 });
      assert.deepStrictEqual(jobs.calls.at(-1), ['start', 3]);
    });

    await t('POST /runs while one is running answers 409 with the running id', async () => {
      jobs.busy = true;
      const r = await s.call('POST', '/api/code-map/runs');
      jobs.busy = false;
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.body.runningId, 4);
      assert.match(r.body.error, /already running/);
    });

    await t('GET /runs lists runs', async () => {
      const r = await s.call('GET', '/api/code-map/runs');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.runs, [{ id: 12, status: 'done' }]);
    });

    await t('GET /runs/latest is a named route, not /:id', async () => {
      const r = await s.call('GET', '/api/code-map/runs/latest');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.run.id, 12);
      assert.deepStrictEqual(jobs.calls.at(-1), ['latest']);
      jobs.none = true;
      const empty = await s.call('GET', '/api/code-map/runs/latest');
      jobs.none = false;
      assert.deepStrictEqual(empty.body, { run: null });
    });

    await t('GET /runs/:id returns the run with its stage, 404 when gone, 400 for a bad id', async () => {
      const r = await s.call('GET', '/api/code-map/runs/12');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.run.stage, 'rules');
      assert.deepStrictEqual(jobs.calls.at(-1), ['get', 12]);
      assert.strictEqual((await s.call('GET', '/api/code-map/runs/13')).status, 404);
      assert.strictEqual((await s.call('GET', '/api/code-map/runs/abc')).status, 400);
      assert.strictEqual((await s.call('GET', '/api/code-map/runs/1.5')).status, 400);
    });

    await t('a server error hides the detail', async () => {
      const r = await s.call('GET', '/api/code-map/runs/500');
      assert.strictEqual(r.status, 500);
      assert.doesNotMatch(r.body.error, /db down/);
    });

    await t('GET /compare compares two finished runs', async () => {
      const r = await s.call('GET', '/api/code-map/compare?from=20&to=21');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.body.from.id, r.body.to.id], [20, 21]);
      assert.deepStrictEqual(r.body.scores, [{ id: 'notes', label: 'Notes', from: 90, to: 80, delta: -10 }]);
      assert.deepStrictEqual(r.body.newFindings.map((n) => n.key), ['rule:docs:notes']);
      assert.ok(!('result' in r.body.from), 'the full results are not sent back');
    });

    await t('POST /findings/explain passes the finding to the explainer, behind the AI limiter (and only it)', async () => {
      limited.length = 0;
      const r = await s.call('POST', '/api/code-map/findings/explain', { runId: '20', ruleId: 'docs', toolId: 'notes', findingId: 'rule:docs' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.explanation, 'ok');
      assert.deepStrictEqual(explained.at(-1), [3, { runId: 20, ruleId: 'docs', toolId: 'notes', findingId: 'rule:docs' }]);
      assert.deepStrictEqual(limited, ['/findings/explain']);
      await s.call('GET', '/api/code-map/runs');
      assert.deepStrictEqual(limited, ['/findings/explain'], 'the other routes are not rate limited');
      const gone = await s.call('POST', '/api/code-map/findings/explain', { runId: 20, ruleId: 'gone' });
      assert.strictEqual(gone.status, 404);
      assert.match(gone.body.error, /not in this run/);
      const noModel = await s.call('POST', '/api/code-map/findings/explain', { runId: 20, ruleId: 'nomodel' });
      assert.strictEqual(noModel.status, 503);
      assert.match(noModel.body.error, /No AI model is set up/, 'a deliberate 503 keeps its message');
    });

    await t('GET /compare refuses bad ids, missing runs and unfinished runs', async () => {
      assert.strictEqual((await s.call('GET', '/api/code-map/compare?from=20')).status, 400);
      assert.strictEqual((await s.call('GET', '/api/code-map/compare?from=x&to=21')).status, 400);
      assert.strictEqual((await s.call('GET', '/api/code-map/compare?from=20&to=99')).status, 404);
      assert.strictEqual((await s.call('GET', '/api/code-map/compare?from=12&to=21')).status, 400); // 12 is still running
    });
    await t('Context: build, list, get one, notes', async () => {
      const b = await s.call('POST', '/api/code-map/briefings');
      assert.strictEqual(b.status, 201);
      assert.match(b.body.briefing.markdown, /^<vault_briefing>/);
      assert.deepStrictEqual(serve.briefing.built, [3], 'built for the signed-in admin');
      assert.strictEqual((await s.call('GET', '/api/code-map/briefings')).body.briefings.length, 1);
      assert.strictEqual((await s.call('GET', '/api/code-map/briefings/7')).status, 200);
      assert.strictEqual((await s.call('GET', '/api/code-map/briefings/8')).status, 404);
      assert.strictEqual((await s.call('GET', '/api/code-map/briefings/x')).status, 400);
      assert.strictEqual((await s.call('PUT', '/api/code-map/briefing/notes', { notes: 'hi' })).body.notes, 'hi');
      assert.strictEqual((await s.call('GET', '/api/code-map/briefing/notes')).body.notes, 'hi');
      assert.strictEqual((await s.call('PUT', '/api/code-map/briefing/notes', { notes: 42 })).status, 400);
      const long = await s.call('PUT', '/api/code-map/briefing/notes', { notes: 'too long' });
      assert.strictEqual(long.status, 400);
      assert.match(long.body.error, /up to 5/);
      assert.ok(!limited.includes('/briefings'), 'no aiLimiter: no model call');
    });

    await t('Context: CLAUDE.md, the docs on offer with sizes, and the default set ticked', async () => {
      const c = await s.call('GET', '/api/code-map/briefing/claude-md');
      assert.strictEqual(c.status, 200);
      assert.match(c.body.text, /^# Curam Vault/);
      assert.deepStrictEqual(c.body.selected, ['client/DESIGN.md', 'docs/hardening.md', 'docs/guide-chat.md']);
      assert.strictEqual(c.body.docs.find((d) => d.path === 'docs/video-tools.md').isDefault, false, 'video-tools is optional');
      assert.strictEqual(c.body.customised, false);
      assert.deepStrictEqual(c.body.missing, []);
      const finance = c.body.docs.find((d) => d.path === 'docs/finance.md');
      assert.ok(finance && finance.tokens === Math.ceil(finance.chars / 4) && finance.note === 'holds real business figures');
      for (const extra of ['client/DESIGN.md', 'ROADMAP.md', 'BACKUP.md', 'planner-core/README.md', 'room-planner/README.md']) assert.ok(c.body.docs.some((d) => d.path === extra), extra);
      assert.ok(!c.body.docs.some((d) => d.path === 'CLAUDE.md'), 'CLAUDE.md is always in, not a choice');
    });

    await t('Context: the choice is saved per admin, unsafe paths dropped, Reset goes back to the defaults', async () => {
      const saved = await s.call('PUT', '/api/code-map/briefing/docs', { paths: ['ROADMAP.md', '../CLAUDE.md', '/etc/passwd', 'server/db.js', 'docs\\finance.md', 'docs/finance.md'] });
      assert.strictEqual(saved.status, 200);
      assert.deepStrictEqual(saved.body.selected, ['ROADMAP.md', 'docs/finance.md']);
      assert.deepStrictEqual(JSON.parse(serve.settings.get('3:code_map_briefing_docs')), ['ROADMAP.md', 'docs/finance.md']);
      assert.deepStrictEqual((await s.call('GET', '/api/code-map/briefing/claude-md')).body.selected, ['ROADMAP.md', 'docs/finance.md']);
      assert.strictEqual((await s.call('PUT', '/api/code-map/briefing/docs', { paths: 'ROADMAP.md' })).status, 400);
      const reset = await s.call('DELETE', '/api/code-map/briefing/docs');
      assert.strictEqual(reset.body.customised, false);
      assert.ok(!serve.settings.has('3:code_map_briefing_docs'));
      assert.strictEqual((await s.call('GET', '/api/code-map/briefing/claude-md')).body.selected.length, 3);
    });

    await t('Context: the copy is built on the server from the allow-list only, ending with the not-included list', async () => {
      const r = await s.call('POST', '/api/code-map/briefing/docs-copy', { paths: ['ROADMAP.md', '../.env', 'server/db.js'] });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.included, ['ROADMAP.md']);
      assert.ok(r.body.text.startsWith('## File: CLAUDE.md'));
      assert.ok(r.body.text.includes('## File: ROADMAP.md'));
      assert.ok(!r.body.text.includes('## File: server/db.js') && !r.body.text.includes('## File: ../.env'));
      assert.match(r.body.text, /## Docs not included in this copy\n[\s\S]*- client\/DESIGN\.md \(~[\d,]+ tokens\)/);
      assert.ok(r.body.text.trim().endsWith('If the work needs any of these, ask me to include them next time.'));
      assert.strictEqual((await s.call('POST', '/api/code-map/briefing/docs-copy', { paths: 'x' })).status, 400);
      const byDefault = await s.call('POST', '/api/code-map/briefing/docs-copy', {});
      assert.deepStrictEqual(byDefault.body.included, ['client/DESIGN.md', 'docs/hardening.md', 'docs/guide-chat.md']);
    });
  } finally {
    await s.close();
  }
  console.log(`codeMap routes: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
