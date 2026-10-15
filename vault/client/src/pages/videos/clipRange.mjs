// The arithmetic behind the Clip / trim timeline, kept out of the component so it can be tested.
// All times are seconds; markers snap to a tenth of a second.

export const MIN_GAP = 0.1;
export const round1 = (n) => Math.round(n * 10) / 10;

/** Where the start marker may go: not before 0, not within MIN_GAP of the end. */
export function clampStart(t, end) {
  return round1(Math.max(0, Math.min(t, end - MIN_GAP)));
}

/** Where the end marker may go: not past the video, not within MIN_GAP of the start. */
export function clampEnd(t, start, dur) {
  return round1(Math.min(dur, Math.max(t, start + MIN_GAP)));
}

/** A keyboard step: 0.1 s, or 1 s with Shift. */
export function nudge(value, direction, big = false) {
  return round1(Number(value) + direction * (big ? 1 : 0.1));
}

/** Time under the pointer on a track `rect` wide, for a video `dur` long. */
export function timeFromX(clientX, rect, dur) {
  if (!rect || !rect.width || !(dur > 0)) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return round1(ratio * dur);
}

/** Percent along the track. */
export function pct(t, dur) {
  return dur > 0 ? Math.max(0, Math.min(100, (t / dur) * 100)) : 0;
}

/** While previewing the selection: has playback reached the out point? */
export function reachedEnd(current, end) {
  return current >= end - 0.05;
}

/** What the timeline shows given the page's raw state (the end box is text, and empty means "to the end"). */
export function normalizeRange(startSec, endSec, duration) {
  const dur = Math.max(0, Number(duration) || 0);
  if (!(dur > 0)) return { dur: 0, start: Math.max(0, Number(startSec) || 0), end: Math.max(0, Number(startSec) || 0) + MIN_GAP };
  // The start can be at most MIN_GAP before the end of the video, so the end marker always fits inside it.
  const start = round1(Math.max(0, Math.min(Number(startSec) || 0, Math.max(0, dur - MIN_GAP))));
  const rawEnd = endSec === '' || endSec == null ? dur : Number(endSec);
  const wanted = Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : dur;
  const end = round1(Math.min(dur, Math.max(start + MIN_GAP, wanted)));
  return { dur, start, end };
}

// ---- a fixed-length block (Replace a section): the whole selection slides along the video, its length never changing ----

/** Where a block `blockSec` long may start: never before 0, never so late that it runs past the end of the video. */
export function clampBlockStart(t, blockSec, dur) {
  const latest = Math.max(0, Number(dur) - Number(blockSec));
  return round1(Math.min(latest, Math.max(0, Number(t) || 0)));
}

/**
 * Dragging the block: where it should start, given where the pointer is, and how far into the block it was grabbed
 * (so the block does not jump to put its left edge under the pointer).
 */
export function blockStartFromPointer(pointerSec, grabOffsetSec, blockSec, dur) {
  return clampBlockStart(Number(pointerSec) - Number(grabOffsetSec || 0), blockSec, dur);
}

// ---- zooming: the track shows a window `view = { start, span }` of the video instead of all of it ----

/** The smallest window worth showing: about 3 seconds (or the whole video if it is shorter). */
export const MIN_SPAN = 3;

/** A window kept inside the video: span between MIN_SPAN and the whole video, start so it never runs off either end. */
export function clampView(view, dur) {
  const d = Math.max(0, Number(dur) || 0);
  if (!(d > 0)) return { start: 0, span: 0 };
  const span = Math.min(d, Math.max(Math.min(MIN_SPAN, d), Number(view?.span) || d));
  const start = Math.max(0, Math.min(Number(view?.start) || 0, d - span));
  return { start: Math.round(start * 1000) / 1000, span: Math.round(span * 1000) / 1000 };
}

/** A window `span` long centred on `centerSec`. */
export function viewAround(centerSec, span, dur) {
  return clampView({ start: Number(centerSec) - Number(span) / 2, span }, dur);
}

/** Zoom by `factor` (< 1 zooms in, > 1 zooms out), keeping `centerSec` in the middle. */
export function zoomView(view, factor, centerSec, dur) {
  const cur = clampView(view, dur);
  return viewAround(centerSec, cur.span * factor, dur);
}

/** The whole video. */
export function wholeView(dur) {
  return clampView({ start: 0, span: dur }, dur);
}

/** True when the window shows the entire video. */
export function isWhole(view, dur) {
  return Number(dur) > 0 && view.span >= Number(dur) - 1e-6;
}

/** A window about three times the selection's length, centred on it (the "zoom to selection" button). */
export function viewForSelection(start, end, dur) {
  const len = Math.max(0, Number(end) - Number(start));
  return viewAround((Number(start) + Number(end)) / 2, Math.max(MIN_SPAN, len * 3), dur);
}

/** Moves the window only if [t0, t1] is not fully inside it: centres on the selection if it fits, else starts at t0. */
export function ensureVisible(view, t0, t1, dur) {
  const v = clampView(view, dur);
  if (!(v.span > 0) || (t0 >= v.start - 1e-6 && t1 <= v.start + v.span + 1e-6)) return v;
  if (t1 - t0 <= v.span) return viewAround((t0 + t1) / 2, v.span, dur);
  return clampView({ start: t0, span: v.span }, dur);
}

/** Time under the pointer inside a window. */
export function timeFromXView(clientX, rect, view) {
  if (!rect || !rect.width || !(view?.span > 0)) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return round1(view.start + ratio * view.span);
}

/** Percent along the track for a time (can be below 0 or above 100 when the time is outside the window). */
export function pctView(t, view) {
  return view?.span > 0 ? ((Number(t) - view.start) / view.span) * 100 : 0;
}

/** The part of [t0, t1] that is inside the window, as percents of the track, or null if none of it is. */
export function visiblePct(t0, t1, view) {
  const a = pctView(t0, view);
  const b = pctView(t1, view);
  if (b < 0 || a > 100) return null;
  const left = Math.max(0, a);
  return { left, width: Math.max(0, Math.min(100, b) - left), clippedLeft: a < 0, clippedRight: b > 100 };
}

/** The times the picture strip is taken at: the middle of each of `count` equal tiles of the window. */
export function stripTimes(view, count, dur) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Math.max(0, Math.min(Number(dur) - 0.05, view.start + ((i + 0.5) * view.span) / count)));
  }
  return out;
}

/** The frame shown as "the last frame covered": the one just before `end` (a frame is about 1/25 s). */
export function lastFrameTime(start, end) {
  return Math.round(Math.max(Number(start) || 0, Number(end) - 0.04) * 1000) / 1000;
}
