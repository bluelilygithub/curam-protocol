import { createStore, type StoreApi } from 'zustand/vanilla';
import { sampleProject, type AppProject } from './model';

/** The open project with undo and redo. Every edit is one step; history starts fresh on every load and is never saved. */
export interface AppState {
  project: AppProject;
  past: AppProject[];
  future: AppProject[];
  /** Bumped on every change (drives the draft save). */
  revision: number;
  edit(fn: (p: AppProject) => AppProject): void;
  load(p: AppProject): void;
  undo(): boolean;
  redo(): boolean;
}
export type AppStore = StoreApi<AppState>;

const LIMIT = 200;

export function createAppStore(initial: AppProject = sampleProject()): AppStore {
  return createStore<AppState>((set, get) => ({
    project: initial, past: [], future: [], revision: 0,
    edit(fn) {
      const cur = get().project;
      const next = fn(cur);
      if (next === cur) return;
      set({ project: next, past: [...get().past, cur].slice(-LIMIT), future: [], revision: get().revision + 1 });
    },
    load(p) { set({ project: p, past: [], future: [], revision: get().revision + 1 }); },
    undo() {
      const { past, project, future } = get();
      if (!past.length) return false;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], revision: get().revision + 1 });
      return true;
    },
    redo() {
      const { past, project, future } = get();
      if (!future.length) return false;
      set({ project: future[0], past: [...past, project], future: future.slice(1), revision: get().revision + 1 });
      return true;
    },
  }));
}
