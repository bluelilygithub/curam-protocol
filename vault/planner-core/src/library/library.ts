// The project library (Room Planner M5, generalised for Garden Planner): a list of saved projects with create / open / save / rename /
// delete. Two stores behind one interface: the user's Vault account (a Postgres table through `/api/<planner>-projects`) and this
// browser. The app uses the account when the user is signed in to Vault and falls back to the browser, and says which.
//
// Generic over the project type `P` and the list-entry type `E`: an entry is `{ id, name, updatedAt }` plus whatever the planner
// shows in its list (Room: `roomCount`; Garden: `plantCount`, `location`). A `ProjectCodec` is how a planner turns its project into
// stored text / wire data and back.
export interface BaseEntry {
  id: string;
  name: string;
  /** ISO timestamp of the last save. Used for the "changed in another window" check. */
  updatedAt: string;
}

export type LibraryErrorCode = 'unauthorised' | 'conflict' | 'not_found' | 'network' | 'invalid' | 'storage';

export class LibraryError<E extends BaseEntry = BaseEntry> extends Error {
  constructor(public readonly code: LibraryErrorCode, message: string, public readonly current?: E) {
    super(message);
    this.name = 'LibraryError';
  }
}

export interface ProjectLibrary<P, E extends BaseEntry> {
  readonly kind: 'server' | 'local';
  /** Newest first. */
  list(): Promise<E[]>;
  load(id: string): Promise<{ project: P; entry: E }>;
  /** Adds a project; the entry's name is the project's name. */
  create(project: P): Promise<E>;
  /** Saves over `id`. With `expectedUpdatedAt`, refuses (code `conflict`) if it was saved elsewhere since. */
  save(id: string, project: P, expectedUpdatedAt?: string): Promise<E>;
  rename(id: string, name: string): Promise<E>;
  remove(id: string): Promise<void>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface ReadableStorage { getItem(key: string): string | null }

/** How one planner stores its projects. */
export interface ProjectCodec<P, E extends BaseEntry> {
  /** The name the library shows (cleaned, never blank). */
  nameOf(p: P): string;
  withName(p: P, name: string): P;
  cleanName(raw: string, fallback: string, max: number): string;
  /** Text for browser storage. */
  toText(p: P): string;
  /** Throws if the text is not a project. */
  fromText(text: string): P;
  /** The object sent to the server as `data`. */
  toData(p: P): unknown;
  /** Throws if the data is not a project. */
  fromData(data: unknown): P;
  /** The list fields beyond id/name/updatedAt, for a project. */
  extra(p: P): Omit<E, keyof BaseEntry>;
  /** A list entry from the server's wire row (`{ id, name, updatedAt, ...extras }`). */
  entryFromWire(w: Record<string, unknown>): E;
  /** Plain words for the UI: what the planner is called. */
  appName: string;
}

export const MAX_PROJECT_NAME = 120;
const newest = (a: BaseEntry, b: BaseEntry): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1);

// ------------------------------------------------------------------ this browser

export interface LocalLibraryPorts {
  storage: StorageLike;
  newId: () => string;
  now?: () => string;
  /** Browser-storage key of the library index; each project is stored at `${indexKey}:${id}`. */
  indexKey: string;
  /** Older versions kept a single project at this key: imported once as the first entry. */
  legacyKey?: string;
}

export function createLocalLibrary<P, E extends BaseEntry>(p: LocalLibraryPorts, codec: ProjectCodec<P, E>): ProjectLibrary<P, E> & {
  /** One-time: turn the single project older versions kept in this browser into the first library entry. */
  importLegacy(): Promise<E | null>;
} {
  const now = p.now ?? ((): string => new Date().toISOString());
  const dataKey = (id: string): string => `${p.indexKey}:${id}`;
  const readIndex = (): E[] => {
    try {
      const raw = p.storage.getItem(p.indexKey);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? (arr as E[]) : [];
    } catch { return []; }
  };
  const write = (key: string, value: string): void => {
    try { p.storage.setItem(key, value); } catch { throw new LibraryError('storage', 'This browser has no room left to save the project. Free some space or download the file.'); }
  };
  const writeIndex = (e: E[]): void => write(p.indexKey, JSON.stringify(e));
  const entryFor = (id: string, project: P): E => ({ id, name: codec.nameOf(project), updatedAt: now(), ...codec.extra(project) }) as E;
  const find = (id: string): E => {
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
      try { return { project: codec.withName(codec.fromText(text), entry.name), entry }; } catch { throw new LibraryError('invalid', 'That project could not be read.'); }
    },
    async create(project) {
      const id = p.newId();
      const entry = entryFor(id, project);
      write(dataKey(id), codec.toText(codec.withName(project, entry.name)));
      writeIndex([...readIndex(), entry]);
      return entry;
    },
    async save(id, project, expectedUpdatedAt) {
      const cur = find(id);
      if (expectedUpdatedAt && cur.updatedAt !== expectedUpdatedAt) throw new LibraryError('conflict', 'This project was changed in another window.', cur);
      const entry = entryFor(id, project);
      write(dataKey(id), codec.toText(codec.withName(project, entry.name)));
      writeIndex(readIndex().map((e) => (e.id === id ? entry : e)));
      return entry;
    },
    async rename(id, name) {
      const cur = find(id);
      const entry = { ...cur, name: codec.cleanName(name, cur.name, MAX_PROJECT_NAME), updatedAt: now() };
      let text: string | null = null;
      try { text = p.storage.getItem(dataKey(id)); } catch { /* ignore */ }
      if (text) write(dataKey(id), codec.toText(codec.withName(codec.fromText(text), entry.name)));
      writeIndex(readIndex().map((e) => (e.id === id ? entry : e)));
      return entry;
    },
    async remove(id) {
      find(id);
      writeIndex(readIndex().filter((e) => e.id !== id));
      try { p.storage.removeItem(dataKey(id)); } catch { /* the index no longer lists it; the orphan is harmless */ }
    },
    async importLegacy() {
      if (readIndex().length > 0 || !p.legacyKey) return null;
      let text: string | null = null;
      try { text = p.storage.getItem(p.legacyKey); } catch { return null; }
      if (!text) return null;
      let project: P;
      try { project = codec.fromText(text); } catch { return null; }
      if (codec.extra(project) && isEmptyExtra(codec.extra(project))) return null;
      return this.create(project);
    },
  };
}

