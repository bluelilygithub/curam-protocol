import { createStore, type StoreApi } from 'zustand/vanilla';
import { sameRef, type SelectionRef } from '../engine/selection';
import type { FurnitureInstance, SnapTargetType } from '../engine/types';

/**
 * UI / interaction state, strictly separate from domain state (Spec §2 rule 12). Only LOW-frequency changes live here
 * (tool, selection, toggles). Per-frame drag, ghost and dimension previews go through the feedback bus (ref/Konva), never here.
 */
export type Tool = 'select' | 'pan' | 'wall_edit' | 'measure';
/** Which renderer is showing (M4). Both draw the same project; the selection and tool state are shared. */
export type ViewMode = '2d' | '3d';
export const TOOL_KEYS: Record<string, Tool> = { '1': 'select', '2': 'pan', '3': 'wall_edit', '4': 'measure' };

/** What the next click on the canvas will place (a ghost follows the pointer). */
export type Placing =
  /** `template` is set for a duplicate whose offset spot was invalid: the copy rides the pointer (A6). */
  | { kind: 'furniture'; definitionId: string; template?: FurnitureInstance }
  | { kind: 'fixture'; definitionId: string }
  | null;

export interface StatusMessage { text: string; severity: 'info' | 'warn' | 'error' }

export interface UiState {
  viewMode: ViewMode;
  tool: Tool;
  selection: SelectionRef[];
  placing: Placing;
  showClearances: boolean;
  showGrid: boolean;
  snapEnabled: SnapTargetType[];
  /** Grid unit in metres (Spec §3 default 0.1 m). */
  grid: number;
  /** Low-frequency status line (the live constraint message goes through the feedback bus instead). */
  status: StatusMessage | null;
  recents: string[];
  leftOpen: boolean;
  rightOpen: boolean;
  /** Violation popover (B5) */
  popoverOpen: boolean;
  /** Autosave indicator. The wording never implies undo history is saved: it is not. */
  saveStatus: 'saved' | 'saving' | 'error';
}

export interface UiActions {
  setViewMode(m: ViewMode): void;
  setTool(t: Tool): void;
  select(refs: SelectionRef[]): void;
  toggleSelect(ref: SelectionRef): void;
  clearSelection(): void;
  startPlacing(p: Placing): void;
  stopPlacing(): void;
  toggleClearances(): void;
  toggleGrid(): void;
  setStatus(s: StatusMessage | null): void;
  noteRecent(id: string): void;
  setPanel(side: 'left' | 'right', open: boolean): void;
  setPopover(open: boolean): void;
  setSaveStatus(s: 'saved' | 'saving' | 'error'): void;
}

export type UiStore = StoreApi<UiState & UiActions>;

export const ALL_SNAPS: SnapTargetType[] = ['wall_endpoint', 'wall', 'furniture_edge', 'furniture_centre', 'alignment', 'grid'];

export function createUiStore(): UiStore {
  return createStore<UiState & UiActions>((set, get) => ({
    viewMode: '2d',
    tool: 'select',
    selection: [],
    placing: null,
    showClearances: false,
    showGrid: true,
    snapEnabled: ALL_SNAPS,
    grid: 0.1,
    status: null,
    recents: [],
    leftOpen: true,
    rightOpen: true,
    popoverOpen: false,
    saveStatus: 'saved',

    setSaveStatus: (saveStatus) => set({ saveStatus }),
    setViewMode: (viewMode) => set({ viewMode }),
    setTool: (tool) => set({ tool, placing: null }),
    select: (selection) => set({ selection, popoverOpen: false }),
    toggleSelect(ref) {
      const cur = get().selection;
      set({ selection: cur.some((r) => sameRef(r, ref)) ? cur.filter((r) => !sameRef(r, ref)) : [...cur, ref] });
    },
    clearSelection: () => set({ selection: [], popoverOpen: false }),
    startPlacing: (placing) => set({ placing, tool: 'select' }),
    stopPlacing: () => set({ placing: null }),
    toggleClearances: () => set({ showClearances: !get().showClearances }),
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    setStatus: (status) => set({ status }),
    noteRecent(id) {
      set({ recents: [id, ...get().recents.filter((r) => r !== id)].slice(0, 6) });
    },
    setPanel: (side, open) => set(side === 'left' ? { leftOpen: open } : { rightOpen: open }),
    setPopover: (popoverOpen) => set({ popoverOpen }),
  }));
}
