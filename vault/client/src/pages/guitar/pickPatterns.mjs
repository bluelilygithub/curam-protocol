// The fingerpicking ladder, pure code (no browser, no network).
//
// A bar is the same eight slots as the strumming arrows (counted "1 & 2 & 3 & 4 &"). A pattern says which strings are plucked in each slot,
// by role: R = the chord's root note, A = its alternate bass note, G / B / E = the third, second and first strings. The picking hand is
// taught as p-i-m-a: the thumb (p) takes the bass strings, index (i) the G string, middle (m) the B string and ring (a) the high E.
//
// PICK_CHORDS is the table of where each role lands for a chord, as a string and a fret. The treble strings come from the standard
// fingering in fingering.mjs, so the diagram and the tab can never disagree. pickPatterns.test.mjs checks every entry against the real
// notes of its chord, so a wrong fret cannot slip in and send a learner to the wrong string.
//
// Strings are numbered 0 to 5 from the thickest (low E) to the thinnest (high E), the same order as `fretPositions`.

import { shapeFor, canon } from './fingering.mjs';

export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];   // E2 A2 D3 G3 B3 E4
export const SLOTS = 8;
export const COUNT_LABELS = ['1', '&', '2', '&', '3', '&', '4', '&'];
export const TREBLE = { G: 3, B: 4, E: 5 };
export const FINGER_FOR = { R: 'p', A: 'p', G: 'i', B: 'm', E: 'a' };
export const FINGER_WORDS = { p: 'thumb', i: 'index finger', m: 'middle finger', a: 'ring finger' };

// Where the root and the alternate bass note sit, for each chord the ladder offers. The alternate bass is the note a teacher swaps in on the next beat
// (a different note of the chord, open or already under a finger of the standard shape, so no extra finger is needed); `s` is the string
// and `f` the fret.
export const PICK_CHORDS = {
  C: { root: { s: 1, f: 3 }, alt: { s: 2, f: 2 } },    // C on the A string, E on the D string
  G: { root: { s: 0, f: 3 }, alt: { s: 2, f: 0 } },    // G on the low E, D on the open D string
  Am: { root: { s: 1, f: 0 }, alt: { s: 2, f: 2 } },   // A open, E on the D string
  Em: { root: { s: 0, f: 0 }, alt: { s: 1, f: 2 } },   // E open, B on the A string
  D: { root: { s: 2, f: 0 }, alt: { s: 1, f: 0 } },    // D open, A open
  Dm: { root: { s: 2, f: 0 }, alt: { s: 1, f: 0 } },
  A: { root: { s: 1, f: 0 }, alt: { s: 0, f: 0 } },    // A open, E open
  E: { root: { s: 0, f: 0 }, alt: { s: 1, f: 2 } },    // E open, B on the A string
};
export const PICK_CHORD_NAMES = Object.keys(PICK_CHORDS);

// The ladder. Each rung is one bar: `slots` holds the roles plucked in each of the eight slots (an empty list = nothing plucked).
export const STAGES = [
  {
    id: 'thumb', name: 'Thumb only',
    slots: [['R'], [], ['R'], [], ['R'], [], ['R'], []],
    what: 'Pluck the root note with your thumb on every beat. Nothing else yet.',
    tip: 'Rest your thumb on the bass string and pull it gently across. Keep your other fingers loose over the thin strings.',
  },
  {
    id: 'pinch', name: 'Thumb and a pinch',
    slots: [['R', 'E'], [], ['B'], [], ['R', 'E'], [], ['B'], []],
    what: 'On beats 1 and 3 pluck the bass note and the high E together, like a pinch. On beats 2 and 4 pluck the B string alone.',
    tip: 'Thumb and ring finger move toward each other and let go together. The single note is the middle finger.',
  },
  {
    id: 'roll', name: 'Roll up the strings',
    slots: [['R'], [], ['G'], [], ['B'], [], ['E'], []],
    what: 'One note on each beat, climbing: thumb on the root, then index on G, middle on B, ring on the high E.',
    tip: 'Say "p, i, m, a" out loud as you go. Each finger always keeps its own string.',
  },
  {
    id: 'up-and-back', name: 'Up and back down',
    slots: [['R'], ['G'], ['B'], ['E'], ['B'], ['G'], ['B'], ['G']],
    what: 'The same roll twice as fast, one note on every count, climbing then coming back: p i m a m i m i.',
    tip: 'Slow the tempo right down first. Even spacing matters more than speed.',
  },
  {
    id: 'alt-bass', name: 'Alternating bass',
    slots: [['R'], [], ['A'], [], ['R'], [], ['A'], []],
    what: 'Only the thumb, swapping between the root note and the alternate bass note on each beat. This is the engine of Travis picking.',
    tip: 'Keep the thumb steady like a heartbeat. It should keep going even when your fingers join in.',
  },
  {
    id: 'travis', name: 'Travis picking',
    slots: [['R'], ['B'], ['A'], ['E'], ['R'], ['B'], ['A'], ['E']],
    what: 'The alternating thumb on every beat, with the middle finger on B and the ring finger on the high E in between.',
    tip: 'Get the thumb going on its own for a bar, then drop the fingers in between its notes. If it falls apart, go back to Alternating bass.',
  },
];

