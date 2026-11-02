// node client/src/pages/guitar/barreStages.test.mjs
import assert from 'node:assert';
import { STAGES, HOLD_SECONDS, CLEAR_AT, eShapeBarre, slideStep, stageStatus, ladder } from './barreStages.mjs';
import { rootSemi } from './theory.mjs';

const OPEN_STRINGS = [4, 9, 2, 7, 11, 4];   // low E to high E, semitones above C
const TONES = { '': [0, 4, 7], m: [0, 3, 7] };
const split = (name) => { const m = /^([A-G][#b]?)(.*)$/.exec(name); return { root: rootSemi(m[1]), quality: m[2] }; };

// Every shape plays only notes of its chord, includes the root, and the thick strings it skips are not wrongly marked
for (const st of STAGES) {
  const { root, quality } = split(st.chord);
  const tones = TONES[quality].map(t => (root + t) % 12);
  const played = st.shape.fretPositions.map((f, s) => (f < 0 ? null : (OPEN_STRINGS[s] + f) % 12));
  for (const n of played.filter(x => x != null)) assert.ok(tones.includes(n), `${st.id}: ${n} is a tone of ${st.chord}`);
  assert.ok(played.includes(root), `${st.id}: the root is played`);
  // a fingered note has a finger; a finger sits on a played, fretted string
  st.shape.fretPositions.forEach((f, s) => {
    const finger = st.shape.fingerPositions[s];
    if (f > 0) assert.ok(finger > 0, `${st.id}: string ${s} has a finger`);
    if (f <= 0) assert.strictEqual(finger, 0, `${st.id}: no finger on string ${s}`);
  });
  // the strings to check are exactly the ones that are played
  assert.deepStrictEqual(st.check, st.shape.fretPositions.map((f, s) => (f >= 0 ? s : -1)).filter(s => s >= 0), `${st.id}: check the strings that are played`);
  assert.ok(st.what && st.tip && st.name && st.id);
}
assert.strictEqual(new Set(STAGES.map(s => s.id)).size, STAGES.length);

// The ladder climbs: more strings are barred at each of the first three rungs
const played = (id) => STAGES.find(s => s.id === id).check.length;
assert.ok(played('two-strings') < played('mini-f') && played('mini-f') < played('full-f'));
// The known answers
assert.deepStrictEqual(STAGES.find(s => s.id === 'full-f').shape.fretPositions, [1, 3, 3, 2, 1, 1]);
assert.deepStrictEqual(STAGES.find(s => s.id === 'mini-f').shape.fretPositions, [-1, -1, 3, 2, 1, 1]);
assert.deepStrictEqual(STAGES.find(s => s.id === 'b-flat').shape.fretPositions, [-1, 1, 3, 3, 3, 1]);

// The slide: F, F sharp, G, A flat, A, with every position a real chord
assert.deepStrictEqual([1, 2, 3, 4, 5].map(n => slideStep(n).chord), ['F', 'F#', 'G', 'Ab', 'A']);
for (let n = 1; n <= 5; n++) {
  const { chord, shape } = slideStep(n);
  const { root } = split(chord);
  const notes = shape.fretPositions.map((f, s) => (OPEN_STRINGS[s] + f) % 12);
  assert.ok(notes.every(x => [0, 4, 7].map(t => (root + t) % 12).includes(x)), `slide ${chord}`);
  assert.strictEqual(shape.baseFret, n);
}
assert.strictEqual(slideStep(0).fret, 1);
assert.strictEqual(slideStep(99).fret, 5);
assert.deepStrictEqual(eShapeBarre(1).fretPositions, [1, 3, 3, 2, 1, 1]);

// Progress
assert.strictEqual(HOLD_SECONDS, 10);
const holds = [
  { stage: 'two-strings', clean: true }, { stage: 'two-strings', clean: true }, { stage: 'two-strings', clean: false },
  { stage: 'two-strings', clean: true }, { stage: 'mini-f', clean: true },
];
assert.deepStrictEqual(stageStatus('two-strings', holds), { clean: CLEAR_AT, total: 4, cleared: true, left: 0 });
assert.deepStrictEqual(stageStatus('mini-f', holds), { clean: 1, total: 1, cleared: false, left: CLEAR_AT - 1 });
assert.deepStrictEqual(stageStatus('full-f', []), { clean: 0, total: 0, cleared: false, left: CLEAR_AT });
// a messy hold does not count towards clearing
assert.strictEqual(stageStatus('two-strings', [{ stage: 'two-strings', clean: false }]).cleared, false);
// next up is the first rung not cleared, and only one rung is next
const l = ladder(holds);
assert.deepStrictEqual(l.map(r => r.next), [false, true, false, false, false]);
assert.strictEqual(ladder([]).filter(r => r.next).length, 1);
assert.strictEqual(ladder([]).find(r => r.next).stage.id, 'two-strings');
assert.strictEqual(ladder(STAGES.flatMap(s => Array.from({ length: CLEAR_AT }, () => ({ stage: s.id, clean: true })))).some(r => r.next), false, 'nothing is next once all are cleared');

console.log('barreStages tests passed');
