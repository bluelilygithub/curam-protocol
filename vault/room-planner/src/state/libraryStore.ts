import { createLibraryStore as createGeneric, type LibraryActions as ActionsOf, type LibraryState as StateOf } from '@planner-core/library/libraryStore';
import type { LibraryEntry } from './library';

/** What the interface shows about the project library (shared implementation: planner-core/library). */
export type { SaveStatus } from '@planner-core/library/libraryStore';
export type LibraryState = StateOf<LibraryEntry>;
export type LibraryActions = ActionsOf<LibraryEntry>;
export type LibraryStore = ReturnType<typeof createGeneric<LibraryEntry>>;

export function createLibraryStore(): LibraryStore {
  return createGeneric<LibraryEntry>();
}
