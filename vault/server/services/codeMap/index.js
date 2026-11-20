'use strict';

// Code Map analyzer: reads Vault's own source from disk and returns tools, ownership, links,
// convention checks, structure and ranked findings. No model calls, no network, no database.
// Ported from specs/code-map/reference/analyze.py + slim.py; output follows reference/sample-data.json.

const fs = require('fs');
const path = require('path');
const { collectFiles, buildLoc, isTest, readText } = require('./files');
const { buildGraph } = require('./imports');
const { buildTools } = require('./tools');
const { parseMounts } = require('./mounts');
const { computeOwnership, buildEdges, buildSharedModules, buildCore } = require('./ownership');
const { RULES, buildRuleContext, applyRules } = require('./rules');
const { buildStructure } = require('./structure');
const { buildSecurity } = require('./security');
const { buildFindings } = require('./findings');

const TOOL_KEEP = ['id', 'label', 'group', 'path', 'featureKey', 'lifecycle', 'defaultOn', 'adminOnly', 'locClient', 'locServer', 'score', 'fails', 'warns',
  'calls', 'biggest', 'churn', 'checks', 'tests', 'ownedClient', 'ownedServer', 'sharedClientCount', 'sharedServerCount', 'clientEntries', 'apiCalls'];

function logger() {
  try {
    return require('../../middleware/requestContext').getLogger();
  } catch {
    return null;
  }
}

function readManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'server/testing/routeManifest.json'), 'utf8')).routes || null;
  } catch {
    return null;
  }
}

function readDocs(root) {
  try {
    return new Set(fs.readdirSync(path.join(root, 'docs')));
  } catch {
    return new Set();
  }
}

/**
 * analyze({ root }) -> result object. `root` is the vault directory (holds server/, client/src/, docs/).
 * Options for tests: `files` (a { relPath: source } map instead of reading disk), `rules`.
 * `onStage(name)` is called as each stage starts (files, imports, tools, mounts, ownership, rules, structure, findings).
 */
function analyze({ root, files: givenFiles, rules = RULES, log = logger(), onStage = null } = {}) {
  const t0 = Date.now();
  const timings = {};
  let current = null;
  let t = Date.now();
  const stage = (name) => {
    if (current) timings[current] = Date.now() - t;
    current = name;
    t = Date.now();
    if (onStage) onStage(name);
  };

  stage('files');
  const files = givenFiles || collectFiles(root);
  const loc = buildLoc(files);

  stage('imports');
  const { deps, importers } = buildGraph(files);

  stage('tools');
  const tools = buildTools(files);

  stage('mounts');
  const mounts = parseMounts(files);

  stage('ownership');
  const reach = computeOwnership({ files, loc, deps, tools, mounts });

  stage('rules');
  const ctx = buildRuleContext(files, {
    docs: root ? readDocs(root) : new Set(),
    keyfiles: root ? readText(path.join(root, 'docs/key-files.md')) : '',
  });
  for (const tool of tools) applyRules(tool, ctx, rules);

  stage('security'); // after the rules: it reuses each tool's SSRF check
  const security = buildSecurity({ files, tools, mounts, manifest: root ? readManifest(root) : null });

  stage('structure');
  const edges = buildEdges(tools);
  const core = buildCore(files, loc, importers, tools, reach);
  const sharedModules = buildSharedModules(files, loc, importers, reach);
  const structure = buildStructure({ root, files, loc, deps, importers });

  stage('findings');
  const findings = buildFindings({ files, tools, structure, rules });
  timings.findings = Date.now() - t;

  const names = Object.keys(files);
  const summary = {
    files: names.length,
    tests: names.filter(isTest).length,
    locServer: names.filter((f) => f.startsWith('server/') && !isTest(f)).reduce((n, f) => n + loc[f], 0),
    locClient: names.filter((f) => f.startsWith('client/') && !isTest(f)).reduce((n, f) => n + loc[f], 0),
    locTests: names.filter(isTest).reduce((n, f) => n + loc[f], 0),
    tools: tools.length,
    mounts: mounts.length,
    routesFiles: names.filter((f) => f.startsWith('server/routes/') && !isTest(f)).length,
    cycles: structure.cycles.length,
    findings: findings.length,
    gaps: tools.reduce((n, x) => n + x.fails + x.warns, 0),
    commitsScanned: null,
    historyFrom: null,
    historyTo: null,
  };

  const outTools = tools.map((x) => {
    const o = {};
    x.churn = 0; // no git history at runtime
    x.sharedClientCount = x.sharedClient.length;
    x.sharedServerCount = x.sharedServer.length;
    for (const k of TOOL_KEEP) o[k] = x[k];
    o.mounts = x.mounts.map((m) => ({ path: m.path, line: m.line, aiLimiter: m.aiLimiter, public: m.public, admin: m.admin, features: m.features, modules: m.modules }));
    return o;
  });

  const durationMs = Date.now() - t0;
  if (log) log.info({ durationMs, timings, files: summary.files, tools: summary.tools, findings: findings.length }, 'code map analysis done');

  return {
    summary,
    tools: outTools,
    edges,
    cycles: structure.cycles,
    largest: structure.largest.slice(0, 20),
    fanin: structure.fanin,
    hotspots: structure.hotspots,
    orphans: structure.orphans.slice(0, 40),
    backups: structure.backups,
    packages: structure.packages,
    core: core.map((c) => ({ file: c.file, n: c.tools.length, importers: c.importers, loc: c.loc })),
    sharedModules,
    mounts: mounts.map((m) => ({ path: m.path, owner: m.owner, line: m.line, features: m.features, aiLimiter: m.aiLimiter, admin: m.admin, public: m.public })),
    findings,
    security,
    rules: rules.map((r) => ({ id: r.id, label: r.label, severity: r.severity, area: r.area, why: r.why, fix: r.fix })),
    commitHint: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    generatedAt: new Date().toISOString(),
    durationMs,
    timings,
  };
}

module.exports = { analyze };
