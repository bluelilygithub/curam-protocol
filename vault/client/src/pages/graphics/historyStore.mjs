// "Recent results" for Graphics, kept in this browser only (IndexedDB). Nothing is uploaded, so the promise that the
// browser-only tools send nothing away still holds. Off until the person switches it on. The pure helpers at the
// top are tested with node (npm run test:graphics-history); the IndexedDB part needs a browser.

export const HISTORY_MAX_ITEMS = 40;
export const HISTORY_MAX_BYTES = 150 * 1024 * 1024; // all kept pictures together
export const HISTORY_MAX_ITEM_BYTES = 12 * 1024 * 1024; // a single picture bigger than this is not kept
export const BATCH_KEEP = 6; // a batch can make 25 results; keeping all would push everything else out of the 40
export const HISTORY_ON_KEY = 'vault_graphics_history_on';

/** Which entries to delete so what is kept fits the limits: the oldest go first. `entries` need { id, createdAt, bytes }. */
export function planPrune(entries, { maxItems = HISTORY_MAX_ITEMS, maxBytes = HISTORY_MAX_BYTES } = {}) {
  const newestFirst = [...entries].sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id)));
  const drop = [];
  let count = 0;
  let bytes = 0;
  for (const e of newestFirst) {
    count += 1;
    bytes += e.bytes || 0;
    if (count > maxItems || bytes > maxBytes) { drop.push(e.id); count -= 1; bytes -= e.bytes || 0; }
  }
  return drop;
}

/** A cheap fingerprint of a data URL so the same result is not saved twice in a row. */
export function signatureOf(dataUrl) {
  const s = String(dataUrl || '');
  return `${s.length}:${s.slice(-48)}:${s.slice(s.indexOf(',') + 1, s.indexOf(',') + 49)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(then, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const mime = (dataUrl.slice(5, comma).split(';')[0]) || 'image/png';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ── IndexedDB (browser only) ─────────────────────────────────────────────────────────────

const DB_NAME = 'vault-graphics-history';
const STORE = 'results';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Newest first, without the pictures themselves (thumbnails only) so the list stays light. */
export async function listHistory() {
  const all = await run('readonly', (s) => s.getAll());
  return (all || []).map(({ image, ...rest }) => rest).sort((a, b) => b.createdAt - a.createdAt);
}

/** The full picture of one entry, as a Blob. */
export async function getHistoryImage(id) {
  const row = await run('readonly', (s) => s.get(id));
  return row?.image || null;
}

export async function removeHistory(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  await run('readwrite', (s) => { list.forEach((id) => s.delete(id)); });
}

export async function clearHistory() {
  await run('readwrite', (s) => { s.clear(); });
}

/** Keep one result. Returns false when it was too big or already the latest one. */
export async function addHistory({ tool, name, dataUrl, thumb }) {
  const image = dataUrlToBlob(dataUrl);
  if (image.size > HISTORY_MAX_ITEM_BYTES) return false;
  const sig = signatureOf(dataUrl);
  const existing = await listHistory();
  if (existing[0]?.sig === sig) return false;
  await run('readwrite', (s) => { s.add({ tool, name, thumb, image, bytes: image.size, sig, createdAt: Date.now() }); });
  const all = await listHistory();
  const drop = planPrune(all);
  if (drop.length) await removeHistory(drop);
  return true;
}

/** A small preview of a picture (about 160px) as a data URL. */
export function makeThumb(dataUrl, max = 160) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try { resolve(c.toDataURL('image/webp', 0.7)); } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

export function historyEnabled() {
  try { return localStorage.getItem(HISTORY_ON_KEY) === '1'; } catch { return false; }
}

export function setHistoryEnabled(on) {
  try { localStorage.setItem(HISTORY_ON_KEY, on ? '1' : '0'); } catch { /* private window: it just will not be remembered */ }
}
