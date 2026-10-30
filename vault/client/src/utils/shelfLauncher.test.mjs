import assert from 'node:assert/strict';
import { SHELF_URL, formatSize, isWindowsDesktop, launcherHelp } from './shelfLauncher.mjs';

const win = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
assert.equal(SHELF_URL, 'vault-shelf://open');
assert.equal(isWindowsDesktop(win, 1400), true, 'a Windows desktop browser');
assert.equal(isWindowsDesktop({ ...win, userAgentData: { platform: 'Windows' } }, 1400), true);
assert.equal(isWindowsDesktop({ ...win, userAgentData: { platform: 'macOS' } }, 1400), false, 'the platform hint wins over the agent string');
assert.equal(isWindowsDesktop(win, 500), false, 'a narrow window is treated as a phone');
assert.equal(isWindowsDesktop({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit' }, 1400), false);
assert.equal(isWindowsDesktop({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, 1400), false);
assert.equal(isWindowsDesktop({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) Mobile' }, 1400), false);
assert.equal(isWindowsDesktop({ userAgent: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) Mobile' }, 1400), false);
assert.equal(isWindowsDesktop({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }, 1400), false);
assert.equal(isWindowsDesktop(null), false);

// where the installer comes from: Vault's own copy wins, then an outside address, then "ask your admin"
const link = 'https://dl.example.com/VaultShelfSetup.exe';
assert.equal(launcherHelp({ installerAvailable: true, installerUrl: link }).source, 'vault');
assert.equal(launcherHelp({ installerAvailable: true, installerUrl: link }).installerUrl, '', 'no outside link is shown when Vault has the file');
assert.equal(launcherHelp({ installerUrl: link }).source, 'link');
assert.equal(launcherHelp({ installerUrl: link }).installerUrl, link);
assert.equal(launcherHelp({ installerUrl: link }).fallback, '');
assert.equal(launcherHelp({}).source, null);
assert.equal(launcherHelp().source, null);
assert.match(launcherHelp({}).fallback, /admin/i);
for (const bad of ['javascript:alert(1)', 'http://x.example/a.exe', 'data:text/html,x', 42, null, undefined]) assert.equal(launcherHelp({ installerUrl: bad }).source, null, String(bad));
assert.equal(launcherHelp({ installerAvailable: 'yes' }).source, null, 'only a real true counts');
assert.ok(!/\b(protocol|registry|URI|handler)\b/i.test(JSON.stringify(launcherHelp({ installerAvailable: true }))), 'plain words only');

assert.equal(formatSize(62_400_000), '59.5 MB');
assert.equal(formatSize(2048), '2 KB');
assert.equal(formatSize(10), '1 KB');
assert.equal(formatSize(-1), '');
assert.equal(formatSize('x'), '');

console.log('shelfLauncher: all passed');
