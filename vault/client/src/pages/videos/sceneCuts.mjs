// Video Tools: shot changes ("cuts") and good thumbnail frames, worked out IN THE BROWSER from tiny copies of frames (no upload, no ffmpeg, no AI, no cost).
// The pure parts are here so `node client/src/pages/videos/sceneCuts.test.mjs` checks them; the part that seeks a video element is sceneScan.js.
// Idea taken from OpenSEO's neighbour project "watch" (scene-change sampling, near-duplicate removal) and from our own Music tool's shot-cut detection
// (server/services/music/musicFit.js), written fresh for the Clip timeline and the Thumbnail tool.
//
// A "frame" here is a small grid of brightness values (0 to 255), one number per pixel, as made by `lumaFrom`.

export const THUMB_W = 48;
export const THUMB_H = 27;

/** RGBA pixels (as from canvas getImageData) -> brightness 0..255 per pixel. */
export function lumaFrom(rgba) {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    out[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
  }
  return out;
}

/** How different two frames are: the average brightness change per pixel, 0 (the same picture) to 1 (black against white). */
export function frameDiff(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / n / 255;
}

/** The times to look at: evenly spread, at most `maxSamples`, never closer together than `minStep` seconds, and including the very start. */
export function sampleTimes(duration, { maxSamples = 90, minStep = 0.5 } = {}) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return [];
  const step = Math.max(minStep, d / Math.max(2, maxSamples));
  const out = [];
  for (let t = 0; t < d - 0.05; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// the typical size of a change and how much it varies, by the MEDIAN: a video with only one or two cuts has mostly tiny changes, and the mean and standard
// deviation would be pulled up by the very cuts we are looking for
const mad = (xs) => { const m = median(xs); return median(xs.map((x) => Math.abs(x - m))); };

/**
 * Where the picture changes suddenly. `times[i]` is when `lumas[i]` was taken. A cut is reported at the SECOND sample of a pair that differs far more than the
 * pairs around it (the typical change plus six times its usual spread (median and MAD), and never less than `floor`), so slow movement and a gentle fade are not cuts. Cuts closer together than
 * `minGap` seconds keep only the stronger one. The time is only as exact as the sample spacing (refine it with `bisectCut`).
 * @returns {{ t: number, before: number, score: number }[]} `before` is the time of the sample just before the change, for refining
 */
export function detectCuts(times, lumas, { floor = 0.1, minGap = 0.5, settle = 0.6 } = {}) {
  const n = Math.min(times.length, lumas.length);
  if (n < 3) return [];
  const diffs = [];
  for (let i = 1; i < n; i += 1) diffs.push(frameDiff(lumas[i - 1], lumas[i]));
  const limit = Math.max(floor, median(diffs) + 6 * mad(diffs));
  const found = [];
  // Runs of consecutive big changes. A real cut is ONE big change (or two, with a flash frame between the shots) and then the picture SETTLES: it is steady
  // just before and just after. A strobe, a flicker or fast camera movement is a long run of big changes, so it is not a cut. (A montage cutting faster than
  // the sample spacing is not found either: that is the price of not mistaking a flicker for a cut.)
  let k = 0;
  while (k < diffs.length) {
    if (diffs[k] < limit) { k += 1; continue; }
    let end = k;
    while (end + 1 < diffs.length && diffs[end + 1] >= limit) end += 1;
    if (end - k + 1 <= 2) {
      let peak = k;
      for (let p = k; p <= end; p += 1) if (diffs[p] > diffs[peak]) peak = p;
      const before = k >= 1 ? diffs[k - 1] : 0;
      const after = end + 1 < diffs.length ? diffs[end + 1] : 0;
      if (before <= settle * diffs[peak] && after <= settle * diffs[peak]) found.push({ t: times[peak + 1], before: times[peak], score: diffs[peak] });
    }
    k = end + 1;
  }
  const kept = [];
  for (const c of found) {
    const last = kept[kept.length - 1];
    if (last && c.t - last.t < minGap) { if (c.score > last.score) kept[kept.length - 1] = c; } else kept.push(c);
  }
  return kept;
}

/**
 * Narrow a cut known to lie between `lo` and `hi` down to a fraction of a second. `isAfter(t)` answers "is the picture at t already the new shot?" (it may be
 * async: it seeks a video). Takes `iterations` questions; the answer is accurate to (hi - lo) / 2^iterations.
 */
export async function bisectCut(lo, hi, isAfter, iterations = 5) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (a + b) / 2;
    if (await isAfter(mid)) b = mid; else a = mid;
  }
  return Math.round(b * 100) / 100;
}

/** The nearest cut to `time` within `maxDist` seconds, or null. `cuts` are times (numbers). */
export function nearestCut(time, cuts, maxDist) {
  let best = null;
  let bestD = Infinity;
  for (const c of cuts) {
    const d = Math.abs(c - time);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best != null && bestD <= maxDist ? best : null;
}

/** The last cut before `time` (more than `eps` earlier), or null. `cuts` must be sorted. */
export function prevCut(time, cuts, eps = 0.05) {
  let found = null;
  for (const c of cuts) { if (c < time - eps) found = c; else break; }
  return found;
}

/** The first cut after `time` (more than `eps` later), or null. `cuts` must be sorted. */
export function nextCut(time, cuts, eps = 0.05) {
  for (const c of cuts) { if (c > time + eps) return c; }
  return null;
}

/** A marker dragged to `time`: jump to a shot change within `snapSec`, otherwise stay where it is. */
export function snapTime(time, cuts, snapSec) {
  const c = nearestCut(time, cuts, snapSec);
  return c == null ? time : c;
}

// ---- thumbnails

/** How much detail a frame has: the average brightness step between neighbouring pixels (a blurred or flat frame scores low). `w` is the row length. */
export function sharpness(luma, w) {
  if (!luma.length || w < 2) return 0;
  const h = Math.floor(luma.length / w);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (x + 1 < w) { sum += Math.abs(luma[i] - luma[i + 1]); count += 1; }
      if (y + 1 < h) { sum += Math.abs(luma[i] - luma[i + w]); count += 1; }
    }
  }
  return count ? sum / count / 255 : 0;
}

export const averageBrightness = (luma) => (luma.length ? mean(Array.from(luma)) : 0);

/**
 * The best frames to offer as a thumbnail. `candidates` are { t, luma } (all the same size, `w` pixels wide). A frame that is nearly black or blown out, or
 * flat (a fade, a title on one colour), is skipped; the rest are ranked by detail; and a frame that looks almost the same as one already chosen, or is within
 * `minGap` seconds of one, is skipped, so the offers are genuinely different. @returns {{ t, score }[]} best first
 */
export function pickThumbnails(candidates, w, { count = 4, minGap = 1, duplicate = 0.06, darkest = 28, brightest = 232, flattest = 0.01 } = {}) {
  const scored = (candidates || [])
    .map((c) => ({ t: c.t, luma: c.luma, score: sharpness(c.luma, w), bright: averageBrightness(c.luma) }))
    .filter((c) => c.bright >= darkest && c.bright <= brightest && c.score >= flattest)
    .sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const c of scored) {
    if (chosen.length >= count) break;
    if (chosen.some((p) => Math.abs(p.t - c.t) < minGap || frameDiff(p.luma, c.luma) < duplicate)) continue;
    chosen.push(c);
  }
  return chosen.map(({ t, score }) => ({ t, score }));
}
