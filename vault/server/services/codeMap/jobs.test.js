'use strict';

// node server/services/codeMap/jobs.test.js
// The Code Map background job: success, failure, one run at a time, keeping the last 30 runs, high findings raised in the inbox once per
// rule and tool, and the worker thread on the fixture repo. In-memory stand-in for the database; no inbox, no network.

const assert = require('assert');
const path = require('path');
const { createJobs, summarize, inboxItems, KEEP_RUNS } = require('./jobs');
const { runInWorker } = require('./worker');

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; } catch (err) { console.error(`FAIL ${name}`); throw err; }
};

// a tiny code_map_runs table
function fakePool({ failInsert = null } = {}) {
  const rows = [];
  let nextId = 1;
  let clock = 0;
  const sqls = [];
  const pool = {
    rows,
    sqls,
    query: async (sql, p = []) => {
      sqls.push(sql);
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^SELECT id FROM code_map_runs WHERE status IN \('queued', 'running'\)/.test(s)) {
        return { rows: rows.filter((r) => r.status === 'queued' || r.status === 'running').sort((a, b) => b.id - a.id).slice(0, 1).map((r) => ({ id: r.id })) };
      }
      if (/^INSERT INTO code_map_runs/.test(s)) {
        if (failInsert) throw failInsert;
        const r = { id: nextId++, userId: p[0], status: 'queued', commitHint: p[1], summary: null, result: null, error: null, durationMs: null, createdAt: new Date(Date.UTC(2026, 0, 1) + clock++ * 1000), finishedAt: null };
        rows.push(r);
        return { rows: [{ id: r.id }] };
      }
      if (/^UPDATE code_map_runs SET status = 'running'/.test(s)) { rows.find((r) => r.id === p[0]).status = 'running'; return { rowCount: 1 }; }
      if (/^UPDATE code_map_runs SET status = 'done'/.test(s)) {
        Object.assign(rows.find((r) => r.id === p[0]), { status: 'done', summary: JSON.parse(p[1]), result: JSON.parse(p[2]), durationMs: p[3], error: null, finishedAt: new Date() });
        return { rowCount: 1 };
      }
      if (/^UPDATE code_map_runs SET status = 'failed'/.test(s)) {
        Object.assign(rows.find((r) => r.id === p[0]), { status: 'failed', error: p[1], durationMs: p[2], finishedAt: new Date() });
        return { rowCount: 1 };
      }
      if (/^DELETE FROM code_map_runs WHERE status NOT IN/.test(s)) {
        const keep = new Set([...rows].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).slice(0, p[0]).map((r) => r.id));
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (!keep.has(rows[i].id) && !['queued', 'running'].includes(rows[i].status)) rows.splice(i, 1);
        return { rowCount: before - rows.length };
      }
      const order = (a, b) => b.createdAt - a.createdAt || b.id - a.id;
      if (/FROM code_map_runs WHERE status = 'done'/.test(s)) return { rows: rows.filter((r) => r.status === 'done').sort(order).slice(0, 1).map((r) => ({ ...r })) };
      if (/FROM code_map_runs WHERE id = \$1/.test(s)) return { rows: rows.filter((r) => r.id === p[0]).map((r) => ({ ...r })) };
      if (/FROM code_map_runs ORDER BY/.test(s)) return { rows: [...rows].sort(order).slice(0, p[0]).map(({ result, ...r }) => r) };
      throw new Error(`unexpected sql: ${s}`);
    },
  };
  return pool;
}

