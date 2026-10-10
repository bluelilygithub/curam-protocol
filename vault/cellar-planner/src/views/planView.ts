import { doorLayout, doorLeafWidthMm, internalSize } from '../enclosure/enclosure';
import type { Enclosure, WallKind, WallSide } from '../enclosure/types';
import type { Issue } from '../engine/types';
import { doorLeaves, doorOpening, footprint, wallPoint, type RackLayoutAnalysis, type RackRun } from '../placement/placement';
import type { Prim, Tone } from './primitives';

// The 2D plan: the enclosure from above, in outer-face millimetres (0, 0 is the outside north-west corner), y down. Pure: a list of drawing
// primitives, so it is tested without a browser and can later feed the drawing package.

const toneOfWall = (k: WallKind): Tone => (k === 'GLASS' ? 'glass' : k === 'STUD' ? 'stud' : 'panel');

export interface PlanOptions {
  /** Minimum walkway; blank draws no landing zone (as it runs no landing check). */
  walkwayMm?: number | null;
  /** Run ids with an error, drawn in the issue tone. */
  badRuns?: Set<string>;
  /** Label each run with its bottle count only (no run id or unit count), for people who do not know what a run is. */
  plainLabels?: boolean;
}

/** Number of bottles text for a run: the count, or "not set". */
const bottleText = (a: RackLayoutAnalysis | undefined, id: string): string => {
  const c = a?.runs.find((r) => r.runId === id)?.capacity;
  return c && c.status === 'OK' ? `${c.capacity} bottles` : 'not set';
};

