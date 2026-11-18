// Shared between PDF → HTML (pages/pdf/PdfToHtml.jsx) and the app-wide watcher (components/PdfHtmlWatcher.jsx), so the watcher knows
// when a web page is being made and does not toast while the tool itself is on screen (the tool shows its own message).
const WATCH_KEY = 'vault_pdf_html_watch';
const TOASTED_KEY = 'vault_pdf_html_toasted';
export const WATCH_EVENT = 'vault:pdf-html-watch';

let toolOpen = false;
export const setToolOpen = (open) => { toolOpen = !!open; };
export const isToolOpen = () => toolOpen;

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* not remembered */ } };

/** A job was started here: the watcher should check on it (also after a reload, until it ends). */
export function startWatching() {
  set(WATCH_KEY, '1');
  try { window.dispatchEvent(new Event(WATCH_EVENT)); } catch { /* no window */ }
}
export const isWatching = () => get(WATCH_KEY) === '1';
export const stopWatching = () => set(WATCH_KEY, null);

/** Job runs already toasted, as "id:finishedAt", so each finished run is announced once. */
export function alreadyToasted(key) {
  return (get(TOASTED_KEY) || '').split(',').includes(key);
}
export function markToasted(key) {
  const list = (get(TOASTED_KEY) || '').split(',').filter(Boolean);
  if (!list.includes(key)) set(TOASTED_KEY, [...list, key].slice(-30).join(','));
}
