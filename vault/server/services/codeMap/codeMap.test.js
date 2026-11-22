'use strict';

// node server/services/codeMap/codeMap.test.js
// Unit tests for the Code Map analyzer, on the small fake repo in __fixtures__/repo (see its README).

const assert = require('assert');
const path = require('path');
const { analyze } = require('./index');
const { collectFiles, isTest, locOf } = require('./files');
const { resolve, buildGraph } = require('./imports');
const { parseMounts, mountsForApi } = require('./mounts');
const { mountOwner, kebab, COMMON_T } = require('./ownership');
const { findCycles } = require('./structure');
const { RULES, RULE_BY_ID, buildRuleContext, pyRound, flagKeys, lifecycleKeys } = require('./rules');
const { sortFindings } = require('./findings');

const ROOT = path.join(__dirname, '__fixtures__', 'repo');
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

const files = collectFiles(ROOT);
const result = analyze({ root: ROOT, log: null });
const T = Object.fromEntries(result.tools.map((t) => [t.id, t]));
const M = Object.fromEntries(result.mounts.map((m) => [m.path, m]));

// ---------- files ----------
test('files: walks server and client/src, js-like files only, tests recognised', () => {
  assert.ok(files['server/index.js']);
  assert.ok(files['client/src/App.jsx']);
  assert.ok(!Object.keys(files).some((f) => f.startsWith('docs/') || f.startsWith('planner/')));
  assert.strictEqual(isTest('server/routes/notes.test.js'), true);
  assert.strictEqual(isTest('client/src/x.spec.jsx'), true);
  assert.strictEqual(isTest('client/src/__tests__/a.js'), true);
  assert.strictEqual(isTest('server/routes/notes.js'), false);
  assert.strictEqual(locOf('a\nb\n'), 3, 'same as Python count("\\n") + 1');
  assert.strictEqual(result.summary.tests, 1);
});

// ---------- imports ----------
test('imports: extension, index file, static and lazy imports', () => {
  assert.strictEqual(resolve(files, 'server/routes/recipes.js', '../services/callModel'), 'server/services/callModel.js');
  assert.strictEqual(resolve(files, 'server/routes/recipes.js', '../services/recipeKit'), 'server/services/recipeKit/index.js');
  assert.strictEqual(resolve(files, 'client/src/App.jsx', './pages/recipes'), 'client/src/pages/recipes/index.jsx');
  assert.strictEqual(resolve(files, 'server/index.js', './nope'), null);
  const { deps, importers } = buildGraph(files);
  assert.ok(deps.get('client/src/App.jsx').has('client/src/pages/RecipesPage.jsx'), 'lazy(() => import()) is an edge');
  assert.ok(deps.get('client/src/pages/RecipesPage.jsx').has('client/src/pages/recipes/lazyPanel.jsx'), 'bare import() is an edge');
  assert.ok(deps.get('client/src/pages/NotesPage.jsx').has('client/src/components/Common.jsx'), 'import X from is an edge');
  assert.ok(!deps.get('client/src/pages/RoutesPage.jsx').has('lucide-react'), 'package imports are ignored');
  assert.strictEqual(importers.get('client/src/components/Common.jsx').size, 3);
});

// ---------- tools ----------
test('tools: nav catalog plus Tasks and Chat, no guide or external link, entries from App.jsx', () => {
  assert.deepStrictEqual(result.tools.map((t) => t.id), ['notes', 'tasks', 'chat', 'recipes', 'gardenPlanner', 'routeTracer', 'mood', 'changelog']);
  assert.strictEqual(T.recipes.group, 'Business');
  assert.strictEqual(T.changelog.adminOnly, true);
  assert.strictEqual(T.notes.featureKey, null);
  assert.deepStrictEqual(T.recipes.clientEntries, ['client/src/pages/RecipesPage.jsx', 'client/src/pages/recipes/index.jsx'], 'detail route /recipes/:id belongs to Recipes; FeatureRoute is unwrapped');
  assert.deepStrictEqual(T.changelog.clientEntries, ['client/src/pages/ChangelogPage.jsx'], 'AdminRoute is unwrapped');
});

