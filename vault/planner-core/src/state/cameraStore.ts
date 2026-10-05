import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CameraState } from '../render3d/camera';

/**
 * The 3D camera (M4). Like the 2D view it is presentation state: never part of the project's history. The viewport writes
 * `camera` when a gesture ends (not per frame); everything that wants to move the camera files a `request`, which the viewport
 * applies (animated for presets and saved views). Saved views are copies of `camera`.
 */
export interface CameraRequest { camera: CameraState; animate: boolean; nonce: number }

export interface CameraStoreState {
  camera: CameraState | null;
  request: CameraRequest | null;
  /** Canvas pixel size, so fitting and projection conversion know the aspect. */
  viewport: { w: number; h: number };
}

export interface CameraStoreActions {
  setCamera(c: CameraState): void;
  requestCamera(c: CameraState, animate: boolean): void;
  setViewport(w: number, h: number): void;
}

export type CameraStore = StoreApi<CameraStoreState & CameraStoreActions>;

export function createCameraStore(): CameraStore {
  let nonce = 0;
  return createStore<CameraStoreState & CameraStoreActions>((set) => ({
    camera: null,
    request: null,
    viewport: { w: 1000, h: 700 },
    setCamera: (camera) => set({ camera }),
    requestCamera: (camera, animate) => set({ request: { camera, animate, nonce: ++nonce }, camera }),
    setViewport: (w, h) => set((s) => (s.viewport.w === w && s.viewport.h === h ? s : { viewport: { w, h } })),
  }));
}
