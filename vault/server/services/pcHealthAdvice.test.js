'use strict';

// node server/services/pcHealthAdvice.test.js   (npm run test:pc-health). Pure code.

const assert = require('assert');
const { explain, withAdvice } = require('./pcHealthAdvice');
const { LEFTOVER_KINDS, analyse, sanitizeReport } = require('./pcHealth');

const F = (id, path) => ({ id, path, severity: 'watch', area: 'x', title: 't', detail: 'd' });
const fileAdvice = (p) => explain(F(`files:${p.toLowerCase()}`, p));

// ---- the paths from the first real scan get the right explanation ----
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx').what, /Docker Desktop/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx').caution, /Never delete the file/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Local\\wsl\\{guid}\\ext4.vhdx').what, /Linux/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Roaming\\Claude\\vm_bundles\\claudevm.bundle\\rootfs.vhdx').what, /Claude desktop app/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Roaming\\Claude\\vm_bundles\\claudevm.bundle\\rootfs.vhdx.zst').what, /Claude desktop app/);
assert.match(fileAdvice('C:\\Users\\m\\Downloads\\a.7z').what, /archive/i);
assert.match(fileAdvice('C:\\Users\\m\\Downloads\\x_archive.daf').what, /archive/i);
assert.match(fileAdvice('C:\\Users\\m\\Downloads\\Docker Desktop Installer.exe').what, /installer/i);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb').what, /saved state database/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb.backup').what, /saved state database/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Roaming\\Local\\run\\x\\mysql\\data\\binlog.000002').what, /MySQL binary logs/);
assert.match(fileAdvice('C:\\Users\\m\\open-design\\.git\\objects\\pack\\pack-1.pack').what, /Git repository/);
assert.match(fileAdvice('C:\\Users\\m\\Downloads\\d.sql').what, /database export/);
assert.match(fileAdvice('C:\\Users\\m\\AppData\\Local\\local-updater\\installer.exe').what, /Local app/);
assert.match(fileAdvice('D:\\random\\thing.dat').what, /large file/i);

assert.match(explain({ ...F('logs:c:\\sites\\talea\\wp-content\\debug.log', 'C:\\Sites\\talea\\app\\public\\wp-content\\debug.log') }).what, /WordPress debug log/);
assert.match(explain(F('logs:total')).what, /Many log files/);
assert.match(explain(F('ram:chrome')).what, /web browser/);
assert.match(explain(F('ram:node')).what, /Node\.js/);
assert.match(explain(F('ram:vmmem')).what, /WSL or Docker/);
assert.match(explain(F('ram:something')).what, /something/);
assert.match(explain(F('ram:total')).what, /memory/);
assert.match(explain(F('cpu:node')).why, /few seconds/);
assert.match(explain(F('disk:C:')).why, /15 to 20 percent/);
assert.match(explain(F('growth:c:\\a')).what, /getting bigger/);
assert.match(explain(F('leftover:package-cache:c:\\u\\npm-cache')).what, /package cache/);
assert.match(explain(F('leftover:recycle-bin:c:\\$recycle.bin')).caution, /permanent/);

// every leftover kind the helper can send has its own explanation
for (const kind of LEFTOVER_KINDS) {
  const a = explain(F(`leftover:${kind}:c:\\x`));
  assert.ok(a.what && a.why && a.options.length, `leftover kind ${kind} is explained`);
}
// an id we do not know yields empty text, never a crash
assert.deepStrictEqual(explain({ id: 'zzz' }), { what: '', why: '', options: [], caution: '' });
assert.deepStrictEqual(explain(null), { what: '', why: '', options: [], caution: '' });

// ---- the advice only explains: no command to run, nothing that says it was done ----
const BANNED = /\b(rm|del|rmdir|erase|Remove-Item|format|docker (system )?prune|npm cache|git gc|wsl --|diskpart|Optimize-VHD|sudo|cmd\.exe|powershell)\b|`|--[a-z]/i;
const probes = [
  'C:\\Users\\m\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx', 'C:\\a\\ext4.vhdx', 'C:\\a\\claudevm.bundle\\r.vhdx', 'C:\\a\\x.vhd', 'C:\\Users\\m\\Downloads\\a.exe',
  'C:\\Users\\m\\Downloads\\a.zip', 'C:\\a\\a.iso', 'C:\\a\\a.sql', 'C:\\Cursor\\state.vscdb', 'C:\\a\\binlog.000001', 'C:\\r\\.git\\objects\\pack\\p.pack',
  'C:\\local-updater\\i.exe', 'C:\\z\\z.dat',
];
const all = [
  ...probes.map(fileAdvice), explain(F('disk:C:')), explain(F('ram:total')), explain(F('ram:chrome')), explain(F('ram:node')), explain(F('ram:vmmem')),
  explain(F('ram:cursor')), explain(F('ram:other')), explain(F('cpu:total')), explain(F('cpu:x')), explain(F('logs:total')), explain(F('logs:c:\\a.log', 'C:\\a.log')),
  explain(F('logs:x', 'C:\\a\\wp-content\\debug.log')), explain(F('growth:x')), ...LEFTOVER_KINDS.map((k) => explain(F(`leftover:${k}:x`))),
];
for (const a of all) {
  const text = [a.what, a.why, a.caution, ...a.options].join('\n');
  assert.ok(!BANNED.test(text), `no command in: ${text.match(BANNED) && text.match(BANNED)[0]}`);
  assert.ok(a.what && a.why && Array.isArray(a.options), 'every explanation has a what, why and options');
}

// ---- withAdvice adds `more` to each stored finding and leaves the rest alone ----
const report = sanitizeReport({
  machine: { ramTotalMB: 16000, ramFreeMB: 1000 }, drives: [{ name: 'C:', sizeGB: 100, freeGB: 5 }],
  largeFiles: [{ path: 'C:\\Users\\m\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx', sizeMB: 13800, modified: '2026-10-17T00:00:00Z' }],
});
const stored = analyse(report);
const enriched = withAdvice(stored);
assert.strictEqual(enriched.findings.length, stored.findings.length);
assert.ok(enriched.findings.every((f) => f.more && f.more.what));
assert.ok(!('more' in stored.findings[0]), 'the stored findings are not changed');
assert.strictEqual(withAdvice(null), null);
assert.strictEqual(withAdvice({ hadPrevious: true }).hadPrevious, true);

console.log('pcHealthAdvice tests passed');
