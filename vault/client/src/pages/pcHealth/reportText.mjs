// Plain-text version of a PC Health scan, for the "Copy report" buttons (paste it into a chat, an email or a note). Pure, no DOM.
// It lists exactly what the page shows. With `withMore` each finding also carries its "More info" text. The report is only a copy of
// what the scan found; it changes nothing anywhere.

import { fmtMB, fmtGB, fmtWhen } from './format.mjs';

const MAX_FINDINGS = 60;
const SEV = { high: 'HIGH', watch: 'WATCH', info: 'INFO' };

function moreLines(more) {
  if (!more || !more.what) return [];
  const out = [`    What it is: ${more.what}`, `    Why it matters: ${more.why}`];
  if (more.options && more.options.length) {
    out.push('    What you could do (your decision):');
    more.options.forEach((o) => out.push(`      - ${o}`));
  }
  if (more.caution) out.push(`    Check first: ${more.caution}`);
  return out;
}

export function buildReportText(scan, { withMore = false } = {}) {
  if (!scan || !scan.report) return '';
  const r = scan.report;
  const m = r.machine || {};
  const findings = ((scan.findings && scan.findings.findings) || []).filter((f) => f.severity !== 'info');
  const L = [];

  L.push(`PC HEALTH REPORT - ${m.hostname || 'PC'} - scanned ${fmtWhen(scan.finishedAt)}`);
  L.push('Report only: this tool changed nothing on the PC.');
  if (m.os) L.push(`${m.os} | ${m.cpuName || ''} | ${m.cores || '?'} threads | on for ${m.uptimeHours || 0} h`);
  L.push('');

  L.push('DRIVES');
  (r.drives || []).forEach((d) => {
    const pct = d.sizeGB ? Math.round(((d.sizeGB - d.freeGB) / d.sizeGB) * 100) : 0;
    L.push(`  ${d.name} ${d.label || ''}`.trimEnd() + `: ${fmtGB(d.freeGB)} free of ${fmtGB(d.sizeGB)} (${pct}% used)`);
  });
  const usedMB = (m.ramTotalMB || 0) - (m.ramFreeMB || 0);
  L.push('');
  L.push(`MEMORY: ${fmtMB(usedMB)} used of ${fmtMB(m.ramTotalMB)}`);
  L.push(`PROCESSOR: ${Math.round(m.cpuLoadPct || 0)}% busy when scanned`);
  if (r.scan) {
    L.push('');
    L.push(`SCAN: ${(r.scan.roots || []).join('; ') || 'usual places'} | ${Number(r.scan.filesSeen || 0).toLocaleString('en-AU')} files in ${r.scan.seconds || 0}s`
      + `${r.scan.truncated ? ' | CUT SHORT by the time limit, sizes may be too low' : ''}${r.scan.skipped ? ` | ${r.scan.skipped} folders unreadable` : ''}`);
  }

  L.push('');
  L.push(`FINDINGS (${findings.length}${findings.length > MAX_FINDINGS ? `, first ${MAX_FINDINGS} shown` : ''})`);
  if (!findings.length) L.push('  Nothing needs a look.');
  findings.slice(0, MAX_FINDINGS).forEach((f, i) => {
    L.push(`${i + 1}. [${SEV[f.severity] || f.severity}] ${f.title}`);
    if (f.detail) L.push(`    ${f.detail}`);
    if (f.path) L.push(`    ${f.path}`);
    if (withMore) moreLines(f.more).forEach((l) => L.push(l));
  });

  const growth = (scan.findings && scan.findings.growth) || [];
  if (growth.length) {
    L.push('');
    L.push('GROWTH SINCE THE PREVIOUS SCAN');
    growth.slice(0, 15).forEach((g) => L.push(`  ${g.path}: ${g.isNew ? 'new' : `was ${fmtMB(g.wasMB)}`}, now ${fmtMB(g.nowMB)} (+${fmtMB(g.grewMB)}, about ${fmtMB(g.perDayMB)} a day)`));
  } else if (scan.findings && scan.findings.hadPrevious === false) {
    L.push('');
    L.push('GROWTH: first scan, nothing to compare with yet.');
  }

  const procs = [...(r.processes || [])].sort((a, b) => b.ramMB - a.ramMB).slice(0, 8);
  if (procs.length) {
    L.push('');
    L.push('TOP PROGRAMS BY MEMORY');
    procs.forEach((p) => L.push(`  ${p.name}${p.count > 1 ? ` (${p.count} copies)` : ''}: ${fmtMB(p.ramMB)}, ${p.cpuPct}% processor`));
  }

  const folders = (r.folders || []).slice(0, 12);
  if (folders.length) {
    L.push('');
    L.push('BIGGEST FOLDERS');
    folders.forEach((f) => L.push(`  ${fmtMB(f.sizeMB)}  ${f.path}`));
  }
  if (r.logs) {
    L.push('');
    L.push(`LOGS: ${Number(r.logs.count || 0).toLocaleString('en-AU')} files, ${fmtMB(r.logs.totalMB)} in total`);
  }
  return L.join('\n');
}
