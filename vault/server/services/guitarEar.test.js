'use strict';
const assert = require('assert');
const { cleanMisses, checkRound, summarise } = require('./guitarEar');

// Misses: only chord names and numerals, whole small counts
assert.deepStrictEqual(cleanMisses({ Am: 2, F: 1, 'V/vi': 3, IVmaj7: 1, 'vii°': 1, 'drop table': 5, G: -1, C: 1.5, Dm7: 'x' }), { Am: 2, F: 1, 'V/vi': 3, IVmaj7: 1, 'vii°': 1 });
assert.deepStrictEqual(cleanMisses(null), {});
assert.deepStrictEqual(cleanMisses(['Am']), {});
assert.strictEqual(Object.keys(cleanMisses(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`${'ABCDEFG'[i % 7]}`, 1])))).length <= 7, true);

// A round
assert.strictEqual(checkRound({ mode: 'chords', correct: 7, total: 10, misses: { Am: 2 } }).ok, true);
assert.strictEqual(checkRound({ mode: 'guess', correct: 1, total: 2 }).ok, false);
for (const mode of ['quality', 'progression', 'bass']) assert.strictEqual(checkRound({ mode, correct: 3, total: 10 }).ok, true, mode);
assert.deepStrictEqual(checkRound({ mode: 'progression', correct: 1, total: 4, misses: { 'I V vi IV': 2, 'ii V I': 1, 'nonsense words': 1 } }).value.misses, { 'I V vi IV': 2, 'ii V I': 1 });
assert.deepStrictEqual(checkRound({ mode: 'quality', correct: 1, total: 4, misses: { Em: 2, Major: 1 } }).value.misses, { Em: 2 }, 'a miss is a chord name, not a word');
assert.strictEqual(checkRound({ mode: 'chords', correct: 11, total: 10 }).ok, false);
assert.strictEqual(checkRound({ mode: 'chords', correct: -1, total: 10 }).ok, false);
assert.strictEqual(checkRound({ mode: 'chords', correct: 0, total: 0 }).ok, false);
assert.strictEqual(checkRound({ mode: 'chords', correct: 1, total: 101 }).ok, false);
assert.deepStrictEqual(checkRound({ mode: 'numerals', correct: 3, total: 5, misses: { bad: 1, IV: 2 } }).value.misses, { IV: 2 });

// Summary
const now = new Date('2026-11-09T00:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
const sessions = [  // newest first
  { mode: 'chords', correct: 9, total: 10, misses: { Am: 1 }, playedAt: ago(1) },
  { mode: 'chords', correct: 8, total: 10, misses: { Am: 1, F: 1 }, playedAt: ago(3) },
  { mode: 'chords', correct: 5, total: 10, misses: { F: 3, Bb: 2 }, playedAt: ago(8) },
  { mode: 'chords', correct: 4, total: 10, misses: { F: 4 }, playedAt: ago(12) },
  { mode: 'numerals', correct: 2, total: 5, misses: { IV: 3 }, playedAt: ago(2) },
  { mode: 'chords', correct: 10, total: 10, misses: {}, playedAt: ago(200) },   // too old
];
const s = summarise(sessions, now);
assert.strictEqual(s.byMode.chords.rounds, 4);
assert.strictEqual(s.byMode.chords.accuracy, 65);          // 26 of 40
assert.strictEqual(s.byMode.chords.trend, 'up');
assert.strictEqual(s.byMode.numerals.accuracy, 40);
assert.strictEqual(s.byMode.numerals.trend, null, 'one round has no trend');
assert.deepStrictEqual(s.topMisses[0], { name: 'F', count: 8 });
assert.deepStrictEqual(s.topMisses.map(m => m.name), ['F', 'IV', 'Am', 'Bb']);
assert.strictEqual(s.last.length, 5);
const empty = summarise([], now);
assert.strictEqual(empty.byMode.chords.accuracy, null);
assert.deepStrictEqual(empty.topMisses, []);

console.log('guitarEar tests passed');
