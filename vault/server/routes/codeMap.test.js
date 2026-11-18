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
  const real = require('../services/codeMap/briefing').createBriefingService({ pool: { query: async () => { throw new Error('no db in this test'); } } });
  const briefing = {
    built: [], notes: '',
    async build(userId) { this.built.push(userId); return { briefing: { id: 7, chars: 10, markdown: '<vault_briefing>x</vault_briefing>' }, sections: [], stats: { chars: 10, tokens: 3 }, rulesStale: [] }; },
    async list() { return [{ id: 7, chars: 10 }]; },
    async get(userId, id) { return id === 7 ? { id: 7, markdown: 'x' } : null; },
    async getNotes() { return this.notes; },
    async saveNotes(userId, text) { if (text.length > 5) throw Object.assign(new Error('Notes can be up to 5 characters.'), { status: 400 }); this.notes = text; return text; },
    claudeMd: () => real.claudeMd(),
    doc: (name) => real.doc(name),
  };
  serve.briefing = briefing;
  app.use('/api/code-map', createCodeMapRouter({ jobs, explain, limiter, briefing }));
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

    await t('Context: CLAUDE.md and its docs; a doc only by a listed name, never a path', async () => {
      const c = await s.call('GET', '/api/code-map/briefing/claude-md');
      assert.strictEqual(c.status, 200);
      assert.match(c.body.text, /^# Curam Vault/);
      assert.ok(c.body.linked.includes('core-conventions.md') && c.body.linked.includes('deploy-speed.md'));
      assert.ok(!c.body.others.some((n) => c.body.linked.includes(n)));
      const d = await s.call('GET', '/api/code-map/briefing/doc?name=code-map.md');
      assert.strictEqual(d.status, 200);
      assert.match(d.body.text, /^# Code Map/);
      for (const bad of ['../CLAUDE.md', '..%2F.env', 'CODE-MAP.md', 'code-map', '.env', 'nope-not-here.md', 'docs/code-map.md']) {
        assert.strictEqual((await s.call('GET', `/api/code-map/briefing/doc?name=${bad}`)).status, 404, bad);
      }
    });
  } finally {
    await s.close();
  }
  console.log(`codeMap routes: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