// ---------- mounts ----------
test('mounts: paths, lines, modules, features, limiter, admin, public', () => {
  const mounts = parseMounts(files);
  assert.strictEqual(mounts.length, 15);
  const by = Object.fromEntries(mounts.map((m) => [m.path, m]));
  assert.strictEqual(by['/api/auth'].public, true);
  assert.strictEqual(by['/api/garden-public'].public, true);
  assert.strictEqual(by['/api/notes'].public, false, 'after app.use(\'/api\', requireAuth)');
  assert.strictEqual(by['/api/notes'].line, 9);
  assert.deepStrictEqual(by['/api/recipes'].modules, ['server/routes/recipes.js']);
  assert.deepStrictEqual(by['/api/recipes'].features, ['recipes']);
  assert.strictEqual(by['/api/recipes'].aiLimiter, true);
  assert.strictEqual(by['/api/mood'].aiLimiter, false);
  assert.deepStrictEqual(by['/api/geocode'].features, ['gardenPlanner', 'routeTracer'], 'requireAnyFeature keys');
  assert.deepStrictEqual(by['/api/garden'].modules, ['server/routes/plannerRouters.js'], 'router object declared earlier');
  assert.deepStrictEqual(by['/api/garden-public'].modules, ['server/routes/plannerRouters.js']);
  assert.strictEqual(by['/api/changelog'].admin, true);
  assert.deepStrictEqual(mountsForApi(mounts, '/api/recipes-tutor').map((m) => m.path), ['/api/recipes-tutor'], 'longest prefix, not /api/recipes');
  assert.deepStrictEqual(mountsForApi(mounts, '/api/recipes/1').map((m) => m.path), ['/api/recipes']);
  assert.deepStrictEqual(mountsForApi(mounts, '/api/elsewhere'), []);
});

// ---------- ownership ----------
test('mount owner: chat segments, extra table, path, kebab id with -tutor stripped, feature key, platform', () => {
  assert.strictEqual(M['/api/chat'].owner, 'chat');
  assert.strictEqual(M['/api/geocode'].owner, 'gardenPlanner', 'extra-segment table');
  assert.strictEqual(M['/api/route-tracks'].owner, 'routeTracer', 'extra-segment table');
  assert.strictEqual(M['/api/garden'].owner, 'gardenPlanner', 'page path');
  assert.strictEqual(M['/api/route-tracer-tutor'].owner, 'routeTracer', 'kebab id after stripping -tutor');
  assert.strictEqual(M['/api/plant-cache'].owner, 'gardenPlanner', 'feature key');
  assert.strictEqual(M['/api/health-extra'].owner, null, 'platform');
  assert.strictEqual(kebab('routeTracer'), 'route-tracer');
  const tools = [{ id: 'a', path: '/projects', featureKey: null }];
  assert.strictEqual(mountOwner({ path: '/api/projects', features: [] }, tools), 'chat', 'chat segments win over a page path');
});

test('ownership: shared at 3 tools, owned below, own route modules always owned', () => {
  assert.strictEqual(COMMON_T, 3);
  for (const id of ['notes', 'recipes', 'gardenPlanner']) {
    assert.ok(!T[id].ownedClient.includes('client/src/components/Common.jsx'), `Common.jsx (3 tools) is shared, not owned by ${id}`);
  }
  assert.strictEqual(T.notes.sharedClientCount, 2, 'Common.jsx and apiClient.js');
  assert.ok(T.gardenPlanner.ownedClient.includes('client/src/components/MapView.jsx'), 'MapView.jsx (2 tools) is owned');
  assert.ok(T.routeTracer.ownedClient.includes('client/src/components/MapView.jsx'));
  assert.ok(T.recipes.ownedClient.includes('client/src/pages/recipes/lazyPanel.jsx'), 'reached through a dynamic import');
  for (const id of ['tasks', 'chat', 'recipes', 'mood']) assert.ok(!T[id].ownedServer.includes('server/services/callModel.js'), `callModel (4 tools) is shared for ${id}`);
  assert.ok(T.mood.ownedServer.includes('server/routes/mood.js'));
  assert.deepStrictEqual(T.notes.tests, ['server/routes/notes.test.js']);
  assert.deepStrictEqual(T.recipes.calls, ['mood'], 'an API link to another tool\'s mount');
  assert.ok(T.recipes.apiCalls.includes('/api/recipes-tutor'));
});

