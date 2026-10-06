import { doorLayout, internalSize } from '../enclosure/enclosure';
import type { Enclosure, WallSide } from '../enclosure/types';
import type { BottleProfileId, Issue } from '../engine/types';
import { checkRackSpec, rackCapacity, type RackCapacity, type RackSpec } from '../rack/rack';

// Placing rack runs inside the enclosure (spec-v1.md section 14). Pure geometry. A rack's footprint comes from its unit width and depth, which are
// BLANK until entered, so a run with a blank spec has no footprint ("not set") and is skipped by the geometry checks, exactly as its capacity is
// "not set". Never a zero-size rack.
//
// Inside coordinates: millimetres from the inside north-west corner, x to the east, y to the south. Along a wall, `s` runs west to east on the north
// and south walls and north to south on the east and west walls; `d` is the distance in from the wall.

export interface RackRun {
  id: string;
  wall: WallSide;
  /** Where the first unit starts, along the wall from its inside start. */
  startMm: number;
  units: number;
  spec: RackSpec;
  bottle: BottleProfileId;
}

export interface Rect { x0: number; x1: number; y0: number; y1: number }
interface WallRect { s0: number; s1: number; d0: number; d1: number }

export type Footprint = { status: 'OK'; rect: Rect; lengthMm: number; depthMm: number } | { status: 'NOT_SET'; missing: string[] };

/** The shortest clear width to walk. PROPOSED default: the owner confirms. */
export const DEFAULT_WALKWAY_MM = 900;

const alongLength = (side: WallSide, w: number, d: number): number => (side === 'NORTH' || side === 'SOUTH' ? w : d);
const acrossLength = (side: WallSide, w: number, d: number): number => (side === 'NORTH' || side === 'SOUTH' ? d : w);
const opposite: Record<WallSide, WallSide> = { NORTH: 'SOUTH', SOUTH: 'NORTH', EAST: 'WEST', WEST: 'EAST' };

/** A rectangle given along (s0..s1) and in from (d0..d1) one wall, as inside x and y. */
function fromWallFrame(side: WallSide, r: WallRect, w: number, d: number): Rect {
  switch (side) {
    case 'NORTH': return { x0: r.s0, x1: r.s1, y0: r.d0, y1: r.d1 };
    case 'SOUTH': return { x0: r.s0, x1: r.s1, y0: d - r.d1, y1: d - r.d0 };
    case 'WEST': return { x0: r.d0, x1: r.d1, y0: r.s0, y1: r.s1 };
    case 'EAST': return { x0: w - r.d1, x1: w - r.d0, y0: r.s0, y1: r.s1 };
  }
}

