// node client/src/pages/guitar/pickPatterns.test.mjs
import assert from 'node:assert';
import {
  STAGES, PICK_CHORDS, PICK_CHORD_NAMES, OPEN_MIDI, SLOTS, FINGER_FOR, TREBLE, pickChord, locate, barFor, tabText, fingerLine, fingersUsed, fingerWords, stageById,
} from './pickPatterns.mjs';
import { rootSemi } from './theory.mjs';
import { shapeFor } from './fingering.mjs';

const TONES = { '': [0, 4, 7], m: [0, 3, 7] };
const split = (name) => { const m = /^([A-G][#b]?)(.*)$/.exec(name); return { root: rootSemi(m[1]), quality: m[2] }; };
const tonesOf = (name) => { const { root, quality } = split(name); return TONES[quality].map(t => (root + t) % 12); };
const pc = (midi) => midi % 12;

// Every chord in the table: the root string really holds the root, the alternate bass is another tone of the chord (the fifth),
// and the three treble strings are all played and are tones of the chord
for (const name of PICK_CHORD_NAMES) {
  const { root } = split(name);
  const tones = tonesOf(name);
  const r = locate(name, 'R'), a = locate(name, 'A');
  assert.strictEqual(pc(r.midi), root, `${name}: the root note is ${name}`);
  assert.ok(tones.includes(pc(a.midi)) && pc(a.midi) !== root, `${name}: the alternate bass is another tone of the chord`);
  // no extra finger is needed: each bass note is either open or exactly where the standard shape already has a finger
  const shape = shapeFor(name);
  for (const n of [r, a]) assert.ok(n.fret === 0 || shape.fretPositions[n.string] === n.fret, `${name}: string ${n.string} fret ${n.fret} is open or already fingered`);
    assert.ok(r.string <= 2 && a.string <= 2, `${name}: both bass notes are on the three thickest strings`);
  assert.notStrictEqual(r.string, a.string, `${name}: the two bass notes use different strings`);
  // the thumb notes sit below every treble note
  for (const role of ['G', 'B', 'E']) {
    const n = locate(name, role);
    assert.strictEqual(n.string, TREBLE[role], `${name}: ${role} is on string ${TREBLE[role]}`);
    assert.ok(n.fret >= 0, `${name}: the ${role} string is played in the standard shape`);
    assert.ok(tones.includes(pc(n.midi)), `${name}: the ${role} string plays a tone of the chord`);
    assert.ok(n.midi > r.midi && n.midi > a.midi, `${name}: ${role} is above the bass notes`);
  }
  assert.ok(tones.includes(pc(r.midi)) && tones.includes(pc(a.midi)), `${name}: bass notes are chord tones`);
  // the midi number is the open string plus the fret
  for (const role of ['R', 'A', 'G', 'B', 'E']) { const n = locate(name, role); assert.strictEqual(n.midi, OPEN_MIDI[n.string] + n.fret); }
}

// Known answers, so the table cannot be wrong in a way the rules above would let through
assert.deepStrictEqual(['R', 'A', 'G', 'B', 'E'].map(r => locate('C', r)).map(n => [n.string, n.fret]), [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
assert.deepStrictEqual(['R', 'A', 'G', 'B', 'E'].map(r => locate('G', r)).map(n => [n.string, n.fret]), [[0, 3], [2, 0], [3, 0], [4, 0], [5, 3]]);
assert.deepStrictEqual(['R', 'A'].map(r => locate('Am', r)).map(n => [n.string, n.fret]), [[1, 0], [2, 2]]);
assert.deepStrictEqual(['R', 'A', 'G', 'B', 'E'].map(r => locate('D', r)).map(n => [n.string, n.fret]), [[2, 0], [1, 0], [3, 2], [4, 3], [5, 2]]);

// Spelling is forgiven: Dm and the chord names from the chart both work; unknown chords give null, never a guess
assert.strictEqual(pickChord('Dm'), 'Dm');
assert.strictEqual(pickChord('F'), null);
assert.strictEqual(pickChord(''), null);
assert.strictEqual(locate('F', 'R'), null);
assert.strictEqual(locate('C', 'X'), null);
assert.strictEqual(barFor('F', STAGES[0]), null);
assert.strictEqual(tabText('F', STAGES[0]), null);

// The fingers: thumb on the bass, index G, middle B, ring on the high E
assert.deepStrictEqual(FINGER_FOR, { R: 'p', A: 'p', G: 'i', B: 'm', E: 'a' });

// Every rung: eight slots, only known roles, no role twice in one slot, ids are unique, words present
assert.strictEqual(new Set(STAGES.map(s => s.id)).size, STAGES.length);
for (const st of STAGES) {
  assert.strictEqual(st.slots.length, SLOTS, `${st.id}: eight slots`);
  assert.ok(st.name && st.what && st.tip, `${st.id}: has words`);
  let notes = 0;
  for (const roles of st.slots) {
    for (const r of roles) assert.ok(['R', 'A', 'G', 'B', 'E'].includes(r), `${st.id}: ${r} is a known role`);
    assert.strictEqual(new Set(roles).size, roles.length, `${st.id}: no role twice in a slot`);
    notes += roles.length;
  }
  assert.ok(notes >= 4, `${st.id}: something is plucked`);
  assert.ok(st.slots[0].length > 0, `${st.id}: the first beat is always plucked`);
  assert.strictEqual(stageById(st.id), st);
}
assert.strictEqual(stageById('nope'), null);

// The ladder climbs: it starts with the thumb alone and ends with the thumb alternating with fingers in between
assert.strictEqual(STAGES[0].id, 'thumb');
assert.deepStrictEqual(fingersUsed(STAGES[0]), ['p']);
assert.strictEqual(STAGES[STAGES.length - 1].id, 'travis');
// Alternating bass uses both bass roles and no treble
const alt = stageById('alt-bass');
assert.ok(alt.slots.flat().includes('R') && alt.slots.flat().includes('A'));
assert.ok(!alt.slots.flat().some(r => TREBLE[r] != null));
// Travis: the thumb falls on every beat (slots 0, 2, 4, 6) alternating root and alternate bass, fingers only between
const travis = stageById('travis');
[0, 2, 4, 6].forEach((i, k) => assert.deepStrictEqual(travis.slots[i], [k % 2 === 0 ? 'R' : 'A'], `Travis beat ${i}`));
[1, 3, 5, 7].forEach(i => assert.ok(travis.slots[i].every(r => TREBLE[r] != null), `Travis between-note ${i} is a finger`));
// Travis is alt-bass plus fingers: its thumb notes match the alternating bass rung exactly
assert.deepStrictEqual([0, 2, 4, 6].map(i => travis.slots[i]), [0, 2, 4, 6].map(i => alt.slots[i]));
// A treble note is never plucked on the same count as a different thumb note it could not reach: one thumb note per slot at most
for (const st of STAGES) for (const roles of st.slots) assert.ok(roles.filter(r => FINGER_FOR[r] === 'p').length <= 1, `${st.id}: one thumb note a slot`);

// Tab text: six lines, high E first, three characters a slot, the right frets
const lines = tabText('C', stageById('thumb'));
assert.strictEqual(lines.length, 6);
assert.ok(lines[0].startsWith('e|') && lines[5].startsWith('E|'));
assert.strictEqual(lines[4], 'A|' + ['-3-', '---', '-3-', '---', '-3-', '---', '-3-', '---'].join('') + '|');
assert.strictEqual(lines[0], 'e|' + '---'.repeat(8) + '|');
const cTravis = tabText('C', travis);
// C Travis: B string fret 1 on the "&" after each beat, high E open on the "&" after beats 2 and 4... check the B string line
assert.strictEqual(cTravis[1], 'B|' + ['---', '-1-', '---', '---', '---', '-1-', '---', '---'].join('') + '|');
for (const l of cTravis) assert.strictEqual(l.length, 2 + 3 * SLOTS + 1);
// In the tab for the alternating bass in G, the root is on the low E and the alternate is the open D string
const gAlt = tabText('G', alt);
assert.ok(gAlt[5].includes('-3-'));
assert.ok(gAlt[3].includes('-0-'));

// Finger line and words
assert.strictEqual(fingerLine(stageById('thumb')), 'p . p . p . p .');
assert.strictEqual(fingerLine(stageById('roll')), 'p . i . m . a .');
assert.strictEqual(fingerLine(stageById('pinch')), 'pa . m . pa . m .');
assert.strictEqual(fingerWords(stageById('thumb')), 'Thumb');
assert.strictEqual(fingerWords(stageById('roll')), 'Thumb, index finger, middle finger and ring finger');

console.log('pickPatterns tests passed');
