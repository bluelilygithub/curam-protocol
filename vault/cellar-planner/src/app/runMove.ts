import type { Issue } from '../engine/types';
import { internalSize } from '../enclosure/enclosure';
import type { WallSide } from '../enclosure/types';
import { doorOpening, footprint } from '../placement';
import { analyseApp, fullRuns, type AppProject, type RunPlacement } from './model';

// Moving a rack run along its wall: where it snaps, and whether a position is acceptable. Pure, so the dragging on the plan and the one-click fixes
// share one set of rules and both are tested without a browser. A position is acceptable when it adds no error for the run (the same checks the
// Checks panel shows); a run that already had errors may move as long as it does not get worse.

/** Inside length of a wall, the direction a run slides in. */
export function alongLength(p: AppProject, wall: WallSide): number {
  const iz = internalSize(p.enclosure);
  return wall === 'NORTH' || wall === 'SOUTH' ? iz.widthMm : iz.depthMm;
}
/** How far in from the wall a run of this wall stands (its depth) is `unitDepthMm`; across the enclosure is the other inside dimension. */
const acrossLength = (p: AppProject, wall: WallSide): number => alongLength(p, wall === 'NORTH' || wall === 'SOUTH' ? 'EAST' : 'NORTH');
export { acrossLength };

export const withRun = (p: AppProject, id: string, patch: Partial<RunPlacement>): AppProject => ({ ...p, runs: p.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

/** The issues that concern this run: its own, and an overlap it is one side of. */
export function issuesForRun(issues: Issue[], id: string): Issue[] {
  return issues.filter((i) => i.where === id || (i.code === 'RUN_OVERLAP' && (i.message.startsWith(`Runs ${id} and `) || i.message.includes(` and ${id} overlap`))));
}
export const errorsForRun = (p: AppProject, id: string): Issue[] => issuesForRun(analyseApp(p).issues, id).filter((i) => i.severity === 'error');

export interface Anchor { at: number; label: string }

/**
 * Positions (the run's start along its wall) worth snapping to: the wall's ends, the door opening's edges, the ends of other runs on the same wall,
 * and clear of runs standing on the walls at either end (a corner: the second run starts after the first one's depth). Null when the run has no size
 * yet (unit width or depth not set): it cannot be placed by position.
 */
export function snapAnchors(p: AppProject, runId: string): Anchor[] | null {
  const run = p.runs.find((r) => r.id === runId);
  if (!run) return null;
  const full = fullRuns(p).find((r) => r.id === runId)!;
  const fp = footprint(p.enclosure, full);
  if (fp.status !== 'OK') return null;
  const len = alongLength(p, run.wall), length = fp.lengthMm;
  const out: Anchor[] = [{ at: 0, label: 'the start of the wall' }, { at: Math.max(0, len - length), label: 'the end of the wall' }];
  const open = doorOpening(p.enclosure);
  if (open.wall === run.wall) { out.push({ at: open.aMm - length, label: 'the door opening' }, { at: open.bMm, label: 'the door opening' }); }
  for (const other of fullRuns(p)) {
    if (other.id === run.id) continue;
    const ofp = footprint(p.enclosure, other);
    if (ofp.status !== 'OK') continue;
    if (other.wall === run.wall) out.push({ at: other.startMm + ofp.lengthMm, label: `the end of ${other.id}` }, { at: other.startMm - length, label: `the start of ${other.id}` });
    else {
      const startSide = run.wall === 'NORTH' || run.wall === 'SOUTH' ? other.wall === 'WEST' : other.wall === 'NORTH';
      const endSide = run.wall === 'NORTH' || run.wall === 'SOUTH' ? other.wall === 'EAST' : other.wall === 'SOUTH';
      if (startSide) out.push({ at: ofp.depthMm, label: `clear of ${other.id}` });
      if (endSide) out.push({ at: len - ofp.depthMm - length, label: `clear of ${other.id}` });
    }
  }
  const max = Math.max(0, len - length);
  // one anchor per position (the first label given wins)
  const seen = new Set<number>();
  return out.filter((x) => x.at >= 0 && x.at <= max).sort((x, y) => x.at - y.at).filter((x) => { const k = Math.round(x.at); if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface SnapResult { startMm: number; snap: string | null }
/** The start the pointer means: within `thresholdMm` of an anchor it snaps to it, otherwise it is the plain millimetre, kept inside the wall. */
export function snapStart(p: AppProject, runId: string, rawMm: number, thresholdMm: number): SnapResult | null {
  const anchors = snapAnchors(p, runId);
  const run = p.runs.find((r) => r.id === runId);
  if (!anchors || !run) return null;
  const full = fullRuns(p).find((r) => r.id === runId)!;
  const fp = footprint(p.enclosure, full);
  if (fp.status !== 'OK') return null;
  const max = Math.max(0, alongLength(p, run.wall) - fp.lengthMm);
  const raw = Math.min(max, Math.max(0, rawMm));
  let best: Anchor | null = null;
  for (const a of anchors) if (Math.abs(a.at - raw) <= thresholdMm && (!best || Math.abs(a.at - raw) < Math.abs(best.at - raw))) best = a;
  return best ? { startMm: Math.round(best.at), snap: best.label } : { startMm: Math.round(raw), snap: null };
}

export interface PlaceResult { project: AppProject; startMm: number; snap: string | null; errors: Issue[]; before: number; ok: boolean }
/** Try the run at a pointer position: where it lands, what is wrong there, and whether that is acceptable (no more errors for this run than it had). */
export function placeRun(p: AppProject, runId: string, rawMm: number, thresholdMm: number): PlaceResult | null {
  const s = snapStart(p, runId, rawMm, thresholdMm);
  if (!s) return null;
  const project = withRun(p, runId, { startMm: s.startMm });
  const errors = errorsForRun(project, runId);
  const before = errorsForRun(p, runId).length;
  return { project, startMm: s.startMm, snap: s.snap, errors, before, ok: errors.length <= before };
}

/** The nearest start (to where the run is now) at which this run, with `units` units, has no error; null when none exists on its wall. */
export function nearestValidStart(p: AppProject, runId: string, units?: number): number | null {
  const run = p.runs.find((r) => r.id === runId);
  if (!run) return null;
  const base = units === undefined ? p : withRun(p, runId, { units });
  const anchors = snapAnchors(base, runId);
  if (!anchors) return null;
  const full = fullRuns(base).find((r) => r.id === runId)!;
  const fp = footprint(base.enclosure, full);
  if (fp.status !== 'OK') return null;
  const max = Math.max(0, alongLength(base, run.wall) - fp.lengthMm);
  const set = new Set<number>(anchors.map((a) => Math.round(a.at)));
  for (let x = 0; x <= max; x += 10) set.add(x);
  set.add(max);
  const order = [...set].sort((a, b) => Math.abs(a - run.startMm) - Math.abs(b - run.startMm) || a - b);
  for (const start of order) if (errorsForRun(withRun(base, runId, { startMm: start }), runId).length === 0) return start;
  return null;
}