const RESULT = {
  summary: { files: 10, tests: 2, locServer: 100, locClient: 50, locTests: 20, tools: 2, mounts: 3, cycles: 1, gaps: 4 },
  tools: [{ id: 'mood', label: 'Mood', score: 50 }, { id: 'chat', label: 'Chat & Projects', score: 70 }],
  rules: [{ id: 'rateLimit', label: 'AI rate limit' }, { id: 'docs', label: 'Docs' }],
  findings: [
    { sev: 'high', ruleId: 'rateLimit', title: 'AI rate limit: 2 tools to check', why: 'Spend.', fix: 'Add aiLimiter.', tools: ['mood', 'chat'],
      toolNotes: [{ tool: 'mood', note: 'AI route(s) without aiLimiter: /api/mood' }, { tool: 'chat', note: 'AI route(s) without aiLimiter: /api/chat' }],
      evidence: [{ file: 'server/index.js', line: 14, text: '/api/mood', tool: 'mood' }, { file: 'server/index.js', line: 11, text: '/api/chat', tool: 'chat' }] },
    { sev: 'high', ruleId: 'cronRequiresRoute', title: 'A cron job requires a route file (1 place)', why: 'Logic in routes.', fix: 'Move it.', tools: [],
      evidence: [{ file: 'server/cron/x.js', line: 3, text: "require('../routes/x')" }] },
    { sev: 'low', ruleId: 'docs', title: 'Docs: 1 tool to check', why: 'w', fix: 'f', tools: ['mood'], evidence: [] },
  ],
};

function build(over = {}) {
  const pool = over.pool || fakePool();
  const captured = [];
  const errors = [];
  const jobs = createJobs({
    pool,
    analyze: over.analyze || (async ({ onStage }) => { onStage('files'); onStage('rules'); return RESULT; }),
    captureIf: async (cond, payload) => { if (cond) captured.push(payload); return cond ? { created: true } : { skipped: true }; },
    makeFingerprint: (s, k) => `${s}|${k}`,
    log: () => ({ error: (...a) => errors.push(a) }),
    env: { RAILWAY_GIT_COMMIT_SHA: 'abc123' },
    root: '/nowhere',
  });
  return { jobs, pool, captured, errors };
}

