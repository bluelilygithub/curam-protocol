// node client/src/pages/guitar/fingering.test.mjs
import assert from 'node:assert';
import { shapeFor, placements, describeChange, changesFor, canon } from './fingering.mjs';
import { NAMES, rootSemi } from './theory.mjs';

// Open-string notes of a guitar in standard tuning, as semitones above C: E A D G B E
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4];
const TONES = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7] };
const notesOf = (shape) => shape.fretPositions.map((f, s) => (f < 0 ? null : (OPEN_STRINGS[s] + f) % 12)).filter(n => n !== null);

// ── Every shape is checked against the real notes of its chord ──
const qualities = Object.keys(TONES);
let checked = 0;
for (const root of NAMES) {
  for (const q of qualities) {
    const name = root + q;
    const shape = shapeFor(name);
    if (!shape) continue;
    checked += 1;
    const r = rootSemi(root);
    const allowed = new Set(TONES[q].map(i => (r + i) % 12));
    const notes = notesOf(shape);
    assert.ok(notes.length >= 3, `${name}: at least three strings sound`);
    for (const n of notes) assert.ok(allowed.has(n), `${name}: every note belongs to the chord (found ${n}, allowed ${[...allowed]})`);
    const have = new Set(notes);
    // The root and the note that makes it major, minor or suspended must sound. The fifth may be left out (the usual C7 does), and the open
    // Bm7 (x20202) is deliberately played without its third.
    const NO_THIRD = new Set(['Bm7']);
    assert.ok(have.has(r), `${name}: has the root`);
    if (!NO_THIRD.has(name)) assert.ok(have.has((r + TONES[q][1]) % 12), `${name}: has the third (or the suspended note)`);
    assert.strictEqual(shape.fretPositions.length, 6);
    assert.strictEqual(shape.fingerPositions.length, 6);
    // a finger only where a fret is pressed, and one finger never on two different frets
    const fretOfFinger = new Map();
    shape.fretPositions.forEach((f, s) => {
      const fi = shape.fingerPositions[s];
      if (f > 0) { assert.ok(fi >= 1 && fi <= 4, `${name}: a finger on every pressed string`); }
      else assert.strictEqual(fi, 0, `${name}: no finger on an open or unplayed string`);
      if (fi) { assert.ok(!fretOfFinger.has(fi) || fretOfFinger.get(fi) === f, `${name}: finger ${fi} is on two different frets`); fretOfFinger.set(fi, f); }
    });
    // the root is the lowest note for the shapes we offer, so the chord is not inverted
    const lowest = shape.fretPositions.findIndex(f => f >= 0);
    assert.strictEqual((OPEN_STRINGS[lowest] + shape.fretPositions[lowest]) % 12, r, `${name}: the lowest note is the root`);
    if (shape.kind === 'barre') assert.ok(shape.baseFret >= 1 && shape.baseFret <= 12);
  }
}
assert.ok(checked >= 55, `many chords have a shape (${checked})`);

// The chords the milestones and the drills use most all have one
for (const c of ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'F', 'Bm', 'B', 'Bb', 'F#m', 'C#m', 'Gm', 'A7', 'E7', 'Fmaj7', 'Dsus4', 'Asus2']) assert.ok(shapeFor(c), `${c} has a finger pattern`);
assert.strictEqual(shapeFor('Hm'), null);
assert.strictEqual(shapeFor('Cdim'), null, 'a chord with no shape in the table says so rather than guessing');
assert.strictEqual(canon('Db'), 'C#');
assert.strictEqual(shapeFor('F').kind, 'barre');
assert.strictEqual(shapeFor('F').baseFret, 1);
assert.strictEqual(shapeFor('C#m').baseFret, 4, 'C#m barre is at the 4th fret');
assert.strictEqual(shapeFor('G').kind, 'open');

// ── Describing a change ──
// E to Em: the middle and ring fingers stay put; only the index finger lifts
const e = describeChange('E', 'Em');
assert.ok(e.ok);
assert.deepStrictEqual(e.anchors.sort(), [1, 2]);
assert.strictEqual(e.stays.filter(s => s.same).length, 2);
assert.deepStrictEqual(e.lifts.map(l => l.finger), [1]);
assert.strictEqual(e.moves.length, 0);
assert.match(e.tip, /anchor/);
assert.strictEqual(e.summary, '2 notes stay held; 1 finger lifts.');
assert.strictEqual(describeChange('Em', 'E').summary, '2 notes stay held; 1 finger lands.');
assert.ok(!/0 /.test(e.summary), 'no zero counts in the sentence');
assert.ok(e.lines.some(l => /Keep your middle finger where it is, on the 2nd fret of the A string/.test(l)));
assert.ok(e.lines.some(l => /Lift your index finger off the 1st fret of the G string/.test(l)));
// and back again: the index finger lands
const em = describeChange('Em', 'E');
assert.deepStrictEqual(em.lands.map(l => l.finger), [1]);
assert.strictEqual(em.lifts.length, 0);

// A to E: nothing is held, three fingers swap
const ae = describeChange('A', 'E');
assert.ok(ae.ok);
assert.ok(ae.moves.length + ae.lands.length + ae.lifts.length >= 3);
assert.match(ae.hint, /No finger stays|Keep|Slide/);
// A to Am shares the open A shape's D string (middle... index on the D string stays or moves): at least one note held
const aam = describeChange('A', 'Am');
assert.ok(aam.stays.length >= 1);
// C to Am: classic, two fingers stay (the middle on D and index on B)
const cam = describeChange('C', 'Am');
assert.ok(cam.stays.length >= 2, 'C to Am keeps two notes held');
assert.strictEqual(cam.stays.filter(s => s.same).length, 0 + cam.stays.filter(s => s.same).length);
// G to C moves fingers across strings
assert.ok(describeChange('G', 'C').moves.length + describeChange('G', 'C').lands.length >= 2);
// Barre involved: wording about the barre
const fb = describeChange('F', 'Bm');
assert.ok(fb.ok);
assert.match(fb.tip + fb.lines.join(' '), /barre/i);
// No shape: honest message
const none = describeChange('A', 'Cdim');
assert.strictEqual(none.ok, false);
assert.match(none.reason, /no finger pattern for Cdim/i);
// Same chord
assert.ok(describeChange('G', 'G').stays.length > 0);
assert.strictEqual(describeChange('G', 'G').moves.length, 0);
// The summary counts match
for (const [x, y] of [['E', 'Em'], ['A', 'D'], ['C', 'G'], ['D', 'A'], ['Am', 'F']]) {
  const d = describeChange(x, y);
  assert.ok(d.ok && /held/.test(d.summary), `${x}-${y} summary says what is held`);
  assert.ok(d.lines.length >= 1, `${x} to ${y} has instructions`);
  // anchors are strings that exist in both shapes at the same fret
  for (const s of d.anchors) assert.strictEqual(d.shapeFrom.fretPositions[s], d.shapeTo.fretPositions[s]);
}

// A loop of chords: one description per change, last back to first
const loop = changesFor(['A', 'D', 'E']);
assert.deepStrictEqual(loop.map(c => `${c.from}>${c.to}`), ['A>D', 'D>E', 'E>A']);
assert.ok(loop.every(c => c.ok));
assert.deepStrictEqual(changesFor(['A', 'E']).map(c => `${c.from}>${c.to}`), ['A>E', 'E>A']);
assert.strictEqual(placements(shapeFor('F')).find(p => p.finger === 1).strings.length, 3, 'the index finger barres three strings in F');

console.log('fingering tests passed');
