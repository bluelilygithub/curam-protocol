import { internalSize } from '../enclosure/enclosure';
import type { Enclosure, WallSide } from '../enclosure/types';
import { profileOf } from '../engine/defaults';
import type { BottleProfileId } from '../engine/types';
import { doorOpening, type RackLayoutAnalysis, type RackRun } from '../placement/placement';
import type { Prim } from './primitives';

// The racks seen from INSIDE the enclosure, facing one wall: each unit with its bottles as circles (end-on, neck-out: the bottle lies along the
// depth) at true size and spacing. Label-forward bottles lie side-on and are drawn as side-view rectangles instead. x runs left to right as the viewer sees it, y down from the inside ceiling to the floor. Facing the south or west
// wall from inside, the wall's start is on the viewer's right, so those walls are drawn mirrored.

export interface RackFaceOptions {
  /** Run ids with an error: their bottles are drawn in the issue tone and labelled "not counted", as the total leaves them out. */
  badRuns?: Set<string>;
}

const wallLen = (e: Enclosure, w: WallSide): number => { const i = internalSize(e); return w === 'NORTH' || w === 'SOUTH' ? i.widthMm : i.depthMm; };

export function rackFaceView(e: Enclosure, runs: RackRun[], analysis: RackLayoutAnalysis | undefined, wall: WallSide, bottle: BottleProfileId, opts: RackFaceOptions = {}): Prim[] {
  const out: Prim[] = [];
  const inner = internalSize(e);
  const L = wallLen(e, wall), H = inner.heightMm;
  const mirrored = wall === 'SOUTH' || wall === 'WEST';
  const viewX = (s: number, width: number): number => (mirrored ? L - s - width : s);
  const dia = profileOf(bottle).diameterMm;

  out.push({ kind: 'rect', x: 0, y: 0, w: L, h: H, tone: 'inside', label: `INSIDE ${wall}` });

  // the door's opening, when this wall carries the door
  const open = doorOpening(e);
  if (open.wall === wall) {
    const w = open.bMm - open.aMm;
    out.push({ kind: 'rect', x: viewX(open.aMm, w), y: H - e.door.heightMm, w, h: e.door.heightMm, tone: 'door', dash: true, label: 'DOOR' });
  }

  for (const run of runs.filter((r) => r.wall === wall)) {
    const fp = analysis?.runs.find((x) => x.runId === run.id);
    const spec = run.spec;
    if (spec.unitWidthMm === null) {
      out.push({ kind: 'text', x: viewX(run.startMm, 0) + 20, y: H - 40, text: `${run.id}: unit width not set`, tone: 'muted', size: 11 });
      continue;
    }
    const uw = spec.unitWidthMm;
    const bad = opts.badRuns?.has(run.id) ?? false;
    const cap = fp?.capacity;
    const unitH = spec.unitHeightMm ?? (cap && cap.status === 'OK' ? cap.rowsPerUnit * (spec.rowPitchMm ?? 0) : 0);
    for (let k = 0; k < run.units; k++) {
      const x0 = viewX(run.startMm + k * uw, uw);
      if (cap?.status !== 'OK') {
        // a unit with values still missing: its outline only, never bottles guessed into it
        out.push({ kind: 'rect', x: x0, y: H - (unitH || H * 0.9), w: uw, h: unitH || H * 0.9, tone: 'rack', dash: true, label: `${run.id}: not set` });
        continue;
      }
      const rows = cap.rowsPerUnit, per = cap.bottlesPerRow;
      const frameH = spec.unitHeightMm ?? rows * (spec.rowPitchMm ?? 0);
      out.push({ kind: 'rect', x: x0, y: H - frameH, w: uw, h: frameH, tone: bad ? 'rackIssue' : 'rack', label: k === 0 ? `${run.id}: ${bad ? 'not counted (has an error)' : `${cap.capacity / run.units} bottles a unit`}` : undefined });
      const gapY = spec.rowsPerUnit ? frameH / rows : (spec.rowPitchMm ?? frameH / rows);
      const r = dia / 2;
      const sideOn = spec.orientation === 'LABEL_FORWARD';
      const slot = uw / per;
      for (let j = 0; j < rows; j++) {
        const cy = H - (j + 0.5) * gapY;
        for (let i = 0; i < per; i++) {
          const cx = x0 + (i + 0.5) * slot;
          if (sideOn) {
            // lying side-on: as long as the bottle, but never wider than its own slot
            const w = Math.min(profileOf(bottle).lengthMm, slot * 0.96);
            out.push({ kind: 'rect', x: cx - w / 2, y: cy - r, w, h: dia, tone: bad ? 'rackIssue' : 'bottle' });
          } else out.push({ kind: 'circle', cx, cy, r, tone: bad ? 'rackIssue' : 'bottle' });
        }
      }
    }
  }

  out.push({ kind: 'dim', x1: 0, y1: H, x2: L, y2: H, offset: 220, text: `${L}` });
  out.push({ kind: 'dim', x1: 0, y1: 0, x2: 0, y2: H, offset: 220, text: `${H}` });
  return out;
}

/** How many bottle circles a view should contain: every counted or left-out bottle in the runs on that wall that have all their values. */
export function bottlesOnWall(analysis: RackLayoutAnalysis, runs: RackRun[], wall: WallSide): number {
  let n = 0;
  for (const run of runs.filter((r) => r.wall === wall)) { const c = analysis.runs.find((x) => x.runId === run.id)?.capacity; if (c?.status === 'OK') n += c.capacity; }
  return n;
}
