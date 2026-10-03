import { cleanName, projectName } from '../engine/roomOps';
import { deserializeProject, serializeProject } from '../engine/serialize';
import type { Project } from '../engine/types';
import { STORAGE_KEY, type StorageLike } from './persistence';
import { readVaultToken, type ReadableStorage } from './vaultAuth';

/**
 * The project library (M5 projects): a list of saved projects with create / open / save / rename / delete. Two stores behind one
 * interface: the user's Vault account (the Postgres `room_projects` table, through `/api/room-projects`) and this browser. The app
 * uses the account when the user is signed in to Vault and falls back to the browser otherwise, and says which.
 */
export interface LibraryEntry {
  id: string;
  name: string;
  roomCount: number;
  /** ISO timestamp of the last save. Used for the "changed in another window" check. */
  updatedAt: string;
}

export type LibraryErrorCode = 'unauthorised' | 'conflict' | 'not_found' | 'network' | 'invalid' | 'storage';

export class LibraryError extends Error {
  constructor(public readonly code: LibraryErrorCode, message: string, public readonly current?: LibraryEntry) {
    super(message);
    this.name = 'LibraryError';
  }
}

export interface ProjectLibrary {
  readonly kind: 'server' | 'local';
  /** Newest first. */
  list(): Promise<LibraryEntry[]>;
  load(id: string): Promise<{ project: Project; entry: LibraryEntry }>;
  /** Adds a project; the entry's name is the project's name. */
  create(project: Project): Promise<LibraryEntry>;
  /** Saves over `id`. With `expectedUpdatedAt`, refuses (code `conflict`) if it was saved elsewhere since. */
  save(id: string, project: Project, expectedUpdatedAt?: string): Promise<LibraryEntry>;
  rename(id: string, name: string): Promise<LibraryEntry>;
  remove(id: string): Promise<void>;
}

export const MAX_PROJECT_NAME = 120;
const nameOf = (p: Project): string => cleanName(projectName(p), 'Untitled project', MAX_PROJECT_NAME);
const newest = (a: LibraryEntry, b: LibraryEntry): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1);

// ------------------------------------------------------------------ this browser

export const LIBRARY_INDEX_KEY = 'room-planner:library:v1';
const dataKey = (id: string): string => `${LIBRARY_INDEX_KEY}:${id}`;

export interface LocalLibraryPorts {
  storage: StorageLike;
  newId: () => string;
  now?: () => string;
}

