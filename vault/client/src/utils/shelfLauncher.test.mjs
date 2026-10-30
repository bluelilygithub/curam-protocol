import assert from 'node:assert/strict';
import { SHELF_URL, isWindowsDesktop, launcherHelp } from './shelfLauncher.mjs';

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

assert.equal(launcherHelp('https://dl.example.com/VaultShelfSetup.exe').installerUrl, 'https://dl.example.com/VaultShelfSetup.exe');
assert.equal(launcherHelp('https://dl.example.com/VaultShelfSetup.exe').fallback, '');
assert.equal(launcherHelp('').installerUrl, '');
assert.match(launcherHelp('').fallback, /admin/i);
for (const bad of ['javascript:alert(1)', 'http://x.example/a.exe', 'data:text/html,x', 42, null, undefined]) assert.equal(launcherHelp(bad).installerUrl, '', String(bad));
assert.ok(!/\b(protocol|registry|URI|handler)\b/i.test(JSON.stringify(launcherHelp('https://a.example/b.exe'))), 'plain words only');

console.log('shelfLauncher: all passed');
