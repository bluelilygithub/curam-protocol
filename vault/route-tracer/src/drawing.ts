import type { Line, Lines, Pos } from './geo';
import { simplifyLine } from './geo';

/** Pure drawing state. The pointer handling in useDrawing.ts only feeds these functions, so the rules are unit-tested. */
export type DrawMode = 'freehand' | 'click';

export const MIN_POINT_PX = 4; // freehand: keep a point only if it is this far (screen px) from the last kept one
export const JOIN_PX = 24; // a new stroke starting this close to the last stroke's end continues that line
export const TAP_PX = 6; // a press that moves more than this is a drag, not a click

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
