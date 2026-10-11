import { create } from 'zustand';
import { closeLoop as closeLoopFn, deleteVertex, emptyDraw, outAndBack as outAndBackFn, snapDelete, type Shaped, type DrawMode, type DrawState, type VertexRef } from './drawing';
import type { Pos, Units } from './geo';
import type { PlanProfile, Track, TrackSummary } from './api';

export const STYLES = [
  { id: 'streets-v2', label: 'Streets' },
  { id: 'outdoor-v2', label: 'Outdoor' },
  { id: 'hybrid', label: 'Satellite' },
] as const;
export type StyleId = (typeof STYLES)[number]['id'];

export const COLORS = ['#E4572E', '#1D6FA5', '#2E7D32', '#8E44AD', '#B7791F', '#212121'];

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string): void => { try { localStorage.setItem(key, v); } catch { /* private window */ } };

export interface Probe { pos: Pos; km: number; totalKm: number; name: string; color: string; several: boolean; /** Terrain height at the spot, metres (set from the elevation chart). */ ele?: number | null }

export interface Toast { id: number; kind: 'ok' | 'error'; text: string }
let toastSeq = 0;

interface State {
  units: Units;
  setUnits(u: Units): void;
  /** The MapTiler key the map uses; the elevation chart reads terrain tiles with it. */
  mapKey: string | null;
  setMapKey(k: string | null): void;
  /** Elevation chart open in the drawing tools. */
  elevationOpen: boolean;
  setElevationOpen(v: boolean): void;
  /** The "How this works" guide. */
  infoOpen: boolean;
  setInfoOpen(v: boolean): void;
  /** A tapped point on a saved track: where, how far from the start, and of which track. */
  probe: Probe | null;
  setProbe(p: Probe | null): void;
  /** Distance markers on the line (every 1 km / 1 mi). */
  markersOn: boolean;
  setMarkersOn(v: boolean): void;
  styleId: StyleId;
  setStyle(s: StyleId): void;

  /** Draw toolbar open. */
  drawing: boolean;
  mode: DrawMode;
  setMode(m: DrawMode): void;
  draw: DrawState;
  /** Click mode rubber band end (desktop pointer position), never counted in the distance. */
  rubber: Pos | null;
  setRubber(p: Pos | null): void;
  /** Edit mode: the point picked for Delete point. */
  /** Follow roads (Click mode): each click finds the road from the last one. Remembered on this device. */
  followRoads: boolean;
  setFollowRoads(v: boolean): void;
  /** The way of travelling Follow roads uses. */
  followProfile: PlanProfile;
  setFollowProfile(p: PlanProfile): void;
  selectedVertex: VertexRef | null;
  setSelectedVertex(v: VertexRef | null): void;
  deleteSelectedVertex(): void;
  /** Route shapes: both are one undo step, and say why when they cannot be done. */
  closeLoop(): void;
  outAndBack(): void;
  apply(fn: (s: DrawState) => DrawState): void;
  /** Open the toolbar. `from` seeds it (Extend). */
  startDrawing(from?: DrawState): void;
  stopDrawing(): void;
  /** The route in the drawing tools came from Plan route: it is saved as a planned route. */
  planned: boolean;
  setPlanned(v: boolean): void;
  /** The server has an OpenRouteService key (Plan route works). */
  routePlanning: boolean;
  setRoutePlanning(v: boolean): void;
  /** The track being extended (PATCH on save), or null for a new one. */
  extendingId: string | null;
  setExtendingId(id: string | null): void;
  /** An imported GPX is open in the drawing tools: its name and notes pre-fill the save dialog and the track is saved as imported. */
  imported: { name: string | null; notes: string | null } | null;
  setImported(v: { name: string | null; notes: string | null } | null): void;

  /** Colour of the line being drawn (the track's own colour when extending). */
  drawColor: string;
  setDrawColor(c: string): void;
  /** The save dialog is open (Finish pressed). */
  saving: boolean;
  setSaving(v: boolean): void;

  panel: 'closed' | 'tracks' | 'detail';
  setPanel(p: 'closed' | 'tracks' | 'detail'): void;
  tracks: TrackSummary[];
  setTracks(t: TrackSummary[]): void;
  /** The track open in the detail view. */
  selected: Track | null;
  select(t: Track | null): void;
  showAll: boolean;
  setShowAll(v: boolean): void;

  toasts: Toast[];
  toast(kind: Toast['kind'], text: string, ms?: number): void;
  dismissToast(id: number): void;
}

