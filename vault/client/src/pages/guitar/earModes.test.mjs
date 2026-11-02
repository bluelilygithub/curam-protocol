// node client/src/pages/guitar/earModes.test.mjs
import assert from 'node:assert';
import { qualityQuestion, bassQuestion, progressionQuestion, scoreRound, OPTIONS } from './earQuestions.mjs';
import { PROGRESSION_LIBRARY } from './progressions.mjs';
import { NAMES, rootSemi } from './theory.mjs';

const seeded = (seed) => { const next = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; for (let i = 0; i < 5; i++) next(); return next; };
const chords = [
  { root: 'A', quality: '', count: 9 }, { root: 'D', quality: '', count: 6 }, { root: 'E', quality: '', count: 6 },
  { root: 'E', quality: 'm', count: 4 }, { root: 'A', quality: 'm', count: 3 }, { root: 'G', quality: '7', count: 2 },
];

// ── Major or minor ──
let sawMajor = 0, sawMinor = 0;
for (let seed = 1; seed <= 60; seed++) {
  const q = qualityQuestion({ chords, rng: seeded(seed) });
  assert.strictEqual(q.mode, 'quality');
  assert.deepStrictEqual(q.options, ['Major', 'Minor']);
  assert.ok(q.options.includes(q.answer));
  const played = q.play[0];
  assert.strictEqual(played.quality === 'm' ? 'Minor' : 'Major', q.answer, 'the answer matches the chord played');
  assert.ok(['', 'm'].includes(played.quality), 'only plain major and minor chords, nothing that gives it away');
  assert.strictEqual(q.key, q.chordName, 'a miss is counted against the chord');
  // the pair differs only in the quality, same root
  assert.strictEqual(q.compare[0].root, q.compare[1].root);
  assert.deepStrictEqual(q.compare.map(c => c.quality), ['', 'm']);
  if (q.answer === 'Major') sawMajor++; else sawMinor++;
}
assert.ok(sawMajor > 10 && sawMinor > 10, 'both answers come up');
// chords come from the person's own songs when they have both kinds
for (let seed = 1; seed <= 30; seed++) {
  const q = qualityQuestion({ chords, rng: seeded(seed) });
  assert.ok(['A', 'D', 'E', 'Am', 'Em'].includes(q.chordName), `own chord ${q.chordName}`);
}
// with no songs at all a common chord of the right kind is used
const empty = qualityQuestion({ chords: [], rng: seeded(5) });
assert.strictEqual(empty.play[0].quality === 'm' ? 'Minor' : 'Major', empty.answer);
// a chord that was missed comes up more often
let hits = 0;
for (let seed = 1; seed <= 200; seed++) {
  const q = qualityQuestion({ chords: [{ root: 'A', quality: '', count: 1 }, { root: 'D', quality: '', count: 1 }, { root: 'E', quality: '', count: 1 }], missed: { D: 5 }, rng: seeded(seed) });
  if (q.answer === 'Major' && q.chordName === 'D') hits++;
}
assert.ok(hits > 200 / 2 * 0.5, 'D (missed) is picked most among the major chords');

// ── Bass note ──
for (let seed = 1; seed <= 60; seed++) {
  const q = bassQuestion({ chords, rng: seeded(seed) });
  assert.strictEqual(q.mode, 'bass');
  assert.strictEqual(q.options.length, OPTIONS);
  assert.strictEqual(new Set(q.options).size, OPTIONS, 'no repeated choice');
  assert.ok(q.options.every(o => NAMES.includes(o)), 'choices are note names');
  assert.strictEqual(q.answer, NAMES[rootSemi(q.play[0].root)], 'the answer is the root of the chord played');
  assert.strictEqual(q.bass.root, q.answer, 'the hint plays the answer');
  assert.ok(q.options.includes(q.answer));
}
const bassEmpty = bassQuestion({ chords: [], rng: seeded(2) });
assert.strictEqual(new Set(bassEmpty.options).size, OPTIONS);

// ── Progression ──
const songs = [
  { title: 'A song', keyDetected: 'A major', chords: [{ root: 'A', quality: '', count: 4 }, { root: 'D', quality: '', count: 3 }, { root: 'E', quality: '', count: 3 }] },
  { title: 'Sad one', keyDetected: 'E minor', chords: [{ root: 'E', quality: 'm', count: 4 }, { root: 'A', quality: 'm', count: 3 }, { root: 'B', quality: '', count: 3 }] },
];
for (let seed = 1; seed <= 60; seed++) {
  const q = progressionQuestion({ songs, rng: seeded(seed) });
  assert.strictEqual(q.mode, 'progression');
  assert.ok(q.options.includes(q.answer));
  assert.strictEqual(new Set(q.options).size, q.options.length, 'no repeated choice');
  assert.ok(q.options.length >= 3);
  const minor = /minor/.test(q.keyLabel);
  const list = PROGRESSION_LIBRARY[minor ? 'minor' : 'major'];
  assert.ok(q.options.every(o => list.some(p => p.numerals === o)), 'choices come from the same mode');
  const prog = list.find(p => p.numerals === q.answer);
  assert.strictEqual(q.play.length, prog.steps.length + 1, 'the key chord then the progression');
  assert.strictEqual(q.chordNames.length, prog.steps.length);
  assert.strictEqual(q.progressionName, prog.name);
  assert.strictEqual(q.key, q.answer);
  assert.ok(q.step > 0);
}
// the chords played are the progression in the key: three-chord song in A
const three = { steps: [[0, ''], [5, ''], [7, '']] };
let found = null;
for (let seed = 1; seed <= 400 && !found; seed++) {
  const q = progressionQuestion({ songs: [songs[0]], rng: seeded(seed) });
  if (q.answer === 'I IV V') found = q;
}
assert.ok(found, 'the three-chord song comes up');
assert.deepStrictEqual(found.chordNames, ['A', 'D', 'E']);
assert.deepStrictEqual(found.play.map(c => c.root), ['A', 'A', 'D', 'E']);
assert.ok(three.steps.length === found.chordNames.length);
// with no songs it still makes a question in a friendly major key
const noSongs = progressionQuestion({ songs: [], rng: seeded(8) });
assert.ok(/major/.test(noSongs.keyLabel));
// a progression that was missed comes up more often
let again = 0;
for (let seed = 1; seed <= 300; seed++) if (progressionQuestion({ songs: [songs[0]], missed: { 'ii V I': 6 }, rng: seeded(seed) }).answer === 'ii V I') again++;
let base = 0;
for (let seed = 1; seed <= 300; seed++) if (progressionQuestion({ songs: [songs[0]], rng: seeded(seed) }).answer === 'ii V I') base++;
assert.ok(again > base, 'a missed progression comes up more');

// ── Scoring: a question with a key counts its miss against the key ──
const score = scoreRound([
  { answer: 'Minor', picked: 'Major', key: 'Em' },
  { answer: 'Minor', picked: 'Minor', key: 'Am' },
  { answer: 'E', picked: 'A', key: 'E' },
  { answer: 'IV', picked: 'V' },
]);
assert.deepStrictEqual(score, { correct: 1, total: 4, misses: { Em: 1, E: 1, IV: 1 } });

console.log('earModes tests passed');
