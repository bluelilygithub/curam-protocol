import { createStore, type StoreApi } from 'zustand/vanilla';
import { CommandHistory, type HistoryJSON } from '../engine/history';
import { apply } from '../engine/commands';
import type { PipelineResult } from '../engine/pipeline';
import type { Command, Project } from '../engine/types';

/**
 * The single owner of authoritative design state: the Project and its undo history (Spec §2 rule 1, §9).
 * `commit*` is the ONLY way the project changes. Drag/ghost/preview state never lives here (A12): pointer moves must cause
 * zero updates to this store. History is deliberately not persisted: it starts fresh on every load.
 */
export interface ProjectState {
  project: Project | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  /** Bumped on every successful change; lets autosave and tests observe commits cheaply. */
  revision: number;
}

export interface ProjectActions {
  /** Replace the project (new / open / import). Clears history. */
  load(project: Project | null): void;
  /** Apply a pipeline result. Rejections leave project and history untouched. Returns true if committed. */
  commitResult(result: PipelineResult, label: string): boolean;
  /** Apply an already-validated command (used by tests and by the pipeline glue). */
  commit(command: Command, label: string): boolean;
  undo(): string | undefined | null;
  redo(): string | undefined | null;
  /** Read-only view of history length (tests). */
  historyLength(): number;
  /** Serialisable copy of the history (tests, diagnostics). Never persisted by the app. */
  historyJSON(): HistoryJSON;
}

export type ProjectStore = StoreApi<ProjectState & ProjectActions>;

export interface ProjectStoreHooks {
  /** Called once for every `history.push`: the gate tests use it to prove "one drag = one command = one entry". */
  onPush?(command: Command, label: string): void;
}

export function createProjectStore(initial: Project | null = null, hooks: ProjectStoreHooks = {}): ProjectStore {
  let history = new CommandHistory();
  const snapshot = (p: Project | null, rev: number): ProjectState => ({
    project: p,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    undoLabel: history.undoLabel(),
    redoLabel: history.redoLabel(),
    revision: rev,
  });

  return createStore<ProjectState & ProjectActions>((set, get) => ({
    ...snapshot(initial, 0),

    load(project) {
      history = new CommandHistory();
      set(snapshot(project, get().revision + 1));
    },

    commit(command, label) {
      const { project } = get();
      if (!project) return false;
      const next = apply(command, project); // throws only on a malformed command; state is untouched if it does
      history.push(command, label);
      hooks.onPush?.(command, label);
      set(snapshot(next, get().revision + 1));
      return true;
    },

    commitResult(result, label) {
      if (result.rejected) return false;
      return get().commit(result.command, label);
    },

    undo() {
      const { project } = get();
      if (!project || !history.canUndo()) return null;
      const label = history.undoLabel();
      const next = history.undo(project);
      if (!next) return null;
      set(snapshot(next, get().revision + 1));
      return label;
    },

    redo() {
      const { project } = get();
      if (!project || !history.canRedo()) return null;
      const label = history.redoLabel();
      const next = history.redo(project);
      if (!next) return null;
      set(snapshot(next, get().revision + 1));
      return label;
    },

    historyLength: () => history.length,
    historyJSON: () => history.toJSON(),
  }));
}
