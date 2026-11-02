// node client/src/pages/guitar/band.test.mjs
import assert from 'node:assert';
import {
  SLOTS, DRUM_STYLES, BASS_STYLES, PROGRESSIONS, drumHits, bassNote, rootMidi, midiFreq, bassLengthSlots,
  loopFromChords, loopFromSong, loopFromProgression, chordForBar,
} from './band.mjs';

// ── Drums ──
const bar = (style) => Array.from({ length: SLOTS }, (_, s) => drumHits(style, s));
const count = (style, kind) => bar(style).filter(h => h.includes(kind)).length;
assert.deepStrictEqual([count('rock', 'kick'), count('rock', 'snare'), count('rock', 'hat')], [2, 2, 8]);
assert.deepStrictEqual(bar('rock')[0], ['kick', 'hat'], 'beat 1: kick and hat');
assert.deepStrictEqual(bar('rock')[2], ['snare', 'hat'], 'beat 2: snare');
assert.deepStrictEqual(bar('rock')[6], ['snare', 'hat'], 'beat 4: snare');
assert.deepStrictEqual([count('pop', 'kick'), count('pop', 'snare'), count('pop', 'hat')], [3, 2, 4]);
assert.deepStrictEqual([count('ballad', 'kick'), count('ballad', 'snare'), count('ballad', 'hat')], [1, 1, 4]);
assert.deepStrictEqual(drumHits('off', 0), []);
assert.deepStrictEqual(drumHits('nonsense', 0), []);
assert.ok(DRUM_STYLES.every(d => d.id && d.name && d.tip));
// every slot stays inside the bar
for (const d of DRUM_STYLES) for (let s = 0; s < SLOTS; s++) assert.ok(Array.isArray(drumHits(d.id, s)));

// ── Bass ──
assert.strictEqual(rootMidi(4), 28, 'E is the lowest bass note');
assert.strictEqual(rootMidi(9), 33, 'A is A1');
assert.strictEqual(rootMidi(3), 39, 'Eb is the highest');
for (let pc = 0; pc < 12; pc++) assert.ok(rootMidi(pc) >= 28 && rootMidi(pc) <= 39, `pitch class ${pc} is in the bass range`);
assert.strictEqual(Math.round(midiFreq(33)), 55);
assert.strictEqual(Math.round(midiFreq(28) * 100) / 100, 41.2);
// roots on every beat only
assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7].map(s => bassNote('roots', s, 9)), [33, null, 33, null, 33, null, 33, null]);
// root and fifth: the fifth is seven semitones above the root, on beat 3
assert.deepStrictEqual([0, 2, 4, 6].map(s => bassNote('rootfifth', s, 9)), [33, 33, 40, 33]);
assert.strictEqual(bassNote('rootfifth', 4, 9) - bassNote('rootfifth', 0, 9), 7);
// eighths: a note on every slot
assert.ok([0, 1, 2, 3, 4, 5, 6, 7].every(s => bassNote('eighths', s, 2) === rootMidi(2)));
assert.strictEqual(bassNote('off', 0, 9), null);
assert.strictEqual(bassNote('nonsense', 0, 9), null);
assert.ok(bassLengthSlots('eighths') < bassLengthSlots('roots'));
assert.ok(BASS_STYLES.every(b => b.id && b.name && b.tip));

// ── Chord loops ──
assert.deepStrictEqual(loopFromChords(['A', 'D', 'E']).map(c => c.name), ['A', 'D', 'E']);
assert.deepStrictEqual(loopFromChords(['A', 'A', 'D', 'nonsense', 'Db', 'C#', 'Hm']).map(c => c.name), ['A', 'D', 'C#'], 'repeats and junk dropped, flats and sharps merged');
assert.strictEqual(loopFromChords(Array.from({ length: 20 }, (_, i) => (i % 2 ? 'C' : 'G'))).length, 8, 'at most eight bars');
assert.deepStrictEqual(loopFromChords([]), []);
assert.deepStrictEqual(loopFromChords(null), []);
assert.strictEqual(loopFromChords(['F#m'])[0].pc, 6);
// a song's chart
const events = [['C', ''], ['C', ''], ['A', 'm'], ['F', ''], ['G', ''], ['G', ''], ['C', '']].map(([chordRoot, chordQuality]) => ({ chordRoot, chordQuality }));
assert.deepStrictEqual(loopFromSong(events).map(c => c.name), ['C', 'Am', 'F', 'G', 'C']);
// progressions
assert.ok(PROGRESSIONS.length >= 10);
assert.strictEqual(new Set(PROGRESSIONS.map(p => p.id)).size, PROGRESSIONS.length);
const threeChord = PROGRESSIONS.find(p => p.name === 'The three-chord song');
assert.deepStrictEqual(loopFromProgression(9, threeChord.id).map(c => c.name), ['A', 'D', 'E'], 'I IV V in A');
assert.deepStrictEqual(loopFromProgression(0, threeChord.id).map(c => c.name), ['C', 'F', 'G']);
const pop = PROGRESSIONS.find(p => p.numerals === 'I V vi IV');
assert.deepStrictEqual(loopFromProgression(7, pop.id).map(c => c.name), ['G', 'D', 'Em', 'C']);
assert.deepStrictEqual(loopFromProgression(7, pop.id).map(c => c.pc), [7, 2, 4, 0]);
const minor = PROGRESSIONS.find(p => p.mode === 'minor');
assert.ok(loopFromProgression(9, minor.id)[0].name.endsWith('m'), 'a minor progression starts on a minor chord');
assert.deepStrictEqual(loopFromProgression(0, 'nope'), []);
// the bar a chord belongs to, counted from after the count-in
const loop = loopFromChords(['A', 'D', 'E']);
assert.strictEqual(chordForBar(loop, 0).name, 'A');
assert.strictEqual(chordForBar(loop, 1).name, 'D');
assert.strictEqual(chordForBar(loop, 3).name, 'A', 'it goes round');
assert.strictEqual(chordForBar(loop, -1), null, 'the count-in has no chord');
assert.strictEqual(chordForBar([], 0), null);

console.log('band tests passed');
