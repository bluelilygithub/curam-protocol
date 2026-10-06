import { ProjectsController } from '@planner-core/library/projectsController';
import type { StorageLike, ReadableStorage } from '@planner-core/library/library';
import {
  chooseDesignLibrary, createDesignLibraryStore, designCodec, DESIGN_CURRENT_KEY, DESIGN_DIRTY_KEY, DRAFT_KEY, FIRST_DESIGN_NAME,
  type FetchLike,
} from './designLibrary';
import { cleanName } from '../domain/projectFactory';
import { deserializeApp, sampleProject, testCaseProject, type AppProject } from './model';
import type { AppStore } from './store';

/** The browser draft kept on every change, so a closed tab loses nothing even before the library has saved. */
export function loadDraft(storage: ReadableStorage = localStorage): AppProject | null {
  try { const t = storage.getItem(DRAFT_KEY); return t ? deserializeApp(t) : null; } catch { return null; }
}

export interface Designs {
  library: ReturnType<typeof createDesignLibraryStore>;
  controller: ProjectsController<AppProject, import('./designLibrary').DesignEntry>;
  /** Begin watching the open design for changes and open the last one. Returns the cleanup. */
  start(): () => void;
  /** Resolves when the library has been chosen and the last design opened. */
  whenReady(): Promise<void>;
}

/**
 * The saved-designs library for the enclosure planner: which design is open, autosave after a pause, and new / open / duplicate / delete.
 * The first design of a brand-new library is the ready-made Test case; "New design" afterwards is the blank sample.
 */
export function createDesigns(p: {
  store: AppStore; storage: StorageLike & ReadableStorage; fetch: FetchLike | undefined; newId: () => string;
  notify: (text: string, severity?: 'info' | 'warn' | 'error') => void;
  onLoaded?: () => void;
  schedule?: (fn: () => void, ms: number) => () => void;
}): Designs {
  const library = createDesignLibraryStore();
  const controller = new ProjectsController({
    doc: {
      get: () => p.store.getState().project,
      revision: () => p.store.getState().revision,
      subscribe: (fn) => p.store.subscribe(fn),
      load: (project) => p.store.getState().load(project),
      setName: (name) => p.store.getState().updateSilently((q) => ({ ...q, name })),
    },
    store: library, storage: p.storage, newId: p.newId,
    choose: async () => {
      const chosen = await chooseDesignLibrary({ storage: p.storage, fetch: p.fetch, newId: p.newId });
      // A design kept only in this browser before accounts existed would be left behind by a (still empty) account library: carry it over once.
      if (chosen.library.kind === 'server') {
        try {
          if ((await chosen.library.list()).length === 0) { const d = loadDraft(p.storage); if (d && d.runs.length > 0) await chosen.library.create(d); }
        } catch { /* the controller reports a failing library itself */ }
      }
      return chosen;
    },
    newEmpty: (name) => (name === FIRST_DESIGN_NAME ? testCaseProject() : { ...sampleProject(), name }),
    schedule: p.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }),
    notify: p.notify,
    ...(p.onLoaded ? { onLoaded: p.onLoaded } : {}),
    currentKey: DESIGN_CURRENT_KEY, dirtyKey: DESIGN_DIRTY_KEY,
    clone: (project, name) => ({ ...project, name }),
    nameOf: (project) => designCodec.nameOf(project),
    withName: (project, name) => ({ ...project, name }),
    cleanName,
    isEmpty: (project) => project.runs.length === 0,
    loadDraft: () => loadDraft(p.storage),
  });
  let initDone: Promise<void> | null = null;
  return {
    library, controller,
    start() {
      const detach = controller.attach();
      initDone ??= controller.init();
      return detach;
    },
    whenReady: () => initDone ?? Promise.resolve(),
  };
}
