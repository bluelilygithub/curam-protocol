'use strict';
const assert = require('assert');
const { chordLabel, isChord, pairKey, countTransitions, rankTransitions, ratePerMin } = require('./guitarTransitions');
const { buildQueue } = require('./guitarPractice');

const ev = (songId, root, q = '') => ({ songId, chordRoot: root, chordQuality: q });

assert.strictEqual(chordLabel('Db', 'm'), 'C#m');
assert.strictEqual(chordLabel('G', ''), 'G');
assert.ok(isChord('F') && isChord('Cmaj7') && isChord('Bbm7b5'));
assert.ok(!isChord('H') && !isChord('') && !isChord('Cadd9'));
assert.strictEqual(pairKey('G', 'C'), pairKey('C', 'G'));

// G C G C then a second song with C G: the order does not matter, repeats of one chord are not changes
const events = [
  ev(1, 'G'), ev(1, 'C'), ev(1, 'C'), ev(1, 'G'), ev(1, 'C'),
  ev(2, 'C'), ev(2, 'G'), ev(2, 'A', 'm'),
];
const pairs = countTransitions(events);
const gc = pairs.get('C|G');
assert.strictEqual(gc.count, 4);               // G>C, C>G, G>C, C>G
assert.strictEqual(gc.songs.size, 2);
assert.strictEqual(pairs.get('Am|G').count, 1);
// A change never spans two songs (last chord of song 1 -> first of song 2)
assert.strictEqual(countTransitions([ev(1, 'G'), ev(2, 'C')]).size, 0);
// An unreadable chord breaks the chain
assert.strictEqual(countTransitions([ev(1, 'G'), ev(1, 'Z'), ev(1, 'C')]).size, 0);

const now = new Date('2026-11-02T00:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();

// A change heard once is not offered
let ranked = rankTransitions(pairs, [], now);
assert.deepStrictEqual(ranked.map(r => `${r.a}${r.b}`), ['CG']);
assert.strictEqual(ranked[0].lastRate, null);

// More frequent and slower comes first
const many = countTransitions([
  ev(1, 'F'), ev(1, 'C'), ev(1, 'F'), ev(1, 'C'), ev(1, 'F'), ev(1, 'C'), ev(1, 'F'), ev(1, 'C'), ev(1, 'F'),
  ev(1, 'G'), ev(1, 'D'), ev(1, 'G'), ev(1, 'D'),
]);
ranked = rankTransitions(many, [], now);
assert.deepStrictEqual(ranked.map(r => `${r.a}${r.b}`), ['CF', 'DG']);

// Scores: 20 changes in a minute is two thirds of the way; 40 clears the pair out of the queue
assert.strictEqual(ratePerMin({ changes: 20, seconds: 60 }), 20);
assert.strictEqual(ratePerMin({ changes: 15, seconds: 30 }), 30);
const scores = [
  { chordA: 'C', chordB: 'F', changes: 12, seconds: 60, playedAt: ago(10) },
  { chordA: 'F', chordB: 'C', changes: 20, seconds: 60, playedAt: ago(9) },   // reversed order is the same pair
  { chordA: 'D', chordB: 'G', changes: 40, seconds: 60, playedAt: ago(9) },
];
ranked = rankTransitions(many, scores, now);
const cf = ranked.find(r => r.a === 'C' && r.b === 'F');
assert.strictEqual(cf.lastRate, 20);
assert.strictEqual(cf.bestRate, 20);
assert.strictEqual(cf.tries, 2);
assert.ok(cf.priority > 0);
assert.strictEqual(ranked.find(r => r.a === 'D' && r.b === 'G').priority, 0);
// Just practised: pushed down
const fresh = rankTransitions(many, [{ chordA: 'C', chordB: 'F', changes: 20, seconds: 60, playedAt: ago(0.1) }], now);
assert.ok(fresh.find(r => r.a === 'C').priority < cf.priority);

// Today's queue gets one drill, last, and none when everything is at target
const song = [{ id: 1, title: 'A', learnStatus: 'learning', lastPracticedAt: ago(1) }];
const q = buildQueue(song, [], now, ranked);
assert.strictEqual(q[q.length - 1].kind, 'transition');
assert.strictEqual(q[q.length - 1].a, 'C');
assert.strictEqual(buildQueue(song, [], now, ranked.filter(r => r.priority === 0)).some(i => i.kind === 'transition'), false);
assert.strictEqual(buildQueue(song, [], now).some(i => i.kind === 'transition'), false);

console.log('guitarTransitions tests passed');
