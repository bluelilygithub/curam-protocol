'use strict';

// node server/services/pcHealth.test.js   (npm run test:pc-health). Pure code: no database, no PC.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sanitizeReport, cleanScanOptions, analyse, summarise, LEFTOVER_KINDS } = require('./pcHealth');

// ---- the report is untrusted: junk becomes empty/zero, text is bounded and stripped of control characters ----
const empty = sanitizeReport(null);
assert.strictEqual(empty.drives.length, 0);
assert.strictEqual(empty.machine.ramTotalMB, 0);
const junk = sanitizeReport({
  machine: { hostname: 'PC\u0000\u001b[31m', cores: -4, cpuLoadPct: 900, ramTotalMB: 'lots' },
  drives: 'nope',
  largeFiles: [{ path: 'x'.repeat(5000), sizeMB: -1, modified: 'not a date' }, null],
  leftovers: [{ kind: 'rm -rf', path: 'C:\\a', sizeMB: 10 }],
  processes: Array.from({ length: 500 }, (_, i) => ({ name: `p${i}`, ramMB: 1 })),
  logs: { files: Array.from({ length: 999 }, () => ({ path: 'C:\\l.log', sizeMB: 1 })) },
});
assert.ok(!/[\u0000-\u001f]/.test(junk.machine.hostname), 'control characters are removed');
assert.strictEqual(junk.machine.cores, 0);
assert.strictEqual(junk.machine.cpuLoadPct, 100, 'percentages are capped');
assert.strictEqual(junk.machine.ramTotalMB, 0);
assert.strictEqual(junk.largeFiles[0].path.length, 400, 'long paths are cut');
assert.strictEqual(junk.largeFiles[0].sizeMB, 0);
assert.strictEqual(junk.largeFiles[0].modified, null);
assert.strictEqual(junk.leftovers[0].kind, 'other', 'an unknown kind becomes other');
assert.ok(LEFTOVER_KINDS.includes('crash-dump'));
assert.strictEqual(junk.processes.length, 40, 'lists are bounded');
assert.strictEqual(junk.logs.files.length, 200);

// ---- what a scan request may ask for ----
assert.deepStrictEqual(cleanScanOptions(null), { wholeDrive: false, roots: [], largeFileMB: 500, minutes: 10 });
const opts = cleanScanOptions({ wholeDrive: 'yes', roots: ['C:\\Users\\me', '/etc', '\\\\server\\share', 'D:\\data'], largeFileMB: 1, minutes: 999 });
assert.strictEqual(opts.wholeDrive, false, 'only true turns on the whole drive');
assert.deepStrictEqual(opts.roots, ['C:\\Users\\me', 'D:\\data'], 'only local drive folders are accepted');
assert.strictEqual(opts.largeFileMB, 50);
assert.strictEqual(opts.minutes, 30);

// ---- findings ----
const base = () => sanitizeReport({
  machine: { hostname: 'PC', cores: 8, cpuLoadPct: 10, ramTotalMB: 16000, ramFreeMB: 12000 },
  drives: [{ name: 'C:', sizeGB: 500, freeGB: 300 }],
});
assert.strictEqual(analyse(base()).findings.length, 0, 'a healthy PC has no findings');

let r = base();
r.drives = [{ name: 'C:', label: '', sizeGB: 500, freeGB: 40 }, { name: 'D:', label: '', sizeGB: 1000, freeGB: 150 }, { name: 'E:', label: '', sizeGB: 100, freeGB: 90 }];
let f = analyse(r).findings;
assert.deepStrictEqual(f.map((x) => [x.id, x.severity]), [['disk:C:', 'high'], ['disk:D:', 'watch']], '92% full is high, 85% full is watch, 10% full is fine');

r = base();
r.machine.ramFreeMB = 1000; r.machine.cpuLoadPct = 90;
r.processes = [{ name: 'chrome', count: 30, cpuPct: 5, ramMB: 4500 }, { name: 'node', count: 1, cpuPct: 70, ramMB: 300 }, { name: 'calm', count: 1, cpuPct: 1, ramMB: 100 }];
f = analyse(r).findings;
const byId = Object.fromEntries(f.map((x) => [x.id, x]));
assert.strictEqual(byId['ram:total'].severity, 'high');
assert.strictEqual(byId['cpu:total'].severity, 'high');
assert.strictEqual(byId['ram:chrome'].severity, 'high');
assert.match(byId['ram:chrome'].detail, /30 running copies/);
assert.strictEqual(byId['cpu:node'].severity, 'high');
assert.ok(!byId['ram:calm'] && !byId['cpu:calm'], 'quiet programs are not listed');
assert.strictEqual(f[0].severity, 'high', 'most important first');

