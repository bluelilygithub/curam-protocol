// Tempo trainer rules, pure code (no browser, no network).

export const MIN_SPEED = 40;
export const MAX_SPEED = 120;
export const START_SPEED = 70;
export const DEFAULT_STEP = 5;
export const DEFAULT_CLEAN_TARGET = 3;

export function clampSpeed(pct) {
  const n = Math.round(Number(pct));
  if (!Number.isFinite(n)) return START_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
}

/**
 * The person taps "Clean" after a clean pass. After `target` clean passes in a row the speed goes up by `step`.
 * Returns the new state and whether a step was cleared (the cleared speed is `cleared`, worth logging).
 */
export function afterCleanPass({ speed, clean, target = DEFAULT_CLEAN_TARGET, step = DEFAULT_STEP }) {
  const count = clean + 1;
  if (count < target) return { speed, clean: count, cleared: null };
  return { speed: clampSpeed(speed + step), clean: 0, cleared: speed };
}

/** "Not clean": the run of clean passes starts again, the speed stays. */
export function afterMessyPass({ speed }) {
  return { speed, clean: 0, cleared: null };
}

/** Closest speed the player can really do. YouTube only offers fixed rates (0.25, 0.5, 0.75, 1, 1.25 ...). */
export function snapRate(wanted, available) {
  if (!Array.isArray(available) || !available.length) return wanted;
  return available.reduce((best, r) => (Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best), available[0]);
}

/** Song time passes at `rate` times real time. */
export function songTimeAfter(baseSec, elapsedRealSec, rate) {
  return baseSec + elapsedRealSec * rate;
}

/** Seconds between beats when playing a song of `bpm` at `speedPct` percent. */
export function beatSeconds(bpm, speedPct) {
  const b = Number(bpm);
  if (!(b > 0)) return null;
  return 60 / (b * (speedPct / 100));
}

/** One point per day: the fastest speed cleared that day. Runs are oldest first. */
export function dailyBest(runs) {
  const byDay = new Map();
  for (const r of runs || []) {
    const day = new Date(r.playedAt).toISOString().slice(0, 10);
    const prev = byDay.get(day);
    if (!prev || r.speedPct > prev.speedPct) byDay.set(day, { day, speedPct: r.speedPct, bpm: r.bpm ?? null });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** "72 -> 96 bpm" or "70% -> 90%" for the first and last point, or null with fewer than two points. */
export function progressLine(points) {
  if (!points || points.length < 2) return null;
  const a = points[0], b = points[points.length - 1];
  if (a.bpm != null && b.bpm != null) return `${a.bpm} to ${b.bpm} bpm`;
  return `${a.speedPct}% to ${b.speedPct}%`;
}
