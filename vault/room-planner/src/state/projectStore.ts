import { createStore, type StoreApi } from 'zustand/vanilla';
import { FURNITURE_LIBRARY } from '../data/furnitureLibrary';
import { CommandHistory, type HistoryJSON } from '../engine/history';
import { apply } from '../engine/commands';
import type { PipelineResult } from '../engine/pipeline';
import type { Command, Project } from '../engine/types';

/**
 * The single owner of authoritative design state: the Project and its undo history (Spec §2 rule 1, §9).
 * `commit*` is the ONLY way the project changes. Drag/ghost/preview state never lives here (A12): pointer moves must cause
 * zero updates to this store. History is deliberately not persisted: it starts fresh on every load.
 *
 * A project holds several rooms (M5 projects), but the editor works on one at a time. So the store keeps the whole project as
 * `document` and exposes `project` as a VIEW of it: the same project with only the active room in `rooms`. Everything that reads
 * `project` (interaction, both renderers, inspector, tour, walk) therefore keeps seeing one room, and commands, which carry room ids,
 * are applied to the document. Persistence, export, saved views and the library use `document`.
 */
export interface ProjectState {
  /** The active-room view of the project (what the editor sees). `rooms` has the active room only, or none while drawing a new one. */
  project: Project | null;
  /** The whole project, every room. */
  document: Project | null;
  /** The room being edited, or null while a new room is being drawn (the view then has no room) or when there are none. */
  activeRoomId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  /** Bumped on every successful change to the document; lets autosave and tests observe commits cheaply. */
  revision: number;
}

export interface ProjectActions {
  /** Replace the project (new / open / import). Clears history. The first room becomes active. */
  load(project: Project | null): void;
  /** Apply a pipeline result. Rejections leave project and history untouched. Returns true if committed. */
  commitResult(result: PipelineResult, label: string): boolean;
  /** Apply an already-validated command (used by tests and by the pipeline glue). */
  commit(command: Command, label: string): boolean;
  undo(): string | undefined | null;
  redo(): string | undefined | null;
  /**
   * Change the project without a history entry (saved 3D views and the project name only): presentation and bookkeeping, not
   * design. Bumps `revision` so autosave picks it up. Never use for anything the commands operate on.
   */
  updateSilently(fn: (p: Project) => Project): void;
  /** Choose the room to edit (no history entry, no revision bump). `null` = drawing a new room. Unknown ids are ignored. */
  setActiveRoom(id: string | null): void;
  /** Leave "drawing a new room" and go back to the room that was active (or the first one). */
  restoreActiveRoom(): void;
  /** Read-only view of history length (tests). */
  historyLength(): number;
  /** Serialisable copy of the history (tests, diagnostics). Never persisted by the app. */
  historyJSON(): HistoryJSON;
}

export type ProjectStore = StoreApi<ProjectState & ProjectActions>;

export interface ProjectStoreHooks {
  /** Called once for every `history.push`: the gate tests use it to prove "one drag = one command = one history entry". */
  onPush?(command: Command, label: string): void;
}

/** The view of `doc` with only the room `activeId` in it (none for null or an unknown id). */
/**
 * The project's definitions plus any library item it does not have yet (a file saved before new pieces were added still offers them).
 * Applied to the view only, so opening a file never changes it; the new items are simply offered again each time it is opened.
 */
// the same stored list always gives the same merged list, so unchanged definitions compare equal between edits
const mergedDefs = new WeakMap<object, Project['furnitureDefinitions']>();
export function withLibrary(p: Project | null): Project | null {
  if (!p) return p;
  let merged = mergedDefs.get(p.furnitureDefinitions);
  if (!merged) {
    const have = new Set(p.furnitureDefinitions.map((d) => d.id));
    const missing = FURNITURE_LIBRARY.filter((d) => !have.has(d.id));
    merged = missing.length ? [...p.furnitureDefinitions, ...structuredClone(missing)] : p.furnitureDefinitions;
    mergedDefs.set(p.furnitureDefinitions, merged);
  }
  return merged === p.furnitureDefinitions ? p : { ...p, furnitureDefinitions: merged };
}

export function viewOf(doc: Project | null, activeId: string | null): Project | null {
  if (!doc) return null;
  const room = activeId ? doc.rooms.find((r) => r.id === activeId) : undefined;
  return { ...doc, rooms: room ? [room] : [] };
}

