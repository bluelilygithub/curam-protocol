// Copy / download for the Code Map Models tab (ModelsView.jsx). Pure: built in the browser from the stored report the page already has.
// Report shape: server/services/codeMap/models/check.js buildReport. Test: node client/src/pages/codeMap/exportModels.test.mjs

import { mdTable, toCsv } from './exportRun.mjs';

const usd = (n) => (n == null ? '' : `$${Number(n).toFixed(n < 1 ? 4 : 2)}`);
const pctOf = (r) => (r == null ? '' : `${(r * 100).toFixed(1)}%`);
const ms = (n) => (n == null ? '' : `${n} ms`);

/** The model ids a tool uses, by role: default (tiers), backup and dedicated settings. */
export function modelsByRole(tool) {
  const pick = (role) => (tool.models || []).filter((m) => m.role === role).map((m) => m.modelId || (m.savedId ? `${m.savedId} (gone)` : 'not set'));
  return { default: [...new Set(pick('default'))], backup: [...new Set(pick('backup'))], dedicated: [...new Set(pick('dedicated'))] };
}

const HEAD = ['Tool', 'Default', 'Backup', 'Dedicated', 'Calls (30d)', 'Cost', 'Median latency', 'Error %', 'Backup %', 'Findings'];
function row(t) {
  const m = modelsByRole(t);
  const s = t.stats || {};
  return [t.label, m.default.join(' / '), m.backup.join(' / '), m.dedicated.join(' / '), s.calls ?? 0, usd(s.costUsd), ms(s.medianMs),
    pctOf(s.errorRate), pctOf(s.backupRate), (t.findings || []).map((f) => `${f.severity}: ${f.kind}`).join('; ') || (t.notEnoughData ? 'not enough data' : '')];
}

export const modelsCsv = (report, tools = report.tools || []) => toCsv(HEAD, tools.map(row));

export function modelsMd(report, tools = report.tools || []) {
  const r = report.range || {};
  const out = [
    '# Code Map: Models',
    `Checked ${report.generatedAt || ''} · usage ${r.from || ''} to ${r.to || ''} (${r.days || 30} days) · ${report.counts?.high || 0} high, ${report.counts?.medium || 0} medium, ${report.counts?.low || 0} low.`,
    'Recommendations only: nothing was changed. Swap a model in Settings if you agree.',
    '',
  ];
  if (report.summary?.overall?.text) out.push('## In short', report.summary.overall.text, `_${report.summary.reason || ''}_`, '');
  const acts = modelActions(report);
  out.push('## What to do');
  if (!acts.length) out.push('Nothing to do.');
  for (const a of acts) out.push(`- **${a.priority}** · ${a.action}`);
  out.push('', '## Findings');
  const all = report.findings || [];
  if (!all.length) out.push('None.');
  for (const f of all) out.push(`- **${f.severity}** · ${f.title}. ${f.detail}`);
  out.push('', '## Tools', mdTable(HEAD, tools.map(row)));
  return out.join('\n');
}

// ---- What to do: one plain action per finding, built in code from the finding's kind and evidence (no AI, so no made-up figures).
const PRIORITY = { high: 'Do now', medium: 'Soon', low: 'Worth testing' };

function actionFor(f) {
  const e = f.evidence || {};
  switch (f.kind) {
    case 'unavailableModel':
      if (e.tier) return `Set a ${e.tier} model in Settings → Models: ${(e.tools || []).length} tools cannot use AI until one is set.`;
      if (e.provider) return `Add the ${e.provider} API key on the server, or stop using ${e.model} in Settings → Models.`;
      if (e.saved) return `In Settings, change ${String(e.via || '').replace('setting:', '')} for ${f.label}: ${e.saved} is no longer connected, so it uses ${e.usedInstead || 'nothing'} instead.`;
      break;
    case 'capabilityMismatch': return `Choose another model for ${f.label} in Settings: ${e.model} ${(e.gaps || []).join('; ')}.`;
    case 'hardcodedModel': return `Move ${f.label}'s hardcoded model id into Settings (a code change).`;
    case 'backupOften': return `Find out why ${f.label}'s main model keeps failing: the backup answered ${pctOf(e.rate)} of calls.`;
    case 'highErrorRate': return `Find out why ${f.label}'s calls fail: ${pctOf(e.rate)} failed (${e.errors} of ${e.attempts}).`;
    case 'cheaperTier': return `Trial ${e.light} on ${f.label} and compare the results before switching it from ${e.standard}.`;
    case 'newerModel': return `Trial ${e.candidate} in place of ${e.current} on one tool, then swap it in Settings if it does as well.`;
    default: break;
  }
  return f.title;
}

/** Every finding as an action, most urgent first: { priority, severity, action, why, tool, via }. */
export const modelActions = (report) => (report.findings || []).map((f) => ({
  priority: PRIORITY[f.severity] || f.severity, severity: f.severity, action: actionFor(f), why: f.detail || '', tool: f.label, via: f.evidence?.via || null,
}));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A standalone HTML page of the report (download, open in Word, or print to PDF). Plain light styling: it is a document, not app UI. */
export function modelsHtml(report, tools = report.tools || []) {
  const r = report.range || {};
  const c = report.counts || {};
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((x) => `<tr>${x.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const acts = modelActions(report);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Code Map: Models</title><style>
body{font:12px/1.45 Helvetica,Arial,sans-serif;color:#111;margin:24px;max-width:1200px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px}
.sub{color:#555;margin:0 0 4px}table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
th{border-bottom:2px solid #999;font-size:10px;text-transform:uppercase;color:#444}.why{color:#555}@media print{body{margin:12mm}}
</style></head><body>
<h1>Code Map: Models</h1>
<p class="sub">Checked ${esc(report.generatedAt || '')} · usage ${esc(r.from || '')} to ${esc(r.to || '')} (${r.days || 30} days) · ${c.high || 0} high, ${c.medium || 0} medium, ${c.low || 0} low.</p>
<p class="sub">Recommendations only: nothing was changed. Swap a model in Settings if you agree.</p>
${report.summary?.overall?.text ? `<h2>In short</h2><p>${esc(report.summary.overall.text)}</p><p class="why">${esc(report.summary.reason || '')}</p>` : ''}
<h2>What to do</h2>${acts.length ? table(['Priority', 'Action', 'Why'], acts.map((a) => [a.priority, a.action, a.why])) : '<p>Nothing to do.</p>'}
<h2>Tools</h2>${table(HEAD, tools.map(row))}
</body></html>`;
}

/** Sheets for an Excel workbook: What to do, Findings, Tools (arrays of rows, first row the header). */
export const modelsSheets = (report, tools = report.tools || []) => ({
  'What to do': [['Priority', 'Tool', 'Action', 'Why'], ...modelActions(report).map((a) => [a.priority, a.tool, a.action, a.why])],
  Findings: [['Severity', 'Tool', 'Kind', 'Title', 'Detail'], ...(report.findings || []).map((f) => [f.severity, f.label, f.kind, f.title, f.detail])],
  Tools: [HEAD, ...tools.map(row)],
});
