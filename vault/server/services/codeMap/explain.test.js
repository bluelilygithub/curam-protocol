#!/usr/bin/env node
/**
 * Code Map "Explain and plan a fix" (explain.js) with a fake run, fake disk and fake model: the path restriction (only server/ and
 * client/src/, nothing that escapes), grounding (only the finding's evidence files are read, around their lines; references outside
 * what was shown are dropped), and model resolution (the workspace's standard model, never a hardcoded id; usage logged).
 * Run: node server/services/codeMap/explain.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { explainFinding, allowedPath, gatherExcerpts, normalizeAnswer, SYSTEM, FEATURE } = require('./explain');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const ROOT = path.resolve('/repo');
const lines = (n, word) => Array.from({ length: n }, (_, i) => `${word} line ${i + 1}`).join('\n');
const DISK = {
  'server/routes/mood.js': lines(400, 'mood'),
  'server/index.js': lines(300, 'index'),
  'client/src/pages/MoodPage.jsx': lines(50, 'page'),
  'server/routes/other.js': lines(20, 'other'),
};
const abs = (rel) => path.join(ROOT, ...rel.split('/'));

function fakeDisk() {
  const reads = [];
  return {
    reads,
    readFile: (p) => {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      reads.push(rel);
      if (!(rel in DISK)) throw new Error('ENOENT');
      return DISK[rel];
    },
    realpath: (p) => (path.relative(ROOT, p).split(path.sep).join('/') === 'server/linked.js' ? path.resolve('/etc/passwd') : p),
  };
}

const RESULT = {
  rules: [{ id: 'rateLimit', label: 'AI rate limit', why: 'Spend can run away.', fix: 'Add aiLimiter.' }, { id: 'housekeeping', label: 'Housekeeping' }],
  tools: [
    { id: 'mood', label: 'Mood', checks: { rateLimit: { status: 'warn', note: 'AI route(s) without aiLimiter: /api/mood', evidence: [
      { file: 'server/index.js', line: 195, text: '/api/mood' },
      { file: 'server/routes/mood.js', line: 10, text: 'callModel(' },
      { file: 'server/routes/mood.js', line: 60, text: 'callModel(' },
      { file: '../.env', line: 1, text: 'SECRET' },
      { file: '/etc/passwd', line: 1, text: '' },
      { file: 'docs/notes.md', line: 1, text: '' },
      { file: 'server/linked.js', line: 1, text: '' },
    ] } } },
    { id: 'notes', label: 'Notes', checks: { rateLimit: { status: 'pass', note: '', evidence: [] } } },
  ],
  findings: [
    { id: 'rule:rateLimit', kind: 'rule', ruleId: 'rateLimit', sev: 'high', area: 'Cost', title: 'AI rate limit: 1 tool to check', tools: ['mood'], evidence: [] },
    { id: 'structure:housekeeping', kind: 'structure', ruleId: 'housekeeping', sev: 'low', title: 'Leftover backups', tools: [], evidence: [{ file: 'client/src/pages/MoodPage.jsx', line: 0, text: 'backup copy' }] },
  ],
};

function deps(over = {}) {
  const disk = fakeDisk();
  const seen = {};
  return {
    disk, seen,
    d: {
      root: ROOT, readFile: disk.readFile, realpath: disk.realpath,
      getRun: async (id) => (id === 5 ? { id: 5, status: 'done', result: RESULT } : id === 6 ? { id: 6, status: 'running' } : null),
      getModels: async (userId) => { seen.modelsFor = userId; return { standard: 'workspace-standard', light: 'workspace-light' }; },
      callModel: async (model, prompt, opts) => {
        Object.assign(seen, { model, prompt, opts });
        return { text: over.answer || JSON.stringify({ explanation: 'The mood route calls a model (server/routes/mood.js:10) but its mount has no limiter (server/index.js:195).', falsePositive: false, steps: [{ do: 'Add aiLimiter to the /api/mood mount.', refs: ['server/index.js:195', 'server/routes/other.js:3', 'server/index.js:999'] }], unsure: '' }), inputTokens: 100, outputTokens: 50 };
      },
      logUsage: (u) => { seen.usage = u; },
      ...over.d,
    },
  };
}

(async () => {
  await t('path restriction: only server/ and client/src/, normalised, nothing that climbs out', async () => {
    assert.strictEqual(allowedPath('server/routes/mood.js'), 'server/routes/mood.js');
    assert.strictEqual(allowedPath('client/src/pages/MoodPage.jsx'), 'client/src/pages/MoodPage.jsx');
    for (const bad of ['../.env', '/etc/passwd', 'C:/Windows/win.ini', 'docs/notes.md', 'server/../../x.js', 'server/./x.js', 'client/other.js',
      'server\\routes\\mood.js', 'server/node_modules/pg/index.js', 'server/.env', '', null, 42, 'server/a\0.js', 'clientx/src/a.js', 'server']) {
      assert.strictEqual(allowedPath(bad), null, `refuses ${JSON.stringify(bad)}`);
    }
  });

  await t('a file whose real path leaves the repo is refused, not read', async () => {
    const disk = fakeDisk();
    const g = gatherExcerpts([{ file: 'server/linked.js', line: 1 }], { root: ROOT, readFile: disk.readFile, realpath: disk.realpath });
    assert.deepStrictEqual(g.excerpts, []);
    assert.deepStrictEqual(disk.reads, []);
    assert.match(g.refused[0].reason, /outside/);
  });

  await t('grounding: only the evidence files are read, around their lines, overlapping windows merged', async () => {
    const { d, disk, seen } = deps();
    const out = await explainFinding(9, { runId: 5, ruleId: 'rateLimit', toolId: 'mood' }, d);
    assert.deepStrictEqual([...new Set(disk.reads)].sort(), ['server/index.js', 'server/routes/mood.js']);
    assert.deepStrictEqual(out.read, [
      { file: 'server/index.js', from: 95, to: 294 },
      { file: 'server/routes/mood.js', from: 1, to: 159 },
    ]);
    assert.deepStrictEqual(out.notRead.map((x) => x.file).sort(), ['../.env', '/etc/passwd', 'docs/notes.md', 'server/linked.js']);
    assert.ok(seen.prompt.includes('195| index line 195'));
    assert.ok(seen.prompt.includes('10| mood line 10'));
    assert.ok(!seen.prompt.includes('mood line 300'), 'nothing past the window');
    assert.ok(!seen.prompt.includes('other line'), 'files not in the evidence are not read');
    assert.ok(!seen.prompt.includes('SECRET line') && !/passwd\n/.test(seen.prompt));
    assert.match(seen.prompt, /AI route\(s\) without aiLimiter: \/api\/mood/);
    assert.match(seen.prompt, /NOT READ/);
  });

  await t('a structural finding uses its own evidence; line 0 reads the start of the file', async () => {
    const { d } = deps();
    const out = await explainFinding(9, { runId: 5, ruleId: 'housekeeping', toolId: 'all' }, d);
    assert.deepStrictEqual(out.read, [{ file: 'client/src/pages/MoodPage.jsx', from: 1, to: 50 }]);
    assert.strictEqual(out.finding.toolId, null);
  });

  await t('references outside the excerpts are dropped', async () => {
    const { d } = deps();
    const out = await explainFinding(9, { runId: 5, ruleId: 'rateLimit', toolId: 'mood' }, d);
    assert.deepStrictEqual(out.steps[0].refs, ['server/index.js:195']);
    assert.ok(out.droppedRefs.includes('server/routes/other.js:3'));
    assert.ok(out.droppedRefs.includes('server/index.js:999'));
  });

  await t('model resolution: the workspace standard model, never a hardcoded id; usage logged', async () => {
    const { d, seen } = deps();
    const out = await explainFinding(9, { runId: 5, ruleId: 'rateLimit', toolId: 'mood' }, d);
    assert.strictEqual(seen.modelsFor, 9);
    assert.strictEqual(seen.model, 'workspace-standard');
    assert.strictEqual(out.model, 'workspace-standard');
    assert.deepStrictEqual(seen.usage, { userId: 9, model: 'workspace-standard', inputTokens: 100, outputTokens: 50, feature: FEATURE });
    assert.strictEqual(seen.opts.system, SYSTEM);
    const src = require('fs').readFileSync(path.join(__dirname, 'explain.js'), 'utf8');
    assert.ok(!/['"`](claude-|gemini-|gpt-|deepseek-)/.test(src), 'no model id in the source');
    const none = deps({ d: { getModels: async () => ({}) } });
    await assert.rejects(explainFinding(9, { runId: 5, ruleId: 'rateLimit', toolId: 'mood' }, none.d), (e) => e.status === 503);
  });

  await t('the instructions demand grounding and "I could not tell"', async () => {
    assert.match(SYSTEM, /ONLY the finding and the excerpts/);
    assert.match(SYSTEM, /I could not tell/);
    assert.match(SYSTEM, /Only cite lines you were shown/);
    assert.match(SYSTEM, /false positive/);
  });

  await t('bad input, missing runs and findings are refused before any model call', async () => {
    const { d, seen } = deps();
    await assert.rejects(explainFinding(9, { runId: 'x', ruleId: 'rateLimit' }, d), (e) => e.status === 400);
    await assert.rejects(explainFinding(9, { runId: 5, ruleId: 'rate limit!' }, d), (e) => e.status === 400);
    await assert.rejects(explainFinding(9, { runId: 7, ruleId: 'rateLimit', toolId: 'mood' }, d), (e) => e.status === 404);
    await assert.rejects(explainFinding(9, { runId: 6, ruleId: 'rateLimit', toolId: 'mood' }, d), (e) => e.status === 400);
    await assert.rejects(explainFinding(9, { runId: 5, ruleId: 'rateLimit', toolId: 'notes' }, d), (e) => e.status === 404, 'notes passes this rule');
    assert.strictEqual(seen.model, undefined);
  });

  await t('an unreadable answer becomes "I could not tell"', async () => {
    const x = normalizeAnswer('sorry, no JSON here', []);
    assert.match(x.explanation, /^I could not tell/);
    assert.deepStrictEqual(x.steps, []);
    const fenced = normalizeAnswer('```json\n{"explanation":"Fine.","falsePositive":true,"steps":[],"unsure":""}\n```', []);
    assert.strictEqual(fenced.falsePositive, true);
  });

  console.log(`explain.test.js: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
