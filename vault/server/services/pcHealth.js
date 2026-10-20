'use strict';

// PC Health agent, the pure half: clean up a report sent by the helper on the admin's own PC, and turn it into plain findings.
// The helper (server/assets/pc-health-helper.ps1) only READS the machine; nothing here, or anywhere in this agent, deletes, moves
// or changes a file, and no finding carries a "fix" command. The report is untrusted input (anyone with the token could post one),
// so every field is type-checked, bounded and stripped of control characters before it is stored or shown.
// The thresholds are code, not model output: the same report always gives the same findings. See docs/pc-health.md.

const LEFTOVER_KINDS = ['crash-dump', 'temp', 'cache', 'recycle-bin', 'old-windows', 'installer', 'disk-image', 'package-cache', 'system-file', 'other'];

const LIMITS = {
  processes: 40, largeFiles: 200, folders: 300, logFiles: 200, leftovers: 200, drives: 12, roots: 20,
};

const THRESHOLDS = {
  driveFreeWatchPct: 20, driveFreeHighPct: 10,
  ramUsedWatchPct: 70, ramUsedHighPct: 85,
  processRamWatchMB: 1500, processRamHighMB: 4000,
  processCpuWatchPct: 25, processCpuHighPct: 60,
  cpuLoadWatchPct: 60, cpuLoadHighPct: 85,
  largeFileHighMB: 5000,
  logTotalWatchMB: 200, logTotalHighMB: 1000, logFileWatchMB: 100,
  leftoverWatchMB: 500, leftoverHighMB: 5000,
  growthMinMB: 100, growthWatchMB: 500, growthWatchPct: 25, newFolderWatchMB: 1000, newFolderHighMB: 5000,
};

const num = (v, max = 1e9) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };
const str = (v, n = 400) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const round1 = (n) => Math.round(n * 10) / 10;
const isoOrNull = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

/** Clean a report from the helper. Never throws on shape problems: a missing part becomes empty. */
function sanitizeReport(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const m = r.machine && typeof r.machine === 'object' ? r.machine : {};
  const scan = r.scan && typeof r.scan === 'object' ? r.scan : {};
  const logs = r.logs && typeof r.logs === 'object' ? r.logs : {};
  const file = (f) => ({ path: str(f && f.path), sizeMB: round1(num(f && f.sizeMB, 1e8)), modified: isoOrNull(f && f.modified) });
  return {
    helperVersion: str(r.helperVersion, 20),
    machine: {
      hostname: str(m.hostname, 80), os: str(m.os, 120), cpuName: str(m.cpuName, 120),
      cores: Math.round(num(m.cores, 1024)), cpuLoadPct: round1(Math.min(100, num(m.cpuLoadPct, 100))),
      ramTotalMB: Math.round(num(m.ramTotalMB, 1e8)), ramFreeMB: Math.round(num(m.ramFreeMB, 1e8)),
      uptimeHours: round1(num(m.uptimeHours, 1e6)),
    },
    drives: arr(r.drives, LIMITS.drives).map((d) => ({
      name: str(d && d.name, 16), label: str(d && d.label, 60), sizeGB: round1(num(d && d.sizeGB, 1e7)), freeGB: round1(num(d && d.freeGB, 1e7)),
    })),
    processes: arr(r.processes, LIMITS.processes).map((p) => ({
      name: str(p && p.name, 80), count: Math.max(1, Math.round(num(p && p.count, 10000))),
      cpuPct: round1(Math.min(100, num(p && p.cpuPct, 100))), ramMB: Math.round(num(p && p.ramMB, 1e8)),
    })),
    largeFiles: arr(r.largeFiles, LIMITS.largeFiles).map(file),
    folders: arr(r.folders, LIMITS.folders).map((f) => ({ path: str(f && f.path), sizeMB: round1(num(f && f.sizeMB, 1e8)) })),
    logs: { totalMB: round1(num(logs.totalMB, 1e8)), count: Math.round(num(logs.count, 1e8)), files: arr(logs.files, LIMITS.logFiles).map(file) },
    leftovers: arr(r.leftovers, LIMITS.leftovers).map((l) => ({
      kind: LEFTOVER_KINDS.includes(l && l.kind) ? l.kind : 'other', path: str(l && l.path), sizeMB: round1(num(l && l.sizeMB, 1e8)), note: str(l && l.note, 200),
    })),
    scan: {
      roots: arr(scan.roots, LIMITS.roots).map((x) => str(x, 260)), seconds: Math.round(num(scan.seconds, 1e6)),
      truncated: scan.truncated === true, skipped: Math.round(num(scan.skipped, 1e9)), filesSeen: Math.round(num(scan.filesSeen, 1e12)),
    },
  };
}

