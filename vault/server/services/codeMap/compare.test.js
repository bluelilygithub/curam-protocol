#!/usr/bin/env node
/**
 * Code Map drift between two runs (compare.js). Runs the analyzer on the fixture repo, changes a few files in memory, runs it
 * again and checks what compareRuns reports; plus small hand-made results for status changes, ordering and added tools.
 * Run: node server/services/codeMap/compare.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { analyze } = require('./index');
const { collectFiles } = require('./files');
const { compareRuns, findingItems } = require('./compare');

const ROOT = path.join(__dirname, '__fixtures__', 'repo');
const base = collectFiles(ROOT);
const before = analyze({ root: ROOT, files: base, log: null });

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const keys = (list) => list.map((x) => x.key).sort();

t('a run compared with itself has no changes', () => {
  const d = compareRuns(before, before);
  assert.deepStrictEqual([d.newFindings, d.resolvedFindings, d.changedFindings, d.scores, d.toolsAdded, d.toolsRemoved, d.cyclesGained, d.cyclesLost],
    [[], [], [], [], [], [], [], []]);
  assert.strictEqual(d.summary.tools.delta, 0);
});

t('findings are split per tool and per file', () => {
  const items = findingItems(before);
  assert.ok(items.has('rule:tests:recipes'));
  assert.ok(items.has('rule:apiClient:mood'));
  assert.ok(items.has('crossToolCycle:server/services/plannerUtil.js | server/services/routeShape.js'));
  assert.ok(items.has('cronRequiresRoute:server/cron/moodCron.js:../routes/mood'));
  assert.ok(items.has('housekeeping:server/old_bk.js'));
  assert.ok(items.has('housekeeping:server/services/lonelyWidget.js'));
  assert.ok(!items.has('rule:tests:notes'), 'notes passes the tests rule');
});

// the "after" repo: a new gap, two fixes, a broken cycle, a deleted backup, and a cron file whose lines moved
const files = { ...base };
files['client/src/pages/RecipesPage.jsx'] = files['client/src/pages/RecipesPage.jsx'].replace("apiClient('/api/recipes');", "fetch('/api/recipes');");
files['server/services/cycleB.js'] = '// no longer requires cycleA\n';
delete files['server/old_bk.js'];
files['server/cron/moodCron.js'] = `// moved down two lines\n\n${files['server/cron/moodCron.js']}`;
files['server/routes/mood.js'] = files['server/routes/mood.js'].replace(/console\.(log|warn|error|info)\(/g, 'log.info(');
const after = analyze({ root: ROOT, files, log: null });
const d = compareRuns(before, after);

t('a new gap is reported as a new finding for that tool', () => {
  const n = d.newFindings.find((x) => x.key === 'rule:apiClient:recipes');
  assert.ok(n, `new: ${keys(d.newFindings)}`);
  assert.strictEqual(n.sev, 'medium');
  assert.strictEqual(n.toolLabel, 'Recipes');
  assert.ok(n.files.some((f) => f.startsWith('client/src/pages/RecipesPage.jsx:')));
});

t('fixes are reported as resolved', () => {
  assert.ok(keys(d.resolvedFindings).includes('housekeeping:server/old_bk.js'), `resolved: ${keys(d.resolvedFindings)}`);
  assert.ok(keys(d.resolvedFindings).includes('rule:logging:mood'), `resolved: ${keys(d.resolvedFindings)}`);
});

t('a cron file whose lines moved is not new or resolved', () => {
  assert.ok(!d.newFindings.some((x) => x.ruleId === 'cronRequiresRoute'));
  assert.ok(!d.resolvedFindings.some((x) => x.ruleId === 'cronRequiresRoute'));
});

t('score movement, worst first', () => {
  const r = d.scores.find((s) => s.id === 'recipes');
  assert.ok(r && r.delta < 0, JSON.stringify(d.scores));
  const m = d.scores.find((s) => s.id === 'mood');
  assert.ok(m && m.delta > 0);
  assert.strictEqual(d.scores[0].id, 'recipes');
  assert.strictEqual(d.counts.scoresDown, 1);
});

t('cycles gained and lost, and summary deltas', () => {
  assert.deepStrictEqual(d.cyclesLost.map((c) => [...c].sort()), [['server/services/cycleA.js', 'server/services/cycleB.js']]);
  assert.deepStrictEqual(d.cyclesGained, []);
  assert.strictEqual(d.summary.cycles.delta, -1);
  assert.strictEqual(d.summary.files.delta, -1);
});

// hand-made results for what the fixture cannot show easily
const tool = (id, score, checks) => ({ id, label: id.toUpperCase(), score, checks });
const result = (tools, findings, extra = {}) => ({ summary: { tools: tools.length }, tools, findings, rules: [{ id: 'docs', label: 'Docs' }, { id: 'ssrf', label: 'SSRF guard' }, { id: 'logging', label: 'Logger' }], cycles: [], backups: [], orphans: [], ...extra });
const ruleF = (ruleId, sev, notes) => ({ kind: 'rule', ruleId, sev, tools: notes.map((n) => n.tool), toolNotes: notes, evidence: [] });

t('amber to red is a worse change, red to amber a better one; worse first', () => {
  const A = result([tool('a', 80), tool('b', 80)], [ruleF('docs', 'low', [{ tool: 'a', status: 'warn', note: '' }, { tool: 'b', status: 'fail', note: '' }])]);
  const B = result([tool('a', 70), tool('b', 90)], [ruleF('docs', 'low', [{ tool: 'a', status: 'fail', note: '' }, { tool: 'b', status: 'warn', note: '' }])]);
  const x = compareRuns(A, B);
  assert.deepStrictEqual(x.changedFindings.map((c) => [c.toolId, c.fromStatus, c.status, c.worse]), [['a', 'warn', 'fail', true], ['b', 'fail', 'warn', false]]);
  assert.deepStrictEqual(x.newFindings, []);
  assert.deepStrictEqual(x.counts.worse, 1);
});

t('new findings come high first; tools added and removed', () => {
  const A = result([tool('a', 100), tool('gone', 50)], []);
  const B = result([tool('a', 60), tool('fresh', 90)], [
    ruleF('logging', 'low', [{ tool: 'a', status: 'warn', note: '' }]),
    ruleF('ssrf', 'high', [{ tool: 'a', status: 'warn', note: '' }]),
  ]);
  const x = compareRuns(A, B);
  assert.deepStrictEqual(x.newFindings.map((n) => n.ruleId), ['ssrf', 'logging']);
  assert.strictEqual(x.counts.newHigh, 1);
  assert.deepStrictEqual(x.toolsAdded.map((u) => u.id), ['fresh']);
  assert.deepStrictEqual(x.toolsRemoved.map((u) => u.id), ['gone']);
  assert.deepStrictEqual(x.scores.map((s) => [s.id, s.delta]), [['a', -40]]);
});

t('cycles match whatever order the files come in', () => {
  const A = result([], [], { cycles: [['x.js', 'y.js', 'z.js']] });
  const B = result([], [], { cycles: [['z.js', 'x.js', 'y.js']] });
  const x = compareRuns(A, B);
  assert.deepStrictEqual([x.cyclesGained, x.cyclesLost], [[], []]);
});

t('missing or empty results do not throw', () => {
  const x = compareRuns(null, {});
  assert.deepStrictEqual(x.newFindings, []);
});

console.log(`compare.test.js: ${passed} passed`);
