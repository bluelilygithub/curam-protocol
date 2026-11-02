'use strict';
const assert = require('assert');
const { practiceState, buildQueue } = require('./guitarPractice');

const now = new Date('2026-11-02T00:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();

// Learning never decays
assert.strictEqual(practiceState({ learnStatus: 'learning', lastPracticedAt: ago(90) }, now), 'learning');
// Unknown status is treated as learning
assert.strictEqual(practiceState({ learnStatus: null }, now), 'learning');
// Ready stays Ready inside the window, Rusty at the limit
assert.strictEqual(practiceState({ learnStatus: 'ready', lastPracticedAt: ago(13) }, now), 'ready');
assert.strictEqual(practiceState({ learnStatus: 'ready', lastPracticedAt: ago(14) }, now), 'rusty');
assert.strictEqual(practiceState({ learnStatus: 'polishing', lastPracticedAt: ago(30) }, now), 'rusty');
// Per-song limit
assert.strictEqual(practiceState({ learnStatus: 'ready', lastPracticedAt: ago(8), rustyAfterDays: 7 }, now), 'rusty');
// Never played: counts from when it was added
assert.strictEqual(practiceState({ learnStatus: 'ready', lastPracticedAt: null, createdAt: ago(40) }, now), 'rusty');
assert.strictEqual(practiceState({ learnStatus: 'ready', lastPracticedAt: null, createdAt: ago(2) }, now), 'ready');

const songs = [
  { id: 1, title: 'A', learnStatus: 'learning', lastPracticedAt: ago(1) },
  { id: 2, title: 'B', learnStatus: 'learning', lastPracticedAt: ago(5) },
  { id: 3, title: 'C', learnStatus: 'ready', lastPracticedAt: ago(40) },
  { id: 4, title: 'D', learnStatus: 'polishing', lastPracticedAt: ago(2) },
  { id: 5, title: 'E', learnStatus: 'ready', lastPracticedAt: ago(1) },
];
const loops = [{ id: 10, name: 'solo', songId: 1, startTimeSec: 10, endTimeSec: 20 }, { id: 11, name: 'intro', songId: 2, startTimeSec: 0, endTimeSec: 8 }];
const q = buildQueue(songs, loops, now);
assert.deepStrictEqual(q.map(i => i.kind), ['learning', 'loop', 'rusty', 'polishing']);
assert.strictEqual(q[0].songId, 2, 'learning pick is the least recently played');
assert.strictEqual(q[1].loopId, 11, 'loop comes from the least recently played song still being learned');
assert.strictEqual(q[2].songId, 3);
assert.strictEqual(q[3].songId, 4);
// A song is never offered twice as a song slot
const ids = q.filter(i => i.kind !== 'loop').map(i => i.songId);
assert.strictEqual(new Set(ids).size, ids.length);
// Empty library gives an empty queue
assert.deepStrictEqual(buildQueue([], [], now), []);
// Only a ready, fresh song: nothing to suggest
assert.deepStrictEqual(buildQueue([{ id: 9, learnStatus: 'ready', lastPracticedAt: ago(1) }], [], now), []);

console.log('guitarPractice tests passed');
