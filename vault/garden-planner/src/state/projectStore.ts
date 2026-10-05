import { createStore, type StoreApi } from 'zustand/vanilla';
import { CommandHistoryOf } from '@planner-core/engine/history';
import { apply, inverse, type Command } from '../domain/commands';
import type { GardenProject } from '../domain/types';

/**
 * The single owner of the project and its undo history. `commit` is the only way design state changes; things that are presentation
 * (saved views, the project name) use `updateSilently`. History is never persisted: it starts fresh on every load.
 */
export interface ProjectState {
  project: GardenProject | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  /** Bumped on every change; autosave watches it. */
  revision: number;
}

export interface ProjectActions {
  load(p: GardenProject | null): void;
  commit(command: Command, label: string): boolean;
  undo(): string | undefined | null;
  redo(): string | undefined | null;
  updateSilently(fn: (p: GardenProject) => GardenProject): void;
}

export type ProjectStore = StoreApi<ProjectState & ProjectActions>;

export function createProjectStore(initial: GardenProject | null = null): ProjectStore {
  let history = new CommandHistoryOf<GardenProject, Command>({ apply, inverse });
  const flags = (): Pick<ProjectState, 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel'> => ({
    canUndo: history.canUndo(), canRedo: history.canRedo(), undoLabel: history.undoLabel(), redoLabel: history.redoLabel(),
  });

  return createStore<ProjectState & ProjectActions>((set, get) => ({
    project: initial, canUndo: false, canRedo: false, undoLabel: undefined, redoLabel: undefined, revision: 0,

    load(p) {
      history = new CommandHistoryOf<GardenProject, Command>({ apply, inverse });
      set({ project: p, ...flags(), revision: get().revision + 1 });
    },

    commit(command, label) {
      const p = get().project;
      if (!p) return false;
      let next: GardenProject;
      try { next = apply(command, p); } catch { return false; } // a stale command (item already gone) leaves everything untouched
      history.push(command, label);
      set({ project: next, ...flags(), revision: get().revision + 1 });
      return true;
    },

    undo() {
      const p = get().project;
      if (!p) return null;
      const label = history.undoLabel();
      const next = history.undo(p);
      if (!next) return null;
      set({ project: next, ...flags(), revision: get().revision + 1 });
      return label;
    },

    redo() {
      const p = get().project;
      if (!p) return null;
      const label = history.redoLabel();
      const next = history.redo(p);
      if (!next) return null;
      set({ project: next, ...flags(), revision: get().revision + 1 });
      return label;
    },

    updateSilently(fn) {
      const p = get().project;
      if (!p) return;
      set({ project: fn(p), revision: get().revision + 1 });
    },
  }));
}
