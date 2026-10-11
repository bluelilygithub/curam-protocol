import type { PlanProfile } from './api';
import { segmentKm, type Line, type Lines, type Pos } from './geo';

/**
 * A route that follows roads (Click mode with "Follow roads" on) is the points you clicked (waypoints) plus one leg between each pair of
 * neighbours. A leg is the road or path between them when it has been routed, or a straight line while it waits, failed, or was chosen
 * to be straight. Everything here is pure: the async routing is in snapRouting.ts, the drawing state in drawing.ts.
 *
 *  routed    the road or path between the two points
 *  straight  a straight line, on purpose (Follow roads was off when the point was clicked)
 *  stale     wants routing; nothing has asked yet
 *  pending   a request is out
 *  failed    the service could not follow a road there (or was out of quota): kept as a straight line, can be tried again
 *  held      one of its ends is being dragged: shown straight until the pointer is released
 */
export type LegState = 'routed' | 'straight' | 'stale' | 'pending' | 'failed' | 'held';

export interface Leg { line: Line; state: LegState; profile: PlanProfile | null }
export interface SnapRoute { wps: Pos[]; legs: Leg[] }

/** The identity of a routing request: the way of travelling and both clicked points (to about 10 cm). */
export const sigOf = (a: Pos, b: Pos, profile: PlanProfile): string => `${profile}|${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`;

export const startRoute = (pos: Pos): SnapRoute => ({ wps: [pos], legs: [] });

function makeLeg(a: Pos, b: Pos, profile: PlanProfile | null): Leg {
  return profile ? { line: [a, b], state: 'stale', profile } : { line: [a, b], state: 'straight', profile: null };
}

/** Where a waypoint is drawn: on the road its legs follow (a click is rarely exactly on one), else where it was clicked. */
export function anchorOf(r: SnapRoute, i: number): Pos {
  const before = r.legs[i - 1];
  if (before && before.state === 'routed') return before.line[before.line.length - 1];
  const after = r.legs[i];
  if (after && after.state === 'routed') return after.line[0];
  return r.wps[i];
}

/** The whole route as one line (the legs joined; a repeated joining point is dropped). */
export function linesOf(r: SnapRoute): Lines {
  if (!r.wps.length) return [];
  const out: Line = [anchorOf(r, 0)];
  r.legs.forEach((leg, i) => {
    const line = leg.state === 'routed' ? leg.line : [anchorOf(r, i), anchorOf(r, i + 1)];
    for (const p of line) { const last = out[out.length - 1]; if (segmentKm(last, p) > 0.0005) out.push(p); }
  });
  return [out];
}

/** The line to draw for one leg (a leg that is not routed yet is a straight line between where its two ends are drawn). */
export const legLine = (r: SnapRoute, i: number): Line => (r.legs[i].state === 'routed' ? r.legs[i].line : [anchorOf(r, i), anchorOf(r, i + 1)]);

export function addWaypoint(r: SnapRoute, pos: Pos, profile: PlanProfile | null): SnapRoute {
  const last = r.wps[r.wps.length - 1];
  return { wps: [...r.wps, pos], legs: [...r.legs, makeLeg(last, pos, profile)] };
}

/** Move a waypoint: the legs on either side become straight lines (held) until the pointer is released and they are routed again. */
export function moveWaypoint(r: SnapRoute, i: number, pos: Pos): SnapRoute {
  if (i < 0 || i >= r.wps.length) return r;
  const wps = r.wps.map((p, j) => (j === i ? pos : p));
  const legs = r.legs.map((leg, j) => {
    if (j !== i - 1 && j !== i) return leg;
    return { line: [j === i - 1 ? anchorOf(r, j) : pos, j === i - 1 ? pos : anchorOf(r, j + 1)], state: leg.profile ? 'held' : 'straight', profile: leg.profile } as Leg;
  });
  return { wps, legs };
}

