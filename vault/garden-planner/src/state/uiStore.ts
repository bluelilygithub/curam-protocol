import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ServiceKind, StructureKind } from '../domain/types';
import type { GrowthStage } from '../plants/growth';
import { DEFAULT_SUN_THRESHOLDS, type SunThresholds } from '../plants/suitability';

export type Tool =
  | 'select' | 'boundary' | 'house' | 'bed' | 'lawn' | 'zone' | 'path' | 'service' | 'structure' | 'plant' | 'scale' | 'north';
export type ItemKind = 'boundary' | 'house' | 'zone' | 'bed' | 'path' | 'service' | 'lawn' | 'structure' | 'plant';
export interface Selection { kind: ItemKind; id: string }
export type ViewMode = '2d' | '3d';

/** Two clicks on the tracing picture, waiting for the known length between them. */
export interface ScaleDraft { a: { x: number; y: number }; b: { x: number; y: number } | null }

export interface UiState {
  tool: Tool;
  /** The structure the Structure tool places. */
  structureKind: StructureKind;
  /** The kind of service the Service tool draws. */
  serviceKind: ServiceKind;
  /** The plant the Plant tool places (plant id). */
  placingPlantId: string | null;
  /** Draw new beds and lawns with curved edges. */
  smoothShapes: boolean;
  selection: Selection | null;
  /** Which boundary edge was clicked (for choosing that edge's fence in the Inspector). */
  boundaryEdge: number | null;
  viewMode: ViewMode;
  stage: GrowthStage;
  /** 1-12. */
  month: number;
  /** Time of day, local standard time in decimal hours (13.5 = 1:30 pm). Drives the shadows and the 3D sun. */
  hour: number;
  /** Show the sun-hours map (for the chosen month and growth stage) on the plan. */
  showSun: boolean;
  /** Show the shadows cast at the chosen time of day on the plan. */
  showShadows: boolean;
  /** Where full sun / part shade / shade begin, in hours of sun a day. A per-browser setting. */
  sunThresholds: SunThresholds;
  /** Library: only plants that suit the sun in the selected bed. */
  matchBedSun: boolean;
  /** Checks setting: the narrowest comfortable path, in metres. A per-browser setting. */
  pathMinWidth: number;
  /** Checks setting: the width of the mower that has to reach the lawns, in metres. A per-browser setting. */
  mowerWidth: number;
  /** Which tab the right-hand panel shows. */
  rightTab: 'details' | 'checks';
  /** Library filters */
  suitsOnly: boolean;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  projectsOpen: boolean;
  wizardOpen: boolean;
  infoOpen: boolean;
  creditsOpen: boolean;
  /** Dragging on the plan moves the satellite map (to line it up with the plot) instead of selecting. */
  mapAlign: boolean;
  snap: boolean;
  grid: number;
  showGrid: boolean;
  scaleDraft: ScaleDraft | null;
  status: { text: string; severity: 'info' | 'warn' | 'error' } | null;
}

export interface UiActions {
  set(patch: Partial<UiState>): void;
  setTool(tool: Tool): void;
  select(sel: Selection | null): void;
  /** Arm the Plant tool with a plant. */
  placePlant(plantId: string): void;
  setStatus(text: string, severity?: 'info' | 'warn' | 'error'): void;
  clearStatus(): void;
}

export type UiStore = StoreApi<UiState & UiActions>;

export function createUiStore(): UiStore {
  return createStore<UiState & UiActions>((set) => ({
    tool: 'select', structureKind: 'shed', serviceKind: 'sewer', placingPlantId: null, smoothShapes: true,
    selection: null, boundaryEdge: null, viewMode: '2d', stage: 'mature', month: new Date().getMonth() + 1,
    hour: 12, showSun: false, showShadows: false, sunThresholds: { ...DEFAULT_SUN_THRESHOLDS }, matchBedSun: false, pathMinWidth: 0.9, mowerWidth: 0.9, rightTab: 'details',
    suitsOnly: true, libraryOpen: true, inspectorOpen: true, projectsOpen: false, wizardOpen: false, infoOpen: false, creditsOpen: false, mapAlign: false,
    snap: true, grid: 0.5, showGrid: true, scaleDraft: null, status: null,

    set: (patch) => set(patch),
    setTool: (tool) => set({ tool, scaleDraft: null }),
    select: (selection) => set({ selection }),
    placePlant: (placingPlantId) => set({ placingPlantId, tool: 'plant', selection: null }),
    setStatus: (text, severity = 'info') => set({ status: { text, severity } }),
    clearStatus: () => set({ status: null }),
  }));
}
