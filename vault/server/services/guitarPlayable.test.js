'use strict';
const assert = require('assert');
const p = require('./guitarPlayable');

const ev = (root, quality = '') => ({ chordRoot: root, chordQuality: quality });

// Chords of a chart: unique, in order, spellings merged, junk dropped
assert.deepStrictEqual(p.songChordNames([ev('G'), ev('C'), ev('G'), ev('A', 'm'), ev('Db'), ev('C#'), ev('H'), ev('E', 'm')]), ['G', 'C', 'Am', 'C#', 'Em']);
assert.deepStrictEqual(p.songChordNames([]), []);
assert.deepStrictEqual([...p.cleanKnown(['G', 'Am', 'nonsense', 'Cadd9', 7, null])], ['G', 'Am']);
assert.deepStrictEqual([...p.cleanKnown('G')], []);

const songs = [
  { id: 1, title: 'Easy One', chords: ['G', 'C', 'D'] },
  { id: 2, title: 'Easy Two', chords: ['G', 'Em'] },
  { id: 3, title: 'Needs D only', chords: ['C', 'G', 'D', 'Em'] },
  { id: 4, title: 'Barre song', chords: ['F', 'Bm', 'G'] },
  { id: 5, title: 'Empty', chords: [] },
  { id: 6, title: 'Needs Em', chords: ['C', 'Em'] },
];
const known = new Set(['G', 'C']);
const c = p.classifySongs(songs, known);
const by = (id) => c.find(s => s.id === id);
assert.strictEqual(by(1).playable, false);
assert.deepStrictEqual(by(1).missing, ['D']);
assert.strictEqual(by(5).playable, false, 'a song with no chords is not "playable"');
assert.strictEqual(p.classifySongs([{ id: 9, title: 'x', chords: ['G'] }], known)[0].playable, true);

// Which chord to learn: D opens Easy One; Em opens Easy Two and Needs Em (and Needs D only needs two more)
const sug = p.suggestChords(c);
assert.strictEqual(sug[0].chord, 'Em', 'the chord that unlocks the most songs comes first');
assert.strictEqual(sug[0].unlockCount, 2);
assert.deepStrictEqual(sug[0].unlocks.sort(), ['Easy Two', 'Needs Em']);
const d = sug.find(s => s.chord === 'D');
assert.strictEqual(d.unlockCount, 1);
assert.strictEqual(d.nearlyCount, 1, 'Needs D only is two chords away');
assert.ok(!sug.some(s => known.has(s.chord)), 'a chord already known is never suggested');
assert.strictEqual(p.suggestChords(p.classifySongs([{ id: 1, title: 'a', chords: ['G'] }], known)).length, 0);

// Roadmap to a song
const target = by(3);   // needs D and Em
const road = p.roadmap(target, c, known);
assert.strictEqual(road.ready, false);
assert.deepStrictEqual(road.steps.map(s => s.chord), ['Em', 'D'], 'the chord that opens more songs on the way is first');
assert.strictEqual(road.steps[0].unlockCount, 2);
assert.deepStrictEqual(road.steps[0].unlocks.sort(), ['Easy Two', 'Needs Em']);
assert.deepStrictEqual(road.steps[1].unlocks, ['Easy One']);
// A song you can already play has nothing to learn
assert.deepStrictEqual(p.roadmap({ id: 9, title: 'Done', chords: ['G'], missing: [] }, c, known), { ready: true, title: 'Done', steps: [] });
// Hard song: every chord appears once, in a stable order
const hard = p.roadmap(by(4), c, known);
assert.deepStrictEqual(hard.steps.map(s => s.chord).sort(), ['Bm', 'F']);
assert.strictEqual(hard.chordCount, 2);

console.log('guitarPlayable tests passed');