test('edges: API links and shared owned files', () => {
  const e = (a, b) => result.edges.find((x) => x.a === a && x.b === b);
  assert.deepStrictEqual(e('mood', 'recipes').api, ['recipes->mood']);
  assert.strictEqual(e('gardenPlanner', 'routeTracer').n, 3);
  assert.ok(e('gardenPlanner', 'routeTracer').files.includes('client/src/components/MapView.jsx'));
});

// ---------- structure ----------
test('cycles: Tarjan finds both loops, iteratively', () => {
  assert.deepStrictEqual(result.cycles, [
    ['server/services/plannerUtil.js', 'server/services/routeShape.js'],
    ['server/services/cycleA.js', 'server/services/cycleB.js'],
  ]);
  // a 50,000-file chain closing on itself would overflow a recursive version
  const deps = new Map();
  const N = 50000;
  const nodes = [];
  for (let i = 0; i < N; i++) {
    nodes.push(`f${i}`);
    deps.set(`f${i}`, new Set([`f${(i + 1) % N}`]));
  }
  const big = findCycles(nodes, deps);
  assert.strictEqual(big.length, 1);
  assert.strictEqual(big[0].length, N);
  // a self-import and a plain chain are not cycles
  assert.deepStrictEqual(findCycles(['a', 'b'], new Map([['a', new Set(['b'])]])), []);
  // two loops joined by a one-way edge stay separate
  const two = findCycles(['a', 'b', 'c', 'd'], new Map([['a', new Set(['b'])], ['b', new Set(['a', 'c'])], ['c', new Set(['d'])], ['d', new Set(['c'])]]));
  assert.deepStrictEqual(two.map((c) => c.join()).sort(), ['a,b', 'c,d']);
});

test('structure: orphans, backups, packages', () => {
  assert.deepStrictEqual(result.orphans, [{ file: 'server/services/lonelyWidget.js', loc: 2 }]);
  assert.deepStrictEqual(result.backups, ['server/old_bk.js']);
  assert.deepStrictEqual(result.packages, [{ name: 'planner', files: 1, loc: 2 }]);
  assert.strictEqual(result.largest[0].loc >= result.largest[1].loc, true);
});

// ---------- rules: pass and fail for each ----------
const S = (id, rule) => T[id].checks[rule].status;
const ctx = buildRuleContext(files, { docs: new Set(['notes.md']), keyfiles: '' });
const runRule = (rule, tool, c = ctx) => RULE_BY_ID[rule].test(tool, c);
const tool = (over) => ({ id: 'x', label: 'X', featureKey: null, adminOnly: false, ownedClient: [], ownedServer: [], sharedServer: [], mounts: [], tests: [], apiCalls: [], clientEntries: [], locClient: 0, locServer: 0, ...over });

test('rules: fourteen declarative entries with the fields the brief lists', () => {
  assert.strictEqual(RULES.length, 14);
  for (const r of RULES) {
    for (const k of ['id', 'label', 'severity', 'area', 'why', 'fix']) assert.ok(r[k], `${r.id} has ${k}`);
    assert.ok(['high', 'medium', 'low'].includes(r.severity));
    assert.strictEqual(typeof r.test, 'function');
  }
  assert.deepStrictEqual(Object.keys(T.notes.checks), RULES.map((r) => r.id));
});

test('rule flag', () => {
  assert.strictEqual(S('recipes', 'flag'), 'pass');
  assert.strictEqual(S('gardenPlanner', 'flag'), 'fail');
  assert.match(T.gardenPlanner.checks.flag.note, /defaults differ \(server true, client false\)/);
  assert.strictEqual(S('mood', 'flag'), 'fail');
  assert.match(T.mood.checks.flag.note, /missing from client/);
  assert.strictEqual(S('notes', 'flag'), 'na');
  assert.strictEqual(S('changelog', 'flag'), 'na');
});

