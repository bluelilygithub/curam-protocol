import {
  AUTOSAVE_MS, ProjectsController as GenericController, RETRY_MS, type ProjectsPorts as GenericPorts,
} from '@planner-core/library/projectsController';
import { cleanName, cloneProject, projectName } from '../engine/roomOps';
import type { Project } from '../engine/types';
import { MAX_PROJECT_NAME, type ChosenLibrary, type LibraryEntry } from './library';
import type { LibraryStore } from './libraryStore';
import { loadStoredProject, type StorageLike } from './persistence';
import type { ProjectStore } from './projectStore';

/**
 * The open project and its library (shared implementation: planner-core/library/projectsController). This binds it to Room Planner:
 * the project store's whole `document`, rooms, and the browser draft. DOM-free: storage, timers and the library are passed in.
 */
export const CURRENT_KEY = 'room-planner:current:v1';
export const DIRTY_KEY = 'room-planner:dirty:v1';
export { AUTOSAVE_MS, RETRY_MS };

export interface ProjectsPorts {
  project: ProjectStore;
  store: LibraryStore;
  choose(): Promise<ChosenLibrary>;
  storage: StorageLike;
  newId(): string;
  newEmpty(name: string): Project;
  schedule(fn: () => void, ms: number): () => void;
  notify(text: string, severity?: 'info' | 'warn' | 'error'): void;
  /** Called after a project has been loaded into the editor (the app fits the view). */
  onLoaded?(): void;
}

export class ProjectsController extends GenericController<Project, LibraryEntry> {
  constructor(p: ProjectsPorts) {
    const ports: GenericPorts<Project, LibraryEntry> = {
      doc: {
        get: () => p.project.getState().document,
        revision: () => p.project.getState().revision,
        subscribe: (fn) => p.project.subscribe(fn),
        load: (pr) => p.project.getState().load(pr),
        setName: (name) => p.project.getState().updateSilently((pr) => ({ ...pr, name })),
      },
      store: p.store, choose: p.choose, storage: p.storage, newId: p.newId, newEmpty: p.newEmpty, schedule: p.schedule, notify: p.notify,
      ...(p.onLoaded ? { onLoaded: p.onLoaded } : {}),
      currentKey: CURRENT_KEY, dirtyKey: DIRTY_KEY,
      clone: (pr, name) => cloneProject(pr, p.newId, name),
      nameOf: (pr) => cleanName(projectName(pr), 'Untitled project', MAX_PROJECT_NAME),
      withName: (pr, name) => ({ ...pr, name }),
      cleanName,
      isEmpty: (pr) => pr.rooms.length === 0,
      loadDraft: () => loadStoredProject(p.storage),
    };
    super(ports);
  }
}
