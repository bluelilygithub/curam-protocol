// node client/src/pages/guitar/progressions.test.mjs
import assert from 'node:assert';
import { suggestProgressions, explainPair, canon } from './progressions.mjs';

const seqs = (r) => r.items.map(i => i.chords.join(' '));

// A and E: the classic. Keys of A and E both fit.
const ae = suggestProgressions('A', 'E');
assert.ok(ae.keys.includes('A major'));
assert.ok(seqs(ae).includes('A D E'), 'the three-chord song in A: A, D, E');
assert.ok(seqs(ae).some(s => s.startsWith('A ') && s.includes('F#m') && s.includes('E') && s.includes('D')), 'a pop progression through F#m and D');
assert.ok(ae.items.every(i => i.chords[0] === 'A'), 'every loop starts on the first chord of the pair');
assert.ok(ae.items.every(i => i.chords.includes('A') && i.chords.includes('E')), 'every loop contains both chords');
assert.ok(ae.items.length <= 8);
assert.strictEqual(new Set(seqs(ae)).size, ae.items.length, 'no repeated loop');
const d = ae.items.find(i => i.chords.join(' ') === 'A D E');
assert.deepStrictEqual(d.inBetween, ['D']);
assert.strictEqual(d.numerals, 'I IV V');
assert.strictEqual(d.key, 'A major');

// What is new depends on what the person can already play
const known = new Set(['A', 'E', 'D']);
const withKnown = suggestProgressions('A', 'E', known);
assert.deepStrictEqual(withKnown.items[0].newChords, [], 'with A, D and E known the first suggestion has nothing new');
assert.strictEqual(withKnown.items[0].chords.join(' '), 'A D E');
assert.ok(withKnown.items.every((it, i, all) => i === 0 || all[i - 1].newChords.length <= it.newChords.length), 'fewest new chords first');
const nothing = suggestProgressions('A', 'E', new Set());
assert.deepStrictEqual(nothing.items[0].newChords.sort(), ['A', 'D', 'E'], 'with nothing known all chords are new');
// Flats and sharps are the same chord
assert.deepStrictEqual(suggestProgressions('A', 'E', new Set(['Db'])).items.length > 0, true);
assert.strictEqual(canon('Db'), 'C#');
assert.strictEqual(canon('Hm'), null);

// The pair from the owner's screen: C#m and E (sit together in E major and A major, and C# minor)
const ce = suggestProgressions('C#m', 'E');
assert.ok(ce.keys.length >= 1);
assert.ok(ce.items.length > 0);
assert.ok(ce.items.every(i => i.chords[0] === 'C#m' && i.chords.includes('E')));
assert.ok(seqs(ce).some(s => s === 'C#m A E B'), 'C#m, A, E, B (vi IV I V in E)');
// Minor key suggestions come from the minor list
const minor = suggestProgressions('Am', 'G');
assert.ok(minor.items.length > 0);
assert.ok(seqs(minor).some(s => s.startsWith('Am') && s.includes('G')));

// Chords that share no key give an honest reason and nothing else
const odd = suggestProgressions('C', 'F#');
assert.deepStrictEqual(odd.items, []);
assert.match(odd.reason, /do not belong to one key/);
assert.match(suggestProgressions('A', 'A').reason, /Two different chords/);
assert.match(suggestProgressions('', 'E').reason, /Two different chords/);

// One-line explanation
assert.match(explainPair('A', 'E'), /^In (A|E) (major|minor), (A|E) is (I|IV|V) and (A|E) is (I|IV|V)\.$/);
assert.strictEqual(explainPair('A', 'E'), 'In A major, A is I and E is V.');
assert.strictEqual(explainPair('C', 'F#'), '');
assert.strictEqual(explainPair('', ''), '');

console.log('progressions tests passed');

// The card wording (the owner could not tell what "13 changes across 1 song" meant)
import { pairSummary } from './progressions.mjs';
const now = new Date('2026-11-16T12:00:00Z').getTime();
assert.strictEqual(pairSummary({ count: 13, songCount: 1, lastRate: null }, now),
  'Your songs switch between these two 13 times, all in one song. No one-minute score saved yet.');
assert.strictEqual(pairSummary({ count: 1, songCount: 1, lastRate: null }, now), 'Your songs switch between these two once, all in one song. No one-minute score saved yet.');
assert.strictEqual(pairSummary({ count: 4, songCount: 3, lastRate: 18, bestRate: 22, lastPlayedAt: '2026-11-13T12:00:00Z' }, now),
  'Your songs switch between these two 4 times, across 3 songs. Last one-minute drill: 18 clean changes (best 22), 3d ago.');
assert.match(pairSummary({ count: 2, songCount: 2, lastRate: 1, bestRate: 1, lastPlayedAt: '2026-11-16T09:00:00Z' }, now), /1 clean change \(best 1\), today\./);
assert.ok(!/across 1 song|changes across/.test(pairSummary({ count: 13, songCount: 1, lastRate: null }, now)), 'the old confusing wording is gone');
console.log('pairSummary tests passed');