(async () => {
  await t('summary: tile numbers and finding counts', () => {
    const s = summarize(RESULT);
    assert.strictEqual(s.lines, 150);
    assert.strictEqual(s.tools, 2);
    assert.strictEqual(s.avgScore, 60);
    assert.deepStrictEqual(s.findingsBySeverity, { high: 2, medium: 0, low: 1 });
  });

  await t('inbox items: one per finding per tool, own evidence only, "all" when no tool', () => {
    const items = inboxItems(RESULT, 7);
    const high = items.filter((i) => i.high);
    assert.deepStrictEqual(high.map((i) => `${i.ruleId}:${i.toolId}`), ['rateLimit:mood', 'rateLimit:chat', 'cronRequiresRoute:all']);
    const mood = high[0];
    assert.strictEqual(mood.title, 'Code Map: AI rate limit (Mood)');
    assert.match(mood.body, /\/api\/mood/);
    assert.doesNotMatch(mood.body, /\/api\/chat/, 'another tool\'s evidence is left out');
    assert.match(high[2].body, /server\/cron\/x\.js:3/);
    assert.strictEqual(high[2].title, 'Code Map: A cron job requires a route file', 'no count in the title (the inbox keeps the first title)');
    assert.match(mood.context, /run #7/);
  });

  await t('success: queued -> done with summary, result, duration, commit hint; stage while running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { jobs, pool, captured } = build({ analyze: async ({ onStage }) => { onStage('ownership'); await gate; return RESULT; } });
    const id = await jobs.start(5);
    assert.strictEqual(id, 1);
    assert.strictEqual(pool.rows[0].status, 'queued');
    assert.strictEqual(pool.rows[0].commitHint, 'abc123');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const mid = await jobs.get(id);
    assert.strictEqual(mid.status, 'running');
    assert.strictEqual(mid.stage, 'ownership');
    assert.strictEqual(mid.stageLabel, 'Working out which tool owns what');
    release();
    await jobs.whenDone(id);
    const run = await jobs.get(id);
    assert.strictEqual(run.status, 'done');
    assert.strictEqual(run.stage, null);
    assert.strictEqual(run.summary.tools, 2);
    assert.strictEqual(run.result.findings.length, 3);
    assert.strictEqual(typeof run.durationMs, 'number');
    assert.ok(run.finishedAt);
    // high findings raised once per rule and tool, with the brief's source, category and fingerprint
    assert.deepStrictEqual(captured.map((c) => c.fingerprint), ['codeMap|rateLimit:mood', 'codeMap|rateLimit:chat', 'codeMap|cronRequiresRoute:all']);
    for (const c of captured) {
      assert.strictEqual(c.source, 'codeMap');
      assert.strictEqual(c.category, 'alert');
      assert.strictEqual(c.userId, 5);
    }
    const latest = await jobs.latest();
    assert.strictEqual(latest.id, id);
    const list = await jobs.list();
    assert.strictEqual(list[0].result, undefined, 'the list leaves out the full result');
  });

  await t('failure: the error is kept and nothing is raised', async () => {
    const { jobs, captured, errors } = build({ analyze: async () => { throw new Error('disk gone'); } });
    const id = await jobs.start(5);
    await jobs.whenDone(id);
    const run = await jobs.get(id);
    assert.strictEqual(run.status, 'failed');
    assert.strictEqual(run.error, 'disk gone');
    assert.strictEqual(run.result, null);
    assert.deepStrictEqual(captured, []);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(await jobs.latest(), null);
  });

  await t('one at a time: a second start is refused with 409 while a run is going, and allowed after', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { jobs } = build({ analyze: async () => { await gate; return RESULT; } });
    const id = await jobs.start(5);
    await assert.rejects(jobs.start(6), (err) => err.status === 409 && err.runningId === id);
    release();
    await jobs.whenDone(id);
    const id2 = await jobs.start(6);
    assert.strictEqual(id2, 2);
    await jobs.whenDone(id2);
  });

  await t('one at a time: a run left queued in the table (another process) blocks a start', async () => {
    const pool = fakePool();
    pool.rows.push({ id: 99, status: 'running', createdAt: new Date() });
    const { jobs } = build({ pool });
    await assert.rejects(jobs.start(5), (err) => err.status === 409 && err.runningId === 99);
  });

  await t('one at a time: the unique index (two clicks at once) becomes a 409', async () => {
    const { jobs } = build({ pool: fakePool({ failInsert: Object.assign(new Error('duplicate key'), { code: '23505' }) }) });
    await assert.rejects(jobs.start(5), (err) => err.status === 409);
  });

  await t('retention: only the last 30 runs are kept after a successful run', async () => {
    const pool = fakePool();
    const { jobs } = build({ pool });
    for (let i = 0; i < KEEP_RUNS + 4; i++) {
      const id = await jobs.start(5);
      await jobs.whenDone(id);
    }
    assert.strictEqual(pool.rows.length, KEEP_RUNS);
    assert.strictEqual(Math.min(...pool.rows.map((r) => r.id)), 5, 'the oldest four went');
    assert.ok(pool.sqls.some((s) => /DELETE FROM code_map_runs/.test(s)));
  });

  await t('a failing inbox does not fail the run', async () => {
    const pool = fakePool();
    const errors = [];
    const jobs = createJobs({
      pool, analyze: async () => RESULT, captureIf: async () => { throw new Error('inbox down'); }, makeFingerprint: (s, k) => k,
      log: () => ({ error: (...a) => errors.push(a) }), env: {},
    });
    const id = await jobs.start(1);
    await jobs.whenDone(id);
    assert.strictEqual((await jobs.get(id)).status, 'done');
    assert.strictEqual((await jobs.get(id)).commitHint, null);
    assert.strictEqual(errors.length, 1);
  });

  await t('worker thread: runs the real analyzer on the fixture repo and reports stages', async () => {
    const stages = [];
    const r = await runInWorker({ root: path.join(__dirname, '__fixtures__', 'repo'), onStage: (s) => stages.push(s) });
    assert.deepStrictEqual(stages, ['files', 'imports', 'tools', 'mounts', 'ownership', 'rules', 'structure', 'findings']);
    assert.strictEqual(r.summary.tools, 8);
    assert.strictEqual(r.findings[0].id, 'rule:flag');
    await assert.rejects(runInWorker({ root: path.join(__dirname, 'no-such-folder') }), /APP_NAV_GROUPS/);
  });

  console.log(`jobs.test.js: ${passed} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