export function planView(e: Enclosure, runs: RackRun[], analysis?: RackLayoutAnalysis, opts: PlanOptions = {}): Prim[] {
  const out: Prim[] = [];
  const W = e.outerWidthMm, D = e.outerDepthMm;
  const nB = e.walls.NORTH.buildUpMm, sB = e.walls.SOUTH.buildUpMm, wB = e.walls.WEST.buildUpMm, eB = e.walls.EAST.buildUpMm;
  const inner = internalSize(e);
  /** Inside coordinates to outer-face coordinates. */
  const o = (x: number, y: number): [number, number] => [x + wB, y + nB];

  // the inside, then the four walls as bands (north and south full width, east and west between them)
  out.push({ kind: 'rect', x: wB, y: nB, w: inner.widthMm, h: inner.depthMm, tone: 'inside' });
  out.push({ kind: 'rect', x: 0, y: 0, w: W, h: nB, tone: toneOfWall(e.walls.NORTH.kind), label: 'NORTH' });
  out.push({ kind: 'rect', x: 0, y: D - sB, w: W, h: sB, tone: toneOfWall(e.walls.SOUTH.kind), label: 'SOUTH' });
  out.push({ kind: 'rect', x: 0, y: nB, w: wB, h: D - nB - sB, tone: toneOfWall(e.walls.WEST.kind), label: 'WEST' });
  out.push({ kind: 'rect', x: W - eB, y: nB, w: eB, h: D - nB - sB, tone: toneOfWall(e.walls.EAST.kind), label: 'EAST' });

  // the door: an opening in its wall, the open leaf, and the arc it sweeps
  const open = doorOpening(e);
  const side: WallSide = open.wall;
  const wallBuild = e.walls[side].buildUpMm;
  const corner = (s: number, d: number): [number, number] => { const p = wallPoint(e, side, s, d); return o(p.x, p.y); };
  const [ax, ay] = corner(open.aMm, 0), [bx, by] = corner(open.bMm, -wallBuild);
  out.push({ kind: 'rect', x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax) || wallBuild, h: Math.abs(by - ay) || wallBuild, tone: 'door', label: 'DOOR' });
  const inward = e.door.swing === 'IN';
  const dc = inward ? 0 : -wallBuild; // the leaf turns on the inner face when it opens in, the outer face when it opens out
  const perp = inward ? 1 : -1;
  // each leaf sweeps a quarter circle about its hinge: one for a single door, two (meeting in the middle) for a double door
  for (const leaf of doorLeaves(e)) {
    const along = Math.sign(leaf.otherMm - leaf.hingeMm), r = leaf.radiusMm;
    const arc: number[] = [];
    for (let i = 0; i <= 24; i++) { const t = (i / 24) * (Math.PI / 2); const p = corner(leaf.hingeMm + along * r * Math.cos(t), dc + perp * r * Math.sin(t)); arc.push(p[0], p[1]); }
    out.push({ kind: 'poly', pts: arc, tone: 'door', dash: true });
    const h0 = corner(leaf.hingeMm, dc), h1 = corner(leaf.hingeMm, dc + perp * r);
    out.push({ kind: 'poly', pts: [h0[0], h0[1], h1[0], h1[1]], tone: 'door' });
  }

  // the floor kept clear inside a door that opens in (only when a minimum walkway is set)
  if (inward && opts.walkwayMm) {
    const p0 = wallPoint(e, side, open.aMm, 0), p1 = wallPoint(e, side, open.bMm, opts.walkwayMm);
    const [x0, y0] = o(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y)), [x1, y1] = o(Math.max(p0.x, p1.x), Math.max(p0.y, p1.y));
    out.push({ kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, tone: 'zone', dash: true, label: 'keep clear' });
  }

  // rack runs
  for (const run of runs) {
    const fp = analysis?.runs.find((x) => x.runId === run.id)?.footprint;
    if (fp?.status === 'OK') {
      const [x, y] = o(fp.rect.x0, fp.rect.y0);
      const bad = opts.badRuns?.has(run.id);
      const count = bottleText(analysis, run.id);
      const n = count.replace(' bottles', '');
      // the full label names the run; when a small run cannot fit it, the count alone is better than no label (the drawing says what it holds)
      const label = opts.plainLabels ? (bad ? 'not counted' : count) : `${run.id}: ${run.units} ${run.units === 1 ? 'unit' : 'units'}, ${bad ? 'not counted (has an error)' : count}`;
      const shortLabels = bad ? ['not counted', '!'] : opts.plainLabels ? [n] : [count, n];
      out.push({ kind: 'rect', x, y, w: fp.rect.x1 - fp.rect.x0, h: fp.rect.y1 - fp.rect.y0, tone: bad ? 'rackIssue' : 'rack', label, shortLabels });
    } else if (fp?.status === 'NOT_SET') {
      const mid = wallPoint(e, run.wall, 0, 0);
      const [tx, ty] = o(mid.x, mid.y);
      out.push({ kind: 'text', x: tx + 60, y: ty + (run.wall === 'SOUTH' ? -60 : 60), text: `${run.id}: size not set`, tone: 'muted', size: 11 });
    }
  }

  // dimensions: outer width and depth, the door wall split, and the inside size
  out.push({ kind: 'dim', x1: 0, y1: 0, x2: W, y2: 0, offset: -350, text: `${W}` });
  out.push({ kind: 'dim', x1: 0, y1: D, x2: 0, y2: 0, offset: -350, text: `${D}` });
  const lay = doorLayout(e);
  const startOfWall = side === 'NORTH' || side === 'SOUTH' ? [0, side === 'SOUTH' ? D : 0] : [side === 'WEST' ? 0 : W, 0];
  const dirOfWall = side === 'NORTH' || side === 'SOUTH' ? [1, 0] : [0, 1];
  // on the outside of the door wall; beyond the swing arc when the door opens out. A positive offset is to the right of the direction of travel,
  // which for these west-to-east or north-to-south runs is outward on the south and west walls and inward on the north and east walls.
  const away = inward ? 350 : doorLeafWidthMm(e) + 250;
  const outward = side === 'SOUTH' || side === 'WEST' ? 1 : -1;
  const seg = (from: number, len: number): void => {
    out.push({ kind: 'dim', x1: startOfWall[0] + dirOfWall[0] * from, y1: startOfWall[1] + dirOfWall[1] * from, x2: startOfWall[0] + dirOfWall[0] * (from + len), y2: startOfWall[1] + dirOfWall[1] * (from + len), offset: outward * away, text: `${len}` });
  };
  seg(0, lay.beforeMm); seg(lay.beforeMm, lay.doorMm); seg(lay.beforeMm + lay.doorMm, lay.afterMm);
  out.push({ kind: 'text', x: wB + inner.widthMm / 2, y: nB + inner.depthMm * 0.4, text: `${inner.widthMm} x ${inner.depthMm} inside`, tone: 'muted', size: 13, anchor: 'middle' });
  return out;
}

/** Run ids that have at least one error, for the plan to draw in the issue tone. */
export function badRunIds(issues: Issue[]): Set<string> {
  return new Set(issues.filter((i) => i.severity === 'error' && i.where).map((i) => i.where as string));
}

