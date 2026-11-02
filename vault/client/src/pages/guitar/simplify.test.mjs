// node client/src/pages/guitar/simplify.test.mjs
import assert from 'node:assert';
import { easyShape, simplifySong, summarise, thinChanges } from './simplify.mjs';

// Single chords
assert.deepStrictEqual(easyShape('G'), { play: 'G', kind: 'same', note: null, cost: 0 });
assert.strictEqual(easyShape('F', 'easier').play, 'Fmaj7');
assert.strictEqual(easyShape('F', 'easier').kind, 'substitute');
assert.match(easyShape('F', 'easier').note, /softer/);
assert.strictEqual(easyShape('F', 'exact').play, 'F', 'exact never changes a chord');
assert.strictEqual(easyShape('F', 'exact').kind, 'barre');
assert.strictEqual(easyShape('Bm', 'easier').play, 'Bm7');
assert.strictEqual(easyShape('B', 'easier').play, 'B7');
assert.strictEqual(easyShape('Bm7', 'easier').kind, 'same', 'Bm7 is easy');
// Fewer notes: a hard seventh becomes the plain chord when that is easier
assert.strictEqual(easyShape('Fm7', 'easier').play, 'Fm7', 'F minor 7 is left alone: F minor is no easier, still a barre');
assert.strictEqual(easyShape('Fm7', 'easier').kind, 'barre');
assert.strictEqual(easyShape('Gsus2', 'easier').play, 'G', 'a hard suspended chord becomes the plain one');
assert.strictEqual(easyShape('Gsus2', 'easier').kind, 'triad');
// No easy twin: it stays a barre and says so
assert.strictEqual(easyShape('Bb', 'easier').kind, 'barre');
assert.strictEqual(easyShape('Bb', 'easier').play, 'Bb');
assert.strictEqual(easyShape('nonsense', 'easier').kind, 'barre');

const ch = (...names) => names.map(n => { const m = /^([A-G][#b]?)(.*)$/.exec(n); return { root: m[1], quality: m[2] }; });

// A song with barre chords in the key of F: Bb F Gm Eb. Capo 3 makes them G D Em C: no barres, and the sound is unchanged
const flat = simplifySong(ch('Bb', 'F', 'Gm', 'Eb', 'Bb', 'F'), { level: 'exact' });
assert.strictEqual(flat.capo, 3);
assert.strictEqual(flat.barresAfter, 0);
assert.strictEqual(flat.barresBefore, 4);
assert.strictEqual(flat.changed, 0, 'the exact level changes no chord');
assert.strictEqual(flat.chords.find(c => c.concert === 'Bb').play, 'G');
assert.match(summarise(flat), /Capo 3, no barre chords, down from 4/);

// A song whose only hard chord is F. With the capo free, capo 5 makes every chord an easy open shape and the sound is exact:
// better than swapping the chord
const campfire = simplifySong(ch('G', 'C', 'F', 'G', 'C', 'F', 'D'), { level: 'easier' });
assert.strictEqual(campfire.capo, 5);
assert.strictEqual(campfire.barresAfter, 0);
assert.strictEqual(campfire.changed, 0, 'no chord had to be swapped');
assert.strictEqual(campfire.chords.find(c => c.concert === 'F').play, 'C');
// With the capo kept off (a person who does not want one), the F is swapped for an Fmaj7 and the plan says so
const noCapo = simplifySong(ch('G', 'C', 'F', 'G', 'C', 'F', 'D'), { level: 'easier', maxCapo: 0 });
assert.strictEqual(noCapo.capo, 0);
assert.strictEqual(noCapo.chords.find(c => c.concert === 'F').play, 'Fmaj7');
assert.strictEqual(noCapo.changed, 1);
assert.strictEqual(noCapo.barresAfter, 0);
// The exact level never swaps a chord, even with no capo allowed: the F stays and is reported as a barre
const exactNoCapo = simplifySong(ch('G', 'C', 'F', 'G', 'C', 'F', 'D'), { level: 'exact', maxCapo: 0 });
assert.strictEqual(exactNoCapo.chords.find(c => c.concert === 'F').play, 'F');
assert.strictEqual(exactNoCapo.barresAfter, 1);
assert.strictEqual(exactNoCapo.changed, 0);

// Already easy: nothing to do
const easy = simplifySong(ch('G', 'C', 'D', 'Em'), { level: 'easier' });
assert.strictEqual(easy.capo, 0);
assert.strictEqual(easy.barresAfter, 0);
assert.strictEqual(easy.changed, 0);
assert.match(summarise(easy), /No capo, no barre chords/);
assert.ok(!/down from/.test(summarise(easy)));
// Empty and junk
assert.strictEqual(simplifySong([]), null);
assert.strictEqual(simplifySong([{ root: 'H', quality: '' }]), null);
// A chord played often matters more than one played once
const weighted = simplifySong([...ch('F', 'F', 'F', 'F', 'F', 'F'), ...ch('G')], { level: 'exact' });
assert.ok(weighted.capo > 0 && weighted.barresAfter === 0, 'the capo is chosen for the chord played most');

// Fast changes
const events = [0, 1, 2, 2.4, 3, 6, 8].map((t, i) => ({ id: i + 1, timestampSec: t }));
// at 120 bpm a beat is 0.5s, so two beats is 1s: the chord at 2s lasts 0.4s (skip), and the one at 2.4s lasts 0.6s (skip)
const skip = thinChanges(events, 120, 2);
assert.ok(skip.has(3) && skip.has(4), 'chords held less than two beats are skipped');
assert.ok(!skip.has(1), 'the first chord is never skipped');
assert.ok(!skip.has(6) && !skip.has(7), 'chords held a long time stay');
assert.strictEqual(skip.has(7), false, 'the last chord stays');
assert.strictEqual(thinChanges(events, 0).size, 0, 'no tempo, no judgement');
assert.strictEqual(thinChanges([{ id: 1, timestampSec: 0 }], 120).size, 0);
assert.strictEqual(thinChanges(events, 40, 2).size > 0, true);
// Slow songs lose nothing
assert.strictEqual(thinChanges([0, 4, 8, 12].map((t, i) => ({ id: i, timestampSec: t })), 100, 2).size, 0);

console.log('simplify tests passed');
