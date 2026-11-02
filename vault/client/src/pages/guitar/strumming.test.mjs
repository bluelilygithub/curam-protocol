// node client/src/pages/guitar/strumming.test.mjs
import assert from 'node:assert';
import { PATTERNS, validPattern, swings, ladder, slotMs, slotTimes, slotAt, describe, SLOTS } from './strumming.mjs';

// The patterns in the library are all valid and distinct
for (const p of PATTERNS) assert.ok(validPattern(p.pattern), `${p.id} is a valid pattern`);
assert.strictEqual(new Set(PATTERNS.map(p => p.id)).size, PATTERNS.length);
assert.strictEqual(new Set(PATTERNS.map(p => p.pattern)).size, PATTERNS.length);

// Validity: D on the beat, U between, '-' anywhere, eight long
assert.ok(validPattern('D-DU-UDU'));
assert.ok(!validPattern('U-D-D-D-'), 'an up on a beat');
assert.ok(!validPattern('DDD-D-D-'), 'a down between beats');
assert.ok(!validPattern('D-D-D-D'), 'seven long');
assert.ok(!validPattern('D-D-D-D-D'), 'nine long');
assert.ok(!validPattern('D-d-D-D-'), 'lower case');
assert.ok(!validPattern(null) && !validPattern(42));

// Swings: direction follows the slot, hit follows the pattern
const s = swings('D-DU-UDU');
assert.strictEqual(s.length, SLOTS);
assert.deepStrictEqual(s.map(x => x.dir), ['down', 'up', 'down', 'up', 'down', 'up', 'down', 'up']);
assert.deepStrictEqual(s.map(x => x.hit), [true, false, true, true, false, true, true, true]);
assert.strictEqual(s[3].label, '&');

// The ladder for the old faithful: beats, then each up added left to right, then let go of the missed beat
const l = ladder('D-DU-UDU');
assert.deepStrictEqual(l.map(x => x.pattern), ['D-D-D-D-', 'D-DUD-D-', 'D-DUDUD-', 'D-DUDUDU', 'D-DU-UDU']);
assert.match(l[0].text, /Down on every beat/);
assert.match(l[1].text, /up strum on the "&" after 2/);
assert.match(l[4].text, /miss the strings on beat 3/);
assert.ok(l.every(x => validPattern(x.pattern)), 'every rung is a real pattern');
// Each rung adds a hit, except the last which removes one
assert.ok(l.slice(0, 4).every((x, i) => i === 0 || x.pattern.replace(/-/g, '').length === l[i - 1].pattern.replace(/-/g, '').length + 1));
// A target that is just the beats has one rung
assert.deepStrictEqual(ladder('D-D-D-D-').map(x => x.pattern), ['D-D-D-D-']);
// Eighths: four rungs of adding ups, and no beat to let go of, so no final "miss" rung
assert.deepStrictEqual(ladder('DUDUDUDU').map(x => x.pattern), ['D-D-D-D-', 'DUD-D-D-', 'DUDUD-D-', 'DUDUDUD-', 'DUDUDUDU']);
// The ballad misses beats 2 only after the ups are in
const b = ladder('D---DUDU');
assert.strictEqual(b[b.length - 1].pattern, 'D---DUDU');
assert.match(b[b.length - 1].text, /beat 2 and 3|beat 2/);
// Junk falls back to the first rung
assert.deepStrictEqual(ladder('nonsense').map(x => x.pattern), ['D-D-D-D-']);
// Every library pattern has a ladder that ends on itself
for (const p of PATTERNS) assert.strictEqual(ladder(p.pattern).pop().pattern, p.pattern);

// Timing: a beat at 60 bpm is 1s, so a swing (eighth) is 500ms; at 120 bpm 250ms
assert.strictEqual(slotMs(60), 500);
assert.strictEqual(slotMs(120), 250);
assert.strictEqual(slotMs(1), slotMs(30), 'a silly tempo is held to the limits');
assert.strictEqual(slotMs(9999), slotMs(240));
assert.strictEqual(slotMs(undefined), slotMs(70));
const t = slotTimes(10, 60, 4);
assert.deepStrictEqual(t.map(x => x.time), [10, 10.5, 11, 11.5]);
assert.deepStrictEqual(t.map(x => x.slot), [0, 1, 2, 3]);
assert.deepStrictEqual(slotTimes(0, 60, 3, 6).map(x => x.slot), [6, 7, 0], 'the slot wraps into the next bar');
assert.deepStrictEqual(slotAt(10.6, 10, 60), { slot: 1, bar: 0 });
assert.deepStrictEqual(slotAt(14.2, 10, 60), { slot: 0, bar: 1 }, 'one bar is four seconds at 60 bpm');
assert.deepStrictEqual(slotAt(9, 10, 60), { slot: -1, bar: -1 }, 'before the start');

// Words
assert.strictEqual(describe('D-DU-UDU'), 'down, down up, up, down up');
assert.strictEqual(describe('D-D-D-D-'), 'down, down, down, down');
assert.strictEqual(describe('DUDUDUDU'), 'down up, down up, down up, down up');
assert.strictEqual(describe('bad'), '');

console.log('strumming tests passed');
