'use strict';

// node server/services/codeMap/models/check.test.js   No database, model or inbox needed.

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@127.0.0.1:1/x';
const assert = require('assert');
const { percentile, attributeCallers, aggregate } = require('./usage');
const { THRESHOLDS, toolFindings, newerSameFamily, newerModelFindings, workspaceUnavailableFindings } = require('./findings');
const { buildReport, runModelsCheck } = require('./check');
const { appCallers } = require('../../callModel');
const { MODEL_NEEDS } = require('../../../config/modelNeeds');

// ---- percentiles ----
assert.strictEqual(percentile([], 0.5), null);
assert.strictEqual(percentile([100, 300, 200], 0.5), 200);
assert.strictEqual(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9, 'linear between ranks like percentile_cont');
assert.strictEqual(percentile([5, null, NaN], 0.5), 5, 'missing timings are ignored');

// ---- the call stack a failure records ----
const stack = [
  'Error',
  '    at callModel (C:\\Users\\m\\Local Sites\\vault\\server\\services\\callModel.js:70:17)',
  '    at askThing (C:\\Users\\m\\Local Sites\\vault\\server\\services\\fontsTutor.js:12:9)',
  '    at async C:\\Users\\m\\Local Sites\\vault\\server\\routes\\fontsTutor.js:30:5',
  '    at Layer.handle (C:\\x\\node_modules\\express\\lib\\router\\layer.js:95:5)',
  '    at /app/server/services/guideCore.js:108:3',
  '    at async /app/server/services/fontsTutor.js:12:9',
].join('\n');
assert.strictEqual(appCallers(stack), 'server/services/fontsTutor.js>server/routes/fontsTutor.js>server/services/guideCore.js',
  'app files only (spaces in Windows paths are fine), no callModel.js, no node_modules, each once');
assert.match(appCallers(new Error().stack), /^server\/services\/codeMap\/models\/check\.test\.js/, 'a real stack works');

// ---- which tool a failure belongs to ----
const ownerOf = new Map([['server/routes/fontsTutor.js', 'fonts'], ['server/routes/contractReview.js', 'contractReview']]);
const toolFiles = { contractReview: ['server/routes/contractReview.js', 'server/services/contractReview/segmentation.js'], tasks: ['server/routes/tasks.js'] };
assert.strictEqual(attributeCallers('server/services/guideCore.js>server/routes/fontsTutor.js', { ownerOf, toolFiles }), 'fonts', 'the first owned file wins over shared plumbing');
assert.strictEqual(attributeCallers('server/services/contractReview/segmentation.js', { ownerOf, toolFiles }), 'contractReview', 'a shared file only one tool reaches');
assert.strictEqual(attributeCallers('server/services/somewhere.js', { ownerOf, toolFiles }), null);

// ---- aggregation ----
const agg = aggregate({
  usageRows: [
    { feature: 'skill_scan_summary', modelId: 'claude-sonnet-4-6', calls: 15, cost: 0.3, sumIn: 30000, sumOut: 6000, latencies: [1000, 2000], fallbacks: 0 },
    { feature: 'skill_scan_deep', modelId: 'claude-sonnet-4-6', calls: 5, cost: 0.2, sumIn: 10000, sumOut: 2000, latencies: [3000], fallbacks: 0 },
    { feature: 'mystery_feature', modelId: 'x', calls: 3, cost: 0, sumIn: 0, sumOut: 0, latencies: [], fallbacks: 0 },
  ],
  errorRows: [{ modelId: 'claude-sonnet-4-6', callers: 'server/routes/skillScan.js' }, { modelId: 'x', callers: 'server/nowhere.js' }],
  ownerOf: new Map([['server/routes/skillScan.js', 'skillScan']]), toolFiles: {},
});
const ss = agg.byTool.skillScan;
assert.deepStrictEqual([ss.calls, ss.errors, ss.attempts, ss.avgInputTokens, ss.medianMs, ss.timedCalls], [20, 1, 21, 2000, 2000, 3]);
assert.strictEqual(ss.costUsd, 0.5);
assert.strictEqual(ss.errorRate, Number((1 / 21).toFixed(4)));
assert.deepStrictEqual(agg.unmappedFeatures, ['mystery_feature'], 'a feature no tool claims is reported, not dropped silently');
assert.strictEqual(agg.unattributedErrors, 1);