export const useStore = create<State>((set, get) => {
  const applyShape = (fn: (s: DrawState) => Shaped): void => {
    const r = fn(get().draw);
    if (!r.ok) return get().toast('error', r.reason);
    set({ draw: r.state, selectedVertex: null }); // point numbers changed: nothing stays picked
  };
  return {
  units: read('route-tracer:units') === 'mi' ? 'mi' : 'km',
  setUnits: (units) => { write('route-tracer:units', units); set({ units }); },
  mapKey: null,
  setMapKey: (mapKey) => set({ mapKey }),
  elevationOpen: false,
  setElevationOpen: (elevationOpen) => set({ elevationOpen }),
  infoOpen: false,
  setInfoOpen: (infoOpen) => set({ infoOpen }),
  probe: null,
  setProbe: (probe) => set({ probe }),
  markersOn: read('route-tracer:markers') !== 'off',
  setMarkersOn: (markersOn) => { write('route-tracer:markers', markersOn ? 'on' : 'off'); set({ markersOn }); },
  styleId: (STYLES.find((s) => s.id === read('route-tracer:style'))?.id ?? 'streets-v2') as StyleId,
  setStyle: (styleId) => { write('route-tracer:style', styleId); set({ styleId }); },

  drawing: false,
  mode: read('route-tracer:mode') === 'click' ? 'click' : 'freehand',
  // the drawing style is remembered per browser; Edit is a one-off activity, never the default
  setMode: (mode) => { if (mode !== 'edit') write('route-tracer:mode', mode); set({ mode, rubber: null, selectedVertex: null }); },
  followRoads: read('route-tracer:follow') === 'on',
  setFollowRoads: (followRoads) => { write('route-tracer:follow', followRoads ? 'on' : 'off'); set({ followRoads }); },
  followProfile: (['walking', 'hiking', 'cycling', 'driving'].find((p) => p === (read('route-tracer:follow-profile') ?? read('route-tracer:plan-profile'))) ?? 'walking') as PlanProfile,
  setFollowProfile: (followProfile) => { write('route-tracer:follow-profile', followProfile); set({ followProfile }); },
  selectedVertex: null,
  setSelectedVertex: (selectedVertex) => set({ selectedVertex }),
  closeLoop: () => applyShape((d) => closeLoopFn(d, get().followRoads ? get().followProfile : null)),
  outAndBack: () => applyShape(outAndBackFn),
  deleteSelectedVertex: () => {
    const { selectedVertex, draw, toast } = get();
    if (!selectedVertex) return;
    const next = draw.snap ? snapDelete(draw, selectedVertex.vi) : deleteVertex(draw, selectedVertex); // on a road-following route a point is a waypoint
    if (!next) return toast('error', draw.snap ? 'A route needs at least two points.' : 'A stroke needs at least two points.');
    set({ draw: next, selectedVertex: null });
  },
  draw: emptyDraw(),
  rubber: null,
  setRubber: (rubber) => set({ rubber }),
  apply: (fn) => set((s) => ({ draw: fn(s.draw) })),
  startDrawing: (from) => set({ probe: null, drawing: true, draw: from ?? emptyDraw(), rubber: null, selectedVertex: null, panel: 'closed' }),
  stopDrawing: () => set({ elevationOpen: false, planned: false, imported: null, mode: get().mode === 'edit' ? (read('route-tracer:mode') === 'click' ? 'click' : 'freehand') : get().mode, drawing: false, draw: emptyDraw(), rubber: null, selectedVertex: null, extendingId: null, saving: false, drawColor: COLORS[0] }),
  extendingId: null,
  drawColor: COLORS[0],
  setDrawColor: (drawColor) => set({ drawColor }),
  saving: false,
  setSaving: (saving) => set({ saving }),
  panel: 'closed',
  setPanel: (panel) => set({ panel }),
  tracks: [],
  setTracks: (tracks) => set({ tracks }),
  selected: null,
  select: (selected) => set({ selected, panel: selected ? 'detail' : get().panel === 'detail' ? 'tracks' : get().panel }),
  showAll: false,
  setShowAll: (showAll) => set({ showAll }),
  setExtendingId: (extendingId) => set({ extendingId }),
  planned: false,
  setPlanned: (planned) => set({ planned }),
  routePlanning: false,
  setRoutePlanning: (routePlanning) => set({ routePlanning }),
  imported: null,
  setImported: (imported) => set({ imported }),

  toasts: [],
  toast: (kind, text, ms = 3000) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), ms);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
};
});
