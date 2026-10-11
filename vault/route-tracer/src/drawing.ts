import type { PlanProfile } from './api';
import type { Line, Lines, Pos } from './geo';
import { MAX_POINTS, pointCount, segmentKm, simplifyLine } from './geo';
import * as snap from './snap';
import type { SnapRoute } from './snap';

/** Pure drawing state. The pointer handling in useDrawing.ts only feeds these functions, so the rules are unit-tested. */
export type DrawMode = 'freehand' | 'click' | 'edit';

export const MIN_POINT_PX = 4; // freehand: keep a point only if it is this far (screen px) from the last kept one
export const JOIN_PX = 24; // a new stroke starting this close to the last stroke's end continues that line
export const TAP_PX = 6; // a press that moves more than this is a drag, not a click
export const HIT_PX = 14; // edit mode: a press this close (screen px) to a point grabs it (touch uses HIT_TOUCH_PX)
export const HIT_TOUCH_PX = 22;
export const MIN_MID_PX = 28; // edit mode: a segment shorter than this on screen gets no "add a point" handle

/** One undo step: the lines, and the road-following route behind them if there is one. */
export interface Snapshot { lines: Lines; snap: SnapRoute | null }

export interface DrawState {
  /** Committed lines, one per stroke group. For a road-following route this is the route drawn as one line (kept in step with `snap`). */
  lines: Lines;
  /** The points clicked and the road between each pair, when Follow roads is in use. Null for an ordinary line. */
  snap: SnapRoute | null;
  /** One snapshot per undo step (structural sharing: nothing is ever mutated). */
  history: Snapshot[];
  /** The freehand stroke being drawn right now (not yet simplified), or null. */
  active: Line | null;
  /** True when `active` extends the last committed line instead of starting a new one. */
  continuing: boolean;
}

export const emptyDraw = (): DrawState => ({ lines: [], snap: null, history: [], active: null, continuing: false });

const snapshot = (s: DrawState): Snapshot => ({ lines: s.lines, snap: s.snap });

export const hasWork = (s: DrawState): boolean => s.lines.length > 0 || (s.active?.length ?? 0) > 1;

/** What to draw and measure right now: committed lines plus the live stroke (joined onto the last line when continuing). */
export function displayLines(s: DrawState): Lines {
  if (!s.active) return s.lines;
  if (s.continuing && s.lines.length) {
    const last = s.lines[s.lines.length - 1];
    return [...s.lines.slice(0, -1), [...last, ...s.active.slice(1)]];
  }
  return [...s.lines, s.active];
}

export const screenDist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Begin a freehand stroke. `nearLastEnd` = the press is within JOIN_PX of the last line's end (the caller measures it on screen). */
export function startStroke(s: DrawState, at: Pos, nearLastEnd: boolean): DrawState {
  const last = s.lines[s.lines.length - 1];
  if (nearLastEnd && last && last.length) return { ...s, active: [last[last.length - 1], at], continuing: true };
  return { ...s, active: [at, at], continuing: false };
}

/** Add a point to the live stroke (the caller applies the MIN_POINT_PX rule on screen first). */
export function extendStroke(s: DrawState, p: Pos): DrawState {
  return s.active ? { ...s, active: [...s.active, p] } : s;
}

/** Throw the live stroke away (a second finger arrived, pointercancel). */
export function cancelStroke(s: DrawState): DrawState {
  return s.active ? { ...s, active: null, continuing: false } : s;
}

/** Finish the live stroke: simplify it and commit as one undo step. A stroke that never moved is dropped. */
export function endStroke(s: DrawState, toleranceDeg: number): DrawState {
  if (!s.active) return s;
  const pts = s.active.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 2) return cancelStroke(s);
  const simple = simplifyLine(pts, toleranceDeg);
  const before = s.lines;
  let lines: Lines;
  if (s.continuing && before.length) {
    const last = before[before.length - 1];
    lines = [...before.slice(0, -1), [...last, ...simple.slice(1)]];
  } else lines = [...before, simple];
  return { lines, snap: null, history: [...s.history, snapshot(s)], active: null, continuing: false }; // a freehand stroke turns a road-following route into a plain line
}

/** Click mode: add a vertex to the current line. */
export function addVertex(s: DrawState, p: Pos): DrawState {
  const last = s.lines[s.lines.length - 1];
  const lines = last ? [...s.lines.slice(0, -1), [...last, p]] : [[p]];
  return { ...s, lines, snap: null, history: [...s.history, snapshot(s)] };
}

/** Undo exactly one step: one freehand stroke, or one click-mode point. */
export function undo(s: DrawState): DrawState {
  if (s.active) return cancelStroke(s);
  if (!s.history.length) return s;
  const back = s.history[s.history.length - 1];
  return { ...s, lines: back.lines, snap: back.snap, history: s.history.slice(0, -1) };
}

