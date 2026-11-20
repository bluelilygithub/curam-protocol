#!/usr/bin/env node
// Code Map AI review: call-site search, answer checking, reuse of unchanged files, splitting big files, and the job with a fake
// database and model. Run: node server/services/codeMap/aiReview.test.js
'use strict';

const assert = require('assert');
const { findSites, fileOwners, normalizeAnswer, reviewSites, summarize, createAiReview, keyOf } = require('./aiReview');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const files = {
  'server/routes/a.js': "const x = 1;\nconst r = await callModel(m, p);\n// callModel(commented)\nconst s = anthropic.messages.stream({});\n",
  'server/routes/a.test.js': 'await callModel(m, p);\n',
  'server/services/callModel.js': 'async function callModel(modelId) {}\n',
  'server/services/b.js': 'const g = await model.generateContent(parts);\n',
  'server/services/none.js': 'const y = 2;\n',
  'client/src/x.js': 'callModel(1)\n',
};
const gather = (ev) => ({ excerpts: [{ file: ev[0].file, from: 1, to: 50, text: '...' }] });

(async () => {
  await t('findSites: server code only, skips tests, comments and callModel.js itself', () => {
    const s = findSites(files);
    assert.deepStrictEqual(Object.keys(s).sort(), ['server/routes/a.js', 'server/services/b.js']);
    assert.deepStrictEqual(s['server/routes/a.js'].sites.map((x) => x.line), [2, 4]);
    assert.ok(/^[0-9a-f]{40}$/.test(s['server/routes/a.js'].hash));
  });

  await t('fileOwners: one tool, or shared when two own it', () => {
    const o = fileOwners({ tools: [{ id: 'notes', ownedServer: ['server/a.js', 'server/c.js'] }, { id: 'chat', ownedServer: ['server/c.js'] }] });
    assert.deepStrictEqual(o, { 'server/a.js': 'notes', 'server/c.js': 'shared' });
  });

  const entry = { hash: 'h', sites: [{ line: 2, text: 'callModel(m, p)' }, { line: 4, text: 'messages.stream' }] };
  const ex = [{ file: 'server/routes/a.js', from: 1, to: 50 }];

  await t('normalizeAnswer: matches real lines, drops unknown lines and refs outside excerpts, fills gaps as unclear', () => {
    const raw = '```json\n' + JSON.stringify({ sites: [
      { line: 2, verdict: 'replace', confidence: 'high', does: 'Classifies', why: 'Fixed set', alternative: 'A lookup', saving: 'medium', refs: ['server/routes/a.js:2', 'server/routes/a.js:999', 'etc/passwd:1'] },
      { line: 77, verdict: 'keep' },
    ] }) + '\n```';
    const out = normalizeAnswer(raw, 'server/routes/a.js', entry, ex);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].verdict, 'replace');
    assert.deepStrictEqual(out[0].refs, ['server/routes/a.js:2']);
    assert.strictEqual(out[1].verdict, 'unclear');
    assert.strictEqual(out[0].key, keyOf('server/routes/a.js', 'callModel(m, p)'));
  });

  await t('normalizeAnswer: bad verdicts and unreadable answers become unclear', () => {
    const out = normalizeAnswer(JSON.stringify({ sites: [{ line: 2, verdict: 'delete it', confidence: 'total', saving: 'lots' }] }), 'f', entry, ex);
    assert.strictEqual(out[0].verdict, 'unclear');
    assert.strictEqual(out[0].confidence, 'low');
    assert.ok(normalizeAnswer('not json', 'f', entry, ex).every((s) => s.verdict === 'unclear' && /could not be read/.test(s.why)));
  });

  await t('reviewSites: unchanged files reuse the last verdicts, changed ones call the model, a failure is recorded', async () => {
    const sites = findSites(files);
    const prev = { files: [{ file: 'server/services/b.js', hash: sites['server/services/b.js'].hash, sites: [{ line: 1, verdict: 'keep' }] }] };
    const prompts = [];
    const call = async (p) => { prompts.push(p); return { text: JSON.stringify({ sites: [{ line: 2, verdict: 'hybrid', confidence: 'medium' }] }), inputTokens: 100, outputTokens: 20 }; };
    const progress = [];
    const r = await reviewSites({ sites, prev, call, gather, owners: { 'server/routes/a.js': 'chat' }, onProgress: (d, n) => progress.push(`${d}/${n}`) });
    assert.strictEqual(prompts.length, 1, 'only the changed file is sent');
    assert.ok(prompts[0].includes('FILE server/routes/a.js') && prompts[0].includes('line 4'));
    const a = r.files.find((f) => f.file === 'server/routes/a.js');
    assert.strictEqual(a.tool, 'chat');
    assert.deepStrictEqual(a.sites.map((s) => s.verdict), ['hybrid', 'unclear']);
    assert.strictEqual(r.files.find((f) => f.file === 'server/services/b.js').reused, true);
    assert.deepStrictEqual(r.usage, { inputTokens: 100, outputTokens: 20, calls: 1 });
    assert.deepStrictEqual(progress, ['1/2', '2/2']);

    const failed = await reviewSites({ sites, prev: null, gather, call: async () => { throw new Error('rate limited'); } });
    assert.ok(failed.files.every((f) => f.error === 'rate limited' && f.sites.every((s) => s.verdict === 'unclear')));
    assert.deepStrictEqual(summarize(failed), { sites: 3, files: 2, replace: 0, hybrid: 0, keep: 0, unclear: 3, reusedFiles: 0, failedFiles: 2 });
  });

  await t('reviewSites: a file with many call sites is split into calls of 4', async () => {
    const big = { 'server/routes/big.js': Array.from({ length: 9 }, (_, i) => `await callModel(${i});`).join('\n') };
    let calls = 0;
    const r = await reviewSites({ sites: findSites(big), gather, call: async (p) => { calls++; const lines = [...p.matchAll(/- line (\d+)/g)].map((m) => Number(m[1])); return { text: JSON.stringify({ sites: lines.map((line) => ({ line, verdict: 'keep', confidence: 'high' })) }) }; } });
    assert.strictEqual(calls, 3);
    assert.strictEqual(r.files[0].sites.length, 9);
    assert.ok(r.files[0].sites.every((s) => s.verdict === 'keep'));
  });

  await t('job: refuses without a model, runs, stores, logs usage and raises only high-confidence replace items', async () => {
    const rows = [];
    const pool = { async query(sql, p) {
      if (/^INSERT INTO code_map_ai_reviews/.test(sql)) { rows.push({ id: rows.length + 1, userId: p[0], status: 'running', model: p[1] }); return { rows: [{ id: rows.length }] }; }
      if (/^UPDATE code_map_ai_reviews SET status = 'done'/.test(sql)) { Object.assign(rows[p[0] - 1], { status: 'done', summary: p[1], result: p[2], inputTokens: p[3], outputTokens: p[4], costUsd: p[5] }); return { rows: [] }; }
      if (/^UPDATE code_map_ai_reviews SET status = 'failed'/.test(sql)) { Object.assign(rows[p[0] - 1], { status: 'failed', error: p[1] }); return { rows: [] }; }
      if (/WHERE status = 'done'/.test(sql)) return { rows: rows.filter((r) => r.status === 'done').slice(-1) };
      if (/^SELECT \* FROM code_map_ai_reviews WHERE id/.test(sql)) return { rows: rows.filter((r) => r.id === p[0]) };
      return { rows: [] };
    } };
    const usage = [];
    const inbox = [];
    const svc = createAiReview({
      pool, collect: () => files, latestRun: async () => null, gather, log: { error() {} },
      getModels: async (u) => (u === 9 ? {} : { standard: 'model-a' }),
      callModel: async (m, p) => ({ text: JSON.stringify({ sites: [{ line: 2, verdict: 'replace', confidence: 'high', does: 'd' }, { line: 4, verdict: 'replace', confidence: 'low' }, { line: 1, verdict: 'keep', confidence: 'high' }] }), inputTokens: 10, outputTokens: 5, model: m }),
      logUsage: (x) => usage.push(x), cost: () => 0.01,
      captureIf: async (c, p) => { if (c) inbox.push(p); }, makeFingerprint: (s, k) => `${s}:${k}`,
    });
    await assert.rejects(svc.start(9), (e) => e.status === 503);
    const est0 = await svc.estimate();
    assert.deepStrictEqual({ files: est0.files, sites: est0.sites, toReview: est0.toReview, calls: est0.calls }, { files: 2, sites: 3, toReview: 2, calls: 2 });
    const id = await svc.start(3);
    await assert.rejects(svc.start(3), (e) => e.status === 409);
    await svc.whenDone(id);
    const row = rows[id - 1];
    assert.strictEqual(row.status, 'done');
    assert.strictEqual(JSON.parse(row.summary).replace, 2);
    assert.strictEqual(row.costUsd, 0.01);
    assert.strictEqual(usage.length, 2);
    assert.ok(usage.every((u) => u.feature === 'code_map_ai_review' && u.model === 'model-a' && u.userId === 3));
    assert.strictEqual(inbox.length, 1, 'only the high-confidence replace');
    assert.ok(inbox[0].fingerprint.startsWith('codeMapAi:server/routes/a.js:'));
    // a second review reuses everything: no model calls
    const est = await svc.estimate();
    assert.strictEqual(est.toReview, 0);
    assert.strictEqual(est.calls, 0);
  });

  console.log(`aiReview tests: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
