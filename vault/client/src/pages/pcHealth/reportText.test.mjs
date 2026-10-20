// node client/src/pages/pcHealth/reportText.test.mjs   (npm run test:pc-health)
import assert from 'assert';
import { buildReportText } from './reportText.mjs';

const scan = {
  finishedAt: '2026-10-21T00:00:00Z',
  report: {
    machine: { hostname: 'PC1', os: 'Windows 10', cpuName: 'Xeon', cores: 8, uptimeHours: 5, ramTotalMB: 32000, ramFreeMB: 16000, cpuLoadPct: 28 },
    drives: [{ name: 'C:', label: '', sizeGB: 237.8, freeGB: 9 }],
    processes: [{ name: 'chrome', count: 29, cpuPct: 10, ramMB: 5600 }, { name: 'node', count: 22, cpuPct: 20, ramMB: 1700 }],
    folders: [{ path: 'C:\\Users\\a', sizeMB: 90000 }],
    logs: { count: 3429, totalMB: 1010, files: [] },
    scan: { roots: ['C:\\Users\\a'], filesSeen: 1234567, seconds: 111, truncated: true, skipped: 4 },
  },
  findings: {
    hadPrevious: false,
    growth: [],
    findings: [
      { id: 'disk:C:', severity: 'high', title: 'Drive C: is 96.2% full', detail: '9 GB free.', more: { what: 'Close to full.', why: 'Slow.', options: ['Move things'], caution: 'Check first.' } },
      { id: 'files:x', severity: 'watch', title: 'Large file: 1 GB', detail: 'Last changed 2026-01-01.', path: 'C:\\x.zip' },
      { id: 'i', severity: 'info', title: 'Info only', detail: '' },
    ],
  },
};

const short = buildReportText(scan);
assert.match(short, /PC HEALTH REPORT - PC1/);
assert.match(short, /changed nothing/);
assert.match(short, /C:: 9\.0 GB free of 237\.8 GB \(96% used\)/);
assert.match(short, /1\. \[HIGH\] Drive C: is 96\.2% full/);
assert.match(short, /2\. \[WATCH\] Large file: 1 GB[\s\S]*C:\\x\.zip/);
assert.ok(!/Info only/.test(short), 'info findings are left out');
assert.ok(!/What it is:/.test(short), 'no explanations unless asked');
assert.match(short, /CUT SHORT/);
assert.match(short, /first scan, nothing to compare/);
assert.match(short, /chrome \(29 copies\): 5\.5 GB/);

const full = buildReportText(scan, { withMore: true });
assert.match(full, /What it is: Close to full\./);
assert.match(full, /Why it matters: Slow\./);
assert.match(full, /What you could do \(your decision\):\n\s+- Move things/);
assert.match(full, /Check first: Check first\./);
assert.ok(!/What it is:[^\n]*\n(?:.*\n)*?.*\[WATCH\].*What it is/.test(full), 'a finding without advice shows none');

assert.strictEqual(buildReportText(null), '');
assert.strictEqual(buildReportText({}), '');

console.log('reportText tests passed');
