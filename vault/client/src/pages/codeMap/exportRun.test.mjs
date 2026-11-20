// node client/src/pages/codeMap/exportRun.test.mjs
import assert from 'node:assert';
import { mdTable, toCsv, findingsMd, toolMd, toolsCsv, conventionsCsv, runMd, datedName } from './exportRun.mjs';

// CSV quoting: commas, quotes and newlines are quoted; plain values are not
assert.strictEqual(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['line\nbreak', 3]]), 'a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",3');

// Markdown tables escape pipes and flatten newlines so a cell cannot break the table
assert.strictEqual(mdTable(['A'], [['x|y\nz']]), '| A |\n| --- |\n| x\\|y z |');
assert.strictEqual(mdTable(['A'], []), '_None._');

const rules = [{ id: 'models', label: 'No hardcoded model ids', severity: 'high', area: 'AI', why: 'Why.', fix: 'Use getModelsForUser.' }];
const tool = {
  id: 'chat', label: 'Chat', group: 'Core', path: '/chat', score: 50, fails: 1, warns: 0, locClient: 1200, locServer: 3400,
  tests: ['server/routes/chat.test.js'], ownedServer: ['server/routes/chat.js'], ownedClient: [], mounts: [{ path: '/api/chat', aiLimiter: true }],
  checks: { models: { status: 'fail', note: '2 hardcoded ids.', evidence: [{ file: 'server/routes/chat.js', line: 1900, text: "id: 'x'" }] } },
};
const data = {
  summary: { tools: 1, files: 10 }, tools: [tool], rules,
  findings: [{ sev: 'high', title: 'No hardcoded model ids: 1 tool', area: 'AI', body: 'Body.', tools: ['chat'], evidence: tool.checks.models.evidence, evidenceTotal: 3 }],
};

const f = findingsMd(data);
assert.ok(f.includes('### 1. [high] No hardcoded model ids: 1 tool'));
assert.ok(f.includes('**Tools:** Chat'), 'tool ids become labels');
assert.ok(f.includes('first 1 of 3'), 'says when evidence is capped');
assert.ok(f.includes('`server/routes/chat.js:1900` id: \'x\''));
assert.ok(findingsMd({ findings: [] }).includes('Nothing to improve'));

const t = toolMd(tool, rules);
assert.ok(t.includes('**No hardcoded model ids** (gap): 2 hardcoded ids.'));
assert.ok(t.includes('Fix: Use getModelsForUser.'), 'fix shown for a gap');
assert.ok(t.includes('`/api/chat` (aiLimiter)'));
assert.ok(t.includes('`server/routes/chat.js`'));

assert.strictEqual(toolsCsv(data).split('\r\n')[1], 'Chat,chat,Core,,ga,,50,1,0,1200,3400,1');
assert.strictEqual(conventionsCsv(data, rules), 'Tool,Score %,No hardcoded model ids\r\nChat,50,gap');

const all = runMd(data, { finishedAt: '2026-11-20T01:00:00Z' });
for (const h of ['# Vault Code Map', '## Summary', '## What to improve', '## Tools', '## Rules', '## Structure', '## Chat']) assert.ok(all.includes(h), `full export has ${h}`);
assert.ok(runMd({}).startsWith('# Vault Code Map'), 'an empty result does not throw');

assert.strictEqual(datedName('vault-code-map', 'md', '2026-11-20T01:00:00Z'), 'vault-code-map-2026-11-20.md');

console.log('exportRun tests passed');