/** The same rectangle seen from a wall: along it and in from it. */
function toWallFrame(side: WallSide, r: Rect, w: number, d: number): WallRect {
  switch (side) {
    case 'NORTH': return { s0: r.x0, s1: r.x1, d0: r.y0, d1: r.y1 };
    case 'SOUTH': return { s0: r.x0, s1: r.x1, d0: d - r.y1, d1: d - r.y0 };
    case 'WEST': return { s0: r.y0, s1: r.y1, d0: r.x0, d1: r.x1 };
    case 'EAST': return { s0: r.y0, s1: r.y1, d0: w - r.x1, d1: w - r.x0 };
  }
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A run's footprint, or "not set" with the missing fields when its unit width or depth is blank. */
export function footprint(e: Enclosure, run: RackRun): Footprint {
  const { widthMm: w, depthMm: d } = internalSize(e);
  const missing: string[] = [];
  if (run.spec.unitWidthMm === null) missing.push('unit width');
  if (run.spec.unitDepthMm === null) missing.push('unit depth');
  if (missing.length) return { status: 'NOT_SET', missing };
  const lengthMm = run.units * (run.spec.unitWidthMm as number);
  const depthMm = run.spec.unitDepthMm as number;
  return { status: 'OK', lengthMm, depthMm, rect: fromWallFrame(run.wall, { s0: run.startMm, s1: run.startMm + lengthMm, d0: 0, d1: depthMm }, w, d) };
}

/** The door's opening along its wall, in inside coordinates (the outer-face position less the build-up of the wall at the start). */
export function doorOpening(e: Enclosure): { wall: WallSide; aMm: number; bMm: number } {
  const layout = doorLayout(e);
  const side = e.door.wall;
  const startBuildUp = side === 'NORTH' || side === 'SOUTH' ? e.walls.WEST.buildUpMm : e.walls.NORTH.buildUpMm;
  const aMm = layout.beforeMm - startBuildUp;
  return { wall: side, aMm, bMm: aMm + e.door.widthMm };
}

/**
 * Hinge point along the door wall. The hinge side is as seen from OUTSIDE, facing the door: on the south wall left is the west end, on the north
 * wall the east end, on the east wall the south end, on the west wall the north end.
 */
export function hingeAt(e: Enclosure): number {
  const o = doorOpening(e);
  const leftIsLow = e.door.wall === 'SOUTH' || e.door.wall === 'WEST';
  const low = e.door.hinge === 'LEFT' ? leftIsLow : !leftIsLow;
  return low ? o.aMm : o.bMm;
}

/** Does a rectangle meet the quarter circle an inward-swinging door sweeps (radius = door width, centred on the hinge)? */
export function hitsDoorSwing(e: Enclosure, r: Rect): boolean {
  if (e.door.swing !== 'IN') return false;
  const { widthMm: w, depthMm: d } = internalSize(e);
  const o = doorOpening(e);
  const f = toWallFrame(o.wall, r, w, d);
  const radius = e.door.widthMm;
  const s0 = Math.max(f.s0, o.aMm), s1 = Math.min(f.s1, o.bMm), d0 = Math.max(f.d0, 0), d1 = Math.min(f.d1, radius);
  if (s0 >= s1 || d0 >= d1) return false;
  const hs = hingeAt(e);
  const nearestS = Math.min(Math.max(hs, s0), s1), nearestD = Math.min(Math.max(0, d0), d1);
  return Math.hypot(nearestS - hs, nearestD) < radius;
}

export interface RunAnalysis { runId: string; footprint: Footprint; capacity: RackCapacity }
export type TotalCapacity = { status: 'OK'; capacity: number } | { status: 'NOT_SET'; unsetRuns: number };
export interface RackLayoutAnalysis { runs: RunAnalysis[]; issues: Issue[]; total: TotalCapacity }

/**
 * Checks and capacity for rack runs in an enclosure: each run inside its wall and the height, none on the door or in an inward swing, a landing in
 * front of the door, no two runs overlapping, and the walkway between runs (or run and wall) wide enough. Runs with blank sizes are skipped by the
 * geometry and reported as "not set".
 */
export function analyseRacks(e: Enclosure, runs: RackRun[], opts: { walkwayMm?: number } = {}): RackLayoutAnalysis {
  const walkway = opts.walkwayMm ?? DEFAULT_WALKWAY_MM;
  const { widthMm: iw, depthMm: id, heightMm: ih } = internalSize(e);
  const issues: Issue[] = [];
  const results: RunAnalysis[] = runs.map((run) => ({ runId: run.id, footprint: footprint(e, run), capacity: rackCapacity(run.spec, run.units) }));

  for (const run of runs) for (const i of checkRackSpec(run.spec, run.bottle)) issues.push({ ...i, where: run.id });

  const placed = runs.map((run, i) => ({ run, fp: results[i].footprint })).filter((x): x is { run: RackRun; fp: Extract<Footprint, { status: 'OK' }> } => x.fp.status === 'OK' && x.run.units > 0);
  const opening = doorOpening(e);
  const landing = fromWallFrame(opening.wall, { s0: opening.aMm, s1: opening.bMm, d0: 0, d1: walkway }, iw, id);

  for (const { run, fp } of placed) {
    const len = alongLength(run.wall, iw, id);
    if (run.startMm < 0 || run.startMm + fp.lengthMm > len) {
      issues.push({ code: 'RUN_OUTSIDE', severity: 'error', message: `This run is ${fp.lengthMm} mm long from ${run.startMm} mm, but the ${run.wall.toLowerCase()} wall is ${len} mm inside.`, fix: `Use at most ${Math.max(0, Math.floor((len - Math.max(0, run.startMm)) / (run.spec.unitWidthMm as number)))} units from there.`, where: run.id });
    }
    if (fp.depthMm > acrossLength(run.wall, iw, id)) issues.push({ code: 'RUN_TOO_DEEP', severity: 'error', message: `A ${fp.depthMm} mm deep unit does not fit across a ${acrossLength(run.wall, iw, id)} mm enclosure.`, where: run.id });
    if (run.spec.unitHeightMm !== null && run.spec.unitHeightMm > ih) {
      issues.push({ code: 'RACK_TOO_TALL', severity: 'error', message: `The unit is ${run.spec.unitHeightMm} mm tall but the inside is ${ih} mm.`, fix: `Use a unit ${ih} mm tall or less.`, where: run.id });
    }
    if (run.wall === opening.wall && run.startMm < opening.bMm && run.startMm + fp.lengthMm > opening.aMm) {
      issues.push({ code: 'RUN_ON_DOOR', severity: 'error', message: 'This run stands across the door opening.', fix: `Keep it to the free wall either side of the ${opening.aMm} to ${opening.bMm} mm opening.`, where: run.id });
    }
    if (hitsDoorSwing(e, fp.rect)) issues.push({ code: 'RUN_IN_DOOR_SWING', severity: 'error', message: `The door swings in and sweeps a ${e.door.widthMm} mm radius that this run is in.`, fix: 'Shorten or move the run, or make the door swing out.', where: run.id });
    else if (overlaps(fp.rect, landing)) issues.push({ code: 'DOOR_PATH_BLOCKED', severity: 'error', message: `This run is in the ${walkway} mm of floor in front of the door.`, fix: 'Move it back or make it shallower.', where: run.id });
  }

  placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => {
    if (overlaps(a.fp.rect, b.fp.rect)) issues.push({ code: 'RUN_OVERLAP', severity: 'error', message: `Runs ${a.run.id} and ${b.run.id} overlap (at a corner, start the second after the first's depth).`, where: a.run.id });
  }));

  // walkway: across the enclosure from each run, past any run facing it, to the far wall
  for (const { run, fp } of placed) {
    const across = acrossLength(run.wall, iw, id);
    const s0 = run.startMm, s1 = run.startMm + fp.lengthMm;
    const facing = placed.filter((o) => o.run.wall === opposite[run.wall] && o.run.startMm < s1 && o.run.startMm + o.fp.lengthMm > s0);
    const taken = fp.depthMm + Math.max(0, ...facing.map((o) => o.fp.depthMm));
    const gap = across - taken;
    if (gap < walkway && (facing.length === 0 || run.wall < opposite[run.wall])) {
      issues.push({ code: 'WALKWAY_TOO_NARROW', severity: 'error', message: `Only ${gap} mm is left to walk ${facing.length ? 'between these runs' : 'in front of this run'}; ${walkway} mm is wanted.`, fix: `Make the units ${walkway - gap} mm shallower in total, or remove a run.`, where: run.id });
    }
  }

  const unset = results.filter((r) => r.capacity.status === 'NOT_SET').length;
  const total: TotalCapacity = unset ? { status: 'NOT_SET', unsetRuns: unset } : { status: 'OK', capacity: results.reduce((n, r) => n + (r.capacity.status === 'OK' ? r.capacity.capacity : 0), 0) };
  return { runs: results, issues, total };
}

/**
 * Fill one wall with as many whole units as fit, leaving the door opening free: one run on a wall without the door, up to two on the door's wall.
 * "Not set" (with the missing fields) when the unit width is blank. Counts are never guessed.
 */
export function fillWall(e: Enclosure, wall: WallSide, spec: RackSpec, bottle: BottleProfileId, idPrefix = wall.toLowerCase()): { status: 'OK'; runs: RackRun[] } | { status: 'NOT_SET'; missing: string[] } {
  if (spec.unitWidthMm === null) return { status: 'NOT_SET', missing: ['unit width'] };
  const { widthMm: iw, depthMm: id } = internalSize(e);
  const len = alongLength(wall, iw, id);
  const o = doorOpening(e);
  const spans: Array<[number, number]> = wall === o.wall ? [[0, Math.max(0, o.aMm)], [Math.min(len, o.bMm), len]] : [[0, len]];
  const runs: RackRun[] = [];
  spans.forEach(([a, b], i) => {
    const units = Math.floor((b - a) / spec.unitWidthMm!);
    if (units > 0) runs.push({ id: `${idPrefix}-${i + 1}`, wall, startMm: a, units, spec, bottle });
  });
  return { status: 'OK', runs };
}
