import assert from 'node:assert/strict';
import { fitWithin, frameTimes, planCostUsd, visionSummary, visionNote, seesFootnote, MAX_PX, FRAMES_PER_CLIP } from './visionFrames.mjs';

// ---- the size of a small copy: the longest side is at most 512, never enlarged
assert.deepEqual(fitWithin(4000, 3000), { w: 512, h: 384 });
assert.deepEqual(fitWithin(3000, 4000), { w: 384, h: 512 });
assert.deepEqual(fitWithin(300, 200), { w: 300, h: 200 }, 'a small picture is not enlarged');
assert.deepEqual(fitWithin(512, 512), { w: 512, h: 512 });
assert.deepEqual(fitWithin(1920, 1), { w: 512, h: 1 }, 'never below one pixel');
assert.deepEqual(fitWithin(0, 0), { w: 1, h: 1 });
assert.deepEqual(fitWithin(undefined, undefined), { w: 1, h: 1 });
assert.deepEqual(fitWithin(1000, 500, 100), { w: 100, h: 50 }, 'another limit can be asked for');
assert.equal(MAX_PX, 512);

// ---- where in a clip the frames come from
assert.deepEqual(frameTimes(10, 1), [4]);
assert.deepEqual(frameTimes(10, 2), [2.5, 7]);
assert.deepEqual(frameTimes(20, 3), [3, 10, 17]);
assert.deepEqual(frameTimes(0, 2), [0], 'no length known: the first frame');
assert.deepEqual(frameTimes(NaN, 2), [0]);
assert.deepEqual(frameTimes(Infinity, 2), [0]);
assert.deepEqual(frameTimes(1, 2), [0.25, 0.7]);
assert.ok(frameTimes(0.05, 2).every((t) => t >= 0 && t <= 0.05), 'a very short clip never asks for a time past its end');
assert.deepEqual(frameTimes(10, 99), [1.5, 5, 8.5], 'at most three');
assert.deepEqual(frameTimes(10, 0), [4], 'at least one');
assert.equal(FRAMES_PER_CLIP, 2);
assert.ok(12 * FRAMES_PER_CLIP <= 24, '12 clips x the frames per clip fits the 24 the server takes');

// ---- the cost
const info = { available: true, model: 'claude-haiku-5-5', usdPerFrame: 0.0004, planBaseUsd: 0.002, maxFrames: 24, maxPx: 512, maxUsd: 0.25, problem: null };
assert.ok(Math.abs(planCostUsd(info, 10) - 0.006) < 1e-9);
assert.equal(planCostUsd(null, 10), null);
assert.equal(planCostUsd({ ...info, available: false }, 10), null);
assert.equal(planCostUsd({ ...info, usdPerFrame: undefined }, 10), null);

// ---- the sentence under the tick box
let s = visionSummary(info, 'pictures', 5);
assert.equal(s.ok, true);
assert.equal(s.pictures, 5);
assert.match(s.text, /^Sends a small copy of each of your 5 pictures, at most 512 pixels wide, to the AI model \(claude-haiku-5-5\)/);
assert.match(s.text, /About US\$0\.004 for this plan/);
assert.match(s.text, /Your original pictures stay in your browser, and nothing is sent unless this is ticked/);
s = visionSummary(info, 'clips', 4);
assert.equal(s.pictures, 8, 'two frames from each clip');
assert.match(s.text, /^Sends 2 small frames from each of your 4 clips \(8 pictures\)/);
assert.match(s.text, /Your original videos stay in your browser/);
assert.match(visionSummary(info, 'pictures', 1).text, /a small copy of each of your 1 picture,/, 'singular');
assert.match(visionSummary(info, 'clips', 1).text, /each of your 1 clip \(/);
// too many
s = visionSummary(info, 'clips', 13);
assert.equal(s.ok, false);
assert.match(s.text, /26 pictures and one plan takes at most 24\. Use 12 clips or fewer/);
s = visionSummary(info, 'pictures', 25);
assert.equal(s.ok, false);
assert.match(s.text, /Use 24 pictures or fewer/);
assert.equal(visionSummary(info, 'pictures', 24).ok, true, '24 is allowed');
// not ready, or no model that can look
assert.equal(visionSummary(null, 'pictures', 3).ok, false);
assert.match(visionSummary(null, 'pictures', 3).text, /Checking/);
s = visionSummary({ available: false, problem: 'None of the AI models set up for this workspace can look at pictures.' }, 'pictures', 3);
assert.deepEqual([s.ok, s.text], [false, 'None of the AI models set up for this workspace can look at pictures.']);
assert.match(visionSummary({ available: false }, 'pictures', 3).text, /No AI model that can look/);

// ---- after the plan
assert.equal(visionNote({}), '');
assert.equal(visionNote(null), '');
assert.equal(visionNote({ vision: { pictures: 0 } }), '');
assert.match(visionNote({ vision: { pictures: 6, model: 'claude-haiku-5-5' } }), /^The AI looked at 6 small pictures \(claude-haiku-5-5\) as well as your description\. It can still misjudge a picture/);
assert.match(visionNote({ vision: { pictures: 1 } }), /looked at 1 small picture \(the AI model\)/);

// ---- the "what it sees" footnote tells the truth either way
assert.match(seesFootnote('pictures', false), /only sees your description and the file names — not the pictures themselves/);
assert.match(seesFootnote('clips', false), /only sees your description and the clip file names — not the footage itself/);
assert.match(seesFootnote('pictures', true), /small copies of your pictures \(never the originals\)/);
assert.match(seesFootnote('clips', true), /small copies of your clips \(two frames each\) \(never the originals\)/);

console.log('visionFrames.test.mjs: all passed');
