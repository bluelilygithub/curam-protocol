// The cellar file format and the browser draft. Where cellars are SAVED (the Vault account, or this browser when offline or signed out) is the
// project library (`library.ts`). This file holds parsing a project file and a one-project draft the browser keeps as you edit.
// Undo history is never stored.
import { DEFAULT_RULES, SCHEMA_VERSION, type CellarProject } from '../engine';
import { rectangularRoom } from '../domain/projectFactory';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DRAFT_KEY = 'cellar-planner:draft:v1';

export class ParseError extends Error {}

export const serializeProject = (p: CellarProject): string => JSON.stringify(p);

/** Parse and sanity-check a project file. Fills in anything an older or hand-edited file lacks. */
export function deserializeProject(text: string): CellarProject {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ParseError('That is not a Cellar Planner file.'); }
  const o = raw as Partial<CellarProject> | null;
  if (!o || typeof o !== 'object' || o.schemaVersion !== SCHEMA_VERSION || typeof o.id !== 'string' || !o.room || !Array.isArray(o.room.walls)) {
    throw new ParseError('That is not a Cellar Planner file.');
  }
  const room = o.room;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: o.id,
    name: typeof o.name === 'string' ? o.name : 'My cellar',
    locale: 'en-AU',
    cornerOwnershipMode: o.cornerOwnershipMode === 'MANUAL' ? 'MANUAL' : 'LONGEST_WALL_FIRST',
    rules: { ...DEFAULT_RULES, ...(o.rules ?? {}) },
    room: {
      heightMm: typeof room.heightMm === 'number' ? room.heightMm : rectangularRoom(1, 1, 2400).heightMm,
      walls: room.walls.map((w) => ({ ...w, bays: Array.isArray(w.bays) ? w.bays.map((b) => ({ ...b, modules: Array.isArray(b.modules) ? b.modules : [] })) : [] })),
      doors: room.doors ?? [], windows: room.windows ?? [], obstructions: room.obstructions ?? [],
    },
  };
}

export const projectFileName = (p: CellarProject): string => `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cellar'}.cellar.json`;

export function loadDraft(s: StorageLike): CellarProject | null {
  try {
    const t = s.getItem(DRAFT_KEY);
    return t ? deserializeProject(t) : null;
  } catch { return null; }
}

export interface Autosave { dispose(): void; flush(): void }

/** Keep the draft up to date shortly after each change. Silent: the library reports the real save status. */
export function startDraftAutosave(
  s: StorageLike, getProject: () => CellarProject | null, subscribe: (onChange: () => void) => () => void, delayMs = 400,
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
