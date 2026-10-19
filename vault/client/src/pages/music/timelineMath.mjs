// Pure maths for the Music timeline (MusicTimeline.jsx): pixels <-> seconds, snapping to picture cuts, and where the music
// and voice bars sit. No DOM, so it is unit-tested (node client/src/pages/music/timelineMath.test.mjs).

const round1 = (n) => Math.round(n * 10) / 10;

/** Seconds at horizontal position `x` of a bar `width` pixels wide that spans `durationS`; clamped to the bar. */
export function timeFromX(x, width, durationS) {
  if (!(width > 0) || !(durationS > 0)) return 0;
  return Math.min(durationS, Math.max(0, (x / width) * durationS));
}

/** The cut within `withinS` seconds of `t` that is closest to it, or null. */
export function nearestCut(t, cuts, withinS = 0.5) {
  let best = null;
  let bestD = Infinity;
  for (const c of Array.isArray(cuts) ? cuts : []) {
    const d = Math.abs(c - t);
    if (d <= withinS && d < bestD) { best = c; bestD = d; }
  }
  return best;
}

/** `t` moved onto the nearest cut when snapping is on and one is close; otherwise `t` itself. */
export function snapTime(t, cuts, { enabled = true, withinS = 0.5 } = {}) {
  if (!enabled) return t;
  const c = nearestCut(t, cuts, withinS);
  return c === null ? t : c;
}

/** Where a voiceover of `voiceDurS` may start: from 0 up to half a second before the end, to a tenth of a second. */
export function clampVoiceStart(t, durationS) {
  const max = Math.max(0, Math.floor((durationS - 0.5) * 10) / 10);
  return round1(Math.min(max, Math.max(0, Number.isFinite(t) ? t : 0)));
}

/** Where the music may start: from 0 up to a second before the end (the server keeps at least a second of music). */
export function clampMusicStart(t, durationS) {
  const max = Math.max(0, Math.floor((durationS - 1) * 10) / 10);
  return round1(Math.min(max, Math.max(0, Number.isFinite(t) ? t : 0)));
}

/** The music bar as percentages of the whole length: where it starts and how long each fade ramp is. */
export function musicBarLayout(durationS, { fadeInS = 0.5, fadeOutS = 2, startS = 0 } = {}) {
  if (!(durationS > 0)) return { startPct: 0, widthPct: 100, fadeInPct: 0, fadeOutPct: 0 };
  const start = Math.min(Math.max(0, startS), durationS);
  const len = durationS - start;
  const pct = (s) => (s / durationS) * 100;
  return {
    startPct: pct(start),
    widthPct: pct(len),
    fadeInPct: pct(Math.min(Math.max(0, fadeInS), len)),
    fadeOutPct: pct(Math.min(Math.max(0, fadeOutS), len)),
  };
}

/** The voice bar: where it starts and how wide it is as percentages, and how many seconds run past the end (cut off). */
export function voiceBarLayout(durationS, voiceDurS, startS) {
  if (!(durationS > 0) || !(voiceDurS > 0)) return { startPct: 0, widthPct: 0, overrunS: 0 };
  const start = Math.min(Math.max(0, startS), durationS);
  const visible = Math.min(voiceDurS, durationS - start);
  return {
    startPct: (start / durationS) * 100,
    widthPct: (visible / durationS) * 100,
    overrunS: round1(Math.max(0, start + voiceDurS - durationS)),
  };
}
