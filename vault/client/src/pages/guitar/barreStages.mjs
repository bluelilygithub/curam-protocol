// The barre chord ladder, pure code (no browser, no network). A barre chord is the hardest early step on guitar, so it is taught in small
// rungs: press two strings flat, then four (the "mini F"), then all six (the full F), then the same idea on a different shape (B flat), then
// slide the shape up the neck. Each rung is cleared by holding the shape for ten seconds with every string ringing, three times.
// barreStages.test.mjs checks every shape against the real notes of its chord, so a wrong fret cannot send a learner to the wrong place.
//
// Strings are numbered 0 to 5 from the thickest (low E) to the thinnest (high E), as in fingering.mjs
// (-1 = not played, 0 = open, n = fret). Fingers: 1 index, 2 middle, 3 ring, 4 little.

import { chordName } from './theory.mjs';

export const HOLD_SECONDS = 10;   // how long a hold lasts
export const CLEAR_AT = 3;        // clean holds needed to clear a rung

// The E-shape barre with the index finger across the fret n: F at fret 1, F sharp at 2, G at 3 and so on
export const eShapeBarre = (n) => ({
  fretPositions: [n, n + 2, n + 2, n + 1, n, n], fingerPositions: [1, 3, 4, 2, 1, 1], baseFret: n, kind: 'barre', barreFret: n,
});

export const STAGES = [
  {
    id: 'two-strings', name: 'Two strings', chord: 'F',
    shape: { fretPositions: [-1, -1, -1, -1, 1, 1], fingerPositions: [0, 0, 0, 0, 1, 1], baseFret: 1, kind: 'barre', barreFret: 1 },
    check: [4, 5],
    what: 'Lay your index finger flat across the 1st fret of the two thinnest strings and pick each one. Both must ring.',
    tip: 'Press with the bony side of the finger, close to the fret wire, not the soft pad. Angle the finger very slightly.',
  },
  {
    id: 'mini-f', name: 'The mini F', chord: 'F',
    shape: { fretPositions: [-1, -1, 3, 2, 1, 1], fingerPositions: [0, 0, 3, 2, 1, 1], baseFret: 1, kind: 'barre', barreFret: 1 },
    check: [2, 3, 4, 5],
    what: 'Keep the two-string barre and add your middle finger on the 2nd fret of the G string and your ring finger on the 3rd fret of the D string. Strum the thinnest four strings.',
    tip: 'This is a real F chord, just on four strings. Get the barre ringing first, then add one finger at a time.',
  },
  {
    id: 'full-f', name: 'The full F', chord: 'F',
    shape: eShapeBarre(1),
    check: [0, 1, 2, 3, 4, 5],
    what: 'The index finger lies across all six strings at the 1st fret. Your ring finger takes the 3rd fret of the A string, your little finger the 3rd fret of the D string and your middle finger the 2nd fret of the G string.',
    tip: 'If the low strings buzz, roll the index finger a little onto its side and bring your elbow in. Pull the guitar neck towards you with your thumb behind it, not squeezing.',
  },
  {
    id: 'b-flat', name: 'B flat, the A shape', chord: 'Bb',
    shape: { fretPositions: [-1, 1, 3, 3, 3, 1], fingerPositions: [0, 1, 2, 3, 4, 1], baseFret: 1, kind: 'barre', barreFret: 1 },
    check: [1, 2, 3, 4, 5],
    what: 'The index finger lies across the 1st fret from the A string to the thinnest string. The other three fingers sit side by side on the 3rd fret of the D, G and B strings. Do not play the thickest string.',
    tip: 'Three fingers on one fret is tight. Lean the fingers up a little so the thinnest string is not muted by the one next to it.',
  },
  {
    id: 'slide-it', name: 'Slide it up the neck', chord: 'F',
    shape: eShapeBarre(1), slide: true,
    check: [0, 1, 2, 3, 4, 5],
    what: 'Hold the full F shape and slide the whole shape up one fret at a time without lifting off: F, F sharp, G, A flat, A. The shape never changes, only where you put it.',
    tip: 'Ease the pressure as you slide and press again when you land. Move the whole hand from the elbow, not just the fingers.',
  },
];

/** The chord and shape at fret `n` of the slide rung (F at 1 up to A at 5). */
export function slideStep(n) {
  const fret = Math.max(1, Math.min(5, Math.round(n)));
  return { fret, chord: chordName(4 + fret, ''), shape: eShapeBarre(fret) };
}

/** Where a rung stands: holds is [{ stage, clean }] for any stages. Returns { clean, total, cleared, left }. */
export function stageStatus(stageId, holds) {
  const list = (holds || []).filter(h => h.stage === stageId);
  const clean = list.filter(h => h.clean).length;
  return { clean, total: list.length, cleared: clean >= CLEAR_AT, left: Math.max(0, CLEAR_AT - clean) };
}

/** The ladder as { stage, status, next } for each rung; `next` marks the first rung not yet cleared. */
export function ladder(holds) {
  let nextTaken = false;
  return STAGES.map((stage) => {
    const status = stageStatus(stage.id, holds);
    const next = !status.cleared && !nextTaken;
    if (next) nextTaken = true;
    return { stage, status, next };
  });
}