/** The pointer was released: legs that were held are routed again. */
export const releaseHeld = (r: SnapRoute): SnapRoute => (r.legs.some((l) => l.state === 'held')
  ? { wps: r.wps, legs: r.legs.map((l) => (l.state === 'held' ? { ...l, state: 'stale' as const } : l)) }
  : r);

/**
 * Add a waypoint in the middle of leg `li` (it is split in two, each routed again with the same way of travelling). With `held` the two
 * new legs wait until the pointer is released: the point is being dragged on from where it was added, so a road to where it started would be wasted.
 */
export function insertWaypoint(r: SnapRoute, li: number, pos: Pos, held = false): SnapRoute {
  const leg = r.legs[li];
  if (!leg) return r;
  const a = r.wps[li];
  const b = r.wps[li + 1];
  const wps = [...r.wps.slice(0, li + 1), pos, ...r.wps.slice(li + 1)];
  const hold = (l: Leg): Leg => (held && l.state === 'stale' ? { ...l, state: 'held' } : l);
  const legs = [...r.legs.slice(0, li), hold(makeLeg(a, pos, leg.profile)), hold(makeLeg(pos, b, leg.profile)), ...r.legs.slice(li + 1)];
  return { wps, legs };
}

/** Delete a waypoint. The two legs beside it become one, routed again. A route keeps at least two waypoints: null if that would break it. */
export function deleteWaypoint(r: SnapRoute, i: number): SnapRoute | null {
  if (r.wps.length <= 2 || i < 0 || i >= r.wps.length) return null;
  if (i === 0) return { wps: r.wps.slice(1), legs: r.legs.slice(1) };
  if (i === r.wps.length - 1) return { wps: r.wps.slice(0, -1), legs: r.legs.slice(0, -1) };
  const profile = r.legs[i - 1].profile ?? r.legs[i].profile;
  const merged = makeLeg(r.wps[i - 1], r.wps[i + 1], profile);
  return { wps: [...r.wps.slice(0, i), ...r.wps.slice(i + 1)], legs: [...r.legs.slice(0, i - 1), merged, ...r.legs.slice(i + 1)] };
}

/** Back to the start: a leg from the last waypoint to the first (null if the route already ends at its start). */
export function closeLoop(r: SnapRoute, profile: PlanProfile | null): SnapRoute | null {
  if (r.wps.length < 2) return null;
  const last = r.wps.length - 1;
  // already back at the start: the clicks are on the same spot, or the roads end on the same spot (a click is rarely exactly on a road)
  if (segmentKm(r.wps[last], r.wps[0]) < 0.001 || segmentKm(anchorOf(r, last), anchorOf(r, 0)) < 0.003) return null;
  return addWaypoint(r, r.wps[0], profile);
}

/** Retrace the route in reverse: the waypoints and the legs, mirrored, after the end (the turnaround point is shared). Routed legs stay routed. */
export function outAndBack(r: SnapRoute): SnapRoute | null {
  if (r.wps.length < 2) return null;
  const back = r.legs.slice().reverse().map((l) => ({ ...l, line: l.line.slice().reverse(), state: l.state === 'pending' || l.state === 'held' ? 'stale' as const : l.state }));
  return { wps: [...r.wps, ...r.wps.slice(0, -1).reverse()], legs: [...r.legs, ...back] };
}

export interface Wanted { index: number; sig: string; from: Pos; to: Pos; profile: PlanProfile }
/** The legs that still need routing (waiting, or marked as sent). */
export function wanted(r: SnapRoute): Wanted[] {
  const out: Wanted[] = [];
  r.legs.forEach((l, i) => {
    if ((l.state === 'stale' || l.state === 'pending') && l.profile) out.push({ index: i, sig: sigOf(r.wps[i], r.wps[i + 1], l.profile), from: r.wps[i], to: r.wps[i + 1], profile: l.profile });
  });
  return out;
}

