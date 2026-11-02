// node client/src/pages/guitar/pairs.test.mjs
import assert from 'node:assert';
import { MAJOR_MINOR_PAIRS, pairDifference } from './pairs.mjs';

assert.strictEqual(MAJOR_MINOR_PAIRS.length, 3);
for (const [major, minor] of MAJOR_MINOR_PAIRS) {
  const d = pairDifference(major, minor);
  assert.ok(d.ok, `${major}/${minor} has shapes`);
  assert.ok(d.single, `${major}/${minor}: exactly one note changes`);
  const [s] = d.strings;
  // that note is the 3rd: four half steps above the root in the major, three in the minor
  assert.strictEqual(s.majorInterval, 4, `${major}: major 3rd`);
  assert.strictEqual(s.minorInterval, 3, `${minor}: minor 3rd`);
  assert.strictEqual(s.majorFret - s.minorFret, 1, 'one fret lower');
  assert.ok(d.sentence.includes(s.majorNote) && d.sentence.includes(s.minorNote));
}
// known answers, so a wrong fret in the shape table cannot slip through
const e = pairDifference('E', 'Em').strings[0];
assert.deepStrictEqual([e.stringName, e.majorNote, e.minorNote], ['G', 'G#', 'G']);
const a = pairDifference('A', 'Am').strings[0];
assert.deepStrictEqual([a.stringName, a.majorNote, a.minorNote], ['B', 'C#', 'C']);
const d = pairDifference('D', 'Dm').strings[0];
assert.deepStrictEqual([d.stringName, d.majorNote, d.minorNote], ['high E', 'F#', 'F']);
// a chord with no fingering says so
assert.strictEqual(pairDifference('E', 'Hm').ok, false);
// pairs whose shapes differ in more than the 3rd are not claimed to be single-note
assert.ok(!MAJOR_MINOR_PAIRS.some(([x]) => x === 'C'));

console.log('pairs tests passed');
