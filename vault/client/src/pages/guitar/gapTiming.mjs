// The gap click, pure code (no browser, no network, no microphone).
//
// A gap click is a metronome that goes silent on purpose: a few beats with the click, then a few without it. The player taps on every beat
// (the tap button or the space bar) and keeps tapping through the silence. When the click is gone, the taps show whether the player's own
// sense of time holds steady or rushes or drags. Vault never listens to the guitar; only the taps are measured.
//
// Times are in seconds from the start of the first count-in beat. Beat n is due at n * 60 / bpm.

export const COUNT_IN = 4;          // beats of plain click before the pattern starts
export const MIN_SILENT_TAPS = 4;   // fewer silent beats tapped than this and there is nothing to measure
export const MATCH_FRACTION = 0.4;  // a tap further than this share of a beat from every beat is ignored as a stray

// The ladder: more silence each step. `on` beats with the click, then `off` without, `cycles` times.
export const LEVELS = [
  { id: 'one', name: 'One beat missing', on: 3, off: 1, cycles: 8, what: 'Three clicks, then one silent beat, over and over. Keep tapping straight through the gap.' },
  { id: 'two', name: 'Two beats missing', on: 2, off: 2, cycles: 6, what: 'Two clicks, then two silent beats. The silence is as long as the sound.' },
  { id: 'bar', name: 'A whole bar missing', on: 4, off: 4, cycles: 4, what: 'A bar of clicks, then a whole bar of silence. You are on your own for four beats.' },
  { id: 'three-bars', name: 'Three bars missing', on: 4, off: 12, cycles: 2, what: 'One bar of clicks, then three silent bars. Time starts to wander here.' },
  { id: 'lost', name: 'Seven bars missing', on: 4, off: 28, cycles: 1, what: 'One bar of clicks to set the tempo, then seven bars on your own. Tap steadily and see where you end up.' },
];
export const levelById = (id) => LEVELS.find(l => l.id === id) || null;

export const beatSeconds = (bpm) => 60 / Math.min(200, Math.max(30, Number(bpm) || 80));

/** How many beats a run lasts, count-in included. */
export const totalBeats = (level) => COUNT_IN + level.cycles * (level.on + level.off);

/** Whether the click sounds on beat n of a run. */
export function audible(level, n) {
  if (n < COUNT_IN) return true;
  return ((n - COUNT_IN) % (level.on + level.off)) < level.on;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Work out how a run went. `taps` are the tap times in seconds from the start of beat 0. Returns { ok: false, reason } when there is not
 * enough to judge, otherwise { ok: true, verdict, bias, silentTaps, silentBeats, missed, meanAbsMs, maxAbsMs, meanMs, driftMsPerBeat, direction, text }.
 *
 * `bias` is how early or late the player taps on beats that DID have a click, in milliseconds. It comes from the player's reaction and from
 * the device's delay, so it is taken off the silent beats and only the change after the click goes away is judged.
 * `verdict` is 'steady', 'close' or 'drifting'; `direction` is 'early', 'late' or 'even'.
 */
export function grade(taps, level, bpm) {
  const beat = beatSeconds(bpm);
  const total = totalBeats(level);
  const clean = (Array.isArray(taps) ? taps : []).filter(t => Number.isFinite(t));

  // Each beat takes the nearest tap; a tap too far from every beat is a stray
  const best = new Map();
  for (const t of clean) {
    const n = Math.round(t / beat);
    if (n < 0 || n >= total) continue;
    const off = t - n * beat;
    if (Math.abs(off) > MATCH_FRACTION * beat) continue;
    if (!best.has(n) || Math.abs(off) < Math.abs(best.get(n))) best.set(n, off);
  }

  const silent = [];
  for (let n = COUNT_IN; n < total; n++) if (!audible(level, n)) silent.push(n);
  const silentTapped = silent.filter(n => best.has(n));
  if (silentTapped.length < MIN_SILENT_TAPS) {
    return { ok: false, reason: `Only ${silentTapped.length} of the ${silent.length} silent beats got a tap. Tap on every beat, even when the click goes quiet.`, silentBeats: silent.length, silentTaps: silentTapped.length };
  }

  const heard = [...best.keys()].filter(n => audible(level, n));
  const biasKnown = heard.length >= 3;
  const bias = biasKnown ? mean(heard.map(n => best.get(n))) : 0;
  const adj = (n) => (best.get(n) - bias) * 1000;   // milliseconds from where the beat should be, bias taken off

  const offsets = silentTapped.map(adj);
  const meanMs = mean(offsets);
  const meanAbsMs = mean(offsets.map(Math.abs));

  // Drift: how the offset changes from one silent beat to the next, within each run of silence (runs of two or more tapped beats)
  const slopes = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) slopes.push((adj(run[run.length - 1]) - adj(run[0])) / (run[run.length - 1] - run[0]));
    run = [];
  };
  for (const n of silent) {
    if (best.has(n) && (run.length === 0 || run[run.length - 1] === n - 1)) run.push(n);
    else { flush(); if (best.has(n)) run = [n]; }
  }
  flush();
  const driftMsPerBeat = slopes.length ? mean(slopes) : null;

  const beatMs = beat * 1000;
  // The worst beat counts as well as the average, so a slow slide that ends far out is not called steady
  const maxAbsMs = Math.max(...offsets.map(Math.abs));
  const verdict = meanAbsMs <= 0.08 * beatMs && maxAbsMs <= 0.15 * beatMs && silentTapped.length >= 0.75 * silent.length ? 'steady'
    : meanAbsMs <= 0.15 * beatMs && maxAbsMs <= 0.3 * beatMs && silentTapped.length >= 0.5 * silent.length ? 'close' : 'drifting';
  // A steady change from beat to beat (more than 1% of a beat each time) says rushing or dragging; failing that, a lean of 3% of a beat
  const drifting = driftMsPerBeat != null && Math.abs(driftMsPerBeat) > 0.01 * beatMs;
  const lean = drifting ? driftMsPerBeat : meanMs;
  const direction = !drifting && Math.abs(meanMs) < 0.03 * beatMs ? 'even' : lean < 0 ? 'early' : 'late';

  const missed = silent.length - silentTapped.length;
  const ms = (x) => `${Math.round(Math.abs(x))} milliseconds`;
  let text = verdict === 'steady' ? 'Steady. You kept the beat well while the click was gone.'
    : verdict === 'close' ? 'Close. The beat held, with a little wobble in the silence.'
      : 'Drifting. Without the click your beat moved away from the tempo.';
  if (direction === 'early') text += ` You tended to rush: about ${ms(lean)} early${drifting ? ' more on each beat' : ' on average'}.`;
  if (direction === 'late') text += ` You tended to drag: about ${ms(lean)} late${drifting ? ' more on each beat' : ' on average'}.`;
  if (missed > 0) text += ` ${missed} of the ${silent.length} silent beats had no tap.`;

  return {
    ok: true, verdict, direction, text, missed,
    silentBeats: silent.length, silentTaps: silentTapped.length,
    bias: round1(bias * 1000), biasKnown, meanMs: round1(meanMs), meanAbsMs: round1(meanAbsMs), maxAbsMs: round1(maxAbsMs),
    driftMsPerBeat: driftMsPerBeat == null ? null : round1(driftMsPerBeat),
  };
}

/** A level is cleared by one steady run. */
export const clears = (result) => !!(result && result.ok && result.verdict === 'steady');
