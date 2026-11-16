'use strict';

// node server/services/videoCleanup.test.js  (pure logic only; no ffmpeg needed)

const assert = require('assert');
const {
  parseFilterList, isHdr, tonemapFilter, parseSilences, planKeepSegments, gridFps, selectExpr, logoBox, planSmartCut,
} = require('./videoCleanup');
const { parseLoudnormJson, loudnormSecondPass, LOUDNESS_PRESETS } = require('./videoFfmpeg');

// ---- filter list ----
const filters = parseFilterList([
  ' T. zscale            V->V       Apply resizing',
  ' .S tonemap           V->V       Conversion to/from different dynamic ranges.',
  ' .. vidstabdetect     V->V       pass 1',
  ' .. vidstabtransform  V->V       pass 2',
  ' TS hqdn3d            V->V       denoiser',
  ' .. silencedetect     A->A       Detect silence.',
].join('\n'));
assert.strictEqual(filters.tonemap, true);
assert.strictEqual(filters.vidstab, true);
assert.strictEqual(filters.hqdn3d, true);
assert.strictEqual(filters.delogo, false, 'a filter not listed is reported missing');
assert.strictEqual(parseFilterList('').tonemap, false);

// ---- HDR ----
assert.strictEqual(isHdr({ colorTransfer: 'arib-std-b67' }), true, 'iPhone HLG is HDR');
assert.strictEqual(isHdr({ colorTransfer: 'smpte2084' }), true, 'PQ is HDR');
assert.strictEqual(isHdr({ colorTransfer: 'bt709' }), false);
assert.strictEqual(isHdr({}), false);
assert.match(tonemapFilter({ colorTransfer: 'arib-std-b67' }), /tin=arib-std-b67/);
assert.match(tonemapFilter({ colorTransfer: 'smpte2084' }), /tin=smpte2084/);
assert.match(tonemapFilter({ colorTransfer: 'smpte2084' }), /^scale=.*min\(1920/, 'large HDR video is scaled down before the slow tone mapping');

// ---- silences ----
const stderr = [
  '[silencedetect @ 0x1] silence_start: 2.0',
  '[silencedetect @ 0x1] silence_end: 3.5 | silence_duration: 1.5',
  '[silencedetect @ 0x1] silence_start: 9.2',
].join('\n');
assert.deepStrictEqual(parseSilences(stderr, 10), [{ start: 2, end: 3.5 }, { start: 9.2, end: 10 }], 'a silence still open at the end runs to the end');

const plan = planKeepSegments([{ start: 2, end: 3.5 }, { start: 9.2, end: 10 }], 10, { padSec: 0.15, fps: 30 });
assert.strictEqual(plan.cuts, 2);
assert.strictEqual(plan.keep.length, 2);
assert.strictEqual(plan.keep[0].start, 0);
assert.ok(Math.abs(plan.keep[0].end - 2.1667) < 0.001, 'the cut starts a little after the word ends, on a frame');
assert.ok(Math.abs(plan.keep[1].start - 3.3667) < 0.001, 'and stops a little before the next word');
assert.ok(Math.abs(plan.keep[1].end - 9.3667) < 0.001, 'a trailing pause is cut after the pad');
for (const k of plan.keep) {
  assert.ok(Math.abs(k.start * 30 - Math.round(k.start * 30)) < 1e-6, 'boundaries sit on the frame grid');
  assert.ok(Math.abs(k.end * 30 - Math.round(k.end * 30)) < 1e-6, 'boundaries sit on the frame grid');
}
const lead = planKeepSegments([{ start: 0, end: 1.2 }], 5, { padSec: 0.15, fps: 25 });
assert.strictEqual(lead.keep[0].start, 1.04, 'a pause at the very start is cut up to the pad before the first word');
assert.strictEqual(planKeepSegments([{ start: 4, end: 4.2 }], 8, { padSec: 0.15 }).cuts, 0, 'a pause shorter than the two pads is left alone');
assert.strictEqual(planKeepSegments([], 8).keep.length, 1);
assert.match(selectExpr([{ start: 0, end: 1.5 }]), /^gte\(t\\,0\.0000\)\*lt\(t\\,1\.5000\)$/);

assert.strictEqual(gridFps('30000/1001'), 30);
assert.strictEqual(gridFps('25/1'), 25);
assert.strictEqual(gridFps('59.94'), 60);
assert.strictEqual(gridFps('24000/1001'), 24);
assert.strictEqual(gridFps(null), 30);
for (const f of [24, 25, 30, 48, 50, 60]) assert.ok(Number.isInteger(48000 / f), 'whole number of sound samples per frame');

// ---- logo box ----
assert.deepStrictEqual(logoBox({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 1920, 1080), { x: 960, y: 540, w: 192, h: 108 });
const edge = logoBox({ x: 0, y: 0, w: 1, h: 1 }, 640, 360);
assert.ok(edge.x >= 1 && edge.y >= 1 && edge.x + edge.w <= 639 && edge.y + edge.h <= 359, 'the box stays one pixel inside the picture');
const corner = logoBox({ x: 0.95, y: 0.95, w: 0.2, h: 0.2 }, 640, 360);
assert.ok(corner.x + corner.w <= 639 && corner.y + corner.h <= 359);

// ---- smart cut planning ----
const h264 = { codec: 'h264', pixFmt: 'yuv420p', rotation: 0, colorTransfer: 'bt709' };
const keys = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const ok = planSmartCut(h264, keys, 3.3, 17.5, { allPackets: Array.from({ length: 600 }, (_, i) => i / 30) });
assert.deepStrictEqual([ok.ok, ok.k1, ok.k2, ok.middleFrames], [true, 4, 16, 360], 'copies keyframe 4 up to keyframe 16, 12 s at 30 fps');
assert.strictEqual(planSmartCut({ ...h264, codec: 'hevc' }, keys, 3, 17).reason, 'not-h264');
assert.strictEqual(planSmartCut({ ...h264, rotation: 90 }, keys, 3, 17).reason, 'rotated');
assert.strictEqual(planSmartCut({ ...h264, colorTransfer: 'arib-std-b67' }, keys, 3, 17).reason, 'hdr');
assert.strictEqual(planSmartCut(h264, keys, 3, 9).reason, 'middle-too-short', 'a short clip is simply re-encoded');
assert.strictEqual(planSmartCut(h264, keys, 4, 16).k1, 4, 'a start on a keyframe needs no head');

// ---- two-pass loudness ----
const measured = parseLoudnormJson('...\n[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-24.31",\n\t"input_tp" : "-6.02",\n\t"input_lra" : "5.10",\n\t"input_thresh" : "-34.55",\n\t"output_i" : "-16.00",\n\t"target_offset" : "0.12"\n}\n');
assert.deepStrictEqual(measured, { i: -24.31, lra: 5.1, tp: -6.02, thresh: -34.55, offset: 0.12 });
assert.strictEqual(parseLoudnormJson('{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0", "input_thresh" : "-70", "target_offset" : "0" }'), null, 'silent sound falls back to one pass');
assert.strictEqual(parseLoudnormJson('no json here'), null);
assert.match(loudnormSecondPass(LOUDNESS_PRESETS.normal, measured), /^loudnorm=I=-16:LRA=11:TP=-1\.5:measured_I=-24\.31:.*:linear=true$/);

console.log('videoCleanup tests passed');
