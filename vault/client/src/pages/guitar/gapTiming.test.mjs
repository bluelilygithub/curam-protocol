// node client/src/pages/guitar/gapTiming.test.mjs
import assert from 'node:assert';
import { LEVELS, COUNT_IN, MIN_SILENT_TAPS, levelById, beatSeconds, totalBeats, audible, grade, clears } from './gapTiming.mjs';

const BPM = 80;
const beat = beatSeconds(BPM);

// The levels: unique ids, more silence each step, every run has enough silent beats to judge
assert.strictEqual(new Set(LEVELS.map(l => l.id)).size, LEVELS.length);
for (const l of LEVELS) {
  assert.ok(l.name && l.what && l.on >= 1 && l.off >= 1 && l.cycles >= 1, l.id);
  assert.ok(l.off * l.cycles >= MIN_SILENT_TAPS, `${l.id}: enough silent beats`);
  assert.strictEqual(totalBeats(l), COUNT_IN + l.cycles * (l.on + l.off));
  assert.strictEqual(levelById(l.id), l);
}
assert.strictEqual(levelById('nope'), null);
const longestGap = LEVELS.map(l => l.off);
assert.deepStrictEqual(longestGap, [...longestGap].sort((a, b) => a - b), 'the gap grows up the ladder');

// Tempo: clamped, 80 bpm is 0.75 s a beat
assert.strictEqual(beatSeconds(80), 0.75);
assert.strictEqual(beatSeconds(5), 2);       // clamped to 30 bpm
assert.strictEqual(beatSeconds(1000), 0.3);  // clamped to 200 bpm
assert.strictEqual(beatSeconds('x'), 0.75);

// Which beats click: the count-in always, then on beats then off beats
const two = levelById('two');
assert.deepStrictEqual([0, 1, 2, 3].map(n => audible(two, n)), [true, true, true, true]);
assert.deepStrictEqual([4, 5, 6, 7, 8, 9, 10].map(n => audible(two, n)), [true, true, false, false, true, true, false]);

// Build taps for a run. bias: seconds every tap is late by (reaction time). drift: extra seconds per silent beat, restarting each gap.
function tapsFor(level, { bias = 0, drift = 0, skipSilent = () => false, jitter = () => 0 } = {}) {
  const taps = [];
  let gapStart = null;
  for (let n = 0; n < totalBeats(level); n++) {
    const silent = !audible(level, n);
    if (!silent) gapStart = null;
    if (silent && gapStart == null) gapStart = n;
    if (silent && skipSilent(n)) continue;
    taps.push(n * beat + bias + (silent ? drift * (n - gapStart) : 0) + jitter(n));
  }
  return taps;
}

// Perfect time, whatever the reaction delay: steady, bias found and removed
for (const bias of [0, 0.03, 0.12]) {
  const r = grade(tapsFor(two, { bias }), two, BPM);
  assert.ok(r.ok && r.verdict === 'steady', `bias ${bias}`);
  assert.ok(Math.abs(r.bias - bias * 1000) < 0.2, `bias found ${r.bias}`);
  assert.ok(r.meanAbsMs < 0.2, 'no error left once the bias is taken off');
  assert.strictEqual(r.direction, 'even');
  assert.strictEqual(r.missed, 0);
  assert.ok(clears(r));
}

// Rushing: each silent beat 12 ms earlier than the last
const rush = grade(tapsFor(levelById('bar'), { drift: -0.012 }), levelById('bar'), BPM);
assert.ok(rush.ok);
assert.ok(Math.abs(rush.driftMsPerBeat + 12) < 0.2, `drift ${rush.driftMsPerBeat}`);
assert.strictEqual(rush.direction, 'early');
assert.ok(/rush/.test(rush.text));
// Dragging: later each beat
const drag = grade(tapsFor(levelById('bar'), { drift: 0.08 }), levelById('bar'), BPM);
assert.strictEqual(drag.direction, 'late');
assert.strictEqual(drag.verdict, 'drifting');
assert.ok(/drag/.test(drag.text));
assert.ok(!clears(drag));

// A slow slide ending far out is not steady even when the average looks fine: 40 ms more each beat ends 120 ms out (16% of a beat)
assert.notStrictEqual(grade(tapsFor(levelById('bar'), { drift: 0.04 }), levelById('bar'), BPM).verdict, 'steady');

// A steady wobble within about 8% of a beat is steady; about 12% is close; 25% is drifting
const wob = (ms) => (n) => (n % 2 ? ms : -ms) / 1000;
assert.strictEqual(grade(tapsFor(two, { jitter: wob(40) }), two, BPM).verdict, 'steady');   // 40 ms of 750 = 5%
assert.strictEqual(grade(tapsFor(two, { jitter: wob(90) }), two, BPM).verdict, 'close');    // 12%
assert.strictEqual(grade(tapsFor(two, { jitter: wob(180) }), two, BPM).verdict, 'drifting'); // 24%

// Missed taps: counted, and too many spoil the verdict
const skip = grade(tapsFor(two, { skipSilent: n => n % 2 === 0 }), two, BPM);
assert.ok(skip.ok && skip.missed > 0);
assert.ok(/had no tap/.test(skip.text));
const most = grade(tapsFor(two, { skipSilent: n => n % 4 !== 0 }), two, BPM);
assert.notStrictEqual(most.verdict, 'steady');

// Not enough to judge: no taps, or only the click beats, or a handful in the gaps
assert.strictEqual(grade([], two, BPM).ok, false);
assert.strictEqual(grade(undefined, two, BPM).ok, false);
const clickOnly = tapsFor(two, { skipSilent: () => true });
const none = grade(clickOnly, two, BPM);
assert.strictEqual(none.ok, false);
assert.ok(/Tap on every beat/.test(none.reason));
assert.strictEqual(grade(tapsFor(two, { skipSilent: n => n > 6 }), two, BPM).ok, false, 'two silent beats is too few');

// Strays: a tap halfway between beats, before the start or after the end is ignored and cannot beat a real tap
const base = tapsFor(two);
const strays = [...base, -2, 0.5 * beat + 3 * beat, totalBeats(two) * beat + 5, NaN, Infinity];
const r2 = grade(strays, two, BPM);
assert.ok(r2.ok && r2.verdict === 'steady' && r2.meanAbsMs < 0.2);
// Two taps near one beat: the closer wins
const dbl = [...base, 10 * beat + 0.2 * beat];
assert.ok(grade(dbl, two, BPM).meanAbsMs < 0.2);

// Without enough clicked taps the bias is not known and is taken as zero
const noClick = tapsFor(levelById('lost'), { bias: 0 }).filter((t, i) => i >= 0);
assert.ok(grade(noClick, levelById('lost'), BPM).ok);

// Another tempo works the same: the beat length changes, the answer does not
const r3 = grade(tapsFor(two, { bias: 0.05 }).map((t, i) => t), two, BPM);
assert.ok(r3.ok);
const fast = beatSeconds(120);
const fastTaps = [];
for (let n = 0; n < totalBeats(two); n++) fastTaps.push(n * fast + 0.02);
const rf = grade(fastTaps, two, 120);
assert.ok(rf.ok && rf.verdict === 'steady' && Math.abs(rf.bias - 20) < 0.2);

console.log('gapTiming tests passed');
