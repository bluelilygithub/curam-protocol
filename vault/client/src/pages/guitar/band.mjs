// The backing band's rules, pure code (no browser, no sound). A bar of 4/4 is eight slots, one per eighth note (the same grid as the strumming
// arrows: 1 & 2 & 3 & 4 &). The drums and the bass play on that grid, and each bar of the chord loop is one chord.

import { PROGRESSION_LIBRARY } from './progressions.mjs';
import { NAMES, rootSemi, chordName } from './theory.mjs';

export const SLOTS = 8;
export const MAX_LOOP = 8;

export const DRUM_STYLES = [
  { id: 'off', name: 'No drums', tip: 'Play without drums.' },
  { id: 'rock', name: 'Rock beat', tip: 'Kick on 1 and 3, snare on 2 and 4, hi-hat on every eighth note.' },
  { id: 'pop', name: 'Pop beat', tip: 'A lighter beat with a kick that pushes into beat 3 and a hi-hat on every beat.' },
  { id: 'ballad', name: 'Slow ballad', tip: 'Kick on 1, snare on 3 and a soft hi-hat on the beat. Spacious and slow.' },
];
const DRUM_PATTERNS = {
  rock: { kick: [0, 4], snare: [2, 6], hat: [0, 1, 2, 3, 4, 5, 6, 7] },
  pop: { kick: [0, 3, 4], snare: [2, 6], hat: [0, 2, 4, 6] },
  ballad: { kick: [0], snare: [4], hat: [0, 2, 4, 6] },
};

export const BASS_STYLES = [
  { id: 'off', name: 'No bass', tip: 'Play without bass.' },
  { id: 'roots', name: 'Root on every beat', tip: 'The root note of the chord on each beat. Simple and solid.' },
  { id: 'rootfifth', name: 'Root and fifth', tip: 'The root on 1, 2 and 4 and the fifth on 3. A little more movement.' },
  { id: 'eighths', name: 'Driving eighths', tip: 'The root note on every eighth note. Pushes the song along.' },
];
// slot -> 'root' | 'fifth'
const BASS_PATTERNS = {
  roots: { 0: 'root', 2: 'root', 4: 'root', 6: 'root' },
  rootfifth: { 0: 'root', 2: 'root', 4: 'fifth', 6: 'root' },
  eighths: { 0: 'root', 1: 'root', 2: 'root', 3: 'root', 4: 'root', 5: 'root', 6: 'root', 7: 'root' },
};

/** Which drums hit on this slot: any of 'kick', 'snare', 'hat'. */
export function drumHits(styleId, slot) {
  const p = DRUM_PATTERNS[styleId];
  if (!p) return [];
  return ['kick', 'snare', 'hat'].filter(k => p[k].includes(slot));
}

/** The bass note (a MIDI number) on this slot for a chord whose root is pitch class `pc`, or null when the bass is silent. */
export function bassNote(styleId, slot, pc) {
  const p = BASS_PATTERNS[styleId];
  const what = p && p[slot];
  if (!what) return null;
  const root = rootMidi(pc);
  return what === 'fifth' ? root + 7 : root;
}

/** The bass plays in the low octave of the guitar's range: pitch class 4 (E) is MIDI 28 (the low E string of a bass), up to 39. */
export const rootMidi = (pc) => 28 + (((pc % 12) - 4 + 12) % 12);
export const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** How long a bass note rings, in slots: beats ring longer than eighths. */
export const bassLengthSlots = (styleId) => (styleId === 'eighths' ? 0.8 : 1.7);

// ── The chord loop (one chord a bar) ─────────────────────────────────────────

const canon = (name) => { const m = /^([A-G][#b]?)(.*)$/.exec(String(name || '')); const r = m && rootSemi(m[1]); return r == null ? null : { name: chordName(r, m[2]), pc: r }; };

/** A loop from chord names: invalid names and straight repeats are dropped, and it is cut at eight chords. */
export function loopFromChords(names) {
  const out = [];
  for (const n of names || []) {
    const c = canon(n);
    if (!c || (out.length && out[out.length - 1].name === c.name)) continue;
    out.push(c);
    if (out.length >= MAX_LOOP) break;
  }
  return out;
}

/** A song's own chart as a loop: its chords in order, repeats collapsed, the first eight. events: [{ chordRoot, chordQuality }] */
export function loopFromSong(events) {
  return loopFromChords((events || []).map(e => `${e.chordRoot}${e.chordQuality || ''}`));
}

export const PROGRESSIONS = [
  ...PROGRESSION_LIBRARY.major.map((p, i) => ({ id: `major:${i}`, mode: 'major', name: p.name, numerals: p.numerals, steps: p.steps })),
  ...PROGRESSION_LIBRARY.minor.map((p, i) => ({ id: `minor:${i}`, mode: 'minor', name: p.name, numerals: p.numerals, steps: p.steps })),
];

/** A well-known progression in a key, as a loop. tonic is a pitch class 0-11. */
export function loopFromProgression(tonic, progressionId) {
  const p = PROGRESSIONS.find(x => x.id === progressionId);
  if (!p) return [];
  return p.steps.map(([semi, q]) => ({ name: chordName(tonic + semi, q), pc: (((tonic + semi) % 12) + 12) % 12 }));
}

/** The chord for a bar counted from the first bar after the count-in (bar 0), or null for the count-in itself. */
export function chordForBar(loop, bar) {
  if (!loop.length || bar < 0) return null;
  return loop[bar % loop.length];
}

export { NAMES };
