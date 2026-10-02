import { createStore, type StoreApi } from 'zustand/vanilla';
import type { View } from '../adapters/canvas';

/** 2D camera (pan/zoom). Independent of design state and history (Spec §6 camera/view state). */
export interface ViewState { view: View; viewport: { width: number; height: number } }
export interface ViewActions {
  setView(v: View): void;
  setViewport(w: number, h: number): void;
}
export type ViewStore = StoreApi<ViewState & ViewActions>;

export function createViewStore(): ViewStore {
  return createStore<ViewState & ViewActions>((set) => ({
    view: { scale: 100, offsetX: 120, offsetY: 520 },
    viewport: { width: 1000, height: 640 },
    setView: (view) => set({ view }),
    setViewport: (width, height) => set({ viewport: { width, height } }),
  }));
}
