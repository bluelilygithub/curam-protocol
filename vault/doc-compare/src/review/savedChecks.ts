import { run } from './db';
import type { Verdict } from './verdict';

/**
 * Saved checks: every comparison is kept in this browser (IndexedDB) with a label and both files, so it can be found, opened again (the
 * comparison re-runs and the decisions come back, as they are keyed by the same two files), renamed or deleted. One saved check per pair
 * of files: comparing the same two files again updates it instead of adding a copy. Nothing is uploaded.
 */

export interface StoredFile { name: string; type: string; lastModified: number; size: number; blob: Blob }

export interface SavedCheck {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  pairKey: string;
  sourceType?: string;
  original: StoredFile;
  edited: StoredFile;
  verdict?: Verdict;
  counts?: { red: number; amber: number; decided: number; total: number };
  versions?: boolean; // compared as intentionally different versions (addendum §0.2): no verdict
}

export interface CheckStore {
  list(): Promise<SavedCheck[]>;
  get(id: string): Promise<SavedCheck | undefined>;
  put(c: SavedCheck): Promise<void>;
  remove(id: string): Promise<void>;
  persistent: boolean;
}

export function indexedDbChecks(): CheckStore {
  return {
    persistent: true,
    list: () => run<SavedCheck[]>('checks', 'readonly', (s) => s.getAll()),
    get: (id) => run<SavedCheck | undefined>('checks', 'readonly', (s) => s.get(id)),
    put: async (c) => { await run('checks', 'readwrite', (s) => s.put(c)); },
    remove: async (id) => { await run('checks', 'readwrite', (s) => s.delete(id)); },
  };
}

export function memoryChecks(): CheckStore {
  const m = new Map<string, SavedCheck>();
  return {
    persistent: false,
    list: async () => [...m.values()],
    get: async (id) => m.get(id),
    put: async (c) => { m.set(c.id, c); },
    remove: async (id) => { m.delete(id); },
  };
}

export async function defaultChecks(): Promise<CheckStore> {
  try {
    if (typeof indexedDB === 'undefined') return memoryChecks();
    const s = indexedDbChecks();
    await s.list();
    return s;
  } catch { return memoryChecks(); }
}

export const storedFile = (f: File): StoredFile => ({ name: f.name, type: f.type, lastModified: f.lastModified, size: f.size, blob: f });
export const toFile = (s: StoredFile) => new File([s.blob], s.name, { type: s.type, lastModified: s.lastModified });

/** "Housing submission (edited) · 21 Nov 2026" from the edited file's name, when no label was typed. */
export function defaultLabel(editedName: string, when = new Date()): string {
  const base = editedName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
  return `${base} · ${when.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** Search by label and file names (every word must match, any order, any case); newest first. */
export function searchChecks(list: SavedCheck[], q: string): SavedCheck[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter((c) => { const hay = `${c.label} ${c.original.name} ${c.edited.name}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Save after a comparison: update the saved check for this pair of files if there is one, else add a new one. */
export async function upsertCheck(store: CheckStore, input: { pairKey: string; label: string; original: File; edited: File; sourceType?: string; versions?: boolean }, now = new Date()): Promise<SavedCheck> {
  const existing = (await store.list()).find((c) => c.pairKey === input.pairKey);
  const at = now.toISOString();
  const check: SavedCheck = existing
    ? { ...existing, label: input.label.trim() || existing.label, updatedAt: at, versions: !!input.versions, ...(input.versions ? { verdict: undefined, counts: undefined } : {}) }
    : {
      id: `chk-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      label: input.label.trim() || defaultLabel(input.edited.name, now),
      createdAt: at, updatedAt: at, pairKey: input.pairKey, sourceType: input.sourceType,
      original: storedFile(input.original), edited: storedFile(input.edited),
      ...(input.versions ? { versions: true } : {}),
    };
  await store.put(check);
  return check;
}

export const checkSize = (c: SavedCheck) => c.original.size + c.edited.size;