test('rule lifecycle', () => {
  assert.strictEqual(S('routeTracer', 'lifecycle'), 'pass', 'ships off, preview on both sides');
  const c = { ...ctx, SL: {}, CL: { routeTracer: 'preview' } };
  assert.strictEqual(runRule('lifecycle', tool({ featureKey: 'routeTracer' }), c).status, 'fail');
  assert.strictEqual(runRule('lifecycle', tool({ featureKey: 'routeTracer' }), { ...ctx, CL: { routeTracer: 'parked' } }).status, 'fail', 'values differ');
  assert.strictEqual(S('notes', 'lifecycle'), 'na');
});

test('rule rateLimit', () => {
  assert.strictEqual(S('mood', 'rateLimit'), 'warn');
  assert.deepStrictEqual(T.mood.checks.rateLimit.evidence, [{ file: 'server/index.js', line: 14, text: '/api/mood' }]);
  assert.strictEqual(S('recipes', 'rateLimit'), 'pass', 'aiLimiter at the mount');
  assert.strictEqual(S('tasks', 'rateLimit'), 'pass', 'aiLimiter inside the route module');
  assert.strictEqual(S('notes', 'rateLimit'), 'na');
  const adminMount = { path: '/api/x', line: 1, aiLimiter: false, admin: true, modules: ['server/routes/mood.js'] };
  assert.strictEqual(runRule('rateLimit', tool({ mounts: [adminMount] })).status, 'pass', 'admin mounts are skipped');
});

test('rule models', () => {
  assert.strictEqual(S('chat', 'models'), 'fail');
  assert.strictEqual(T.chat.checks.models.evidence[0].file, 'server/routes/chat.js');
  assert.strictEqual(T.chat.checks.models.evidence[0].line, 2);
  assert.strictEqual(S('recipes', 'models'), 'pass');
  const c = { ...ctx, files: { ...files, 'server/services/costCalculator.js': "'claude-opus-4-6'" } };
  assert.strictEqual(runRule('models', tool({ ownedServer: ['server/services/costCalculator.js'] }), c).status, 'pass', 'pricing tables are allowed');
});

test('rule modelResolver', () => {
  assert.strictEqual(S('mood', 'modelResolver'), 'warn');
  assert.strictEqual(S('recipes', 'modelResolver'), 'pass');
  assert.strictEqual(S('notes', 'modelResolver'), 'na');
});

test('rule apiClient', () => {
  assert.strictEqual(S('mood', 'apiClient'), 'fail');
  assert.strictEqual(T.mood.checks.apiClient.evidence[0].file, 'client/src/pages/MoodPage.jsx');
  assert.strictEqual(S('notes', 'apiClient'), 'pass');
});

test('rule ssrf', () => {
  assert.strictEqual(S('chat', 'ssrf'), 'warn');
  assert.strictEqual(S('recipes', 'ssrf'), 'pass', 'uses safeFetch');
});

test('rule tests', () => {
  assert.strictEqual(S('notes', 'tests'), 'pass');
  assert.strictEqual(S('mood', 'tests'), 'fail');
  assert.strictEqual(runRule('tests', tool({ tests: ['a.test.js'], locServer: 2500, locClient: 600 })).status, 'warn', 'one test for over 3,000 lines');
  assert.strictEqual(runRule('tests', tool({ tests: ['a.test.js', 'b.test.js'], locServer: 9000 })).status, 'pass');
});

test('rule guide', () => {
  assert.strictEqual(S('recipes', 'guide'), 'pass');
  assert.strictEqual(S('gardenPlanner', 'guide'), 'warn', 'tutor endpoint not in guides.js');
  assert.strictEqual(S('notes', 'guide'), 'fail');
  assert.strictEqual(S('changelog', 'guide'), 'na', 'admin-only');
});

test('rule docs', () => {
  assert.strictEqual(S('notes', 'docs'), 'pass');
  assert.strictEqual(T.recipes.checks.docs.note, 'docs/recipes-import.md', 'docs/<kebab-id>-*.md counts');
  assert.strictEqual(S('mood', 'docs'), 'warn', 'only in key-files.md');
  assert.strictEqual(S('tasks', 'docs'), 'fail');
});

