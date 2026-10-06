import {
  chooseLibrary as chooseGeneric, MAX_PROJECT_NAME,
  type BaseEntry, type ChosenLibrary as ChosenGeneric, type FetchLike, type ProjectCodec, type ReadableStorage, type StorageLike,
} from '@planner-core/library/library';
import { createLibraryStore as createGeneric, type LibraryState as StateOf, type LibraryActions as ActionsOf } from '@planner-core/library/libraryStore';
import { cleanName } from '../domain/projectFactory';
import { deserializeApp, serializeApp, type AppProject } from './model';

/**
 * The saved designs of the enclosure planner: kept in the Vault account (table `cellar_projects`, `/api/cellar-projects`) or, when signed
 * out or offline, in this browser. The same library machinery as Room and Garden Planner (`@planner-core/library`).
 * (`state/library.ts` is a separate, older binding for the joinery engine's project type; no screen uses it.)
 */
export interface DesignEntry extends BaseEntry {
  /** Rack runs placed. */
  runCount: number;
  /** Rack units across all runs. */
  rackUnits: number;
  /** True while any rack value is still a best guess. */
  estimated: boolean;
}

export type { FetchLike };
export type ChosenDesigns = ChosenGeneric<AppProject, DesignEntry>;
export type DesignLibraryState = StateOf<DesignEntry>;
export type DesignLibraryStore = ReturnType<typeof createDesignLibraryStore>;
export const createDesignLibraryStore = () => createGeneric<DesignEntry>();
export type { ActionsOf as DesignLibraryActions };

export const DESIGN_INDEX_KEY = 'cellar-planner:designs:v1';
export const DESIGN_API_BASE = '/api/cellar-projects';
export const DESIGN_CURRENT_KEY = 'cellar-planner:designs-current:v1';
export const DESIGN_DIRTY_KEY = 'cellar-planner:designs-dirty:v1';
/** The browser draft older versions kept (and this one still keeps): imported as the first saved design. */
export const DRAFT_KEY = 'cellar-planner:enclosure-draft:v1';
/** What a brand-new library's first design is called (the Test case); also the controller's fallback name. */
export const FIRST_DESIGN_NAME = 'Untitled project';

const rackUnitsOf = (p: AppProject): number => p.runs.reduce((n, r) => n + (Number.isFinite(r.units) && r.units > 0 ? Math.floor(r.units) : 0), 0);

export const designCodec: ProjectCodec<AppProject, DesignEntry> = {
  appName: 'Cellar Planner',
  nameOf: (p) => cleanName(p.name, 'Untitled design', MAX_PROJECT_NAME),
  withName: (p, name) => ({ ...p, name }),
  cleanName,
  toText: serializeApp,
  fromText: deserializeApp,
  // the same validated file format the Save file button writes, as an object
  toData: (p) => JSON.parse(serializeApp(p)) as unknown,
  fromData: (d) => deserializeApp(JSON.stringify(d)),
  extra: (p) => ({ runCount: p.runs.length, rackUnits: rackUnitsOf(p), estimated: (p.estimated?.length ?? 0) > 0 }),
  entryFromWire: (w) => ({
    id: String(w.id), name: String(w.name), runCount: Number(w.runCount) || 0, rackUnits: Number(w.rackUnits) || 0, estimated: w.estimated === true,
    updatedAt: new Date(String(w.updatedAt)).toISOString(),
  }),
};

export function chooseDesignLibrary(p: { storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string; now?: () => string }): Promise<ChosenDesigns> {
  return chooseGeneric<AppProject, DesignEntry>({ ...p, indexKey: DESIGN_INDEX_KEY, legacyKey: DRAFT_KEY, apiBase: DESIGN_API_BASE }, designCodec);
}
