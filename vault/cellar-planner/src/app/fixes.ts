import type { Issue } from '../engine/types';
import { internalSize, wallLengthMm } from '../enclosure/enclosure';
import { analyseApp, type AppProject } from './model';
import { nearestValidStart, withRun } from './runMove';

// One-click fixes for the errors in the Checks panel. A fix is only offered when applying it really removes errors (it is tried on a copy first and the
// error count must go down), so a button never makes a design worse. Each is one undo step. Errors that need a decision (a rack taller than the
// inside, a unit too shallow for the bottle, a spec value) have no fix: the planner will not change a supplier's number for you.

export interface Fix { label: string; detail: string; apply(p: AppProject): AppProject }

const errorCount = (p: AppProject): number => analyseApp(p).issues.filter((i) => i.severity === 'error').length;
const side = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

/** Fixes that move or shorten a run so it stands clear of everything. Tries moving first (nearest good position), then shortening by whole units. */
function fixRun(p: AppProject, id: string): Fix | null {
  const run = p.runs.find((r) => r.id === id);
  if (!run) return null;
  const moved = nearestValidStart(p, id);
  if (moved !== null && moved !== run.startMm) {
    return { label: `Move ${id} to ${moved} mm`, detail: `Slide ${id} along the ${run.wall.toLowerCase()} wall from ${run.startMm} mm to ${moved} mm, the nearest place it fits.`, apply: (q) => withRun(q, id, { startMm: moved }) };
  }
  for (let u = run.units - 1; u >= 1; u--) {
    const s = nearestValidStart(p, id, u);
    if (s !== null) return { label: `Shorten ${id} to ${u} unit${u === 1 ? '' : 's'}`, detail: `Take ${id} down from ${run.units} to ${u} unit${u === 1 ? '' : 's'}, starting at ${s} mm, so it fits.`, apply: (q) => withRun(q, id, { units: u, startMm: s }) };
  }
  return null;
}

function candidate(p: AppProject, issue: Issue): Fix | null {
  const e = p.enclosure;
  switch (issue.code) {
    case 'RUN_OUTSIDE': case 'RUN_ON_DOOR': case 'RUN_IN_DOOR_SWING': case 'DOOR_PATH_BLOCKED':
      return issue.where ? fixRun(p, issue.where) : null;
    case 'RUN_OVERLAP': {
      const m = /^Runs (\S+) and (\S+) overlap/.exec(issue.message);
      const ids = [issue.where, m?.[2], m?.[1]].filter((x): x is string => !!x);
      for (const id of [...new Set(ids)]) { const f = fixRun(p, id); if (f) return f; }
      return null;
    }
    case 'DOOR_TOO_WIDE': {
      const w = wallLengthMm(e, e.door.wall) - 100;
      return w > 0 ? { label: `Make the door ${w} mm wide`, detail: `The widest door that leaves a 50 mm fixed section either side of it on the ${side(e.door.wall)} wall.`, apply: (q) => ({ ...q, enclosure: { ...q.enclosure, door: { ...q.enclosure.door, widthMm: w } } }) } : null;
    }
    case 'DOOR_OFF_WALL':
      return { label: 'Centre the door on its wall', detail: 'Remove the door\'s offset so it sits in the middle of its wall.', apply: (q) => { const { offsetMm: _o, ...door } = q.enclosure.door; void _o; return { ...q, enclosure: { ...q.enclosure, door } }; } };
    case 'DOOR_TOO_TALL': {
      const h = internalSize(e).heightMm;
      return { label: `Make the door ${h} mm tall`, detail: 'The tallest door the inside height allows.', apply: (q) => ({ ...q, enclosure: { ...q.enclosure, door: { ...q.enclosure.door, heightMm: h } } }) };
    }
    case 'HEADER_COMPONENT_OUTSIDE': {
      const c = e.header.find((x) => x.id === issue.where);
      if (!c) return null;
      const x = Math.max(0, Math.min(c.xMm, e.outerWidthMm - c.widthMm)), y = Math.max(0, Math.min(c.yMm, e.headerHeightMm - c.heightMm));
      return x < 0 || y < 0 ? null : { label: `Move ${c.id} inside the header`, detail: `Slide it to ${x} mm across and ${y} mm up, the nearest place inside the header.`, apply: (q) => ({ ...q, enclosure: { ...q.enclosure, header: q.enclosure.header.map((h) => (h.id === c.id ? { ...h, xMm: x, yMm: y } : h)) } }) };
    }
    default:
      return null;
  }
}

/** A fix for this issue, or null when there is none that really helps. Verified on a copy: the design must end up with fewer errors. */
export function suggestFix(p: AppProject, issue: Issue): Fix | null {
  if (issue.severity !== 'error') return null;
  const f = candidate(p, issue);
  if (!f) return null;
  const before = errorCount(p);
  let after: number;
  try { after = errorCount(f.apply(p)); } catch { return null; }
  return after < before ? f : null;
}

/** Apply every fix there is, one after another (each is checked against the design as it now stands). Returns the labels of what was done. */
export function fixAll(p: AppProject, max = 20): { project: AppProject; applied: string[] } {
  let cur = p;
  const applied: string[] = [];
  for (let i = 0; i < max; i++) {
    let did = false;
    for (const issue of analyseApp(cur).issues) {
      const f = suggestFix(cur, issue);
      if (f) { cur = f.apply(cur); applied.push(f.label); did = true; break; }
    }
    if (!did) break;
  }
  return { project: cur, applied };
}
