import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Issue } from '../checks/types';

/** The result of the last run of the checks. They run a moment after each change, never during a drag. */
export interface ChecksState {
  issues: Issue[];
  /** True while a run is pending or in progress. */
  computing: boolean;
  /** How many runs have finished (the browser tests wait on it). */
  runs: number;
}
export interface ChecksActions { set(patch: Partial<ChecksState>): void }
export type ChecksStore = StoreApi<ChecksState & ChecksActions>;

export function createChecksStore(): ChecksStore {
  return createStore<ChecksState & ChecksActions>((set) => ({ issues: [], computing: false, runs: 0, set: (patch) => set(patch) }));
}

export const countBySeverity = (issues: Issue[]): { error: number; warning: number; info: number } => ({
  error: issues.filter((i) => i.severity === 'error').length,
  warning: issues.filter((i) => i.severity === 'warning').length,
  info: issues.filter((i) => i.severity === 'info').length,
});