/** What a scan request may ask for. Anything else is ignored; the helper re-checks it too. */
function cleanScanOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const roots = arr(o.roots, LIMITS.roots).map((x) => str(x, 260).trim()).filter((x) => /^[A-Za-z]:\\/.test(x));
  return {
    wholeDrive: o.wholeDrive === true,
    roots,
    largeFileMB: Math.min(5000, Math.max(50, Math.round(num(o.largeFileMB, 5000)) || 500)),
    minutes: Math.min(30, Math.max(1, Math.round(num(o.minutes, 30)) || 10)),
  };
}

const fmtMB = (mb) => (mb >= 1024 ? `${round1(mb / 1024)} GB` : `${Math.round(mb)} MB`);
const SEV_ORDER = { high: 0, watch: 1, info: 2 };

/**
 * Findings from one report, with the previous finished report (if any) for growth. Pure.
 * Each finding: { id, severity: 'high'|'watch'|'info', area, title, detail, path? }. Wording says what is there and why it matters;
 * it never tells the person to run a command, and never says anything was changed.
 */
function analyse(report, prev = null, prevAt = null, nowAt = new Date()) {
  const T = THRESHOLDS; const out = [];
  const add = (f) => out.push(f);
  const m = report.machine;

  for (const d of report.drives) {
    if (!d.sizeGB) continue;
    const freePct = (d.freeGB / d.sizeGB) * 100;
    if (freePct < T.driveFreeWatchPct) {
      add({ id: `disk:${d.name}`, severity: freePct < T.driveFreeHighPct ? 'high' : 'watch', area: 'disk',
        title: `Drive ${d.name} is ${round1(100 - freePct)}% full`,
        detail: `${round1(d.freeGB)} GB free of ${round1(d.sizeGB)} GB. Windows and many programs slow down or fail when a drive is nearly full.` });
    }
  }

  if (m.ramTotalMB) {
    const usedPct = ((m.ramTotalMB - m.ramFreeMB) / m.ramTotalMB) * 100;
    if (usedPct >= T.ramUsedWatchPct) {
      add({ id: 'ram:total', severity: usedPct >= T.ramUsedHighPct ? 'high' : 'watch', area: 'ram',
        title: `Memory is ${Math.round(usedPct)}% used`,
        detail: `${fmtMB(m.ramTotalMB - m.ramFreeMB)} in use of ${fmtMB(m.ramTotalMB)}. When memory runs out Windows swaps to the disk, which makes everything slow.` });
    }
  }
  if (m.cpuLoadPct >= T.cpuLoadWatchPct) {
    add({ id: 'cpu:total', severity: m.cpuLoadPct >= T.cpuLoadHighPct ? 'high' : 'watch', area: 'cpu',
      title: `Processor load was ${Math.round(m.cpuLoadPct)}% when scanned`,
      detail: 'A snapshot over a few seconds, so check the programs listed below before reading much into it.' });
  }
  for (const p of report.processes) {
    if (p.ramMB >= T.processRamWatchMB) {
      add({ id: `ram:${p.name.toLowerCase()}`, severity: p.ramMB >= T.processRamHighMB ? 'high' : 'watch', area: 'ram',
        title: `${p.name} is using ${fmtMB(p.ramMB)} of memory`,
        detail: p.count > 1 ? `Across ${p.count} running copies of it.` : 'One running copy.' });
    }
    if (p.cpuPct >= T.processCpuWatchPct) {
      add({ id: `cpu:${p.name.toLowerCase()}`, severity: p.cpuPct >= T.processCpuHighPct ? 'high' : 'watch', area: 'cpu',
        title: `${p.name} was using ${Math.round(p.cpuPct)}% of the processor`,
        detail: p.count > 1 ? `Across ${p.count} running copies of it, over a few seconds.` : 'Over a few seconds, so it may have been a short burst.' });
    }
  }

  for (const f of report.largeFiles) {
    add({ id: `files:${f.path.toLowerCase()}`, severity: f.sizeMB >= T.largeFileHighMB ? 'high' : 'watch', area: 'files', path: f.path,
      title: `Large file: ${fmtMB(f.sizeMB)}`, detail: f.modified ? `Last changed ${f.modified.slice(0, 10)}.` : 'Last-changed date not available.' });
  }

  const logTotal = report.logs.totalMB;
  if (logTotal >= T.logTotalWatchMB) {
    add({ id: 'logs:total', severity: logTotal >= T.logTotalHighMB ? 'high' : 'watch', area: 'logs',
      title: `${report.logs.count} log files take ${fmtMB(logTotal)}`,
      detail: 'Logs that are never rotated keep growing. The biggest ones are listed under Logs and leftovers.' });
  }
  for (const f of report.logs.files) {
    if (f.sizeMB >= T.logFileWatchMB) {
      add({ id: `logs:${f.path.toLowerCase()}`, severity: 'watch', area: 'logs', path: f.path, title: `Large log file: ${fmtMB(f.sizeMB)}`,
        detail: f.modified ? `Last written ${f.modified.slice(0, 10)}.` : 'Last-written date not available.' });
    }
  }
  for (const l of report.leftovers) {
    if (l.sizeMB >= T.leftoverWatchMB) {
      add({ id: `leftover:${l.kind}:${l.path.toLowerCase()}`, severity: l.sizeMB >= T.leftoverHighMB ? 'high' : 'watch', area: 'logs', path: l.path,
        title: `${LEFTOVER_LABEL[l.kind]}: ${fmtMB(l.sizeMB)}`, detail: l.note || 'Looks like something left behind.' });
    }
  }

  // Growth against the previous finished scan, folder by folder.
  const growth = [];
  if (prev && Array.isArray(prev.folders) && prevAt) {
    const days = Math.max((new Date(nowAt) - new Date(prevAt)) / 86400000, 0.01);
    const before = new Map(prev.folders.map((f) => [f.path.toLowerCase(), f.sizeMB]));
    for (const f of report.folders) {
      const was = before.get(f.path.toLowerCase());
      const grew = was == null ? f.sizeMB : f.sizeMB - was;
      if (was == null) {
        if (f.sizeMB >= T.newFolderWatchMB) {
          growth.push({ path: f.path, nowMB: f.sizeMB, wasMB: null, grewMB: round1(grew), perDayMB: round1(grew / days), isNew: true });
        }
      } else if (grew >= T.growthMinMB && (grew >= T.growthWatchMB || (was > 0 && (grew / was) * 100 >= T.growthWatchPct))) {
        growth.push({ path: f.path, nowMB: f.sizeMB, wasMB: was, grewMB: round1(grew), perDayMB: round1(grew / days), isNew: false });
      }
    }
    growth.sort((a, b) => b.grewMB - a.grewMB);
    for (const g of growth.slice(0, 25)) {
      add({ id: `growth:${g.path.toLowerCase()}`, severity: g.isNew ? (g.nowMB >= T.newFolderHighMB ? 'high' : 'watch') : (g.grewMB >= 2 * T.growthWatchMB ? 'high' : 'watch'),
        area: 'growth', path: g.path,
        title: g.isNew ? `New large folder: ${fmtMB(g.nowMB)}` : `Grew by ${fmtMB(g.grewMB)} since the last scan`,
        detail: g.isNew ? 'Not in the previous scan.' : `Was ${fmtMB(g.wasMB)}, now ${fmtMB(g.nowMB)}: about ${fmtMB(g.perDayMB)} a day.` });
    }
  }

  out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return { findings: out, growth: growth.slice(0, 25), hadPrevious: !!prev };
}

const LEFTOVER_LABEL = {
  'crash-dump': 'Crash dump', temp: 'Temporary files', cache: 'Cache', 'recycle-bin': 'Recycle Bin', 'old-windows': 'Old Windows install',
  installer: 'Installer left in a folder', 'disk-image': 'Disk image', 'package-cache': 'Package cache', 'system-file': 'System file', other: 'Left-behind item',
};

/** One short line per severity for the Overview header and the list of past scans. */
function summarise(findings) {
  const c = { high: 0, watch: 0, info: 0 };
  for (const f of findings) c[f.severity] += 1;
  return c;
}

module.exports = { LEFTOVER_KINDS, LEFTOVER_LABEL, LIMITS, THRESHOLDS, sanitizeReport, cleanScanOptions, analyse, summarise };
