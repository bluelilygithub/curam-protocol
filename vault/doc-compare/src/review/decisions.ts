import type { Decisions } from './verdict';

/**
 * Where review decisions are kept (addendum §6.2): in this browser's IndexedDB, so reloading the page does not lose them. A quick
 * comparison is keyed by the SHA-256 hashes of the two files (projects, phase 5, will key them by project and round instead). Nothing
 * leaves the computer. If IndexedDB is unavailable (some private windows), decisions live for this page only and the UI says so.
 */

export interface DecisionStore {
  load(pairKey: string): Promise<Decisions>;
  save(pairKey: string, decisions: Decisions): Promise<void>;
  persistent: boolean;
}

const DB = 'doc-compare';
const STORE = 'decisions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDbStore(): DecisionStore {
  let db: Promise<IDBDatabase> | undefined;
  const get = () => (db ??= openDb());
  return {
    persistent: true,
    async load(pairKey) {
      const d = await get();
      return new Promise((resolve, reject) => {
        const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(pairKey);
        req.onsuccess = () => resolve((req.result as { decisions?: Decisions } | undefined)?.decisions ?? {});
        req.onerror = () => reject(req.error);
      });
    },
    async save(pairKey, decisions) {
      const d = await get();
      return new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ decisions, savedAt: new Date().toISOString() }, pairKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

export function memoryStore(): DecisionStore {
  const m = new Map<string, Decisions>();
  return { persistent: false, async load(k) { return { ...(m.get(k) ?? {}) }; }, async save(k, d) { m.set(k, { ...d }); } };
}

/** IndexedDB when this browser allows it, else memory. */
export async function defaultStore(): Promise<DecisionStore> {
  try {
    if (typeof indexedDB === 'undefined') return memoryStore();
    const s = indexedDbStore();
    await s.load('__probe__');
    return s;
  } catch { return memoryStore(); }
}

/** SHA-256 of a file, hex. */
export async function sha256(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key for a quick comparison: both files' hashes, in order. */
export async function pairKeyOf(original: Blob, edited: Blob): Promise<string> {
  const [a, b] = await Promise.all([sha256(original), sha256(edited)]);
  return `pair:${a}:${b}`;
}
