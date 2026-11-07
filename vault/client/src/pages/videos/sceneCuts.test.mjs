import assert from 'node:assert/strict';
import {
  lumaFrom, frameDiff, sampleTimes, detectCuts, bisectCut, nearestCut, prevCut, nextCut, snapTime, sharpness, averageBrightness, pickThumbnails, THUMB_W, THUMB_H,
} from './sceneCuts.mjs';

const flat = (v, n = 100) => new Uint8Array(n).fill(v);
const noise = (seed, n = 100) => Uint8Array.from({ length: n }, (_, i) => Math.abs(Math.sin((i + 1) * seed) * 255) | 0);

// ---- brightness from pixels
assert.deepEqual([...lumaFrom([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])], [255, 0, 76], 'white, black, red (0.299 x 255)');
assert.equal(lumaFrom([]).length, 0);
assert.equal(lumaFrom([1, 2, 3]).length, 0, 'a partial pixel is ignored');
assert.equal(THUMB_W * THUMB_H, 1296);

// ---- how different two frames are
assert.equal(frameDiff(flat(0), flat(0)), 0);
assert.equal(frameDiff(flat(0), flat(255)), 1);
assert.ok(Math.abs(frameDiff(flat(100), flat(150)) - 50 / 255) < 1e-9);
assert.equal(frameDiff(new Uint8Array(0), flat(5)), 0, 'nothing to compare is no difference');

// ---- when to look
assert.deepEqual(sampleTimes(0), []);
assert.deepEqual(sampleTimes(NaN), []);
assert.deepEqual(sampleTimes(-4), []);
assert.deepEqual(sampleTimes(3), [0, 0.5, 1, 1.5, 2, 2.5], 'short video: every half second');
const long = sampleTimes(600);
assert.ok(long.length <= 91 && long.length >= 80, `a 10 minute video is sampled about 90 times (${long.length})`);
assert.equal(long[0], 0);
assert.ok(long[long.length - 1] < 600);
assert.ok(sampleTimes(60, { maxSamples: 20 }).length <= 21);

// ---- cuts: three shots (flat grey, noisy, flat bright), sampled every second
const times = Array.from({ length: 12 }, (_, i) => i);
const shotA = noise(0.37); const shotB = noise(2.91); const shotC = noise(7.13);
const lumas = times.map((t) => (t < 4 ? shotA : t < 8 ? shotB : shotC));
const cuts = detectCuts(times, lumas);
assert.deepEqual(cuts.map((c) => [c.before, c.t]), [[3, 4], [7, 8]], 'a cut is reported at the first sample of the new shot, with the sample before it');
assert.ok(cuts.every((c) => c.score > 0.1));
// slow movement is not a cut: a brightness ramp
const ramp = times.map((t) => flat(40 + t * 10));
assert.deepEqual(detectCuts(times, ramp), [], 'a gentle change is not a cut');
// a static picture: none
assert.deepEqual(detectCuts(times, times.map(() => shotA)), []);
// too few samples
assert.deepEqual(detectCuts([0, 1], [shotA, shotB]), []);
// two cuts closer than minGap keep only the stronger one
const close = detectCuts([0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8], [shotA, shotA, shotA, flat(120), shotB, shotB, shotB, shotB, shotB, shotB], { minGap: 0.5 });
assert.equal(close.length, 1, 'two changes 0.2 s apart are one cut');
// a strobe or flicker (the picture flips back and forth every sample) is not a cut, and a real cut inside a steady video is still found
const strobe = times.map((tt) => (tt % 2 ? shotB : shotA));
assert.deepEqual(detectCuts(times, strobe), [], 'a picture that keeps flipping is not cutting');
const strobeThenShot = times.map((tt) => (tt < 6 ? (tt % 2 ? shotB : shotA) : shotC));
assert.ok(!detectCuts(times, strobeThenShot).some((c) => c.t < 6), 'no cut is reported inside the flicker');
// a cut right at the end, or right at the start, has only one neighbour to check and is still found
assert.deepEqual(detectCuts([0, 1, 2, 3], [shotA, shotA, shotA, shotB]).map((c) => c.t), [3], 'a cut at the last sample');
assert.deepEqual(detectCuts([0, 1, 2, 3], [shotA, shotB, shotB, shotB]).map((c) => c.t), [1], 'a cut at the second sample');
// fast camera movement (every step a big change) is not a run of cuts
const whip = times.map((tt) => noise(1 + tt * 0.9));
assert.ok(detectCuts(times, whip).length <= 1, 'constant large change is not many cuts');
// a noisy but cut-free video does not fire (the limit rises with the noise)
const jitter = times.map((t) => noise(0.37 + (t % 2) * 0.0001));
assert.deepEqual(detectCuts(times, jitter), []);

