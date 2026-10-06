import { createStore, type StoreApi } from 'zustand/vanilla';
import type { WallSide } from '../enclosure';

/** Screen state that is not part of the design (and so is not undoable or saved): which drawing is showing, and whether the guide is open. */
export interface UiState {
  tab: 'plan' | 'elevation';
  wall: WallSide;
  infoOpen: boolean;
  set(patch: Partial<Pick<UiState, 'tab' | 'wall' | 'infoOpen'>>): void;
}
export type UiStore = StoreApi<UiState>;

export const INFO_KEY = 'cellar-planner:info-seen:v1';

export function createUiStore(wall: WallSide = 'SOUTH'): UiStore {
  return createStore<UiState>((set) => ({ tab: 'plan', wall, infoOpen: false, set: (patch) => set(patch) }));
}