/** A project with nothing in it (no rooms, no plants) is not worth importing. */
function isEmptyExtra(x: object): boolean {
  const nums = Object.values(x).filter((v): v is number => typeof v === 'number');
  return nums.length > 0 && nums.every((n) => n === 0);
}

// ------------------------------------------------------------------ the Vault account

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export function createServerLibrary<P, E extends BaseEntry>(
  fetchFn: FetchLike, token: () => string | null, base: string, codec: ProjectCodec<P, E>,
): ProjectLibrary<P, E> {
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
    if (res.status === 409) throw new LibraryError('conflict', message, data.current ? codec.entryFromWire(data.current as Record<string, unknown>) : undefined);
    throw new LibraryError(res.status >= 500 ? 'network' : 'invalid', message);
  }
  const entryOf = (d: Record<string, unknown>): E => codec.entryFromWire(d.project as Record<string, unknown>);
  const bodyOf = (project: P): { name: string; data: unknown } => {
    const name = codec.nameOf(project);
    return { name, data: codec.toData(codec.withName(project, name)) };
  };

  return {
    kind: 'server',
    async list() {
      const d = await call('');
      return ((d.projects as Array<Record<string, unknown>>) ?? []).map((w) => codec.entryFromWire(w)).sort(newest);
    },
    async load(id) {
      const d = await call(`/${encodeURIComponent(id)}`);
      const w = d.project as Record<string, unknown>;
      const entry = codec.entryFromWire(w);
      try { return { project: codec.withName(codec.fromData(w.data), entry.name), entry }; } catch { throw new LibraryError('invalid', 'That project could not be read.'); }
    },
    async create(project) { return entryOf(await call('', 'POST', bodyOf(project))); },
    async save(id, project, expectedUpdatedAt) {
      return entryOf(await call(`/${encodeURIComponent(id)}`, 'PUT', { ...bodyOf(project), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }));
    },
    async rename(id, name) {
      return entryOf(await call(`/${encodeURIComponent(id)}`, 'PUT', { name: codec.cleanName(name, 'Untitled project', MAX_PROJECT_NAME) }));
    },
    async remove(id) { await call(`/${encodeURIComponent(id)}`, 'DELETE'); },
  };
}

// ------------------------------------------------------------------ choosing

export interface ChosenLibrary<P, E extends BaseEntry> {
  library: ProjectLibrary<P, E> & { importLegacy?(): Promise<E | null> };
  /** Plain-words note for the interface: where projects are saved, and why if it is only this browser. */
  note: string;
}

/** The Vault token a planner served from Vault's origin can use: zustand-persisted `{ state: { token } }` under `vault-auth`. */
export function readVaultToken(storage: ReadableStorage | undefined): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem('vault-auth');
    if (!raw) return null;
    const token = (JSON.parse(raw) as { state?: { token?: unknown } } | null)?.state?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** The account library when signed in to Vault and reachable, else this browser. */
export async function chooseLibrary<P, E extends BaseEntry>(
  p: { storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string; now?: () => string; indexKey: string; legacyKey?: string; apiBase: string },
  codec: ProjectCodec<P, E>,
): Promise<ChosenLibrary<P, E>> {
  const local = createLocalLibrary<P, E>({
    storage: p.storage, newId: p.newId, indexKey: p.indexKey, ...(p.legacyKey ? { legacyKey: p.legacyKey } : {}), ...(p.now ? { now: p.now } : {}),
  }, codec);
  const token = readVaultToken(p.storage);
  if (!token || !p.fetch) {
    return { library: local, note: `Saved in this browser only. Open ${codec.appName} from Vault while signed in to save to your account.` };
  }
  const server = createServerLibrary<P, E>(p.fetch, () => readVaultToken(p.storage), p.apiBase, codec);
  try {
    await server.list();
    return { library: server, note: 'Saved to your Vault account.' };
  } catch (e) {
    const why = e instanceof LibraryError && e.code === 'unauthorised' ? 'Your Vault session has ended.' : 'Vault could not be reached.';
    return { library: local, note: `${why} Saving in this browser only for now.` };
  }
}
