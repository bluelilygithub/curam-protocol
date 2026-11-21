import { run } from './db';
import type { Decisions } from './verdict';

/**
 * Where review decisions are kept (addendum §6.2): in this browser's IndexedDB, so reloading the page does not lose them. A quick
 * comparison is keyed by the SHA-256 hashes of the two files (projects, phase 5, will key them by project and round instead). Nothing
 * leaves the computer. If IndexedDB is unavailable (some private windows), decisions live for this page only and the UI says so.
 */

export interface DecisionStore {
  load(pairKey: string): Promise<Decisions>;
  save(pairKey: string, decisions: Decisions): Promise<void>;
  remove(pairKey: string): Promise<void>;
  persistent: boolean;
}

export function indexedDbStore(): DecisionStore {
  return {
    persistent: true,
    async load(pairKey) {
      const r = await run<{ decisions?: Decisions } | undefined>('decisions', 'readonly', (s) => s.get(pairKey));
      return r?.decisions ?? {};
    },
    async save(pairKey, decisions) {
      await run('decisions', 'readwrite', (s) => s.put({ decisions, savedAt: new Date().toISOString() }, pairKey));
    },
    async remove(pairKey) {
      await run('decisions', 'readwrite', (s) => s.delete(pairKey));
    },
  };
}

export function memoryStore(): DecisionStore {
  const m = new Map<string, Decisions>();
  return {
    persistent: false,
    async load(k) { return { ...(m.get(k) ?? {}) }; },
    async save(k, d) { m.set(k, { ...d }); },
    async remove(k) { m.delete(k); },
  };
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