export function createLocalLibrary(p: LocalLibraryPorts): ProjectLibrary & {
  /** One-time: turn the single project older versions kept in this browser into the first library entry. */
  importLegacy(): Promise<LibraryEntry | null>;
} {
  const now = p.now ?? ((): string => new Date().toISOString());
  const readIndex = (): LibraryEntry[] => {
    try {
      const raw = p.storage.getItem(LIBRARY_INDEX_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? (arr as LibraryEntry[]) : [];
    } catch { return []; }
  };
  const write = (key: string, value: string): void => {
    try { p.storage.setItem(key, value); } catch { throw new LibraryError('storage', 'This browser has no room left to save the project. Free some space or download the file.'); }
  };
  const writeIndex = (e: LibraryEntry[]): void => write(LIBRARY_INDEX_KEY, JSON.stringify(e));
  const entryFor = (id: string, project: Project): LibraryEntry => ({ id, name: nameOf(project), roomCount: project.rooms.length, updatedAt: now() });
  const find = (id: string): LibraryEntry => {
    const e = readIndex().find((x) => x.id === id);
    if (!e) throw new LibraryError('not_found', 'That project is no longer in your library.');
    return e;
  };

  return {
    kind: 'local',
    async list() { return readIndex().sort(newest); },
    async load(id) {
      const entry = find(id);
      let text: string | null = null;
      try { text = p.storage.getItem(dataKey(id)); } catch { /* treated as missing */ }
      if (!text) throw new LibraryError('not_found', 'That project\'s data is missing from this browser.');
      try { return { project: { ...deserializeProject(text), name: entry.name }, entry }; } catch { throw new LibraryError('invalid', 'That project could not be read.'); }
    },
    async create(project) {
      const id = p.newId();
      const entry = entryFor(id, project);
      write(dataKey(id), serializeProject({ ...project, name: entry.name }));
      writeIndex([...readIndex(), entry]);
      return entry;
    },
    async save(id, project, expectedUpdatedAt) {
      const cur = find(id);
      if (expectedUpdatedAt && cur.updatedAt !== expectedUpdatedAt) throw new LibraryError('conflict', 'This project was changed in another window.', cur);
      const entry = entryFor(id, project);
      write(dataKey(id), serializeProject({ ...project, name: entry.name }));
      writeIndex(readIndex().map((e) => (e.id === id ? entry : e)));
      return entry;
    },
    async rename(id, name) {
      const cur = find(id);
      const entry = { ...cur, name: cleanName(name, cur.name, MAX_PROJECT_NAME), updatedAt: now() };
      let text: string | null = null;
      try { text = p.storage.getItem(dataKey(id)); } catch { /* ignore */ }
      if (text) write(dataKey(id), serializeProject({ ...deserializeProject(text), name: entry.name }));
      writeIndex(readIndex().map((e) => (e.id === id ? entry : e)));
      return entry;
    },
    async remove(id) {
      find(id);
      writeIndex(readIndex().filter((e) => e.id !== id));
      try { p.storage.removeItem(dataKey(id)); } catch { /* the index no longer lists it; the orphan is harmless */ }
    },
    async importLegacy() {
      if (readIndex().length > 0) return null;
      let text: string | null = null;
      try { text = p.storage.getItem(STORAGE_KEY); } catch { return null; }
      if (!text) return null;
      let project: Project;
      try { project = deserializeProject(text); } catch { return null; }
      if (project.rooms.length === 0) return null;
      return this.create(project);
    },
  };
}

// ------------------------------------------------------------------ the Vault account

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export const API_BASE = '/api/room-projects';

interface WireEntry { id: number | string; name: string; roomCount: number; updatedAt: string }
const toEntry = (w: WireEntry): LibraryEntry => ({ id: String(w.id), name: w.name, roomCount: Number(w.roomCount), updatedAt: new Date(w.updatedAt).toISOString() });

export function createServerLibrary(fetchFn: FetchLike, token: () => string | null, base = API_BASE): ProjectLibrary {
  async function call(path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const t = token();
    if (!t) throw new LibraryError('unauthorised', 'Sign in to Vault to use your project library.');
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchFn(`${base}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new LibraryError('network', 'Could not reach Vault. Your changes are kept in this browser and will be saved when it is back.');
    }
    let data: Record<string, unknown> = {};
    try { data = ((await res.json()) ?? {}) as Record<string, unknown>; } catch { /* empty body */ }
    if (res.ok) return data;
    const message = typeof data.error === 'string' ? data.error : 'Vault could not complete that.';
    if (res.status === 401) throw new LibraryError('unauthorised', 'Your Vault session has ended. Sign in again to save to your library.');
    if (res.status === 404) throw new LibraryError('not_found', message);
    if (res.status === 409) throw new LibraryError('conflict', message, data.current ? toEntry(data.current as WireEntry) : undefined);
    throw new LibraryError(res.status >= 500 ? 'network' : 'invalid', message);
  }
  const entryOf = (d: Record<string, unknown>): LibraryEntry => toEntry(d.project as WireEntry);

  return {
    kind: 'server',
    async list() {
      const d = await call('');
      return ((d.projects as WireEntry[]) ?? []).map(toEntry).sort(newest);
    },
    async load(id) {
      const d = await call(`/${encodeURIComponent(id)}`);
      const w = d.project as WireEntry & { data: unknown };
      const entry = toEntry(w);
      try { return { project: { ...deserializeProject(JSON.stringify(w.data)), name: entry.name }, entry }; } catch { throw new LibraryError('invalid', 'That project could not be read.'); }
    },
    async create(project) {
      return entryOf(await call('', 'POST', { name: nameOf(project), data: { ...project, name: nameOf(project) } }));
    },
    async save(id, project, expectedUpdatedAt) {
      return entryOf(await call(`/${encodeURIComponent(id)}`, 'PUT', {
        name: nameOf(project), data: { ...project, name: nameOf(project) }, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      }));
    },
    async rename(id, name) {
      return entryOf(await call(`/${encodeURIComponent(id)}`, 'PUT', { name: cleanName(name, 'Untitled project', MAX_PROJECT_NAME) }));
    },
    async remove(id) { await call(`/${encodeURIComponent(id)}`, 'DELETE'); },
  };
}

// ------------------------------------------------------------------ choosing

export interface ChosenLibrary {
  library: ProjectLibrary & { importLegacy?(): Promise<LibraryEntry | null> };
  /** Plain-words note for the interface: where projects are saved, and why if it is only this browser. */
  note: string;
}

/** The account library when signed in to Vault and reachable, else this browser. */
export async function chooseLibrary(p: {
  storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string; now?: () => string;
}): Promise<ChosenLibrary> {
  const local = createLocalLibrary({ storage: p.storage, newId: p.newId, ...(p.now ? { now: p.now } : {}) });
  const token = readVaultToken(p.storage);
  if (!token || !p.fetch) {
    return { library: local, note: 'Saved in this browser only. Open Room Planner from Vault while signed in to save to your account.' };
  }
  const server = createServerLibrary(p.fetch, () => readVaultToken(p.storage));
  try {
    await server.list();
    return { library: server, note: 'Saved to your Vault account.' };
  } catch (e) {
    const why = e instanceof LibraryError && e.code === 'unauthorised' ? 'Your Vault session has ended.' : 'Vault could not be reached.';
    return { library: local, note: `${why} Saving in this browser only for now.` };
  }
}