// ---------------------------------------------------------------- moving runs on the plan

/** Where a run can be picked up on the plan: its rectangle in the plan's own millimetres, and what to say when the pointer rests on it. */
export interface RunHit { id: string; wall: WallSide; x: number; y: number; w: number; h: number; tip: string }

const wallName = (w: WallSide): string => w.charAt(0) + w.slice(1).toLowerCase();
/** The end of a wall a run's start is measured from (west on north/south walls, north on east/west walls). */
export const wallStartName = (w: WallSide): string => (w === 'NORTH' || w === 'SOUTH' ? 'west' : 'north');
export const wallEndName = (w: WallSide): string => (w === 'NORTH' || w === 'SOUTH' ? 'east' : 'south');

/** The pick-up areas of the runs that have a size, in the same millimetres as `planView`. Topmost (last drawn) first. */
export function planRunHits(e: Enclosure, runs: RackRun[], analysis?: RackLayoutAnalysis, bad?: Set<string>): RunHit[] {
  const wB = e.walls.WEST.buildUpMm, nB = e.walls.NORTH.buildUpMm;
  const out: RunHit[] = [];
  for (const run of runs) {
    const fp = analysis?.runs.find((x) => x.runId === run.id)?.footprint;
    if (fp?.status !== 'OK') continue;
    const count = bottleText(analysis, run.id);
    out.push({
      id: run.id, wall: run.wall, x: fp.rect.x0 + wB, y: fp.rect.y0 + nB, w: fp.rect.x1 - fp.rect.x0, h: fp.rect.y1 - fp.rect.y0,
      tip: `${run.id}: ${run.units} ${run.units === 1 ? 'unit' : 'units'}, ${bad?.has(run.id) ? 'not counted (has an error)' : count}. Starts ${run.startMm} mm from the ${wallStartName(run.wall)} end of the ${wallName(run.wall).toLowerCase()} wall. Drag it along the wall to move it.`,
    });
  }
  return out.reverse();
}

/**
 * The outline shown while a run is being dragged: the run where it would land (dashed; red when that place is not allowed), with how far it
 * stands from each end of its wall and what it snaps to. `startMm` is the candidate start along the wall.
 */
export function dragGhost(e: Enclosure, run: RackRun, startMm: number, o: { ok: boolean; snap: string | null; reason?: string }): Prim[] {
  const moved: RackRun = { ...run, startMm };
  const fp = ((): ReturnType<typeof footprint> => footprint(e, moved))();
  if (fp.status !== 'OK') return [];
  const wB = e.walls.WEST.buildUpMm, nB = e.walls.NORTH.buildUpMm;
  const iz = internalSize(e);
  const len = run.wall === 'NORTH' || run.wall === 'SOUTH' ? iz.widthMm : iz.depthMm;
  const x = fp.rect.x0 + wB, y = fp.rect.y0 + nB, w = fp.rect.x1 - fp.rect.x0, h = fp.rect.y1 - fp.rect.y0;
  const gapEnd = Math.max(0, len - startMm - fp.lengthMm);
  const text = [`${startMm} mm from the ${wallStartName(run.wall)} end`, `${gapEnd} mm to the ${wallEndName(run.wall)} end`, ...(o.snap ? [`snaps to ${o.snap}`] : []), ...(o.ok || !o.reason ? [] : [o.reason])].join(' · ');
  // the caption sits on the room side of the run so it is never hidden by the wall
  const tone = o.ok ? 'ink' : 'rackIssue';
  const caption: Prim = run.wall === 'WEST' ? { kind: 'text', x: x + w + 80, y: y + h / 2, text, tone, size: 12, anchor: 'start' }
    : run.wall === 'EAST' ? { kind: 'text', x: x - 80, y: y + h / 2, text, tone, size: 12, anchor: 'end' }
    // along north and south walls the caption starts at the run's edge that has more room, so it never runs over a wall
    : (startMm + fp.lengthMm / 2 < len / 2
      ? { kind: 'text', x, y: run.wall === 'SOUTH' ? y - 70 : y + h + 150, text, tone, size: 12, anchor: 'start' }
      : { kind: 'text', x: x + w, y: run.wall === 'SOUTH' ? y - 70 : y + h + 150, text, tone, size: 12, anchor: 'end' });
  return [{ kind: 'rect', x, y, w, h, tone: o.ok ? 'rack' : 'rackIssue', dash: true }, caption];
}
