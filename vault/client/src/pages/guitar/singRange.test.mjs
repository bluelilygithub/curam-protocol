// node client/src/pages/guitar/singRange.test.mjs
import assert from 'node:assert';
import {
  noteName, midiFreq, NOTE_CHOICES, VOICE_PRESETS, checkRange, fit, suggestKey,
  MELODY_BELOW, MELODY_ABOVE, MIN_SPAN, LOWEST, HIGHEST,
} from './singRange.mjs';

// Note names and pitch
assert.strictEqual(noteName(60), 'C4');
assert.strictEqual(noteName(69), 'A4');
assert.strictEqual(noteName(40), 'E2');
assert.strictEqual(noteName(61), 'C#4');
assert.strictEqual(Math.round(midiFreq(69)), 440);
assert.strictEqual(Math.round(midiFreq(60) * 100) / 100, 261.63);
assert.strictEqual(NOTE_CHOICES[0].name, 'C2');
assert.strictEqual(NOTE_CHOICES[NOTE_CHOICES.length - 1].name, 'C6');
assert.strictEqual(NOTE_CHOICES.length, HIGHEST - LOWEST + 1);

// Every preset is a valid range
for (const p of VOICE_PRESETS) assert.ok(checkRange(p.low, p.high).ok, p.id);

// Range checks
assert.ok(checkRange(48, 72).ok);
assert.strictEqual(checkRange(60, 60).ok, false, 'nothing between the notes');
assert.strictEqual(checkRange(60, 60 + MIN_SPAN - 1).ok, false, 'too narrow');
assert.strictEqual(checkRange(60, 60 + MIN_SPAN).ok, true);
assert.strictEqual(checkRange(72, 48).ok, false, 'upside down');
assert.strictEqual(checkRange(20, 60).ok, false, 'below the lowest offered note');
assert.strictEqual(checkRange(60, 100).ok, false);
assert.strictEqual(checkRange('x', 60).ok, false);
assert.strictEqual(checkRange(null, null).ok, false);

// Fit: a wide range holds a typical tune in any key; a narrow one does not
assert.strictEqual(MELODY_BELOW + MELODY_ABOVE, 14);
const wide = { low: 48, high: 76 };
for (let pc = 0; pc < 12; pc++) assert.ok(fit(wide, pc).fits, `a wide range fits key ${pc}`);
const narrow = { low: 57, high: 69 };   // A3 to A4, one octave
assert.ok(fit(narrow, 9).overflow >= 2, 'a one-octave range cannot hold 14 semitones');
assert.strictEqual(fit(narrow, 9).overflow, 5, 'key of A in A3 to A4: the tune sticks out by 5');
assert.strictEqual(fit(narrow, 2).overflow, 2, 'key of D is the best a one-octave range can do');
// A range of exactly 14 semitones, C4 to D5, holds the tune only with the key note on F4: the tune then runs C4 (a fifth below) to D5 (a sixth above)
const exact = { low: 60, high: 74 };
const fF = fit(exact, 5);
assert.strictEqual(fF.overflow, 0);
assert.strictEqual(fF.tonic, 65);
assert.strictEqual(fF.lowest, 60);
assert.strictEqual(fF.highest, 74);
// the key of C does not fit that range exactly: it sticks out by the distance to the nearest octave of C
const fC = fit(exact, 0);
assert.ok(fC.overflow > 0);
assert.strictEqual(fC.overflow, fC.tooLow + fC.tooHigh);
// a note too high for the range is reported as too high, too low as too low
const high = fit({ low: 60, high: 70 }, 5);
assert.ok(high.tooHigh > 0 || high.tooLow > 0);
assert.ok(fit({ low: 60, high: 70 }, 2).fits === false);
// fit picks the octave that suits: the key note lands inside the range for a wide one
const wideFit = fit(wide, 7);
assert.ok(wideFit.tonic >= wide.low && wideFit.tonic <= wide.high);

// suggestKey: already fits, so no move
const roomy = suggestKey({ range: { low: 48, high: 76 }, playedTonic: 9, transpose: 0 });
assert.ok(roomy.ok && roomy.already);
assert.strictEqual(roomy.shift, 0);
assert.strictEqual(roomy.transpose, 0);

// suggestKey: a tight range needs a move, and the move is the smallest that works
const tight = { low: 60, high: 74 };   // only the key of F fits (above)
const s1 = suggestKey({ range: tight, playedTonic: 5, transpose: 0 });
assert.ok(s1.already, 'already in F');
const s2 = suggestKey({ range: tight, playedTonic: 7, transpose: 0 });   // song played in G: move down 2 to F
assert.ok(!s2.already);
assert.strictEqual(s2.shift, -2);
assert.strictEqual(s2.transpose, -2);
assert.strictEqual(s2.best.fit.overflow, 0);
assert.ok(s2.current.overflow > 0);
const s3 = suggestKey({ range: tight, playedTonic: 4, transpose: 3 });   // song played in E (already transposed 3): move up 1 to F
assert.strictEqual(s3.shift, 1);
assert.strictEqual(s3.transpose, 4);
// the shift is never more than a tritone away, and the transpose stays in range
for (let pc = 0; pc < 12; pc++) {
  for (const t of [-11, -6, 0, 5, 11]) {
    const r = suggestKey({ range: tight, playedTonic: pc, transpose: t });
    assert.ok(r.shift >= -6 && r.shift <= 5, `shift ${r.shift}`);
    assert.ok(r.transpose >= -11 && r.transpose <= 11, `transpose ${r.transpose}`);
    assert.ok(r.best.fit.overflow <= r.current.overflow, 'never makes it worse');
    // moving by the shift really lands on the best key
    assert.strictEqual(fit(r.range, (((pc + r.shift) % 12) + 12) % 12).overflow, r.best.fit.overflow);
  }
}
// a range that is too narrow is refused with a reason
const bad = suggestKey({ range: { low: 60, high: 64 }, playedTonic: 0 });
assert.strictEqual(bad.ok, false);
assert.ok(/major sixth/.test(bad.error));
assert.strictEqual(suggestKey({ range: null, playedTonic: 0 }).ok, false);
// a range that fits no key perfectly still gets the least-bad one
const small = suggestKey({ range: { low: 60, high: 69 }, playedTonic: 0 });   // 9 semitones: every key overflows by 5
assert.ok(small.ok);
assert.strictEqual(small.best.fit.overflow, 5);
assert.strictEqual(small.shift, 0, 'when every key is equally bad, stay where you are');

console.log('singRange tests passed');