test('rule recycleBin', () => {
  assert.strictEqual(S('notes', 'recycleBin'), 'pass');
  assert.strictEqual(S('mood', 'recycleBin'), 'warn');
  assert.strictEqual(S('chat', 'recycleBin'), 'na');
});

test('rule icons', () => {
  assert.strictEqual(S('routeTracer', 'icons'), 'fail');
  assert.strictEqual(S('gardenPlanner', 'icons'), 'pass');
  const c = { ...ctx, files: { ...files, 'client/src/providers/IconProvider.jsx': "import { X } from 'lucide-react';" } };
  assert.strictEqual(runRule('icons', tool({ ownedClient: ['client/src/providers/IconProvider.jsx'] }), c).status, 'pass', 'IconProvider is allowed');
});

test('rule modals', () => {
  assert.strictEqual(S('gardenPlanner', 'modals'), 'warn');
  assert.strictEqual(S('notes', 'modals'), 'pass');
});

test('rule logging', () => {
  assert.strictEqual(S('mood', 'logging'), 'warn');
  assert.match(T.mood.checks.logging.note, /^6 console/);
  assert.strictEqual(S('notes', 'logging'), 'pass');
  assert.strictEqual(runRule('logging', tool({})).status, 'na');
});

test('score: passes over non-na checks, rounded like Python', () => {
  assert.strictEqual(T.notes.score, 90, '9 of 10');
  assert.strictEqual(T.mood.score, 36, '5 of 14 rounds to 36');
  assert.strictEqual(pyRound(62.5), 62);
  assert.strictEqual(pyRound(87.5), 88);
  assert.strictEqual(pyRound(36.4), 36);
  assert.strictEqual(T.mood.fails + T.mood.warns, 9);
  assert.strictEqual(T.routeTracer.lifecycle, 'preview');
  assert.strictEqual(T.routeTracer.defaultOn, false);
  assert.deepStrictEqual(flagKeys('const DEFAULTS = {\n  a: true,\n  b: false,\n};'), { a: 'true', b: 'false' });
  assert.deepStrictEqual(lifecycleKeys('const FEATURE_LIFECYCLE = {\n  a: \'preview\',\n};'), { a: 'preview' });
});

// ---------- findings ----------
test('findings: one per rule, generated, sorted by severity then tools affected', () => {
  const f = result.findings;
  const sev = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < f.length; i++) {
    const a = f[i - 1];
    const b = f[i];
    assert.ok(sev[a.sev] < sev[b.sev] || (a.sev === b.sev && a.tools.length >= b.tools.length), `${a.id} before ${b.id}`);
  }
  const ruleIds = f.filter((x) => x.kind === 'rule').map((x) => x.ruleId);
  assert.strictEqual(new Set(ruleIds).size, ruleIds.length, 'one finding per rule');
  assert.ok(!ruleIds.includes('lifecycle'), 'no finding for a rule every tool passes');
  const flag = f.find((x) => x.id === 'rule:flag');
  assert.deepStrictEqual(flag.tools, ['gardenPlanner', 'mood']);
  assert.strictEqual(flag.sev, 'high');
  assert.strictEqual(f[0].id, 'rule:flag', 'high with the most tools first');
  const rl = f.find((x) => x.id === 'rule:rateLimit');
  assert.deepStrictEqual(rl.evidence, [{ file: 'server/index.js', line: 14, text: '/api/mood', tool: 'mood' }]);
  const cron = f.find((x) => x.ruleId === 'cronRequiresRoute');
  assert.deepStrictEqual(cron.tools, ['mood']);
  assert.strictEqual(cron.evidence[0].file, 'server/cron/moodCron.js');
  const cyc = f.filter((x) => x.ruleId === 'crossToolCycle');
  assert.strictEqual(cyc.length, 1, 'only the loop owned by two tools');
  assert.deepStrictEqual(cyc[0].tools, ['gardenPlanner', 'routeTracer']);
  const hk = f.find((x) => x.ruleId === 'housekeeping');
  assert.deepStrictEqual(hk.evidence.map((e) => e.file), ['server/old_bk.js', 'server/services/lonelyWidget.js']);
  const sorted = sortFindings([{ sev: 'low', tools: [1, 2, 3] }, { sev: 'high', tools: [1] }, { sev: 'high', tools: [1, 2] }]);
  assert.deepStrictEqual(sorted.map((x) => `${x.sev}${x.tools.length}`), ['high2', 'high1', 'low3']);
});

