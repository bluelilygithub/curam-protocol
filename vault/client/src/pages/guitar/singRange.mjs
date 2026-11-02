// The sing-along key finder, pure code (no browser, no network, no microphone). The person says the lowest and highest notes they can sing
// comfortably; for the song they have open this works out how far to move the key so the tune sits in that range.
//
// Vault does not know the melody of a song, so it assumes a typical one: from a fifth below the key note up to a major sixth above it
// (14 semitones), in whichever octave suits the singer. That is a rule of thumb, not a measurement, and the result says so.

export const MELODY_BELOW = 5;   // semitones from the key note down to the lowest note of a typical tune
export const MELODY_ABOVE = 9;   // semitones from the key note up to the highest
export const MIN_SPAN = 9;       // a range narrower than this (a major sixth) cannot hold a typical tune, so it is refused
export const LOWEST = 36;        // C2
export const HIGHEST = 84;       // C6

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note number to a name such as 'C#3' (middle C, MIDI 60, is C4). */
export const noteName = (midi) => `${SHARP_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Every note the range pickers offer, low to high. */
export const NOTE_CHOICES = Array.from({ length: HIGHEST - LOWEST + 1 }, (_, i) => ({ midi: LOWEST + i, name: noteName(LOWEST + i) }));

export const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Usual ranges, as a starting point for someone who does not know their notes
export const VOICE_PRESETS = [
  { id: 'bass', name: 'Low voice', low: 40, high: 64, note: 'about E2 to E4' },
  { id: 'baritone', name: 'Medium-low voice', low: 45, high: 69, note: 'about A2 to A4' },
  { id: 'tenor', name: 'Medium voice', low: 48, high: 72, note: 'about C3 to C5' },
  { id: 'alto', name: 'Medium-high voice', low: 53, high: 77, note: 'about F3 to F5' },
  { id: 'soprano', name: 'High voice', low: 60, high: 84, note: 'about C4 to C6' },
];

const mod12 = (n) => ((n % 12) + 12) % 12;

/** Check a range before it is used or saved. Returns { ok, error?, value? }. */
export function checkRange(low, high) {
  const lo = Number(low), hi = Number(high);
  if (!(Number.isInteger(lo) && Number.isInteger(hi))) return { ok: false, error: 'Pick a lowest and a highest note.' };
  if (lo < LOWEST || hi > HIGHEST) return { ok: false, error: `Notes must be between ${noteName(LOWEST)} and ${noteName(HIGHEST)}.` };
  if (hi - lo < MIN_SPAN) return { ok: false, error: `Your highest note should be at least a major sixth (${MIN_SPAN} semitones) above your lowest, or no song will fit.` };
  return { ok: true, value: { low: lo, high: hi } };
}

/**
 * How well a typical tune in the key with key note `tonicPc` (0 to 11, C = 0) sits in the range. The singer may use any octave, so the best
 * octave is chosen. Returns { overflow, tooLow, tooHigh, tonic, lowest, highest, fits }: `overflow` is how many semitones stick out (0 = fits),
 * `tooLow` and `tooHigh` split that between the two ends, and `tonic` is the MIDI note of the key note in the best octave.
 */
export function fit(range, tonicPc) {
  let best = null;
  for (let tonic = range.low - 12; tonic <= range.high + 12; tonic++) {
    if (mod12(tonic) !== mod12(tonicPc)) continue;
    const lowest = tonic - MELODY_BELOW, highest = tonic + MELODY_ABOVE;
    const tooLow = Math.max(0, range.low - lowest), tooHigh = Math.max(0, highest - range.high);
    const overflow = tooLow + tooHigh;
    if (!best || overflow < best.overflow || (overflow === best.overflow && Math.abs(tonic - (range.low + range.high) / 2) < Math.abs(best.tonic - (range.low + range.high) / 2))) {
      best = { overflow, tooLow, tooHigh, tonic, lowest, highest, fits: overflow === 0 };
    }
  }
  return best;
}

/**
 * Where to move a song's key. `range` is { low, high } in MIDI numbers, `playedTonic` is the pitch class of the key note as the chart is
 * played now (key plus transpose), `transpose` is the chart's current shift in semitones. Returns
 * { ok, current, best, shift, transpose, already } where `shift` is how many semitones to move the key (-6 to +5), `transpose` is the new
 * transpose value to set, and `already` is true when the song already fits. Among keys that fit equally well the smallest move wins.
 */
export function suggestKey({ range, playedTonic, transpose = 0 }) {
  const check = checkRange(range && range.low, range && range.high);
  if (!check.ok) return { ok: false, error: check.error };
  const current = fit(check.value, playedTonic);
  let best = null;
  for (let shift = -6; shift <= 5; shift++) {
    const f = fit(check.value, mod12(playedTonic + shift));
    if (!best || f.overflow < best.fit.overflow || (f.overflow === best.fit.overflow && Math.abs(shift) < Math.abs(best.shift))) best = { shift, fit: f };
  }
  const already = current.overflow <= best.fit.overflow;
  const shift = already ? 0 : best.shift;
  let next = transpose + shift;
  if (next > 11) next -= 12;
  if (next < -11) next += 12;
  return { ok: true, range: check.value, current, best: already ? { shift: 0, fit: current } : best, shift, transpose: next, already };
}
