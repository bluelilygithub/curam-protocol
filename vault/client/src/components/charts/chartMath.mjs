// Geometry and small sums for charts. Pure, no React, nothing tool-specific.

const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The scale for a zero-centred chart: the largest absolute value (ticks included), never below `floor`. */
export function maxAbsOf(values, floor = 1) {
  return Math.max(floor, ...values.map(num).filter((v) => v != null).map(Math.abs));
}

/** Where a value sits on a zero-centred track, as % from the left (0 is 50%). Clamped to the track. */
export function positionPct(value, maxAbs) {
  const v = num(value);
  if (v == null || !(maxAbs > 0)) return 50;
  return 50 + (clamp(v, -maxAbs, maxAbs) / maxAbs) * 50;
}

/** A bar from zero to `value` on a zero-centred track: { left, width } in %. Non-zero bars get at least `minWidth` so they show. */
export function divergingBar(value, maxAbs, minWidth = 1) {
  const v = num(value);
  if (v == null || v === 0 || !(maxAbs > 0)) return { left: 50, width: 0 };
  const width = Math.max(minWidth, (Math.min(Math.abs(v), maxAbs) / maxAbs) * 50);
  return v > 0 ? { left: 50, width } : { left: 50 - width, width };
}

/** within / near / past for a fall measured as a positive size (8 = 8% off) against a trigger (10) with a `proximity` margin. */
export function thresholdStatus(size, trigger, proximity) {
  const v = num(size);
  if (v == null) return 'within';
  if (v >= trigger) return 'past';
  if (v >= trigger - proximity) return 'near';
  return 'within';
}

/** Bar width and trigger line for a threshold chart, both in % of the track. The scale reaches past the trigger so the line is never at the edge. */
export function thresholdBar(size, trigger, scaleMax) {
  const max = Math.max(scaleMax || 0, trigger * 1.5);
  const v = Math.max(0, num(size) ?? 0);
  return { width: clamp((v / max) * 100, 0, 100), triggerAt: (trigger / max) * 100 };
}

/** Change from the first to the last usable point of `key`: { first, last, change, pct } or null with fewer than two points. */
export function changeOverRange(points, key) {
  const vals = (points || []).map((p) => num(p?.[key])).filter((v) => v != null);
  if (vals.length < 2) return null;
  const first = vals[0];
  const last = vals[vals.length - 1];
  return { first, last, change: last - first, pct: first ? ((last - first) / Math.abs(first)) * 100 : null };
}

/** Cards that only make sense for some ranges. Over 7d and longer the trailing return is the same window as Movers, so it shows on Today only. */
export function cardsForRange(range) {
  return { trailingReturn: range === 'today' };
}
