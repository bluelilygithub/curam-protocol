import { bayResult } from './capacity';
import type { CabinetBay, ConstructionRules, CornerOwnershipMode, Termination, Wall } from './types';

// Runs, scribes and corners (spec-v1.md 6).

export const wallLengthMm = (w: Pick<Wall, 'start' | 'end'>): number => Math.round(Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]));

/** A scribe (site-cut filler) is needed wherever a run meets a room wall, including the wall of a corner this run owns. */
export const scribeFor = (t: Termination, r: ConstructionRules): number => (t === 'CORNER_YIELDS' ? 0 : r.scribeMm);

export interface RunExtent {
  /** Where the first cabinet can start, measured from the start of the wall. */
  startOffsetMm: number;
  /** Space left at the far end. */
  endOffsetMm: number;
  usableMm: number;
}

/**
 * The part of a wall cabinets can use. A run that ends at a room wall loses a scribe; a run that yields a corner starts after the owning
 * wall's cabinets plus the corner clearance (and needs no scribe there, it meets cabinets, not a wall).
 */
export function runExtent(wallLengthMm: number, start: Termination, end: Termination, ownerDepthAtStartMm: number, ownerDepthAtEndMm: number, r: ConstructionRules): RunExtent {
  const startOffsetMm = start === 'CORNER_YIELDS' ? ownerDepthAtStartMm + r.cornerClearanceMm : scribeFor(start, r);
  const endOffsetMm = end === 'CORNER_YIELDS' ? ownerDepthAtEndMm + r.cornerClearanceMm : scribeFor(end, r);
  return { startOffsetMm, endOffsetMm, usableMm: wallLengthMm - startOffsetMm - endOffsetMm };
}

export interface RunSplit {
  bayWidthMm: number;
  remainderMm: number;
  /** Extra width added to the start and end scribes so every bay stays a whole, identical millimetre size. */
  startExtraMm: number;
  endExtraMm: number;
}

/** Split a run into equal bays: each is rounded down to a whole millimetre and the remainder goes to the site-cut scribes. */
export function splitRun(usableMm: number, bayCount: number): RunSplit {
  if (!Number.isInteger(bayCount) || bayCount < 1) throw new RangeError('bayCount must be a whole number of at least 1');
  const bayWidthMm = Math.max(0, Math.floor(usableMm / bayCount));
  const remainderMm = Math.max(0, usableMm - bayWidthMm * bayCount);
  const startExtraMm = Math.floor(remainderMm / 2);
  return { bayWidthMm, remainderMm, startExtraMm, endExtraMm: remainderMm - startExtraMm };
}

/** Which of two walls meeting at a corner owns it (its cabinets run into the corner). A tie goes to the first wall. */
export function cornerOwner(a: { id: string; lengthMm: number }, b: { id: string; lengthMm: number }, mode: CornerOwnershipMode, manualOwnerId?: string): 'A' | 'B' {
  if (mode === 'MANUAL' && manualOwnerId) return manualOwnerId === b.id ? 'B' : 'A';
  return b.lengthMm > a.lengthMm ? 'B' : 'A';
}

export interface DeadCorner {
  /** Length of the yielding wall's run the corner takes out. */
  widthMm: number;
  areaMm2: number;
  lostCapacity: number;
}

/**
 * The corner square the yielding wall cannot use. Its lost capacity is what a bay of that width would have held with the same modules as
 * `template` (zero when the strip is too narrow to hold a bottle).
 */
export function deadCorner(ownerDepthMm: number, yieldingDepthMm: number, template: CabinetBay, r: ConstructionRules): DeadCorner {
  const widthMm = ownerDepthMm + r.cornerClearanceMm;
  const lost = bayResult({ ...template, widthMm, outerDepthMm: yieldingDepthMm }, r).capacity;
  return { widthMm, areaMm2: widthMm * yieldingDepthMm, lostCapacity: lost };
}

const samePoint = (p: [number, number], q: [number, number]): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1;

/** The wall that meets `wall` at its start or end point, if any (corners are where wall end points coincide). */
export function adjacentWall(wall: Wall, which: 'start' | 'end', walls: Wall[]): Wall | undefined {
  const p = which === 'start' ? wall.start : wall.end;
  return walls.find((w) => w.id !== wall.id && (samePoint(w.start, p) || samePoint(w.end, p)));
}
