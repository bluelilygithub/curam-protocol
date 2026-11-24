'use strict';

// node server/services/codeMap/models/summary.test.js   No database or model needed.

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@127.0.0.1:1/x';
const assert = require('assert');
const { codeSummary, buildEvidence, parseReply, mergeChecked, summarize, FEATURE } = require('./summary');
const { checkFigures } = require('../../../utils/checkFigures');

// ---- the shared figure check, with every digit counted ----
assert.deepStrictEqual(checkFigures('7 tools failed', '{"calls":25,"errors":3}', { minDigits: 1 }), ['7'], 'a single made-up digit is caught when every number is checked');
assert.deepStrictEqual(checkFigures('7 tools failed', '{"calls":25}'), [], 'Business Profiler still ignores single digits');
assert.deepStrictEqual(checkFigures('3 of 25 calls failed (16.7%)', '{"errors":3,"calls":25,"rate":0.167,"title":"16.7% of calls"}', { minDigits: 1 }), []);
assert.deepStrictEqual(checkFigures('12% of calls failed', '{"calls":25,"errors":3}', { minDigits: 1 }), ['12'], 'a figure the model worked out itself (3 of 25) is not in the evidence');
assert.deepStrictEqual(checkFigures('12% of calls failed', '{"rate":0.12}', { minDigits: 1 }), [], 'a stored rate written as a percentage is the same figure');

// ---- a report to summarise ----
const range = { from: '2026-10-25', to: '2026-11-24', days: 30 };
const report = {
  range, counts: { high: 1, medium: 1, low: 0 }, thresholds: { minCalls: 20 },
  workspaceFindings: [{ kind: 'unavailableModel', severity: 'high', title: 'No gemini key for gemini-2.5-flash', evidence: { tools: ['CRM'] } }],
  findings: [
    { tool: '(workspace)', kind: 'unavailableModel', severity: 'high', title: 'No gemini key for gemini-2.5-flash' },
    { tool: 'newsDigest', kind: 'backupOften', severity: 'medium', title: 'News Digest: backup used on 20.0% of calls' },
  ],
  tools: [
    { tool: 'newsDigest', label: 'News Digest', notEnoughData: false, stats: { calls: 25, errors: 3, costUsd: 0.225, medianMs: 1120, errorRate: 0.1071, backupRate: 0.2 },
      findings: [{ kind: 'backupOften', severity: 'medium', title: 'News Digest: backup used on 20.0% of calls', evidence: { fallbacks: 5, calls: 25, rate: 0.2 } }] },
    { tool: 'notes', label: 'Notes', notEnoughData: true, stats: null, findings: [] },
  ],
};

// ---- the app's own text ----
const app = codeSummary(report);
assert.match(app.overall, /^1 high, 1 medium and 0 low findings across 2 tools \(usage 2026-10-25 to 2026-11-24\)\./);
assert.match(app.overall, /Most urgent: No gemini key for gemini-2\.5-flash\./);
assert.match(app.overall, /1 tool had fewer than 20 calls, so it gets no error/);
assert.match(app.overall, /Nothing was changed/);
assert.deepStrictEqual(Object.keys(app.tools), ['newsDigest'], 'only tools with findings get a line');
assert.strictEqual(app.tools.newsDigest, 'backup used on 20.0% of calls.');
assert.match(codeSummary({ ...report, counts: { high: 0, medium: 0, low: 0 }, findings: [], tools: [] }).overall, /No problems found/);

// ---- what the model sees ----
const ev = buildEvidence(report);
assert.deepStrictEqual(ev.tools.map((t) => t.id), ['newsDigest'], 'only tools with findings');
assert.strictEqual(ev.toolsWithTooFewCalls, 1);

// ---- reading the reply ----
assert.strictEqual(parseReply('no json here'), null);
assert.strictEqual(parseReply('{bad'), null);
assert.deepStrictEqual(parseReply('Sure: {"overall":"  A  b ","tools":{"newsDigest":"x","empty":""}}'), { overall: 'A b', tools: { newsDigest: 'x' } });

