import { deserializeProject, serializeProject, SerializeError } from '../engine/serialize';
import type { Project } from '../engine/types';

/** Minimal slice of the Web Storage API so persistence is testable without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'room-planner:project:v1';
export const RECENTS_KEY = 'room-planner:recents:v1';

/**
 * Only the PROJECT is persisted. Undo history is deliberately never stored: it starts fresh on every load, and the UI must
 * say nothing that implies otherwise.
 */
export function saveProject(storage: StorageLike, project: Project): boolean {
  try {
    storage.setItem(STORAGE_KEY, serializeProject(project));
    return true;
  } catch {
    return false; // quota / private mode
  }
}

export function loadStoredProject(storage: StorageLike): Project | null {
  try {
    const text = storage.getItem(STORAGE_KEY);
    return text ? deserializeProject(text) : null;
  } catch {
    return null;
  }
}

export function clearStoredProject(storage: StorageLike): void {
  try { storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export type ImportResult = { ok: true; project: Project } | { ok: false; error: string };

/** Parse an uploaded `.json` file. Never throws. */
export function parseProjectFile(text: string): ImportResult {
  try {
    return { ok: true, project: deserializeProject(text) };
  } catch (e) {
    return { ok: false, error: e instanceof SerializeError ? e.message : 'Not a Room Planner project file' };
  }
}

export function projectFileName(project: Project): string {
  const first = project.name?.trim() || project.rooms[0]?.name || 'project';
  return `${first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room'}.roomplan.json`;
}

export interface Autosave {
  /** Flush now and stop. */
  dispose(): void;
  /** 'saved' | 'saving' | 'error' */
  status(): 'saved' | 'saving' | 'error';
}

/**
 * Debounced autosave. `subscribe` receives a change callback and returns an unsubscribe; `getProject` reads the current one.
 */
export function startAutosave(
  storage: StorageLike,
  getProject: () => Project | null,
  subscribe: (onChange: () => void) => () => void,
  onStatus: (s: 'saved' | 'saving' | 'error') => void = () => {},
  delayMs = 400,
): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: 'saved' | 'saving' | 'error' = 'saved';
  const set = (s: 'saved' | 'saving' | 'error'): void => { current = s; onStatus(s); };
  const flush = (): void => {
    timer = null;
    const p = getProject();
    if (!p) { clearStoredProject(storage); set('saved'); return; }
    set(saveProject(storage, p) ? 'saved' : 'error');
  };
  const unsubscribe = subscribe(() => {
    set('saving');
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  return {
    dispose() {
      unsubscribe();
      if (timer) { clearTimeout(timer); flush(); }
    },
    status: () => current,
  };
}
