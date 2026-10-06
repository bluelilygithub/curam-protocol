import { doorLayout, internalSize } from '../enclosure/enclosure';
import type { Enclosure, WallKind, WallSide } from '../enclosure/types';
import type { Issue } from '../engine/types';
import { doorOpening, hingeAt, wallPoint, type RackLayoutAnalysis, type RackRun } from '../placement/placement';
import type { Prim, Tone } from './primitives';

// The 2D plan: the enclosure from above, in outer-face millimetres (0, 0 is the outside north-west corner), y down. Pure: a list of drawing
// primitives, so it is tested without a browser and can later feed the drawing package.

const toneOfWall = (k: WallKind): Tone => (k === 'GLASS' ? 'glass' : k === 'STUD' ? 'stud' : 'panel');

export interface PlanOptions {
  /** Minimum walkway; blank draws no landing zone (as it runs no landing check). */
  walkwayMm?: number | null;
  /** Run ids with an error, drawn in the issue tone. */
  badRuns?: Set<string>;
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
  const hinge = hingeAt(e);
  const other = hinge === open.aMm ? open.bMm : open.aMm;
  const dc = inward ? 0 : -wallBuild; // the leaf turns on the inner face when it opens in, the outer face when it opens out
  const along = Math.sign(other - hinge), perp = inward ? 1 : -1, r = e.door.widthMm;
  const arc: number[] = [];
  for (let i = 0; i <= 24; i++) { const t = (i / 24) * (Math.PI / 2); const p = corner(hinge + along * r * Math.cos(t), dc + perp * r * Math.sin(t)); arc.push(p[0], p[1]); }
  out.push({ kind: 'poly', pts: arc, tone: 'door', dash: true });
  const h0 = corner(hinge, dc), h1 = corner(hinge, dc + perp * r);
  out.push({ kind: 'poly', pts: [h0[0], h0[1], h1[0], h1[1]], tone: 'door' });

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
      out.push({ kind: 'rect', x, y, w: fp.rect.x1 - fp.rect.x0, h: fp.rect.y1 - fp.rect.y0, tone: opts.badRuns?.has(run.id) ? 'rackIssue' : 'rack', label: `${run.id}: ${run.units} units, ${opts.badRuns?.has(run.id) ? 'not counted (has an error)' : bottleText(analysis, run.id)}` });
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
  const away = inward ? 350 : e.door.widthMm + 250;
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
