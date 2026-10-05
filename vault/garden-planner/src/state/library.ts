import {
  chooseLibrary as chooseGeneric, MAX_PROJECT_NAME,
  type BaseEntry, type ChosenLibrary as ChosenGeneric, type FetchLike, type ProjectCodec, type ProjectLibrary as ProjectLibraryOf, type ReadableStorage,
  type StorageLike,
} from '@planner-core/library/library';
import { createLibraryStore as createGeneric, type LibraryActions as ActionsOf, type LibraryState as StateOf } from '@planner-core/library/libraryStore';
import { cleanName } from '../domain/projectFactory';
import type { GardenProject } from '../domain/types';
import { deserializeProject, serializeProject } from './persistence';

/** The garden library: saved to the Vault account (table `garden_projects`, `/api/garden-projects`) or, offline or signed out, this browser. */
export interface GardenEntry extends BaseEntry {
  plantCount: number;
  location: string;
}

export type { FetchLike };
export type GardenLibrary = ProjectLibraryOf<GardenProject, GardenEntry>;
export type ChosenLibrary = ChosenGeneric<GardenProject, GardenEntry>;
export type LibraryState = StateOf<GardenEntry>;
export type LibraryActions = ActionsOf<GardenEntry>;
export const createLibraryStore = () => createGeneric<GardenEntry>();
export type LibraryStore = ReturnType<typeof createLibraryStore>;

export const LIBRARY_INDEX_KEY = 'garden-planner:library:v1';
export const API_BASE = '/api/garden-projects';
export const CURRENT_KEY = 'garden-planner:current:v2';
export const DIRTY_KEY = 'garden-planner:dirty:v1';

export const gardenCodec: ProjectCodec<GardenProject, GardenEntry> = {
  appName: 'Garden Planner',
  nameOf: (p) => cleanName(p.name, 'Untitled garden', MAX_PROJECT_NAME),
  withName: (p, name) => ({ ...p, name }),
  cleanName,
  toText: serializeProject,
  fromText: deserializeProject,
  toData: (p) => p,
  fromData: (d) => deserializeProject(JSON.stringify(d)),
  extra: (p) => ({ plantCount: p.plants.length, location: p.location.label }),
  entryFromWire: (w) => ({
    id: String(w.id), name: String(w.name), plantCount: Number(w.plantCount), location: String(w.location ?? ''),
    updatedAt: new Date(String(w.updatedAt)).toISOString(),
  }),
};

export function chooseLibrary(p: { storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string; now?: () => string }): Promise<ChosenLibrary> {
  return chooseGeneric<GardenProject, GardenEntry>({ ...p, indexKey: LIBRARY_INDEX_KEY, apiBase: API_BASE }, gardenCodec);
}
