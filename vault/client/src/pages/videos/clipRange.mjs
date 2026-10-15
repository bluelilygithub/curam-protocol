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
