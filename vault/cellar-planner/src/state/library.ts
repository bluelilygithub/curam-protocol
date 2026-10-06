import {
  chooseLibrary as chooseGeneric, MAX_PROJECT_NAME,
  type BaseEntry, type ChosenLibrary as ChosenGeneric, type FetchLike, type ProjectCodec, type ProjectLibrary as ProjectLibraryOf, type ReadableStorage,
  type StorageLike,
} from '@planner-core/library/library';
import { createLibraryStore as createGeneric, type LibraryActions as ActionsOf, type LibraryState as StateOf } from '@planner-core/library/libraryStore';
import { cleanName } from '../domain/projectFactory';
import { analyseProject, type CellarProject } from '../engine';
import { deserializeProject, serializeProject } from './persistence';

/** The cellar library: saved to the Vault account (table `cellar_projects`, `/api/cellar-projects`) or, offline or signed out, this browser. */
export interface CellarEntry extends BaseEntry {
  bayCount: number;
  /** Bottles the design holds, worked out by the engine when saved. */
  capacity: number;
}

export type { FetchLike };
export type CellarLibrary = ProjectLibraryOf<CellarProject, CellarEntry>;
export type ChosenLibrary = ChosenGeneric<CellarProject, CellarEntry>;
export type LibraryState = StateOf<CellarEntry>;
export type LibraryActions = ActionsOf<CellarEntry>;
export const createLibraryStore = () => createGeneric<CellarEntry>();
export type LibraryStore = ReturnType<typeof createLibraryStore>;

export const LIBRARY_INDEX_KEY = 'cellar-planner:library:v1';
export const API_BASE = '/api/cellar-projects';
export const CURRENT_KEY = 'cellar-planner:current:v1';
export const DIRTY_KEY = 'cellar-planner:dirty:v1';

export const bayCountOf = (p: CellarProject): number => p.room.walls.reduce((n, w) => n + w.bays.length, 0);

export const cellarCodec: ProjectCodec<CellarProject, CellarEntry> = {
  appName: 'Cellar Planner',
  nameOf: (p) => cleanName(p.name, 'Untitled cellar', MAX_PROJECT_NAME),
  withName: (p, name) => ({ ...p, name }),
  cleanName,
  toText: serializeProject,
  fromText: deserializeProject,
  toData: (p) => p,
  fromData: (d) => deserializeProject(JSON.stringify(d)),
  extra: (p) => ({ bayCount: bayCountOf(p), capacity: analyseProject(p).totalCapacity }),
  entryFromWire: (w) => ({
    id: String(w.id), name: String(w.name), bayCount: Number(w.bayCount), capacity: Number(w.capacity),
    updatedAt: new Date(String(w.updatedAt)).toISOString(),
  }),
};

export function chooseLibrary(p: { storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string; now?: () => string }): Promise<ChosenLibrary> {
  return chooseGeneric<CellarProject, CellarEntry>({ ...p, indexKey: LIBRARY_INDEX_KEY, apiBase: API_BASE }, cellarCodec);
}
