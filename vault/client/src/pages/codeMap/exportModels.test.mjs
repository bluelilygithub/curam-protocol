// node client/src/pages/codeMap/exportModels.test.mjs
import assert from 'node:assert';
import { modelsByRole, modelsCsv, modelsMd } from './exportModels.mjs';

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
console.log('exportModels.test.mjs: all passed');
