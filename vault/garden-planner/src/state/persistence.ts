// The garden file format and the browser draft. Where gardens are SAVED (the Vault account, or this browser when offline or signed out) is
// the project library (`library.ts`, shared with Room Planner). This file holds what is left: parsing a project file, and a one-project
// "draft" the browser keeps of the open garden as you edit, so a session that ends before the server save finishes loses nothing.
// Undo history is never stored.
import { newGardenProject } from '../domain/projectFactory';
import type { GardenProject } from '../domain/types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The draft of the garden being edited (also read by the library's recovery after a session that ended unsaved). */
export const DRAFT_KEY = 'garden-planner:draft:v1';

export class ParseError extends Error {}

export function serializeProject(p: GardenProject): string {
  return JSON.stringify(p);
}

/** Parse and sanity-check a project file. Fills in anything an older or hand-edited file lacks. */
export function deserializeProject(text: string): GardenProject {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ParseError('That is not a Garden Planner file.'); }
  const o = raw as Partial<GardenProject> | null;
  if (!o || typeof o !== 'object' || o.schemaVersion !== 1 || typeof o.id !== 'string') throw new ParseError('That is not a Garden Planner file.');
  const base = newGardenProject(o.name ?? 'My garden', o.location, o.id);
  return {
    ...base, ...o,
    zones: o.zones ?? [], beds: o.beds ?? [], paths: o.paths ?? [], services: o.services ?? [], lawns: o.lawns ?? [], structures: o.structures ?? [], plants: o.plants ?? [],
    boundary: o.boundary ?? null, house: o.house ?? null,
  } as GardenProject;
}

export function projectFileName(p: GardenProject): string {
  return `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'garden'}.garden.json`;
}

export function loadDraft(s: StorageLike): GardenProject | null {
  try {
    const t = s.getItem(DRAFT_KEY);
    return t ? deserializeProject(t) : null;
  } catch { return null; }
}

export interface Autosave { dispose(): void; flush(): void }

/** Keep the draft up to date shortly after each change. Silent: the library reports the real save status. */
export function startDraftAutosave(
  s: StorageLike, getProject: () => GardenProject | null, subscribe: (onChange: () => void) => () => void, delayMs = 400,
): Autosave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    const p = getProject();
    if (!p) return;
    try { s.setItem(DRAFT_KEY, serializeProject(p)); } catch { /* quota or private mode: the library save is what counts */ }
  };
  const off = subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });
  return { flush, dispose() { off(); if (timer) flush(); } };
}
