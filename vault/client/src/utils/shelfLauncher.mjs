// The "Open Shelf" button in Vault's top bar (docs/vault-shelf.md). Pure helpers, so they can be tested without a browser.

/** The only address the button ever opens. It carries no information: the Windows app opens its shelf and nothing else. */
export const SHELF_URL = 'vault-shelf://open';

/**
 * The Shelf app is a Windows program, so the button is for a Windows desktop browser only: not a phone or tablet, not a Mac or Linux PC.
 * `nav` is the browser's navigator (passed in so a test can supply one); `width` is the window width.
 */
export function isWindowsDesktop(nav, width = 1024) {
  if (!nav || width < 640) return false;
  const ua = String(nav.userAgent || '');
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  const platform = String(nav.userAgentData?.platform || '');
  if (platform) return /^Windows$/i.test(platform);
  return /Windows NT/i.test(ua);
}

/**
 * What to say after the button is pressed, and where the installer comes from. The browser cannot tell us whether the app opened, so this never
 * claims it did not. The installer is the one an admin uploaded to Vault if there is one, else the outside address an admin entered, else nothing.
 */
export function launcherHelp({ installerAvailable = false, installerUrl = '' } = {}) {
  const url = typeof installerUrl === 'string' && /^https:\/\//i.test(installerUrl) ? installerUrl : '';
  const source = installerAvailable === true ? 'vault' : url ? 'link' : null;
  return {
    title: 'Opening Vault Shelf',
    text: 'Your browser may ask to open Vault Shelf: choose Open. If nothing happens, the app may not be installed on this PC yet.',
    source,
    installerUrl: source === 'link' ? url : '',
    fallback: source ? '' : 'Ask your Vault admin for the installer.',
  };
}

/** "58.4 MB" for the size of the uploaded installer. */
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