export const stageById = (id) => STAGES.find(s => s.id === id) || null;

/** The chord name as the table spells it, or null when the ladder has no tab for it. */
export function pickChord(name) {
  const c = canon(name);
  return c && PICK_CHORDS[c] ? c : null;
}

const noteAt = (s, f) => ({ string: s, fret: f, midi: OPEN_MIDI[s] + f });

/** Where a role lands for a chord: { string, fret, midi, finger, role }, or null when the chord is not in the table. */
export function locate(chord, role) {
  const c = pickChord(chord);
  if (!c) return null;
  let pos;
  if (role === 'R') pos = PICK_CHORDS[c].root;
  else if (role === 'A') pos = PICK_CHORDS[c].alt;
  else if (TREBLE[role] != null) {
    const shape = shapeFor(c);
    const s = TREBLE[role];
    const f = shape.fretPositions[s];
    pos = { s, f };
  } else return null;
  return { ...noteAt(pos.s, pos.f), finger: FINGER_FOR[role], role };
}

/** The bar for a chord: eight slots, each a list of the notes plucked there. Returns null when the chord is not in the table. */
export function barFor(chord, stage) {
  if (!pickChord(chord) || !stage) return null;
  return stage.slots.map((roles, slot) => ({ slot, label: COUNT_LABELS[slot], notes: roles.map(r => locate(chord, r)) }));
}

/** The bar as tab text, high E at the top: six lines, each slot three characters wide ("-3-" or "---"). */
export function tabText(chord, stage) {
  const bar = barFor(chord, stage);
  if (!bar) return null;
  const names = ['E', 'A', 'D', 'G', 'B', 'e'];
  const lines = [];
  for (let s = 5; s >= 0; s--) {
    let line = `${names[s]}|`;
    for (const col of bar) {
      const hit = col.notes.find(n => n.string === s);
      line += hit ? `-${hit.fret}-` : '---';
    }
    lines.push(`${line}|`);
  }
  return lines;
}

/** The fingers used in each slot as a line of letters: "p . i . m . a .". */
export function fingerLine(stage) {
  return stage.slots.map(roles => (roles.length ? roles.map(r => FINGER_FOR[r]).join('') : '.')).join(' ');
}

/** Whether the ring finger (a) or only p, i, m are needed, so the words can mention only fingers the rung uses. */
export function fingersUsed(stage) {
  const set = new Set();
  for (const roles of stage.slots) for (const r of roles) set.add(FINGER_FOR[r]);
  return ['p', 'i', 'm', 'a'].filter(f => set.has(f));
}

/** Plain words for the notes of one rung: "Thumb, middle finger and ring finger". */
export function fingerWords(stage) {
  const used = fingersUsed(stage).map(f => FINGER_WORDS[f]);
  if (used.length === 1) return used[0][0].toUpperCase() + used[0].slice(1);
  const text = `${used.slice(0, -1).join(', ')} and ${used[used.length - 1]}`;
  return text[0].toUpperCase() + text.slice(1);
}
