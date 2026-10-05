import { createStore, type StoreApi } from 'zustand/vanilla';
import { sameRef, type SelectionRef } from '../engine/selection';
import { DEFAULT_VOLUME, type AmbientKind } from '../audio/ambient';
import type { FurnitureInstance, SnapTargetType } from '../engine/types';

/**
 * UI / interaction state, strictly separate from domain state (Spec §2 rule 12). Only LOW-frequency changes live here
 * (tool, selection, toggles). Per-frame drag, ghost and dimension previews go through the feedback bus (ref/Konva), never here.
 */
export type Tool = 'select' | 'pan' | 'wall_edit' | 'measure';
/** Which renderer is showing (M4). Both draw the same project; the selection and tool state are shared. */
export type ViewMode = '2d' | '3d';
/** Cinematic render quality (Spec Addition A1): low = no post effects, small shadow map; high = soft shadows and ambient occlusion. */
export type Quality = 'low' | 'high';
/** The Cinematic look (Spec Addition A1/A2): clay (white model) or realistic (generated textures, daylight). */
export type Look = 'clay' | 'realistic';
/** Snapping: `smart` = corners, walls, furniture edges and centres, alignment and grid; `grid` = grid only; `off` = none. Holding Alt while dragging bypasses it. */
export type SnapMode = 'smart' | 'grid' | 'off';
export const GRID_SIZES = [0.05, 0.1, 0.25, 0.5] as const;
export const snapsFor = (mode: SnapMode): SnapTargetType[] => (mode === 'smart' ? ALL_SNAPS_LIST : mode === 'grid' ? ['grid'] : []);
const ALL_SNAPS_LIST: SnapTargetType[] = ['wall_endpoint', 'wall', 'furniture_edge', 'furniture_centre', 'alignment', 'grid'];
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
  /** Cinematic mode of the 3D view (clay look, fly-through). Presentation only: never touches the project. */
  cinematic: boolean;
  quality: Quality;
  look: Look;
  tourPlaying: boolean;
  /** First-person walk mode (Spec Addition A1, C4). Exclusive with the fly-through. */
  walking: boolean;
  tourLoop: boolean;
  /** Interface hidden for a full-screen presentation. */
  immersive: boolean;
  /** The Projects panel (new, open, rename, duplicate, delete, import, export). */
  projectsOpen: boolean;
  /** The Render photo panel (path-traced still image, M4.7). */
  photoOpen: boolean;
  /** The How This Works modal. */
  infoOpen: boolean;
  /** The furniture schedule and plan PDF panel. */
  scheduleOpen: boolean;
  /** Where the fly-through is: stop index (0-based) of `total`. */
  tourProgress: { stop: number; total: number } | null;
  tool: Tool;
  selection: SelectionRef[];
  placing: Placing;
  showClearances: boolean;
  showGrid: boolean;
  /** Ceiling lights, lamps and the like give off light in the Realistic look (and Render photo). */
  lightsOn: boolean;
  /** How bright all lights are together, 0-2 (1 = standard). Remembered per browser. */
  lightPower: number;
  /** Soothing ambient sound while the 3D view is showing (synthesised in the browser). */
  ambient: AmbientKind;
  ambientVolume: number;
  snapMode: SnapMode;
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
  setCinematic(on: boolean): void;
  setQuality(q: Quality): void;
  setLook(l: Look): void;
  setTourPlaying(on: boolean): void;
  setWalking(on: boolean): void;
  setTourLoop(on: boolean): void;
  setImmersive(on: boolean): void;
  setProjectsOpen(on: boolean): void;
  setPhotoOpen(on: boolean): void;
  setLightsOn(on: boolean): void;
  setLightPower(v: number): void;
  setAmbient(kind: AmbientKind): void;
  setAmbientVolume(v: number): void;
  setSnapMode(mode: SnapMode): void;
  setGrid(metres: number): void;
  setInfoOpen(on: boolean): void;
  setScheduleOpen(on: boolean): void;
  setTourProgress(p: { stop: number; total: number } | null): void;
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
    cinematic: false,
    quality: 'low',
    look: 'clay',
    tourPlaying: false,
    walking: false,
    tourLoop: true,
    immersive: false,
    projectsOpen: false,
    photoOpen: false,
    infoOpen: false,
    scheduleOpen: false,
    tourProgress: null,
    tool: 'select',
    selection: [],
    placing: null,
    showClearances: false,
    showGrid: true,
    lightsOn: true,
    lightPower: 1,
    ambient: 'off',
    ambientVolume: DEFAULT_VOLUME,
    snapMode: 'smart',
    snapEnabled: ALL_SNAPS,
    grid: 0.1,
    status: null,
    recents: [],
    leftOpen: true,
    rightOpen: true,
    popoverOpen: false,
    saveStatus: 'saved',

    setSaveStatus: (saveStatus) => set({ saveStatus }),
    setViewMode: (viewMode) => set(viewMode === '3d' ? { viewMode } : { viewMode, tourPlaying: false, walking: false, immersive: false, photoOpen: false }),
    setCinematic: (cinematic) => set(cinematic ? { cinematic } : { cinematic, tourPlaying: false, immersive: false, tourProgress: null }),
    setQuality: (quality) => set({ quality }),
    setLook: (look) => set({ look }),
    setTourPlaying: (tourPlaying) => set(tourPlaying ? { tourPlaying, walking: false } : { tourPlaying }),
    setWalking: (walking) => set(walking ? { walking, tourPlaying: false, tourProgress: null } : { walking }),
    setTourLoop: (tourLoop) => set({ tourLoop }),
    setImmersive: (immersive) => set({ immersive }),
    setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
    setLightsOn: (lightsOn) => set({ lightsOn }),
    setLightPower: (v) => set({ lightPower: Math.max(0, Math.min(2, Number.isFinite(v) ? v : 1)) }),
    setAmbient: (ambient) => set({ ambient }),
    setAmbientVolume: (ambientVolume) => set({ ambientVolume: Math.max(0, Math.min(1, ambientVolume)) }),
    setSnapMode: (snapMode) => set({ snapMode, snapEnabled: snapsFor(snapMode) }),
    setGrid: (grid) => set({ grid: GRID_SIZES.includes(grid as (typeof GRID_SIZES)[number]) ? grid : 0.1 }),
    setInfoOpen: (infoOpen) => set({ infoOpen }),
    setScheduleOpen: (scheduleOpen) => set({ scheduleOpen }),
    setPhotoOpen: (photoOpen) => set(photoOpen ? { photoOpen, tourPlaying: false, walking: false } : { photoOpen }),
    setTourProgress(p) {
      const cur = get().tourProgress;
      if (cur?.stop === p?.stop && cur?.total === p?.total) return;
      set({ tourProgress: p });
    },
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
