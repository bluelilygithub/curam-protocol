'use strict';

// Code Map, stage 11: the ranked list of findings, generated from the rule results and the structure.
// (In the Python prototype these were written by hand in slim.py; here nothing is hand-written.)

const { splitLines } = require('./files');
const { RULES } = require('./rules');

const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const EVIDENCE_CAP = 30;

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// One finding per rule that any tool fails or warns on.
function ruleFindings(tools, rules = RULES) {
  const out = [];
  for (const r of rules) {
    const hit = tools.filter((t) => t.checks && ['fail', 'warn'].includes(t.checks[r.id]?.status));
    if (!hit.length) continue;
    const evidence = [];
    const seen = new Set();
    for (const t of hit) {
      for (const e of t.checks[r.id].evidence) {
        const k = `${e.file}:${e.line}`;
        if (seen.has(k)) continue;
        seen.add(k);
        evidence.push({ ...e, tool: t.id });
      }
    }
    const fails = hit.filter((t) => t.checks[r.id].status === 'fail').length;
    out.push({
      id: `rule:${r.id}`,
      kind: 'rule',
      ruleId: r.id,
      sev: r.severity,
      area: r.area,
      title: `${r.label}: ${plural(hit.length, 'tool')} to check`,
      body: `${r.why} ${r.fix}`,
      why: r.why,
      fix: r.fix,
      tools: hit.map((t) => t.id),
      fails,
      warns: hit.length - fails,
      toolNotes: hit.map((t) => ({ tool: t.id, status: t.checks[r.id].status, note: t.checks[r.id].note })),
      evidence: evidence.slice(0, EVIDENCE_CAP),
      evidenceTotal: evidence.length,
    });
  }
  return out;
}

function ownerMap(tools) {
  const m = new Map();
  for (const t of tools) {
    for (const f of [...t.ownedClient, ...t.ownedServer]) {
      if (!m.has(f)) m.set(f, new Set());
      m.get(f).add(t.id);
    }
  }
  return m;
}

// Import cycles whose files are owned by two or more tools.
function crossToolCycleFindings(cycles, tools) {
  const owners = ownerMap(tools);
  const out = [];
  for (const cyc of cycles) {
    const ids = new Set();
    for (const f of cyc) for (const o of owners.get(f) || []) ids.add(o);
    if (ids.size < 2) continue;
    const list = tools.filter((t) => ids.has(t.id)).map((t) => t.id);
    out.push({
      id: `cycle:${cyc[0]}`,
      kind: 'structure',
      ruleId: 'crossToolCycle',
      sev: 'medium',
      area: 'Structure',
      title: `Import cycle across ${plural(list.length, 'tool')} (${plural(cyc.length, 'file')})`,
      why: 'Files owned by different tools import each other in a loop, so changing one tool can break the other.',
      fix: 'Move the code both sides need into one module that both import, so the loop goes away.',
      body: 'Files owned by different tools import each other in a loop, so changing one tool can break the other. Move the code both sides need into one module that both import, so the loop goes away.',
      tools: list,
      evidence: cyc.map((f) => ({ file: f, line: 0, text: '' })),
      evidenceTotal: cyc.length,
    });
  }
  return out;
}

const CRON_ROUTE_RE = /require\(\s*['"](\.\.\/routes\/[^'"]+)['"]\s*\)/;

// A cron file that requires a route file: business logic living in a route.
function cronRouteFindings(files, tools) {
  const evidence = [];
  const routeFiles = new Set();
  for (const f of Object.keys(files)) {
    if (!f.startsWith('server/cron/')) continue;
    splitLines(files[f]).forEach((l, i) => {
      const m = l.match(CRON_ROUTE_RE);
      if (!m) return;
      evidence.push({ file: f, line: i + 1, text: l.trim().slice(0, 160) });
      routeFiles.add(`server/routes/${m[1].slice('../routes/'.length).replace(/\.js$/, '')}.js`);
    });
  }
  if (!evidence.length) return [];
  const list = tools.filter((t) => t.ownedServer.some((f) => routeFiles.has(f))).map((t) => t.id);
  return [{
    id: 'structure:cronRoute',
    kind: 'structure',
    ruleId: 'cronRequiresRoute',
    sev: 'high',
    area: 'Structure',
    title: `A cron job requires a route file (${plural(evidence.length, 'place')})`,
    why: 'Cron jobs that reach into route files mean business logic lives in the route, and often make an import cycle back to the cron.',
    fix: 'Move the shared logic into a services/ module that both the route and the cron import.',
    body: 'Cron jobs that reach into route files mean business logic lives in the route, and often make an import cycle back to the cron. Move the shared logic into a services/ module that both the route and the cron import.',
    tools: list,
    evidence: evidence.slice(0, EVIDENCE_CAP),
    evidenceTotal: evidence.length,
  }];
}

function housekeepingFindings(backups, orphans) {
  if (!backups.length && !orphans.length) return [];
  const evidence = [
    ...backups.map((f) => ({ file: f, line: 0, text: 'backup copy' })),
    ...orphans.map((o) => ({ file: o.file, line: 0, text: `${o.loc} lines, no importers` })),
  ];
  return [{
    id: 'structure:housekeeping',
    kind: 'structure',
    ruleId: 'housekeeping',
    sev: 'low',
    area: 'Housekeeping',
    title: `Leftover backups (${backups.length}) and possibly unused files (${orphans.length})`,
    why: 'Old copies and unused files get edited or searched by mistake and make the code look bigger than it is.',
    fix: 'Check that nothing loads them by path, then delete them.',
    body: 'Old copies and unused files get edited or searched by mistake and make the code look bigger than it is. Check that nothing loads them by path, then delete them.',
    tools: [],
    evidence: evidence.slice(0, EVIDENCE_CAP),
    evidenceTotal: evidence.length,
  }];
}

// Severity first, then the number of tools affected (most first). Stable for ties.
function sortFindings(list) {
  return list
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (SEV_ORDER[a.f.sev] - SEV_ORDER[b.f.sev]) || (b.f.tools.length - a.f.tools.length) || (a.i - b.i))
    .map((x) => x.f);
}

function buildFindings({ files, tools, structure, rules = RULES }) {
  return sortFindings([
    ...ruleFindings(tools, rules),
    ...cronRouteFindings(files, tools),
    ...crossToolCycleFindings(structure.cycles, tools),
    ...housekeepingFindings(structure.backups, structure.orphans),
  ]);
}

module.exports = { SEV_ORDER, ruleFindings, crossToolCycleFindings, cronRouteFindings, housekeepingFindings, sortFindings, buildFindings };
