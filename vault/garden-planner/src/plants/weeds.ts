// Weed status. A plant's weed status in a state is one of three things, and "not recorded" is NOT "not a weed":
//   listed      - the dataset lists it as a weed in that state (draft, not yet checked against the state's own list)
//   not_listed  - the plant HAS been checked against that state's official weed list and is not on it (`weedChecked` names the states)
//   unknown     - anything else: no one has checked. This is the status of almost every plant today.
// The checks and the plant library only ever treat `listed` as a weed, but they never describe `unknown` as safe.
import type { AuState } from '../domain/types';
import { PLANTS } from './plants';
import type { PlantRecord } from './types';

export type WeedStatus = 'listed' | 'not_listed' | 'unknown';

export function weedStatus(p: PlantRecord, state: AuState): WeedStatus {
  if (p.weedStates.includes(state)) return 'listed';
  if (p.weedChecked.includes(state)) return 'not_listed';
  return 'unknown';
}

export interface WeedCoverage {
  plants: number;
  /** Plants with at least one weed listing in the draft data. */
  withAnyListing: number;
  /** (plant, state) pairs confirmed against an official list: 0 until someone verifies the data. */
  verifiedPairs: number;
  /** Plants whose weed status in this state is still unknown. */
  unknownIn(state: AuState): number;
}

export function weedCoverage(plants: readonly PlantRecord[] = PLANTS): WeedCoverage {
  return {
    plants: plants.length,
    withAnyListing: plants.filter((p) => p.weedStates.length > 0).length,
    verifiedPairs: plants.reduce((n, p) => n + p.weedChecked.length, 0),
    unknownIn: (state) => plants.filter((p) => weedStatus(p, state) === 'unknown').length,
  };
}

/** Plain-words status for a plant card or message. */
export function weedStatusText(p: PlantRecord, state: AuState): string {
  switch (weedStatus(p, state)) {
    case 'listed': return `Listed as a weed in ${state} (draft, unverified)`;
    case 'not_listed': return `Checked against the ${state} weed list: not listed`;
    default: return `Unknown in ${state}: not checked against any weed list`;
  }
}

/** The warning shown wherever the weed filter is used. */
export function weedFilterNote(plants: readonly PlantRecord[] = PLANTS): string {
  const c = weedCoverage(plants);
  return `The weed filter is incomplete. Only ${c.withAnyListing} of ${c.plants} plants have any weed listing, and none has been checked against a state weed list. A plant that is not marked is "unknown", not safe.`;
}
