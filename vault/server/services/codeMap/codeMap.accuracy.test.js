'use strict';

// node server/services/codeMap/codeMap.accuracy.test.js
// Runs the analyzer on this repo and compares it with the Python prototype's output from commit 40bf883
// (__fixtures__/sample-data.json, copied from specs/code-map/reference/). It asserts the brief's accuracy
// check (60 tools, 145 mounts, 11 cycles, 404 test files, per-tool scores within 5) and prints every other
// difference so it can be explained. As Vault changes after 40bf883 these numbers will drift on purpose:
// read the printed differences, explain them, and do not tune the analyzer to hit the old numbers.

const assert = require('assert');
const path = require('path');
const { analyze } = require('./index');
const { collectFiles } = require('./files');
const sample = require('./__fixtures__/sample-data.json');

const ROOT = path.resolve(__dirname, '../../..');
// The Code Map's own code did not exist at 40bf883, so it is left out to compare like with like: its service folder, its route file
// and test, its weekly cron, its guide, its page, views and tour, and its single lines in shared files (blanked, so later line numbers stay
// the same): the mounts and cron start in server/index.js, the guide registry entry, the menu entry, the App.jsx import and route, the icon.
const OWN = 'server/services/codeMap/';
const OWN_PREFIXES = [OWN, 'server/routes/codeMap', 'server/cron/codeMapCron', 'server/services/codeMapTutor', 'client/src/pages/CodeMapPage', 'client/src/pages/codeMap/', 'client/src/utils/tours/codeMapTour'];
const OWN_LINES = {
  'server/index.js': (l) => l.includes("app.use('/api/code-map") || l.includes("require('./cron/codeMapCron')"),
  'client/src/config/appNavigation.js': (l) => l.includes("id: 'codeMap'"),
  'client/src/App.jsx': (l) => l.includes('CodeMapPage'),
  'server/config/guides.js': (l) => l.includes("'code-map':"),
  'client/src/providers/iconMap.js': (l) => l.includes("'code-map':"),
};
const all = collectFiles(ROOT);
const files = Object.fromEntries(Object.entries(all).filter(([f]) => !OWN_PREFIXES.some((p) => f.startsWith(p))));
for (const [f, own] of Object.entries(OWN_LINES)) files[f] = files[f].split('\n').map((l) => (own(l) ? '' : l)).join('\n');
const full = analyze({ root: ROOT, files: all, log: null });
const r = analyze({ root: ROOT, files, log: null });
console.log(`Whole repo now: ${full.summary.files} files, ${full.summary.tests} tests, ${full.summary.tools} tools, ${full.summary.mounts} mounts, ${full.cycles.length} cycles`);
console.log(`Without ${OWN} (${Object.keys(all).length - Object.keys(files).length} files): compared with the prototype below.`);

const diffs = [];
const note = (s) => diffs.push(s);

for (const k of ['files', 'tests', 'locServer', 'locClient', 'locTests', 'tools', 'mounts', 'routesFiles']) {
  if (r.summary[k] !== sample.summary[k]) note(`summary.${k}: sample ${sample.summary[k]}, now ${r.summary[k]}`);
}
if (r.cycles.length !== sample.cycles.length) note(`cycles: sample ${sample.cycles.length}, now ${r.cycles.length}`);
const key = (c) => c.join(',');
const sc = new Set(sample.cycles.map(key));
const rc = new Set(r.cycles.map(key));
for (const c of rc) if (!sc.has(c)) note(`new cycle: ${c}`);
for (const c of sc) if (!rc.has(c)) note(`cycle gone: ${c}`);

const S = Object.fromEntries(sample.tools.map((t) => [t.id, t]));
const R = Object.fromEntries(r.tools.map((t) => [t.id, t]));
for (const id of Object.keys(S)) if (!R[id]) note(`tool gone: ${id}`);
for (const id of Object.keys(R)) if (!S[id]) note(`new tool: ${id}`);
const scoreGaps = [];
for (const t of r.tools) {
  const o = S[t.id];
  if (!o) continue;
  if (o.score !== t.score) note(`${t.id}: score ${o.score} -> ${t.score}`);
  if (Math.abs(o.score - t.score) > 5) scoreGaps.push(`${t.id} ${o.score} -> ${t.score}`);
  for (const k of Object.keys(o.checks)) {
    if (!t.checks[k]) note(`${t.id}: check ${k} missing`);
    else if (o.checks[k].status !== t.checks[k].status) note(`${t.id}.${k}: ${o.checks[k].status} -> ${t.checks[k].status} (${t.checks[k].note})`);
  }
  for (const k of ['locClient', 'locServer']) if (o[k] !== t[k]) note(`${t.id}.${k}: ${o[k]} -> ${t[k]}`);
  for (const k of ['ownedClient', 'ownedServer', 'tests', 'calls', 'clientEntries']) {
    if (JSON.stringify(o[k]) !== JSON.stringify(t[k])) note(`${t.id}.${k} differs`);
  }
}
if (r.edges.length !== sample.edges.length) note(`tool links: sample ${sample.edges.length}, now ${r.edges.length}`);
if (JSON.stringify(r.orphans) !== JSON.stringify(sample.orphans)) note('possibly-unused list differs');
if (JSON.stringify(r.backups) !== JSON.stringify(sample.backups)) note('backups differ');
for (const p of r.packages) {
  const o = sample.packages.find((x) => x.name === p.name);
  if (!o || o.files !== p.files || o.loc !== p.loc) note(`package ${p.name}: sample ${o ? `${o.files} files/${o.loc} lines` : 'absent'}, now ${p.files} files/${p.loc} lines`);
}

console.log(`Differences from the prototype at 40bf883 (${diffs.length}):`);
for (const d of diffs) console.log(`  - ${d}`);

assert.strictEqual(r.summary.tools, 60, 'tools');
assert.strictEqual(r.summary.mounts, 145, 'mounts');
assert.strictEqual(r.cycles.length, 11, 'import cycles');
assert.strictEqual(r.summary.tests, 404, 'test files');
assert.deepStrictEqual(scoreGaps, [], 'per-tool scores within 5');
console.log('codeMap.accuracy.test.js: passed (60 tools, 145 mounts, 11 cycles, 404 test files, scores within 5)');