/** Lines worth saving: a click-mode line with a single point is only a start marker. */
export const finish = (s: DrawState): Lines => s.lines.filter((l) => l.length >= 2);

/** Start from an existing track (Extend). The first undo step returns to the track as it was. */
export const fromLines = (lines: Lines): DrawState => ({ ...emptyDraw(), lines });

/** Throw everything away (Clear). */
export const cleared = (s: DrawState): DrawState => ({ ...s, lines: [], snap: null, history: [], active: null, continuing: false });

// ---- edit mode: move, add and delete points on lines that already exist --------------------------------------------------------

export interface VertexRef { li: number; vi: number }
export type Hit = (VertexRef & { kind: 'vertex' }) | (VertexRef & { kind: 'mid'; pos: Pos });

/** Midpoint of a segment in lng/lat: where the "add a point" handle sits (and what a new point starts as). */
export const midOf = (a: Pos, b: Pos): Pos => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** One undo step: the lines as they are now. Edit mode takes it once when a drag really starts. */
export const pushHistory = (s: DrawState): DrawState => ({ ...s, history: [...s.history, snapshot(s)] });

/** Move a point. No undo step of its own (a drag calls this many times after one pushHistory). */
export function setVertex(s: DrawState, { li, vi }: VertexRef, p: Pos): DrawState {
  if (!s.lines[li]?.[vi]) return s;
  return { ...s, snap: null, lines: s.lines.map((l, i) => (i === li ? l.map((q, j) => (j === vi ? p : q)) : l)) };
}

/** Add a point so it becomes index `vi` of line `li` (between the points that were at vi - 1 and vi). One undo step. */
export function insertVertex(s: DrawState, { li, vi }: VertexRef, p: Pos): DrawState {
  const line = s.lines[li];
  if (!line || vi < 1 || vi > line.length) return s;
  const next = [...line.slice(0, vi), p, ...line.slice(vi)];
  return { ...s, lines: s.lines.map((l, i) => (i === li ? next : l)), snap: null, history: [...s.history, snapshot(s)] };
}

/** Delete a point (one undo step). A stroke keeps at least two points: returns null when that would break it. */
export function deleteVertex(s: DrawState, { li, vi }: VertexRef): DrawState | null {
  const line = s.lines[li];
  if (!line || vi < 0 || vi >= line.length || line.length <= 2) return null;
  const next = line.filter((_, j) => j !== vi);
  return { ...s, lines: s.lines.map((l, i) => (i === li ? next : l)), snap: null, history: [...s.history, snapshot(s)] };
}

/** What a press at `at` (screen px) grabs: the nearest point within hitPx, else the nearest long-enough segment midpoint, else nothing. */
export function hitTest(
  lines: Lines, project: (p: Pos) => { x: number; y: number }, at: { x: number; y: number }, hitPx: number, minMidPx = MIN_MID_PX,
): Hit | null {
  let best: Hit | null = null;
  let bestD = hitPx;
  lines.forEach((l, li) => l.forEach((p, vi) => {
    const d = screenDist(project(p), at);
    if (d <= bestD) { bestD = d; best = { kind: 'vertex', li, vi }; }
  }));
  if (best) return best;
  bestD = hitPx;
  lines.forEach((l, li) => {
    for (let i = 1; i < l.length; i += 1) {
      const a = project(l[i - 1]);
      const b = project(l[i]);
      if (screenDist(a, b) < minMidPx) continue;
      const mid = midOf(l[i - 1], l[i]);
      const d = screenDist(project(mid), at);
      if (d <= bestD) { bestD = d; best = { kind: 'mid', li, vi: i, pos: mid }; }
    }
  });
  return best;
}

// ---- route shapes: loop and out-and-back ------------------------------------------------------------------------------------

export type Shaped = { ok: true; state: DrawState } | { ok: false; reason: string };

const CLOSED_KM = 0.001; // the end is already within a metre of the start

/** "Return to start": one straight segment from the end of the route back to its first point. One undo step. */
export function closeLoop(s: DrawState, profile: PlanProfile | null = null): Shaped {
  if (s.snap) {
    const next = snap.closeLoop(s.snap, profile);
    if (!next) return { ok: false, reason: s.snap.wps.length < 2 ? 'Draw at least two points first.' : 'The route already ends at its start.' };
    return { ok: true, state: withSnap(s, next, true) };
  }
  const lines = s.lines.filter((l) => l.length > 0);
  const first = lines[0]?.[0];
  const lastLine = lines[lines.length - 1];
  const last = lastLine?.[lastLine.length - 1];
  if (!first || !last || pointCount(lines) < 2) return { ok: false, reason: 'Draw at least two points first.' };
  if (segmentKm(last, first) < CLOSED_KM) return { ok: false, reason: 'The route already ends at its start.' };
  if (pointCount(s.lines) + 1 > MAX_POINTS) return { ok: false, reason: `A track can have at most ${MAX_POINTS} points.` };
  const li = s.lines.lastIndexOf(lastLine);
  return { ok: true, state: { ...s, lines: s.lines.map((l, i) => (i === li ? [...l, first] : l)), history: [...s.history, snapshot(s)] } };
}

