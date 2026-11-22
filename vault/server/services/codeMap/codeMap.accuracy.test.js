'use strict';

// node server/services/codeMap/codeMap.accuracy.test.js   (needs git and the repo's history; local only)
// Runs today's analyzer on Vault exactly as it was at commit 40bf883, read from git, and compares it with the Python
// prototype's output from that commit (__fixtures__/sample-data.json, copied from specs/code-map/reference/). Same input,
// so later Vault changes cannot make it drift; a difference means the analyzer itself changed. It asserts the brief's
// accuracy check (60 tools, 145 mounts, 11 cycles, 404 test files, per-tool scores within 5) and prints every other
// difference so it can be explained. If an analyzer change is meant to differ, explain it; do not tune to the old numbers.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { analyze } = require('./index');
const { EXTS } = require('./files');
const sample = require('./__fixtures__/sample-data.json');

const COMMIT = '40bf8834';
const VAULT = path.resolve(__dirname, '../../..');
const SNAP = path.join(os.tmpdir(), `vault-codemap-${COMMIT}`);
const DONE = path.join(SNAP, '.complete');

// Writes what the analyzer reads (server/ and client/src/ source, docs/, the route manifest) at COMMIT into SNAP, once.
function snapshot() {
  if (fs.existsSync(DONE)) return;
  const git = (args, input) => execFileSync('git', args, { cwd: VAULT, input, maxBuffer: 512 * 1024 * 1024 });
  const prefix = git(['rev-parse', '--show-prefix']).toString().trim(); // 'vault/'; ls-tree already prints paths relative to it
  const names = git(['ls-tree', '-r', '--name-only', COMMIT, '--', 'server', 'client/src', 'docs']).toString().split('\n')
    .filter(Boolean)
    .filter((f) => f.startsWith('docs/') || f === 'server/testing/routeManifest.json' || EXTS.some((e) => f.endsWith(e)));
  const out = git(['cat-file', '--batch'], names.map((f) => `${COMMIT}:${prefix}${f}`).join('\n') + '\n');
  fs.rmSync(SNAP, { recursive: true, force: true });
  let at = 0;
  for (const f of names) {
    const nl = out.indexOf(10, at);
    const size = Number(out.toString('latin1', at, nl).split(' ')[2]);
    const dest = path.join(SNAP, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  fs.writeFileSync(DONE, COMMIT);
}

try {
  snapshot();
} catch (e) {
  console.log(`codeMap.accuracy.test.js: skipped (could not read commit ${COMMIT} from git: ${e.message.split('\n')[0]})`);
  process.exit(0);
}
const r = analyze({ root: SNAP, log: null });
console.log(`Vault at ${COMMIT}: ${r.summary.files} files, ${r.summary.tests} tests, ${r.summary.tools} tools, ${r.summary.mounts} mounts, ${r.cycles.length} cycles`);

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
