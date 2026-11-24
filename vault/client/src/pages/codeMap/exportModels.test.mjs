// node client/src/pages/codeMap/exportModels.test.mjs
import assert from 'node:assert';
import { modelActions, modelsByRole, modelsCsv, modelsHtml, modelsMd, modelsSheets } from './exportModels.mjs';

const tool = {
  label: 'PDF Tools', notEnoughData: false,
  models: [
    { role: 'default', modelId: 'claude-sonnet-4-6' }, { role: 'default', modelId: 'claude-sonnet-4-6' },
    { role: 'dedicated', modelId: 'claude-sonnet-4-6', savedId: 'old-model' },
    { role: 'backup', modelId: null, savedId: null },
  ],
  stats: { calls: 42, costUsd: 0.5, medianMs: 1200, errorRate: 0.0476, backupRate: 0 },
  findings: [{ severity: 'high', kind: 'unavailableModel' }],
};
assert.deepStrictEqual(modelsByRole(tool), { default: ['claude-sonnet-4-6'], backup: ['not set'], dedicated: ['claude-sonnet-4-6'] });
const csv = modelsCsv({ tools: [tool, { label: 'Notes, etc', models: [], stats: null, findings: [], notEnoughData: true }] });
assert.match(csv, /^Tool,Default,Backup,Dedicated/);
assert.match(csv, /PDF Tools,claude-sonnet-4-6,not set,claude-sonnet-4-6,42,\$0\.5000,1200 ms,4\.8%,0\.0%,high: unavailableModel/);
assert.match(csv, /"Notes, etc",,,,0,,,,,not enough data/, 'commas quoted, no usage shown as zero calls and "not enough data"');
const md = modelsMd({ generatedAt: 'now', range: { from: 'a', to: 'b', days: 30 }, counts: { high: 1 }, findings: [{ severity: 'high', title: 'T', detail: 'D' }], tools: [tool] });
assert.match(md, /# Code Map: Models/);
assert.match(md, /- \*\*high\*\* · T\. D/);
assert.match(md, /Recommendations only/);
assert.doesNotMatch(md, /## In short/, 'no summary section when the report has none');
const withSummary = modelsMd({ counts: {}, findings: [], tools: [], summary: { overall: { text: 'All fine.' }, reason: 'Written by the app.' } });
assert.match(withSummary, /## In short\nAll fine\.\n_Written by the app\._/);
// What to do: one action per finding, from its evidence
const rep = { counts: { high: 2, low: 1 }, tools: [tool], findings: [
  { severity: 'high', kind: 'unavailableModel', label: 'Workspace', title: 'No light model is set', detail: 'D1', evidence: { tier: 'light', tools: ['A', 'B'] } },
  { severity: 'high', kind: 'unavailableModel', label: 'PDF Tools', title: 't', detail: 'D2', evidence: { via: 'setting:pdf_html_model', saved: 'old-model', usedInstead: 'claude-sonnet-4-6' } },
  { severity: 'low', kind: 'newerModel', label: 'Workspace', modelId: 'm-1', title: 't', detail: 'D3', evidence: { current: 'm-1', candidate: 'm-2' } },
  { severity: 'medium', kind: 'somethingNew', label: 'X', title: 'Fallback title', detail: 'D4' },
] };
const acts = modelActions(rep);
assert.strictEqual(acts.length, 4);
assert.deepStrictEqual(acts.map((a) => a.priority), ['Do now', 'Do now', 'Worth testing', 'Soon']);
assert.match(acts[0].action, /Set a light model in Settings → Models: 2 tools/);
assert.match(acts[1].action, /change pdf_html_model for PDF Tools: old-model is no longer connected, so it uses claude-sonnet-4-6/);
assert.strictEqual(acts[1].via, 'setting:pdf_html_model');
assert.match(acts[2].action, /Trial m-2 in place of m-1/);
assert.strictEqual(acts[3].action, 'Fallback title', 'unknown kinds fall back to the title');
const tested = (label) => modelActions({ findings: [{ severity: 'low', kind: 'newerModel', label: 'Workspace', evidence: { current: 'm-1', candidate: 'm-2', test: { label } } }] })[0].action;
assert.match(tested('same'), /^Swap m-1 for m-2 in Settings: a test set found the same quality/);
assert.match(tested('worse'), /^Keep m-1: a test set found m-2 worse/);
assert.match(tested('notEnough'), /^Trial m-2/, 'not enough evidence keeps the trial wording');
assert.match(modelsMd(rep), /## What to do\n- \*\*Do now\*\* · Set a light model/);
const html = modelsHtml({ ...rep, tools: [{ ...tool, label: 'A <b>' }] });
assert.match(html, /<h2>What to do<\/h2>/);
assert.match(html, /A &lt;b&gt;/, 'HTML is escaped');
const sheets = modelsSheets(rep);
assert.deepStrictEqual(Object.keys(sheets), ['What to do', 'Findings', 'Tools']);
assert.strictEqual(sheets['What to do'].length, 5);
assert.strictEqual(sheets.Tools[1][0], 'PDF Tools');
console.log('exportModels.test.mjs: all passed');