// ---- rules ----
const range = { from: '2026-10-25', to: '2026-11-24', days: 30 };
const tiers = { standard: 'claude-sonnet-4-6', light: 'claude-haiku-4-5' };
const model = (o) => ({ role: 'default', via: 'tier:standard', modelId: 'claude-sonnet-4-6', provider: 'anthropic', inList: true, providerKey: true, info: { vision: true, json: true, context: 200000, capabilitySource: 'family' }, ...o });
const stats = (o) => ({ calls: 100, errors: 0, attempts: 100, fallbacks: 0, backupRate: 0, errorRate: 0, avgInputTokens: 10000, avgOutputTokens: 2000, costUsd: 1, byModel: {}, ...o });
const kinds = (r) => r.findings.map((f) => `${f.kind}:${f.severity}`);

// capability mismatch: a vision tool on a non-vision model
const vis = toolFindings({ row: { tool: 'pdf', label: 'PDF Tools', needs: MODEL_NEEDS.pdf, models: [model({ via: 'setting:pdf_html_model', role: 'dedicated', modelId: 'deepseek-chat', provider: 'deepseek', info: { vision: false, json: true, context: 64000, capabilitySource: 'family' } })] }, stats: stats(), tiers, range });
assert.deepStrictEqual(kinds(vis), ['capabilityMismatch:high']);
assert.match(vis.findings[0].title, /takes no images/);
assert.deepStrictEqual(vis.findings[0].evidence.range, range, 'every finding carries its date range');
// unknown capability is not a mismatch; an explicit deepseek tier is not held to the tool's needs
assert.deepStrictEqual(kinds(toolFindings({ row: { tool: 'pdf', label: 'PDF', needs: MODEL_NEEDS.pdf, models: [model({ info: { vision: null, json: null, context: null } }), model({ via: 'tier:deepseek', modelId: 'deepseek-chat', provider: 'deepseek', info: { vision: false } })] }, stats: stats(), tiers, range })), []);
// too little context
assert.match(toolFindings({ row: { tool: 'contractReview', label: 'CR', needs: MODEL_NEEDS.contractReview, models: [model({ info: { vision: true, json: true, context: 64000 } })] }, stats: stats(), tiers, range }).findings[0].title, /64000 tokens, the tool needs 100000/);

// hardcoded (Code Map's own rule) and unavailable
const unav = toolFindings({
  row: { tool: 'x', label: 'X', needs: MODEL_NEEDS.notes, hardcoded: { note: '2+ hardcoded model id(s)', evidence: [{ file: 'a.js', line: 3 }] }, models: [
    model({ via: 'tier:light', modelId: null }),
    model({ via: 'tier:deepseek', modelId: null, provider: null }), // an optional extra: not a finding
    // the saved id is gone; the model actually used (the fallback) IS in the list, which must not hide it
    model({ role: 'dedicated', via: 'setting:x_model', savedId: 'gone-1', savedInList: false, inList: true }),
  ] },
  stats: stats(), tiers, range,
});
assert.deepStrictEqual(kinds(unav), ['hardcodedModel:high', 'unavailableModel:high'], 'a tier not set is a workspace finding, not one per tool');
assert.match(unav.findings[1].detail, /gone-1, which is no longer connected/);
// a missing provider key, and a workspace model that is not set: once each for the workspace, listing the tools
const ws = workspaceUnavailableFindings([
  { label: 'CRM', models: [model({ modelId: 'gemini-2.5-flash', provider: 'gemini', providerKey: false }), model({ via: 'tier:standard', modelId: null })] },
  { label: 'YouTube', models: [model({ modelId: 'gemini-2.5-flash', provider: 'gemini', providerKey: false }), model({ via: 'tier:standard', modelId: null }), model({ via: 'tier:deepseek', modelId: null })] },
], range);
assert.deepStrictEqual(ws.map((f) => f.title), ['No standard model is set', 'No gemini key for gemini-2.5-flash'], 'no workspace models at all is one finding, not one per tool; an unset deepseek tier is none');
assert.ok(ws.every((f) => f.severity === 'high'));
assert.deepStrictEqual(ws[0].evidence.tools, ['CRM', 'YouTube']);
assert.deepStrictEqual(ws[1].evidence.tools, ['CRM', 'YouTube']);