// ---- the figure check decides, part by part ----
const evidenceText = JSON.stringify(ev);
const merged = mergeChecked({
  app, evidenceText, toolIds: ['newsDigest'],
  model: { overall: 'One high finding: no gemini key. News Digest fell back on 5 of 25 calls.', tools: { newsDigest: 'The backup answered 40% of calls.' } },
});
assert.strictEqual(merged.overall.source, 'model', 'every number (1? no: "One"; 5, 25) is in the evidence');
assert.strictEqual(merged.tools.newsDigest.source, 'app', 'a summary with a number not in the evidence is rejected');
assert.deepStrictEqual(merged.tools.newsDigest.rejected.unverified, ['40']);
assert.strictEqual(merged.tools.newsDigest.text, app.tools.newsDigest, 'and the app text is shown instead');

// ---- the whole summary, with stand-ins for the model ----
const deps = (callModel, models = { light: 'claude-haiku-4-5', standard: 'claude-sonnet-4-6' }) => {
  const logged = [];
  return {
    logged,
    deps: {
      getModelsForUser: async () => models,
      pickTextModel: (t, prefer) => (prefer === 'light' ? t.light || t.standard : t.standard) || null,
      callModel, logUsage: (row) => logged.push(row),
    },
  };
};

(async () => {
  // the weekly cron: no model call at all
  let called = 0;
  const off = await summarize(report, { userId: 3, useModel: false, deps: deps(async () => { called += 1; }).deps });
  assert.strictEqual(called, 0);
  assert.strictEqual(off.overall.source, 'app');
  assert.match(off.reason, /makes no AI call/);

  // a good reply: used, logged under the feature, light model chosen
  const good = deps(async (modelId, prompt, opts) => {
    assert.strictEqual(modelId, 'claude-haiku-4-5', 'the light model writes it');
    assert.match(opts.system, /Every number you write must appear in the evidence/);
    assert.match(opts.system, /never say a model was changed/);
    assert.match(prompt, /^EVIDENCE:\n\{/);
    return { text: JSON.stringify({ overall: 'Two findings. Add the gemini key first.', tools: { newsDigest: 'The backup answered 5 of 25 calls; check the primary.' } }), inputTokens: 900, outputTokens: 80, latencyMs: 1500 };
  });
  const s = await summarize(report, { userId: 3, useModel: true, deps: good.deps });
  assert.strictEqual(s.overall.source, 'model');
  assert.strictEqual(s.tools.newsDigest.source, 'model');
  assert.strictEqual(s.model, 'claude-haiku-4-5');
  assert.match(s.reason, /every number checked against the evidence\.$/);
  assert.deepStrictEqual(good.logged.map((r) => [r.feature, r.userId, r.inputTokens, r.latencyMs]), [[FEATURE, 3, 900, 1500]]);

  // an invented number in the overall text: that part falls back, the reason says so
  const lying = deps(async () => ({ text: JSON.stringify({ overall: 'There are 9 findings.', tools: { newsDigest: 'Backup used on 20.0% of calls.' } }), inputTokens: 1, outputTokens: 1 }));
  const l = await summarize(report, { userId: 3, useModel: true, deps: lying.deps });
  assert.strictEqual(l.overall.source, 'app');
  assert.deepStrictEqual(l.overall.rejected.unverified, ['9']);
  assert.strictEqual(l.tools.newsDigest.source, 'model');
  assert.match(l.reason, /1 part used a number not in the evidence/);

  // failures fall back to the app's text, never throw
  assert.match((await summarize(report, { userId: 3, useModel: true, deps: deps(async () => { throw new Error('overloaded'); }).deps })).reason, /AI summary failed \(overloaded\)/);
  assert.match((await summarize(report, { userId: 3, useModel: true, deps: deps(async () => ({ text: 'Sorry, no.' })).deps })).reason, /could not be read/);
  assert.match((await summarize(report, { userId: 3, useModel: true, deps: deps(async () => ({}), { light: null, standard: null }).deps })).reason, /no AI model is set up/);

  console.log('summary.test.js: all passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