/**
 * "Out and back": the route retraced in reverse from its end to its start, so the distance doubles. With several strokes the last
 * stroke carries on straight back and the earlier ones follow, each reversed, in reverse order (the gaps between strokes stay gaps).
 */
export function outAndBack(s: DrawState): Shaped {
  if (s.snap) {
    const next = snap.outAndBack(s.snap);
    if (!next) return { ok: false, reason: 'Draw at least two points first.' };
    const made = withSnap(s, next, true);
    if (pointCount(made.lines) > MAX_POINTS) return { ok: false, reason: `That would make more than ${MAX_POINTS} points. Remove some first.` };
    return { ok: true, state: made };
  }
  const lines = s.lines.filter((l) => l.length >= 2);
  if (!lines.length) return { ok: false, reason: 'Draw at least two points first.' };
  const back = (l: Line): Line => l.slice().reverse();
  const last = lines[lines.length - 1];
  const out: Lines = [
    ...lines.slice(0, -1),
    [...last, ...back(last).slice(1)], // the turnaround point is shared, not repeated
    ...lines.slice(0, -1).reverse().map(back),
  ];
  if (pointCount(out) > MAX_POINTS) return { ok: false, reason: `That would make more than ${MAX_POINTS} points. Remove some first.` };
  return { ok: true, state: { ...s, lines: out, history: [...s.history, snapshot(s)] } };
}

// ---- follow roads: a route made of the points you clicked and the road between each pair -------------------------------------------

/** The state with a new road-following route (its line kept in step), and, if asked, one undo step. */
function withSnap(s: DrawState, next: SnapRoute, push: boolean): DrawState {
  return { ...s, snap: next, lines: snap.linesOf(next), history: push ? [...s.history, snapshot(s)] : s.history };
}

/** Follow roads can start on an empty drawing or carry on a route that already follows roads, not on a plain line. */
export const canSnap = (s: DrawState): boolean => !!s.snap || s.lines.length === 0;

/** A click with Follow roads in use: a new waypoint, and (with a way of travelling) a road to it from the last one. One undo step. */
export function snapClick(s: DrawState, pos: Pos, profile: PlanProfile | null): DrawState {
  if (!canSnap(s)) return s;
  return withSnap(s, s.snap ? snap.addWaypoint(s.snap, pos, profile) : snap.startRoute(pos), true);
}

/** Move a waypoint (a drag calls this many times after one pushHistory). The legs beside it are straight until release. */
export function snapMove(s: DrawState, wi: number, pos: Pos): DrawState {
  return s.snap ? withSnap(s, snap.moveWaypoint(s.snap, wi, pos), false) : s;
}

/** The pointer was released: the legs that were held are routed again. */
export function snapRelease(s: DrawState): DrawState {
  return s.snap ? withSnap(s, snap.releaseHeld(s.snap), false) : s;
}

/** Add a waypoint in the middle of leg `li`. One undo step. */
export function snapInsert(s: DrawState, li: number, pos: Pos, held = false): DrawState {
  return s.snap ? withSnap(s, snap.insertWaypoint(s.snap, li, pos, held), true) : s;
}

/** Delete a waypoint (one undo step); null if the route would be left with fewer than two. */
export function snapDelete(s: DrawState, wi: number): DrawState | null {
  const next = s.snap ? snap.deleteWaypoint(s.snap, wi) : null;
  return next ? withSnap(s, next, true) : null;
}

/** The legs that still need routing, and the bookkeeping as their requests go out and come back. None of these is an undo step. */
export const snapWanted = (s: DrawState): snap.Wanted[] => (s.snap ? snap.wanted(s.snap) : []);
export const snapMarkPending = (s: DrawState, sigs: Set<string>): DrawState => (s.snap ? withSnap(s, snap.markPending(s.snap, sigs), false) : s);
export const snapApply = (s: DrawState, sig: string, line: Line): DrawState => (s.snap ? withSnap(s, snap.applyLeg(s.snap, sig, line), false) : s);
export const snapFail = (s: DrawState, sig: string): DrawState => (s.snap ? withSnap(s, snap.failLeg(s.snap, sig), false) : s);
export const snapRetry = (s: DrawState): DrawState => (s.snap ? withSnap(s, snap.retryFailed(s.snap), false) : s);
export const snapCounts = (s: DrawState): snap.SnapCounts => (s.snap ? snap.counts(s.snap) : { waiting: 0, failed: 0, routed: 0, straight: 0 });
