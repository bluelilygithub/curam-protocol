'use strict';

// Code Map drift: what changed between two stored runs (milestone 4). Pure: give it two run results (the JSON analyze() returns).
//
// A finding is broken into items, so a change shows up even when the finding as a whole is still there:
//   a rule finding        one item per tool it names            key rule:<ruleId>:<toolId>
//   an import cycle        one item per cycle across tools       key crossToolCycle:<its files, sorted>
//   a cron needing a route one item per cron file and route       key cronRequiresRoute:<cron file>:<required path>  (line numbers move)
//   housekeeping           one item per backup or unused file    key housekeeping:<file>  (from the full lists, not the capped evidence)
// New = in "to" but not "from"; resolved = the reverse; changed = same key, status moved between amber and red.
// Scores, tools added or removed, all import cycles gained or lost and the summary numbers are compared as well.
// Lists come back worst first: new and changed items by severity (high first), scores by the biggest drop.

const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { na: 0, pass: 0, warn: 1, fail: 2 };
const SUMMARY_KEYS = ['tools', 'files', 'tests', 'mounts', 'cycles', 'gaps', 'findings', 'locServer', 'locClient', 'locTests'];
const CRON_REQ_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/;

const cycleKey = (files) => [...files].sort().join(' | ');

/** Every finding item of one run, as a Map key -> item. */
function findingItems(result) {
  const r = result || {};
  const label = Object.fromEntries((r.tools || []).map((t) => [t.id, t.label]));
  const ruleLabel = Object.fromEntries((r.rules || []).map((x) => [x.id, x.label]));
  const items = new Map();
  const add = (it) => { if (!items.has(it.key)) items.set(it.key, it); };

  for (const f of r.findings || []) {
    if (f.kind === 'rule') {
      for (const n of f.toolNotes || []) {
        add({
          key: `rule:${f.ruleId}:${n.tool}`, kind: 'rule', ruleId: f.ruleId, sev: f.sev, status: n.status,
          what: ruleLabel[f.ruleId] || f.ruleId, toolId: n.tool, toolLabel: label[n.tool] || n.tool, note: n.note,
          files: (f.evidence || []).filter((e) => e.tool === n.tool).map((e) => (e.line ? `${e.file}:${e.line}` : e.file)),
        });
      }
    } else if (f.ruleId === 'crossToolCycle') {
      const files = (f.evidence || []).map((e) => e.file);
      add({
        key: `crossToolCycle:${cycleKey(files)}`, kind: 'structure', ruleId: f.ruleId, sev: f.sev, status: 'fail',
        what: 'Import cycle across tools', toolId: null, toolLabel: (f.tools || []).map((id) => label[id] || id).join(', '), note: f.title, files,
      });
    } else if (f.ruleId === 'cronRequiresRoute') {
      for (const e of f.evidence || []) {
        const req = (e.text || '').match(CRON_REQ_RE);
        add({
          key: `cronRequiresRoute:${e.file}:${req ? req[1] : e.text}`, kind: 'structure', ruleId: f.ruleId, sev: f.sev, status: 'fail',
          what: 'A cron job requires a route file', toolId: null, toolLabel: '', note: e.text || '', files: [`${e.file}:${e.line}`],
        });
      }
    }
  }
  // housekeeping from the full lists (the finding's evidence is capped)
  const hk = (r.findings || []).find((f) => f.ruleId === 'housekeeping');
  const sev = hk ? hk.sev : 'low';
  for (const b of r.backups || []) {
    add({ key: `housekeeping:${b}`, kind: 'structure', ruleId: 'housekeeping', sev, status: 'warn', what: 'Leftover backup copy', toolId: null, toolLabel: '', note: 'Backup copy', files: [b] });
  }
  for (const o of r.orphans || []) {
    add({ key: `housekeeping:${o.file}`, kind: 'structure', ruleId: 'housekeeping', sev, status: 'warn', what: 'Possibly unused file', toolId: null, toolLabel: '', note: `${o.loc} lines, no importers`, files: [o.file] });
  }
  return items;
}

const bySeverity = (a, b) => (SEV_ORDER[a.sev] ?? 3) - (SEV_ORDER[b.sev] ?? 3)
  || (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0)
  || String(a.what).localeCompare(String(b.what))
  || String(a.toolLabel).localeCompare(String(b.toolLabel))
  || a.key.localeCompare(b.key);

/** Drift from run `from` to run `to` (both analyze() results). */
function compareRuns(from, to) {
  const a = from || {};
  const b = to || {};
  const A = findingItems(a);
  const B = findingItems(b);

  const newFindings = [...B.values()].filter((it) => !A.has(it.key)).sort(bySeverity);
  const resolvedFindings = [...A.values()].filter((it) => !B.has(it.key)).sort(bySeverity);
  const changedFindings = [...B.values()].filter((it) => A.has(it.key) && A.get(it.key).status !== it.status)
    .map((it) => ({ ...it, fromStatus: A.get(it.key).status, worse: (STATUS_RANK[it.status] || 0) > (STATUS_RANK[A.get(it.key).status] || 0) }))
    .sort((x, y) => (y.worse - x.worse) || bySeverity(x, y));

  const at = Object.fromEntries((a.tools || []).map((t) => [t.id, t]));
  const bt = Object.fromEntries((b.tools || []).map((t) => [t.id, t]));
  const toolsAdded = (b.tools || []).filter((t) => !at[t.id]).map((t) => ({ id: t.id, label: t.label, score: t.score }));
  const toolsRemoved = (a.tools || []).filter((t) => !bt[t.id]).map((t) => ({ id: t.id, label: t.label, score: t.score }));
  const scores = (b.tools || []).filter((t) => at[t.id] && at[t.id].score !== t.score).map((t) => ({
    id: t.id, label: t.label, from: at[t.id].score, to: t.score, delta: t.score - at[t.id].score,
  })).sort((x, y) => x.delta - y.delta || x.label.localeCompare(y.label));

  const ac = new Map((a.cycles || []).map((c) => [cycleKey(c), c]));
  const bc = new Map((b.cycles || []).map((c) => [cycleKey(c), c]));
  const cyclesGained = [...bc].filter(([k]) => !ac.has(k)).map(([, c]) => c);
  const cyclesLost = [...ac].filter(([k]) => !bc.has(k)).map(([, c]) => c);

  const sa = a.summary || {};
  const sb = b.summary || {};
  const summary = {};
  for (const k of SUMMARY_KEYS) {
    if (typeof sa[k] === 'number' || typeof sb[k] === 'number') summary[k] = { from: sa[k] ?? null, to: sb[k] ?? null, delta: (sb[k] ?? 0) - (sa[k] ?? 0) };
  }

  return {
    summary,
    newFindings,
    resolvedFindings,
    changedFindings,
    scores,
    toolsAdded,
    toolsRemoved,
    cyclesGained,
    cyclesLost,
    counts: {
      new: newFindings.length,
      newHigh: newFindings.filter((x) => x.sev === 'high').length,
      resolved: resolvedFindings.length,
      worse: changedFindings.filter((x) => x.worse).length,
      better: changedFindings.filter((x) => !x.worse).length,
      scoresDown: scores.filter((s) => s.delta < 0).length,
      scoresUp: scores.filter((s) => s.delta > 0).length,
    },
  };
}

module.exports = { compareRuns, findingItems, cycleKey };
