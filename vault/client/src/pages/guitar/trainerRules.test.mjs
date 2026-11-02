import assert from 'assert';
import { clampSpeed, afterCleanPass, afterMessyPass, snapRate, songTimeAfter, beatSeconds, dailyBest, progressLine } from './trainerRules.mjs';

assert.strictEqual(clampSpeed(10), 40);
assert.strictEqual(clampSpeed(500), 120);
assert.strictEqual(clampSpeed('abc'), 70);
assert.strictEqual(clampSpeed(72.6), 73);

// Ramp: 3 clean passes in a row raise the speed by 5, and report the cleared speed
let st = { speed: 70, clean: 0 };
st = afterCleanPass(st); assert.deepStrictEqual(st, { speed: 70, clean: 1, cleared: null });
st = afterCleanPass(st); assert.deepStrictEqual(st, { speed: 70, clean: 2, cleared: null });
st = afterCleanPass(st); assert.deepStrictEqual(st, { speed: 75, clean: 0, cleared: 70 });
// A messy pass resets the run
st = afterCleanPass({ speed: 75, clean: 2 });
assert.strictEqual(afterMessyPass({ speed: 75, clean: 2 }).clean, 0);
assert.strictEqual(st.speed, 80);
// Never past the maximum
assert.strictEqual(afterCleanPass({ speed: 120, clean: 2 }).speed, 120);
// Custom target
assert.strictEqual(afterCleanPass({ speed: 60, clean: 0, target: 1, step: 10 }).speed, 70);

assert.strictEqual(snapRate(0.7, [0.25, 0.5, 0.75, 1]), 0.75);
assert.strictEqual(snapRate(0.7, undefined), 0.7);

assert.strictEqual(songTimeAfter(10, 2, 0.5), 11);
assert.strictEqual(beatSeconds(120, 100), 0.5);
assert.strictEqual(beatSeconds(120, 50), 1);
assert.strictEqual(beatSeconds(null, 50), null);

const runs = [
  { playedAt: '2026-11-01T09:00:00Z', speedPct: 70, bpm: 72 },
  { playedAt: '2026-11-01T09:10:00Z', speedPct: 80, bpm: 82 },
  { playedAt: '2026-11-03T09:00:00Z', speedPct: 90, bpm: 92 },
];
const pts = dailyBest(runs);
assert.deepStrictEqual(pts.map(p => p.speedPct), [80, 90]);
assert.strictEqual(progressLine(pts), '82 to 92 bpm');
assert.strictEqual(progressLine([pts[0]]), null);
assert.strictEqual(progressLine([{ speedPct: 60, bpm: null }, { speedPct: 80, bpm: null }]), '60% to 80%');

console.log('tempoTrainer tests passed');