/** Legs waiting to be asked for become pending (their requests are out). */
export function markPending(r: SnapRoute, sigs: Set<string>): SnapRoute {
  let changed = false;
  const legs = r.legs.map((l, i) => {
    if (l.state === 'stale' && l.profile && sigs.has(sigOf(r.wps[i], r.wps[i + 1], l.profile))) { changed = true; return { ...l, state: 'pending' as const }; }
    return l;
  });
  return changed ? { wps: r.wps, legs } : r;
}

const matches = (r: SnapRoute, i: number, sig: string): boolean => {
  const l = r.legs[i];
  return !!l.profile && sigOf(r.wps[i], r.wps[i + 1], l.profile) === sig;
};

/** An answer arrived: every leg with that identity that was waiting for it takes the road. */
export function applyLeg(r: SnapRoute, sig: string, line: Line): SnapRoute {
  let changed = false;
  const legs = r.legs.map((l, i) => {
    if ((l.state === 'stale' || l.state === 'pending' || l.state === 'failed') && matches(r, i, sig)) { changed = true; return { ...l, line, state: 'routed' as const }; }
    return l;
  });
  return changed ? { wps: r.wps, legs } : r;
}

/** The service could not follow a road there: the leg stays a straight line, marked as failed. */
export function failLeg(r: SnapRoute, sig: string): SnapRoute {
  let changed = false;
  const legs = r.legs.map((l, i) => {
    if ((l.state === 'stale' || l.state === 'pending') && matches(r, i, sig)) { changed = true; return { ...l, state: 'failed' as const }; }
    return l;
  });
  return changed ? { wps: r.wps, legs } : r;
}

/** Try the failed legs again. */
export const retryFailed = (r: SnapRoute): SnapRoute => (r.legs.some((l) => l.state === 'failed')
  ? { wps: r.wps, legs: r.legs.map((l) => (l.state === 'failed' ? { ...l, state: 'stale' as const } : l)) }
  : r);

export interface SnapCounts { waiting: number; failed: number; routed: number; straight: number }
export function counts(r: SnapRoute): SnapCounts {
  const c = { waiting: 0, failed: 0, routed: 0, straight: 0 };
  for (const l of r.legs) {
    if (l.state === 'stale' || l.state === 'pending' || l.state === 'held') c.waiting += 1;
    else if (l.state === 'failed') c.failed += 1;
    else if (l.state === 'routed') c.routed += 1;
    else c.straight += 1;
  }
  return c;
}

/** The point half way along a leg's line (where its "add a point here" dot goes). */
export function midOfLine(line: Line): Pos {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += segmentKm(line[i - 1], line[i]);
  let walked = 0;
  for (let i = 1; i < line.length; i += 1) {
    const len = segmentKm(line[i - 1], line[i]);
    if (len > 0 && walked + len >= total / 2) {
      const t = (total / 2 - walked) / len;
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
    }
    walked += len;
  }
  return line[0];
}

export type SnapHit = { kind: 'vertex'; wi: number } | { kind: 'mid'; li: number; pos: Pos };

/** What a press grabs on a road-following route: the nearest waypoint within hitPx, else the middle dot of a long-enough leg. */
export function hitTestSnap(r: SnapRoute, project: (p: Pos) => { x: number; y: number }, at: { x: number; y: number }, hitPx: number, minMidPx = 28, mids = true): SnapHit | null {
  const d = (p: Pos): number => { const q = project(p); return Math.hypot(q.x - at.x, q.y - at.y); };
  let best: SnapHit | null = null;
  let bestD = hitPx;
  r.wps.forEach((_, i) => { const dd = d(anchorOf(r, i)); if (dd <= bestD) { bestD = dd; best = { kind: 'vertex', wi: i }; } });
  if (best || !mids) return best;
  bestD = hitPx;
  r.legs.forEach((_, i) => {
    const a = project(anchorOf(r, i));
    const b = project(anchorOf(r, i + 1));
    if (Math.hypot(a.x - b.x, a.y - b.y) < minMidPx) return;
    const pos = midOfLine(legLine(r, i));
    const dd = d(pos);
    if (dd <= bestD) { bestD = dd; best = { kind: 'mid', li: i, pos }; }
  });
  return best;
}
