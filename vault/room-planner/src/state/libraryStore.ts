import { createStore, type StoreApi } from 'zustand/vanilla';
import type { LibraryEntry } from './library';

/**
 * What the interface shows about the project library: where projects are saved, the list, which one is open, and whether it is
 * saved. Low-frequency (a save every second or two at most), so a normal store is fine here; the design itself is in the project store.
 */
export type SaveStatus = 'loading' | 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';

export interface LibraryState {
  /** False until the first load of the library has finished. */
  ready: boolean;
  kind: 'server' | 'local' | null;
  /** Plain-words note about where projects are saved. */
  note: string;
  entries: LibraryEntry[];
  currentId: string | null;
  status: SaveStatus;
  /** Plain-words reason when status is `error` or `conflict`. */
  error: string | null;
  lastSavedAt: string | null;
}

export interface LibraryActions { set(patch: Partial<LibraryState>): void }

export type LibraryStore = StoreApi<LibraryState & LibraryActions>;

export function createLibraryStore(): LibraryStore {
  return createStore<LibraryState & LibraryActions>((set) => ({
    ready: false, kind: null, note: '', entries: [], currentId: null, status: 'loading', error: null, lastSavedAt: null,
    set: (patch) => set(patch),
  }));
}
