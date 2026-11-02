// node client/src/pages/guitar/earGig.test.mjs   (ear training questions and gig mode rules)
import assert from 'node:assert';
import { vocabulary, chordQuestion, numeralQuestion, scoreRound, missedCounts, shuffle, ROUND_LENGTH, OPTIONS } from './earQuestions.mjs';
import { clampBpm, chordMs, groupChart, keyAction, clampIndex, FONT_STEPS } from './gigPlay.mjs';

// A seeded random source so the questions are the same every run
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ── Vocabulary ──
const chords = [
  { root: 'C', quality: '', count: 10 }, { root: 'G', quality: '', count: 8 }, { root: 'A', quality: 'm', count: 6 },
  { root: 'F', quality: '', count: 5 }, { root: 'Db', quality: '', count: 1 }, { root: 'C#', quality: '', count: 2 }, { root: 'H', quality: '', count: 9 },
];
const v = vocabulary(chords);
assert.deepStrictEqual(v.map(c => c.name), ['C', 'G', 'Am', 'F', 'C#'], 'sorted by use, flat and sharp spellings merged, junk dropped');
assert.strictEqual(v.find(c => c.name === 'C#').count, 3);

// ── Chord questions ──
for (let seed = 1; seed <= 200; seed++) {
  const qn = chordQuestion({ chords, rng: seeded(seed) });
  assert.strictEqual(qn.options.length, OPTIONS);
  assert.strictEqual(new Set(qn.options).size, OPTIONS, 'no repeated choice');
  assert.ok(qn.options.includes(qn.answer), 'the answer is one of the choices');
  assert.strictEqual(qn.play.length, 1);
}
// With almost no chords the choices are filled from common ones, never repeated
const tiny = chordQuestion({ chords: [{ root: 'C', quality: '', count: 1 }], rng: seeded(3) });
assert.strictEqual(new Set(tiny.options).size, OPTIONS);
const none = chordQuestion({ chords: [], rng: seeded(4) });
assert.strictEqual(none.options.length, OPTIONS);
// The answer is always a chord from the person's own songs, never one of the padding chords
const ownNames = new Set(['C', 'G', 'Am', 'F', 'C#']);
for (let seed = 1; seed <= 300; seed++) assert.ok(ownNames.has(chordQuestion({ chords, rng: seeded(seed) }).answer), 'answer comes from your own chords');
// Chords you keep missing come up more
let hits = 0;
for (let seed = 1; seed <= 400; seed++) if (chordQuestion({ chords, missed: { F: 4 }, rng: seeded(seed) }).answer === 'F') hits++;
let base = 0;
for (let seed = 1; seed <= 400; seed++) if (chordQuestion({ chords, rng: seeded(seed) }).answer === 'F') base++;
assert.ok(hits > base * 1.5, `missed chords come up more (${hits} against ${base})`);
// A look-alike (same root, other quality) is offered when the song has one
const withLook = [{ root: 'A', quality: 'm', count: 9 }, { root: 'A', quality: '', count: 2 }, { root: 'C', quality: '', count: 2 }, { root: 'D', quality: '', count: 2 }, { root: 'G', quality: '', count: 2 }, { root: 'E', quality: '', count: 2 }];
let both = 0;
for (let seed = 1; seed <= 100; seed++) { const x = chordQuestion({ chords: withLook, rng: seeded(seed) }); if (x.answer === 'Am' && x.options.includes('A')) both++; }
assert.ok(both > 0, 'a close chord is among the choices');

