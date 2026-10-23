// An unfinished voice recording kept safe on THIS device while it is being made, so a crash, a refreshed page, a phone that locks its
// screen or a closed tab does not lose it. Each second of audio is written to the browser's own storage (IndexedDB) as it arrives; when the
// note is made (or the recording is thrown away) it is cleared. Nothing here is sent anywhere. If the browser has no IndexedDB (or a private
// window refuses it) every call quietly does nothing, and the recorder works as before, just without the safety net.
//
// One recording at a time: starting a new one replaces any older leftover (the recorder offers the leftover first).

const DB_NAME = 'vault-voice-recovery';
const META = 'meta';
const CHUNKS = 'chunks';
const KEY = 'current';

function open() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

const done = (tx) => new Promise((resolve) => { tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false); });

/** Forget any earlier leftover and note that a new recording has begun: { mime, startedAt }. */
export async function begin(meta) {
  const db = await open();
  if (!db) return false;
  try {
    const tx = db.transaction([META, CHUNKS], 'readwrite');
    tx.objectStore(CHUNKS).clear();
    tx.objectStore(META).put({ mime: meta.mime || '', startedAt: meta.startedAt || new Date().toISOString(), elapsed: 0 }, KEY);
    return await done(tx);
  } catch { return false; } finally { db.close(); }
}

/** Save the next piece of audio (`index` counts from 0) and how long the recording is so far. */
export async function addChunk(index, blob, elapsed) {
  const db = await open();
  if (!db) return false;
  try {
    const tx = db.transaction([META, CHUNKS], 'readwrite');
    tx.objectStore(CHUNKS).put(blob, index);
    const metaStore = tx.objectStore(META);
    const get = metaStore.get(KEY);
    get.onsuccess = () => { if (get.result) metaStore.put({ ...get.result, elapsed }, KEY); };
    return await done(tx);
  } catch { return false; } finally { db.close(); }
}

/** The unfinished recording on this device, or null: { meta: { mime, startedAt, elapsed }, blob }. */
export async function loadLeftover() {
  const db = await open();
  if (!db) return null;
  try {
    const tx = db.transaction([META, CHUNKS], 'readonly');
    const meta = await new Promise((resolve) => { const r = tx.objectStore(META).get(KEY); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
    const parts = await new Promise((resolve) => { const r = tx.objectStore(CHUNKS).getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => resolve([]); });
    if (!meta || !parts.length) return null;
    const blob = new Blob(parts, { type: meta.mime || 'audio/webm' });
    return blob.size ? { meta, blob } : null;
  } catch { return null; } finally { db.close(); }
}

/** Throw the saved copy away (the note was made, or the person discarded the recording). */
export async function clear() {
  const db = await open();
  if (!db) return false;
  try {
    const tx = db.transaction([META, CHUNKS], 'readwrite');
    tx.objectStore(CHUNKS).clear();
    tx.objectStore(META).clear();
    return await done(tx);
  } catch { return false; } finally { db.close(); }
}
