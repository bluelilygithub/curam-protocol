import type { Line, Lines, Pos } from './geo';
import { simplifyLine } from './geo';

/** Pure drawing state. The pointer handling in useDrawing.ts only feeds these functions, so the rules are unit-tested. */
export type DrawMode = 'freehand' | 'click' | 'edit';

export const MIN_POINT_PX = 4; // freehand: keep a point only if it is this far (screen px) from the last kept one
export const JOIN_PX = 24; // a new stroke starting this close to the last stroke's end continues that line
export const TAP_PX = 6; // a press that moves more than this is a drag, not a click
export const HIT_PX = 14; // edit mode: a press this close (screen px) to a point grabs it (touch uses HIT_TOUCH_PX)
export const HIT_TOUCH_PX = 22;
export const MIN_MID_PX = 28; // edit mode: a segment shorter than this on screen gets no "add a point" handle

export interface DrawState {
  /** Committed lines, one per stroke group. */
  lines: Lines;
  /** One snapshot per undo step (structural sharing: lines are never mutated). */
  history: Lines[];
  /** The freehand stroke being drawn right now (not yet simplified), or null. */
  active: Line | null;
  /** True when `active` extends the last committed line instead of starting a new one. */
  continuing: boolean;
}

export const emptyDraw = (): DrawState => ({ lines: [], history: [], active: null, continuing: false });

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
  return { lines, history: [...s.history, before], active: null, continuing: false };
}

/** Click mode: add a vertex to the current line. */
export function addVertex(s: DrawState, p: Pos): DrawState {
  const last = s.lines[s.lines.length - 1];
  const lines = last ? [...s.lines.slice(0, -1), [...last, p]] : [[p]];
  return { ...s, lines, history: [...s.history, s.lines] };
}

/** Undo exactly one step: one freehand stroke, or one click-mode point. */
export function undo(s: DrawState): DrawState {
  if (s.active) return cancelStroke(s);
  if (!s.history.length) return s;
  return { ...s, lines: s.history[s.history.length - 1], history: s.history.slice(0, -1) };
}

/** Lines worth saving: a click-mode line with a single point is only a start marker. */
export const finish = (s: DrawState): Lines => s.lines.filter((l) => l.length >= 2);

/** Start from an existing track (Extend). The first undo step returns to the track as it was. */
export const fromLines = (lines: Lines): DrawState => ({ ...emptyDraw(), lines });

// ---- edit mode: move, add and delete points on lines that already exist --------------------------------------------------------

export interface VertexRef { li: number; vi: number }
export type Hit = (VertexRef & { kind: 'vertex' }) | (VertexRef & { kind: 'mid'; pos: Pos });

/** Midpoint of a segment in lng/lat: where the "add a point" handle sits (and what a new point starts as). */
export const midOf = (a: Pos, b: Pos): Pos => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** One undo step: the lines as they are now. Edit mode takes it once when a drag really starts. */
export const pushHistory = (s: DrawState): DrawState => ({ ...s, history: [...s.history, s.lines] });

/** Move a point. No undo step of its own (a drag calls this many times after one pushHistory). */
export function setVertex(s: DrawState, { li, vi }: VertexRef, p: Pos): DrawState {
  if (!s.lines[li]?.[vi]) return s;
  return { ...s, lines: s.lines.map((l, i) => (i === li ? l.map((q, j) => (j === vi ? p : q)) : l)) };
}

/** Add a point so it becomes index `vi` of line `li` (between the points that were at vi - 1 and vi). One undo step. */
export function insertVertex(s: DrawState, { li, vi }: VertexRef, p: Pos): DrawState {
  const line = s.lines[li];
  if (!line || vi < 1 || vi > line.length) return s;
  const next = [...line.slice(0, vi), p, ...line.slice(vi)];
  return { ...s, lines: s.lines.map((l, i) => (i === li ? next : l)), history: [...s.history, s.lines] };
}

/** Delete a point (one undo step). A stroke keeps at least two points: returns null when that would break it. */
export function deleteVertex(s: DrawState, { li, vi }: VertexRef): DrawState | null {
  const line = s.lines[li];
  if (!line || vi < 0 || vi >= line.length || line.length <= 2) return null;
  const next = line.filter((_, j) => j !== vi);
  return { ...s, lines: s.lines.map((l, i) => (i === li ? next : l)), history: [...s.history, s.lines] };
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