// backup used often, high error rate
const busy = toolFindings({ row: { tool: 'newsDigest', label: 'News digest', needs: MODEL_NEEDS.newsDigest, models: [] }, stats: stats({ calls: 40, fallbacks: 6, backupRate: 0.15, errors: 4, attempts: 44, errorRate: 0.0909 }), tiers, range });
assert.deepStrictEqual(kinds(busy).sort(), ['backupOften:medium', 'highErrorRate:medium']);
assert.strictEqual(busy.findings.find((f) => f.kind === 'backupOften').evidence.calls, 40, 'evidence carries the sample size');

// under 20 calls: no quality or cost findings, but "not enough data" — capability findings still apply
const thin = toolFindings({ row: { tool: 'newsDigest', label: 'News digest', needs: MODEL_NEEDS.newsDigest, models: [model({ modelId: null })] }, stats: stats({ calls: 10, attempts: 12, fallbacks: 9, backupRate: 0.9, errors: 2, errorRate: 0.17 }), tiers, range });
assert.strictEqual(thin.notEnoughData, true);
assert.deepStrictEqual(kinds(thin), [], 'no backup/error findings on 12 calls (and an unset tier is a workspace finding)');
assert.strictEqual(toolFindings({ row: { tool: 'a', label: 'A', needs: {}, models: [] }, stats: undefined, tiers, range }).notEnoughData, true, 'no usage at all is not enough data');

// cheaper tier: background + standard + small calls, worded as a trial
const cheap = toolFindings({ row: { tool: 'newsDigest', label: 'News digest', needs: MODEL_NEEDS.newsDigest, models: [model()] }, stats: stats({ avgInputTokens: 1500, avgOutputTokens: 300 }), tiers, range });
assert.deepStrictEqual(kinds(cheap), ['cheaperTier:low']);
assert.match(cheap.findings[0].detail, /not a sure saving/);
assert.deepStrictEqual(kinds(toolFindings({ row: { tool: 'notes', label: 'Notes', needs: MODEL_NEEDS.notes, models: [model()] }, stats: stats({ avgInputTokens: 1500, avgOutputTokens: 300 }), tiers, range })), [], 'an interactive tool is not told to trial light');

// newer model: same family, newer, same or lower price
assert.strictEqual(newerSameFamily('claude-sonnet-4-6').candidate, 'claude-sonnet-5-5');
assert.strictEqual(newerSameFamily('claude-opus-5').candidate, 'claude-opus-5-5');
assert.strictEqual(newerSameFamily('claude-sonnet-5-5'), null, 'already the newest');
assert.strictEqual(newerSameFamily('claude-haiku-4-5', ['claude-haiku-4-5', 'claude-sonnet-5-5']), null, 'another family is not a candidate');
assert.strictEqual(newerSameFamily('claude-sonnet-4-6', ['claude-sonnet-4-6', 'claude-sonnet-9-9']), null, 'an unpriced (family-priced, dearer) newer id is not suggested');
const newer = newerModelFindings([{ label: 'A', models: [model()] }, { label: 'B', models: [model()] }], range);
assert.strictEqual(newer.length, 1, 'once per model for the workspace, not once per tool');
assert.deepStrictEqual(newer[0].evidence.tools, ['A', 'B']);