test('result shape: the sample-data keys plus findings', () => {
  for (const k of ['summary', 'tools', 'edges', 'cycles', 'largest', 'hotspots', 'orphans', 'backups', 'packages', 'core', 'findings']) {
    assert.ok(k in result, `result has ${k}`);
  }
  for (const k of ['id', 'label', 'group', 'path', 'featureKey', 'lifecycle', 'defaultOn', 'adminOnly', 'locClient', 'locServer', 'score', 'fails', 'warns',
    'calls', 'biggest', 'churn', 'checks', 'tests', 'ownedClient', 'ownedServer', 'sharedClientCount', 'sharedServerCount', 'clientEntries', 'mounts']) {
    assert.ok(k in T.recipes, `tool has ${k}`);
  }
  assert.strictEqual(JSON.stringify(result).length < 1024 * 1024, true);
});

test('embedded app: its TypeScript is owned by the tool, type-only imports ignored, Vault-only rules skip it', () => {
  const { EMBEDDED_APPS } = require('./files');
  EMBEDDED_APPS.recipes = 'recipe-app'; // a fixture tool stands in for docCompare & co.
  try {
    const app = {
      'recipe-app/src/main.tsx': "import { shell } from './ui/shell';\nfetch('/api/recipes/list');\nshell();\n",
      'recipe-app/src/ui/shell.tsx': "import type { Opts } from '../main';\nexport function shell() { return '<div class=\"fixed inset-0\">'; }\n",
      'recipe-app/tests/shell.test.ts': "import { shell } from '../src/ui/shell';\n",
    };
    const { deps } = buildGraph(app);
    assert.deepStrictEqual([...deps.get('recipe-app/src/main.tsx')], ['recipe-app/src/ui/shell.tsx'], '.tsx resolves');
    assert.ok(!deps.has('recipe-app/src/ui/shell.tsx'), 'import type is not a link');
    const r = analyze({ root: ROOT, files: { ...files, ...app }, log: null });
    const t = r.tools.find((x) => x.id === 'recipes');
    assert.ok(t.ownedClient.includes('recipe-app/src/main.tsx') && t.ownedClient.includes('recipe-app/src/ui/shell.tsx'));
    assert.ok(t.tests.includes('recipe-app/tests/shell.test.ts'));
    assert.strictEqual(t.checks.apiClient.status, T.recipes.checks.apiClient.status, 'raw fetch in the app is not an apiClient gap');
    assert.strictEqual(t.checks.modals.status, T.recipes.checks.modals.status, 'its own overlay is not a Dialog gap');

    // @planner-core/... resolves to planner-core/src/...; a file only this tool reaches is owned by it, and Vault-only rules skip it
    const withCore = { ...app,
      'recipe-app/src/main.tsx': `${app['recipe-app/src/main.tsx']}import { mic } from '@planner-core/speech/mic';\n`,
      'planner-core/src/speech/mic.ts': "export const mic = () => fetch('/api/x').then(() => '<div class=\"fixed inset-0\">');\n" };
    assert.ok(buildGraph(withCore).deps.get('recipe-app/src/main.tsx').has('planner-core/src/speech/mic.ts'), 'alias resolves');
    const r2 = analyze({ root: ROOT, files: { ...files, ...withCore }, log: null });
    const t2 = r2.tools.find((x) => x.id === 'recipes');
    assert.ok(t2.ownedClient.includes('planner-core/src/speech/mic.ts'));
    assert.strictEqual(t2.checks.apiClient.status, T.recipes.checks.apiClient.status, 'planner-core is not checked for apiClient');
    assert.strictEqual(t2.checks.modals.status, T.recipes.checks.modals.status, 'planner-core is not checked for Dialog');
  } finally {
    delete EMBEDDED_APPS.recipes;
  }
});

console.log(`codeMap.test.js: ${passed} passed`);