// ── Numeral questions ──
const songs = [
  { id: 1, title: 'Song A', keyDetected: 'C major', chords: [{ root: 'C', quality: '', count: 6 }, { root: 'G', quality: '', count: 4 }, { root: 'A', quality: 'm', count: 3 }, { root: 'F', quality: '', count: 3 }, { root: 'E', quality: '', count: 1 }, { root: 'G', quality: '7', count: 2 }] },
  { id: 2, title: 'Song B', keyDetected: null, chords: [{ root: 'A', quality: 'm', count: 5 }, { root: 'F', quality: '', count: 3 }, { root: 'C', quality: '', count: 3 }, { root: 'G', quality: '', count: 3 }] },
];
for (let seed = 1; seed <= 200; seed++) {
  const n = numeralQuestion({ songs, rng: seeded(seed) });
  assert.ok(n, 'a question is made');
  assert.strictEqual(new Set(n.options).size, n.options.length);
  assert.ok(n.options.includes(n.answer));
  assert.ok(n.options.length >= 3 && n.options.length <= OPTIONS);
  assert.strictEqual(n.play.length, 2, 'the key chord, then the chord to name');
  assert.ok(!n.options.some(o => /7/.test(o)), 'no seventh gives the answer away');
  assert.ok(!/V\/|bVII/.test(n.answer), 'only chords inside the key are asked');
}
// Song B has no detected key: it is worked out (A minor) so its chords still make questions
const b = numeralQuestion({ songs: [songs[1]], rng: seeded(9) });
assert.ok(b && b.keyLabel === 'A minor');
assert.deepStrictEqual(b.play[0], { root: 'A', quality: 'm' });
// Known answer in a fixed key: G in C major is V
const c = numeralQuestion({ songs: [{ id: 1, title: 'X', keyDetected: 'C major', chords: [{ root: 'C', quality: '', count: 1 }, { root: 'G', quality: '', count: 1 }] }], rng: seeded(2) });
assert.ok(['I', 'V'].includes(c.answer));
assert.strictEqual(c.play[1].root, c.answer === 'I' ? 'C' : 'G');
assert.strictEqual(numeralQuestion({ songs: [], rng: seeded(1) }), null);
assert.strictEqual(numeralQuestion({ songs: [{ id: 3, title: 'One chord', keyDetected: 'C major', chords: [{ root: 'C', quality: '', count: 9 }] }] }), null);

// ── Scoring ──
const round = [{ answer: 'Am', picked: 'Am' }, { answer: 'F', picked: 'C' }, { answer: 'F', picked: 'G' }, { answer: 'G', picked: 'G' }];
assert.deepStrictEqual(scoreRound(round), { correct: 2, total: 4, misses: { F: 2 } });
assert.deepStrictEqual(missedCounts(round), { F: 2 });
assert.strictEqual(ROUND_LENGTH, 10);
assert.strictEqual(shuffle([1, 2, 3, 4], seeded(5)).length, 4);

// ── Gig mode ──
assert.strictEqual(clampBpm(100), 100);
assert.strictEqual(clampBpm(5), 30);
assert.strictEqual(clampBpm(900), 240);
assert.strictEqual(clampBpm(null), 100);
assert.strictEqual(chordMs(120, 4), 2000);
assert.strictEqual(chordMs(60, 2), 2000);
assert.strictEqual(chordMs(undefined, 4), 2400);

const events = [
  { sectionName: 'Verse', lineIdx: 0, lyricText: 'one', chordRoot: 'C' }, { sectionName: 'Verse', lineIdx: 0, chordRoot: 'G' },
  { sectionName: 'Verse', lineIdx: 1, lyricText: 'two', chordRoot: 'A' },
  { sectionName: 'Chorus', lineIdx: 2, chordRoot: 'F' }, { sectionName: 'Capo 2', lineIdx: 3, chordRoot: 'C' },
];
const g = groupChart(events);
assert.deepStrictEqual(g.map(s => [s.name, s.lines.length]), [['Verse', 2], ['Chorus', 1], [null, 1]], 'a Capo line is not a section');
assert.deepStrictEqual(g[0].lines[0].evs.map(e => e.flatIdx), [0, 1]);
assert.strictEqual(g[0].lines[0].lyric, 'one');
assert.strictEqual(g[2].lines[0].evs[0].flatIdx, 4);
assert.deepStrictEqual(groupChart([]), []);

for (const [k, a] of [[' ', 'toggle'], ['ArrowRight', 'next'], ['PageDown', 'next'], ['ArrowLeft', 'prev'], ['PageUp', 'prev'], ['+', 'bigger'], ['-', 'smaller'], ['n', 'nextSong'], ['p', 'prevSong'], [']', 'faster'], ['[', 'slower']]) {
  assert.strictEqual(keyAction(k), a, `${JSON.stringify(k)} is ${a}`);
}
assert.strictEqual(keyAction('x'), null);
assert.strictEqual(keyAction('Escape'), null, 'Escape is left to the window');
assert.strictEqual(clampIndex(-3, 5), 0);
assert.strictEqual(clampIndex(9, 5), 4);
assert.strictEqual(clampIndex(2, 0), 0);
assert.ok(FONT_STEPS.every((n, i) => i === 0 || n > FONT_STEPS[i - 1]));

console.log('earGig tests passed');
