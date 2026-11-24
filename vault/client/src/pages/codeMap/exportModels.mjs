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
  out.push('## Findings');
  const all = report.findings || [];
  if (!all.length) out.push('None.');
  for (const f of all) out.push(`- **${f.severity}** · ${f.title}. ${f.detail}`);
  out.push('', '## Tools', mdTable(HEAD, tools.map(row)));
  return out.join('\n');
}