// ---- the whole check: stored, inbox only for high/medium, de-duplicated across runs ----
const inventory = {
  adminId: 7, tiers, undeclared: [], unknownNeeds: [], ownerOf: new Map(), toolFiles: {},
  tools: [
    { tool: 'pdf', label: 'PDF Tools', needs: MODEL_NEEDS.pdf, needsDeclared: true, hardcoded: null, models: [model({ via: 'setting:pdf_html_model', role: 'dedicated', modelId: 'deepseek-chat', provider: 'deepseek', info: { vision: false, json: true, context: 64000, capabilitySource: 'family', price: { input: 1, output: 5 }, priced: false } })] },
    { tool: 'notes', label: 'Notes', needs: MODEL_NEEDS.notes, needsDeclared: true, hardcoded: { note: '1+ hardcoded model id(s)', evidence: [] }, models: [model({ info: { ...model().info, price: { input: 3, output: 15 }, priced: true } })] },
  ],
};
const usage = { usageRows: [], errorRows: [], from: range.from, to: range.to, days: 30 };
const report = buildReport({ inventory, usage, aggregate });
assert.deepStrictEqual(report.counts, { high: 2, medium: 0, low: 1 }, 'capability mismatch + hardcoded id + newer model for sonnet-4-6');
assert.strictEqual(report.tools.find((t) => t.tool === 'notes').notEnoughData, true);
assert.ok(!('info' in report.tools[0].models[0]), 'the stored report keeps a slim model, not the whole price entry');

const inbox = new Map(); // SuggestionService: one open row per fingerprint, refreshed when raised again
const stored = [];
const fakePool = { async query(sql, params) { if (/^INSERT INTO code_map_model_reports/.test(sql)) { stored.push(JSON.parse(params[1])); return { rows: [{ id: stored.length }] }; } return { rows: [] }; } };
const deps = {
  pool: fakePool, loadInventory: async () => inventory, loadUsage: async () => usage, aggregate,
  captureIf: async (cond, p) => { if (!cond) return null; inbox.set(p.fingerprint, (inbox.get(p.fingerprint) || 0) + 1); return p; },
  makeFingerprint: (src, key) => `${src}:${key}`, log: { info() {}, error() {} },
};
(async () => {
  const first = await runModelsCheck(deps);
  const second = await runModelsCheck(deps);
  assert.deepStrictEqual([first.id, second.id], [1, 2]);
  assert.strictEqual(inbox.size, 1, 'the same finding on two runs is one inbox item (same fingerprint, refreshed); the hardcoded id is left to Code Map; low stays off');
  assert.deepStrictEqual([...inbox.keys()], ['codeMapModels:pdf:capabilityMismatch:deepseek-chat']);
  assert.strictEqual([...inbox.values()][0], 2, 'raised again on the second run, so the existing item is refreshed');
  assert.strictEqual(stored.length, 2);
  assert.strictEqual(stored[0].summary.overall.source, 'app', 'the weekly-style run stores the app summary without a model call');
  assert.match(stored[0].summary.reason, /no AI call/);
  // a summary that throws never loses the check: the app's text is stored instead and the error is logged
  const errs = [];
  let tries = 0;
  const flaky = async (rep, o) => { tries += 1; if (o.useModel) throw new Error('model down'); return require('./summary').summarize(rep, o); };
  const third = await runModelsCheck({ ...deps, summarize: flaky, summaryWithModel: true, log: { info() {}, error: (o, m) => errs.push(m) } });
  assert.strictEqual(third.report.summary.overall.source, 'app');
  assert.deepStrictEqual([tries, errs], [2, ['[codeMapModels] summary failed']]);
  console.log('check.test.js: all passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

void THRESHOLDS;
