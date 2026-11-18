#!/usr/bin/env node
/**
 * /api/code-map routes with a fake job service: start (202, 409 passed through), list, latest before /:id, compare is 501 for now,
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
    async get(id) { calls.push(['get', id]); if (id === 500) throw new Error('db down'); return id === 12 ? { id: 12, status: 'running', stage: 'rules' } : null; },
  };
}

async function serve(jobs) {
  const app = express();
  app.use((req, res, next) => { req.user = { id: 3, isAdmin: true }; next(); }); // requireAdmin runs before this router in server/index.js
  app.use('/api/code-map', createCodeMapRouter({ jobs }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p) => {
    const res = await fetch(base + p, { method });
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

    await t('GET /compare is not built yet (501)', async () => {
      const r = await s.call('GET', '/api/code-map/compare?from=1&to=2');
      assert.strictEqual(r.status, 501);
    });
  } finally {
    await s.close();
  }
  console.log(`codeMap routes: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