// ---- refining a cut to a fraction of a second
let questions = 0;
const exact = await bisectCut(3, 4, async (t) => { questions += 1; return t >= 3.4; }, 5);
assert.equal(questions, 5, 'five questions');
assert.ok(Math.abs(exact - 3.4) <= 1 / 32 + 0.011, `found 3.4 to within a thirty-second of a second (${exact})`);
assert.equal(await bisectCut(10, 11, async () => true, 3), 10.13, 'always already after: the early end');
assert.equal(await bisectCut(10, 11, async () => false, 3), 11, 'never after: the late end');
assert.equal(await bisectCut(0, 1, (t) => t >= 0.5, 4), 0.5, 'a plain (not async) answer works too');

// ---- finding a cut near a point
const list = [4, 8, 20.5];
assert.equal(nearestCut(4.2, list, 0.5), 4);
assert.equal(nearestCut(6, list, 0.5), null, 'too far from any cut');
assert.equal(nearestCut(6, list, 2.5), 4, 'the nearer of two');
assert.equal(nearestCut(1, [], 5), null);
assert.equal(snapTime(7.8, list, 0.4), 8, 'close: it snaps');
assert.equal(snapTime(6, list, 0.4), 6, 'far: it stays');
assert.equal(prevCut(8, list), 4, 'strictly before: the cut we are standing on does not count');
assert.equal(prevCut(8.2, list), 8);
assert.equal(prevCut(3, list), null);
assert.equal(nextCut(4, list), 8);
assert.equal(nextCut(3.9, list), 4);
assert.equal(nextCut(20.5, list), null);
assert.equal(nextCut(1, []), null);

// ---- how much detail a frame has
const W = 10;
assert.equal(sharpness(flat(128), W), 0, 'a flat frame has none');
const checker = Uint8Array.from({ length: 100 }, (_, i) => (((i % W) + Math.floor(i / W)) % 2 ? 255 : 0));
assert.equal(sharpness(checker, W), 1, 'a chequerboard is the most detail there is');
const soft = Uint8Array.from({ length: 100 }, (_, i) => (i % W) * 12);
assert.ok(sharpness(soft, W) > 0 && sharpness(soft, W) < sharpness(checker, W), 'a gradient is smoother than a chequerboard');
assert.equal(sharpness(new Uint8Array(0), W), 0);
assert.equal(sharpness(flat(5), 1), 0, 'a one-pixel-wide frame is not measurable');
assert.equal(averageBrightness(flat(40)), 40);
assert.equal(averageBrightness(new Uint8Array(0)), 0);

// ---- choosing thumbnails
const cand = (t, luma) => ({ t, luma });
const sharpA = checker;
const sharpB = Uint8Array.from({ length: 100 }, (_, i) => (((Math.floor(i / 2) % W) + Math.floor(i / W)) % 3 ? 220 : 60)); // different pattern, also detailed
const sharpC = Uint8Array.from({ length: 100 }, (_, i) => ((i * 7) % 200) + 30);
const dark = flat(5);
const blown = flat(250);
const picks = pickThumbnails([cand(1, dark), cand(5, sharpA), cand(9, blown), cand(12, sharpB), cand(20, soft), cand(30, sharpC)], W, { count: 4 });
assert.ok(picks.length >= 2 && picks.length <= 4);
assert.ok(!picks.some((p) => p.t === 1 || p.t === 9), 'a near-black frame and a blown-out frame are never offered');
assert.equal(picks[0].t, 5, 'the most detailed frame first');
assert.ok(picks.every((p, i) => i === 0 || p.score <= picks[i - 1].score), 'best first');
// near-duplicates and frames too close in time are skipped
const dup = pickThumbnails([cand(5, sharpA), cand(6, sharpA), cand(40, sharpA), cand(70, sharpB)], W, { count: 4, minGap: 1 });
assert.deepEqual(dup.map((p) => p.t).sort((a, b) => a - b), [5, 70], 'the same picture three times is offered once');
const near = pickThumbnails([cand(5, sharpA), cand(5.4, sharpB)], W, { count: 4, minGap: 1 });
assert.equal(near.length, 1, 'two different pictures only 0.4 s apart: one is enough');
assert.deepEqual(pickThumbnails([], W), []);
assert.deepEqual(pickThumbnails(undefined, W), []);
assert.deepEqual(pickThumbnails([cand(1, flat(128)), cand(2, dark)], W), [], 'only flat or dark frames: nothing to offer');
assert.equal(pickThumbnails([cand(5, sharpA), cand(50, sharpB), cand(90, sharpC)], W, { count: 2 }).length, 2, 'at most as many as asked for');

console.log('sceneCuts.test.mjs: all passed');
