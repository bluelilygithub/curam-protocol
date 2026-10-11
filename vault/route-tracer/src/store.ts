import { create } from 'zustand';
import { emptyDraw, type DrawMode, type DrawState } from './drawing';
import type { Pos, Units } from './geo';
import type { Track, TrackSummary } from './api';

export const STYLES = [
  { id: 'streets-v2', label: 'Streets' },
  { id: 'outdoor-v2', label: 'Outdoor' },
  { id: 'hybrid', label: 'Satellite' },
] as const;
export type StyleId = (typeof STYLES)[number]['id'];

export const COLORS = ['#E4572E', '#1D6FA5', '#2E7D32', '#8E44AD', '#B7791F', '#212121'];

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string): void => { try { localStorage.setItem(key, v); } catch { /* private window */ } };

export interface Toast { id: number; kind: 'ok' | 'error'; text: string }
let toastSeq = 0;

interface State {
  units: Units;
  setUnits(u: Units): void;
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
  apply(fn: (s: DrawState) => DrawState): void;
  /** Open the toolbar. `from` seeds it (Extend). */
  startDrawing(from?: DrawState): void;
  stopDrawing(): void;
  /** The track being extended (PATCH on save), or null for a new one. */
  extendingId: string | null;
  setExtendingId(id: string | null): void;

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
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
}

export const useStore = create<State>((set, get) => ({
  units: read('route-tracer:units') === 'mi' ? 'mi' : 'km',
  setUnits: (units) => { write('route-tracer:units', units); set({ units }); },
  styleId: (STYLES.find((s) => s.id === read('route-tracer:style'))?.id ?? 'streets-v2') as StyleId,
  setStyle: (styleId) => { write('route-tracer:style', styleId); set({ styleId }); },

  drawing: false,
  mode: read('route-tracer:mode') === 'click' ? 'click' : 'freehand',
  setMode: (mode) => { write('route-tracer:mode', mode); set({ mode, rubber: null }); },
  draw: emptyDraw(),
  rubber: null,
  setRubber: (rubber) => set({ rubber }),
  apply: (fn) => set((s) => ({ draw: fn(s.draw) })),
  startDrawing: (from) => set({ drawing: true, draw: from ?? emptyDraw(), rubber: null, panel: 'closed' }),
  stopDrawing: () => set({ drawing: false, draw: emptyDraw(), rubber: null, extendingId: null, saving: false, drawColor: COLORS[0] }),
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

  toasts: [],
  toast: (kind, text) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), 3000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
