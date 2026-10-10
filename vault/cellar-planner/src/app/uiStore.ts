import { createStore, type StoreApi } from 'zustand/vanilla';
import type { WallSide } from '../enclosure';

/** Screen state that is not part of the design (and so is not undoable or saved): which drawing is showing, and whether the guide is open. */
export interface UiState {
  tab: 'plan' | 'elevation' | 'racks';
  wall: WallSide;
  /** The wall whose racks the Racks tab shows (seen from inside). */
  rackWall: WallSide;
  /** Phone layout only: which of the three panes shows (controls, drawing, checks). */
  pane: 'controls' | 'drawing' | 'checks';
  infoOpen: boolean;
  /** The Open from design code dialog. */
  codeOpen: boolean;
  /** The drawing package form (title block details and the PDF download). */
  packageOpen: boolean;
  /** The saved-designs list. */
  designsOpen: boolean;
  /** The website enquiries list. */
  leadsOpen: boolean;
  /** "How the numbers are calculated" (for technicians). */
  calcOpen: boolean;
  /** The customer quote form (and PDF). */
  quoteOpen: boolean;
  /** The one-line message under the header (what just happened: opened, loaded, could not read). */
  notice: string;
  set(patch: Partial<Pick<UiState, 'codeOpen' | 'pane' | 'tab' | 'wall' | 'rackWall' | 'infoOpen' | 'packageOpen' | 'designsOpen' | 'leadsOpen' | 'quoteOpen' | 'calcOpen' | 'notice'>>): void;
}
export type UiStore = StoreApi<UiState>;

export const INFO_KEY = 'cellar-planner:info-seen:v1';

export function createUiStore(wall: WallSide = 'SOUTH'): UiStore {
  return createStore<UiState>((set) => ({ tab: 'plan', wall, rackWall: 'NORTH', pane: 'drawing', infoOpen: false, codeOpen: false, packageOpen: false, designsOpen: false, leadsOpen: false, quoteOpen: false, calcOpen: false, notice: '', set: (patch) => set(patch) }));
}
