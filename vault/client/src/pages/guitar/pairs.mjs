// Major and minor pairs, pure code (no browser, no network): the open chords whose major and minor shapes differ in a single note, the 3rd.
// Dropping that one note by a half step is all it takes to turn a chord sad, so these three pairs make the best first drill.
// The two shapes come from the verified table in fingering.mjs; pairs.test.mjs checks the note that changes against real chord tones.

import { shapeFor, STRING_NAMES } from './fingering.mjs';
import { rootSemi } from './theory.mjs';

// [major, minor] — the server keeps the same list for the best scores (guitarTransitions.js); a server test fails if they differ
export const MAJOR_MINOR_PAIRS = [['E', 'Em'], ['A', 'Am'], ['D', 'Dm']];

// Open strings, low E to high E, as semitones above C
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const noteAt = (string, fret) => (OPEN_STRINGS[string] + fret) % 12;

/**
 * What differs between a major chord and its minor. Returns { ok, major, minor, root, strings: [{ string, stringName, majorFret, minorFret,
 * majorNote, minorNote }], single, sentence } where `strings` lists every string that sounds a different note, and `single` is true when
 * it is exactly one (the 3rd). { ok: false } when a chord has no fingering in the table.
 */
export function pairDifference(major, minor) {
  const a = shapeFor(major), b = shapeFor(minor);
  if (!a || !b) return { ok: false, major, minor };
  const root = rootSemi(major.replace(/m$/, ''));
  const strings = [];
  for (let s = 0; s < 6; s++) {
    const fa = a.fretPositions[s], fb = b.fretPositions[s];
    if (fa === fb) continue;
    const na = fa < 0 ? null : noteAt(s, fa);
    const nb = fb < 0 ? null : noteAt(s, fb);
    if (na === nb) continue;
    strings.push({
      string: s, stringName: STRING_NAMES[s], majorFret: fa, minorFret: fb,
      majorNote: na == null ? null : SHARP_NAMES[na], minorNote: nb == null ? null : SHARP_NAMES[nb],
      majorInterval: na == null ? null : (na - root + 12) % 12, minorInterval: nb == null ? null : (nb - root + 12) % 12,
    });
  }
  const single = strings.length === 1;
  const s = strings[0];
  const sentence = single
    ? `Only one note changes. On the ${s.stringName} string, ${major} plays ${s.majorNote} and ${minor} plays ${s.minorNote}. That note is the 3rd, and a half step lower makes the chord minor.`
    : `${major} and ${minor} differ in ${strings.length} notes.`;
  return { ok: true, major, minor, root, strings, single, sentence, shapeMajor: a, shapeMinor: b };
}