r = base();
r.largeFiles = [{ path: 'C:\\a\\vm.vhdx', sizeMB: 20000, modified: '2026-01-02T00:00:00Z' }, { path: 'C:\\a\\big.zip', sizeMB: 700, modified: null }];
r.logs = { totalMB: 1500, count: 4000, files: [{ path: 'C:\\x\\app.log', sizeMB: 800, modified: '2026-10-01T00:00:00Z' }, { path: 'C:\\x\\small.log', sizeMB: 2, modified: null }] };
r.leftovers = [{ kind: 'crash-dump', path: 'C:\\dumps', sizeMB: 6000, note: 'dumps' }, { kind: 'temp', path: 'C:\\t', sizeMB: 100, note: '' }];
f = analyse(r).findings;
const ids = f.map((x) => x.id);
assert.ok(ids.includes('files:c:\\a\\vm.vhdx') && ids.includes('files:c:\\a\\big.zip'));
assert.strictEqual(f.find((x) => x.id === 'files:c:\\a\\vm.vhdx').severity, 'high');
assert.strictEqual(f.find((x) => x.id === 'files:c:\\a\\big.zip').severity, 'watch');
assert.strictEqual(f.find((x) => x.id === 'logs:total').severity, 'high');
assert.ok(ids.includes('logs:c:\\x\\app.log') && !ids.includes('logs:c:\\x\\small.log'));
assert.strictEqual(f.find((x) => x.id === 'leftover:crash-dump:c:\\dumps').severity, 'high');
assert.ok(!ids.some((i) => i.includes('c:\\t')), 'small leftovers are not flagged');
assert.deepStrictEqual(summarise(f), { high: f.filter((x) => x.severity === 'high').length, watch: f.filter((x) => x.severity === 'watch').length, info: 0 });

// ---- growth against the previous scan ----
const prev = base(); prev.folders = [{ path: 'C:\\Users\\me\\logs', sizeMB: 1000 }, { path: 'C:\\Users\\me\\stable', sizeMB: 5000 }, { path: 'C:\\Users\\me\\tiny', sizeMB: 10 }];
const now = base(); now.folders = [
  { path: 'c:\\users\\me\\logs', sizeMB: 4000 },     // grew 3 GB (path case differs)
  { path: 'C:\\Users\\me\\stable', sizeMB: 5050 },   // +1%, under the limit
  { path: 'C:\\Users\\me\\tiny', sizeMB: 60 },       // +500% but only 50 MB
  { path: 'C:\\Users\\me\\newbig', sizeMB: 7000 },   // new
  { path: 'C:\\Users\\me\\newsmall', sizeMB: 200 },  // new but small
];
const t0 = '2026-10-18T00:00:00Z'; const t1 = new Date('2026-10-21T00:00:00Z');
const g = analyse(now, prev, t0, t1);
assert.strictEqual(g.hadPrevious, true);
assert.deepStrictEqual(g.growth.map((x) => x.path), ['C:\\Users\\me\\newbig', 'c:\\users\\me\\logs']);
const logsG = g.growth.find((x) => /logs$/i.test(x.path));
assert.strictEqual(logsG.grewMB, 3000);
assert.strictEqual(logsG.perDayMB, 1000, '3 GB over 3 days');
assert.strictEqual(g.findings.find((x) => x.id.startsWith('growth:') && /newbig/.test(x.id)).severity, 'high');
assert.strictEqual(analyse(now).hadPrevious, false, 'the first scan has nothing to compare with');
assert.strictEqual(analyse(now).growth.length, 0);

// ---- the agent only reports: nothing in the findings or the helper offers a way to change the PC ----
const words = JSON.stringify([f, g.findings]);
assert.ok(!/\b(rm|del|rmdir|Remove-Item|format)\b/i.test(words.replace(/title|detail/g, '')), 'no finding carries a delete command');
const helper = fs.readFileSync(path.join(__dirname, '../assets/pc-health-helper.ps1'), 'utf8')
  .replace(/<#[\s\S]*?#>/, '').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').replace(/'[^'\n]*'|"[^"\n]*"/g, '""');
for (const bad of ['Remove-Item', 'Set-Content', 'Add-Content', 'Out-File', 'New-Item', 'Move-Item', 'Rename-Item', 'Copy-Item', 'Clear-', 'Stop-Process', 'Stop-Service',
  'Set-ItemProperty', 'Compress-', 'Expand-', 'Start-Process', 'Invoke-Expression', 'iex ', 'Invoke-Command', '.Delete(', '[System.IO.File]::Write', '[IO.File]::Write', 'WriteAll']) {
  assert.ok(!helper.includes(bad), `the helper must stay read-only: found ${bad}`);
}
assert.ok(/Get-CimInstance/.test(helper) && /EnumerateFiles/.test(helper));

console.log('pcHealth tests passed');