/**
 * Which room should be active after the document changed from `before` to `after`: a room that appeared (created, duplicated, or
 * brought back by undo) becomes active; if the active room disappeared, its neighbour does; otherwise nothing changes.
 */
export function nextActive(before: Project | null, after: Project, active: string | null): string | null {
  const added = after.rooms.filter((r) => !before?.rooms.some((b) => b.id === r.id));
  if (added.length > 0) return added[added.length - 1].id;
  if (active && after.rooms.some((r) => r.id === active)) return active;
  if (active === null && before?.rooms.length) return after.rooms[0]?.id ?? null; // an undo or redo while drawing falls back to a room
  const oldIndex = before?.rooms.findIndex((r) => r.id === active) ?? -1;
  const pick = after.rooms[Math.min(Math.max(oldIndex, 0), after.rooms.length - 1)];
  return pick?.id ?? null;
}

export function createProjectStore(initial: Project | null = null, hooks: ProjectStoreHooks = {}): ProjectStore {
  let history = new CommandHistory();
  /** The room that was active before "drawing a new room" began. */
  let remembered: string | null = null;
  // The view must keep its identity until the document or the active room changes (renderers rebuild on identity).
  let viewKey: { doc: Project | null; active: string | null; view: Project | null } | null = null;
  const view = (doc: Project | null, active: string | null): Project | null => {
    if (viewKey && viewKey.doc === doc && viewKey.active === active) return viewKey.view;
    const v = withLibrary(viewOf(doc, active));
    viewKey = { doc, active, view: v };
    return v;
  };
  const snapshot = (doc: Project | null, active: string | null, rev: number): ProjectState => ({
    project: view(doc, active),
    document: doc,
    activeRoomId: active,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    undoLabel: history.undoLabel(),
    redoLabel: history.redoLabel(),
    revision: rev,
  });
  const firstRoom = (p: Project | null): string | null => p?.rooms[0]?.id ?? null;

  return createStore<ProjectState & ProjectActions>((set, get) => ({
    ...snapshot(initial, firstRoom(initial), 0),

    load(project) {
      history = new CommandHistory();
      remembered = null;
      set(snapshot(project, firstRoom(project), get().revision + 1));
    },

    commit(command, label) {
      const { document, activeRoomId } = get();
      if (!document) return false;
      const next = apply(command, document); // throws only on a malformed command; state is untouched if it does
      history.push(command, label);
      hooks.onPush?.(command, label);
      set(snapshot(next, nextActive(document, next, activeRoomId), get().revision + 1));
      return true;
    },

    commitResult(result, label) {
      if (result.rejected) return false;
      return get().commit(result.command, label);
    },

    undo() {
      const { document, activeRoomId } = get();
      if (!document || !history.canUndo()) return null;
      const label = history.undoLabel();
      const next = history.undo(document);
      if (!next) return null;
      set(snapshot(next, nextActive(document, next, activeRoomId), get().revision + 1));
      return label;
    },

    redo() {
      const { document, activeRoomId } = get();
      if (!document || !history.canRedo()) return null;
      const label = history.redoLabel();
      const next = history.redo(document);
      if (!next) return null;
      set(snapshot(next, nextActive(document, next, activeRoomId), get().revision + 1));
      return label;
    },

    updateSilently(fn) {
      const { document, activeRoomId } = get();
      if (!document) return;
      const next = fn(document);
      if (next === document) return;
      set(snapshot(next, activeRoomId, get().revision + 1));
    },

    setActiveRoom(id) {
      const { document, activeRoomId } = get();
      if (!document || id === activeRoomId) return;
      if (id !== null && !document.rooms.some((r) => r.id === id)) return;
      if (id === null && activeRoomId) remembered = activeRoomId; // entering "drawing a new room"
      set(snapshot(document, id, get().revision));
    },

    restoreActiveRoom() {
      const { document, activeRoomId } = get();
      if (!document || activeRoomId !== null) return;
      const back = remembered && document.rooms.some((r) => r.id === remembered) ? remembered : firstRoom(document);
      remembered = null;
      set(snapshot(document, back, get().revision));
    },

    historyLength: () => history.length,
    historyJSON: () => history.toJSON(),
  }));
}
