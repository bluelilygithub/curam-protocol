import {
  chooseLibrary as chooseGeneric, createLocalLibrary as createLocalGeneric, createServerLibrary as createServerGeneric,
  LibraryError as GenericLibraryError, MAX_PROJECT_NAME,
  type BaseEntry, type ChosenLibrary as ChosenGeneric, type FetchLike, type LocalLibraryPorts, type ProjectCodec, type ProjectLibrary as ProjectLibraryOf,
} from '@planner-core/library/library';
import { cleanName, projectName } from '../engine/roomOps';
import { deserializeProject, serializeProject } from '../engine/serialize';
import type { Project } from '../engine/types';
import { STORAGE_KEY, type StorageLike } from './persistence';
import type { ReadableStorage } from './vaultAuth';

/**
 * The project library (M5 projects): a list of saved projects with create / open / save / rename / delete. Two stores behind one
 * interface: the user's Vault account (the Postgres `room_projects` table, through `/api/room-projects`) and this browser. The
 * implementation is shared with Garden Planner (`planner-core/library`); this file binds it to Room Planner's project format.
 */
export interface LibraryEntry extends BaseEntry {
  roomCount: number;
}

export { MAX_PROJECT_NAME };
export type { FetchLike };
export type { LibraryErrorCode } from '@planner-core/library/library';
export const LibraryError = GenericLibraryError<LibraryEntry>;
export type LibraryError = GenericLibraryError<LibraryEntry>;
export type ProjectLibrary = ProjectLibraryOf<Project, LibraryEntry>;
export type ChosenLibrary = ChosenGeneric<Project, LibraryEntry>;

export const LIBRARY_INDEX_KEY = 'room-planner:library:v1';
export const API_BASE = '/api/room-projects';

export const roomCodec: ProjectCodec<Project, LibraryEntry> = {
  appName: 'Room Planner',
  nameOf: (p) => cleanName(projectName(p), 'Untitled project', MAX_PROJECT_NAME),
  withName: (p, name) => ({ ...p, name }),
  cleanName,
  toText: serializeProject,
  fromText: deserializeProject,
  toData: (p) => p,
  fromData: (d) => deserializeProject(JSON.stringify(d)),
  extra: (p) => ({ roomCount: p.rooms.length }),
  entryFromWire: (w) => ({ id: String(w.id), name: String(w.name), roomCount: Number(w.roomCount), updatedAt: new Date(String(w.updatedAt)).toISOString() }),
};

export interface RoomLocalPorts { storage: StorageLike; newId: () => string; now?: () => string }

export function createLocalLibrary(p: RoomLocalPorts) {
  const ports: LocalLibraryPorts = { ...p, indexKey: LIBRARY_INDEX_KEY, legacyKey: STORAGE_KEY };
  return createLocalGeneric<Project, LibraryEntry>(ports, roomCodec);
}

export function createServerLibrary(fetchFn: FetchLike, token: () => string | null, base = API_BASE): ProjectLibrary {
  return createServerGeneric<Project, LibraryEntry>(fetchFn, token, base, roomCodec);
}

/** The account library when signed in to Vault and reachable, else this browser. */
export function chooseLibrary(p: { storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string; now?: () => string }): Promise<ChosenLibrary> {
  return chooseGeneric<Project, LibraryEntry>({ ...p, indexKey: LIBRARY_INDEX_KEY, legacyKey: STORAGE_KEY, apiBase: API_BASE }, roomCodec);
}
