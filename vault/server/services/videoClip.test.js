'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { clipArgs } = require('./videoFfmpeg');

// 02:36 - 02:48 must be a 12 second clip, not 168 seconds (the old "-ss 156 -to 168" bug).
const a = clipArgs('in.mp4', 'out.mp4', { startSec: 156, endSec: 168 });
assert.strictEqual(a[a.indexOf('-ss') + 1], '156');
assert.strictEqual(a[a.indexOf('-t') + 1], '12');
assert.ok(!a.includes('-to'), 'never use -to after an input -ss');
assert.ok(!a.includes('copy'), 'no keyframe-snapping stream copy');

const open = clipArgs('in.mp4', 'out.mp4', { startSec: 30, endSec: '' });
assert.ok(!open.includes('-t'), 'no end = to the end of the file');
const short = clipArgs('i', 'o', { startSec: 0, endSec: 7.25 });
assert.strictEqual(short[short.indexOf('-t') + 1], '7.25');
assert.throws(() => clipArgs('i', 'o', { startSec: 10, endSec: 10 }), /after Start/);
assert.ok(a.includes('yuv420p'), 'clip output is 4:2:0');
assert.strictEqual(a[a.indexOf('-crf') + 1], '16', 'exact cut is re-saved near-losslessly');

// Keep original quality = stream copy, no re-encode at all.
const k = clipArgs('in.mp4', 'out.mp4', { startSec: 156, endSec: 168, keepOriginal: true });
assert.strictEqual(k[k.indexOf('-c') + 1], 'copy');
assert.strictEqual(k[k.indexOf('-t') + 1], '12');
assert.ok(!k.includes('libx264') && !k.includes('-crf'));

// Every H.264 encode must be 4:2:0, or Windows/QuickTime/phones refuse to play it
// (a "joined.mp4" made through the transition graph came out High 4:4:4 and would not play).
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))) {
  const src = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  src.forEach((l, i) => {
    if (l.includes("'libx264'")) {
      assert.ok(src.slice(i, i + 6).join(' ').includes('yuv420p'), `libx264 without yuv420p: ${path.basename(file)}:${i + 1}`);
    }
  });
}

// Audio -> transcript: SRT is turned into plain readable text.
const { srtToPlainText } = require('./srtUtils');
const sampleSrt = [
  '1', '00:00:01,000 --> 00:00:03,000', 'Hello there.', '',
  '2', '00:00:03,500 --> 00:00:05,000', 'Second   line.', '',
].join('\n');
assert.strictEqual(srtToPlainText(sampleSrt), ['Hello there.', 'Second line.'].join('\n'));
assert.strictEqual(srtToPlainText(''), '');
// Audio -> video with the transcript on it: sizes and colour validation (the ffmpeg render itself needs ffmpeg).
const { audioVideoSize, safeHexColor } = require('./videoFfmpeg');
assert.deepStrictEqual(audioVideoSize('9:16'), [720, 1280]);
assert.deepStrictEqual(audioVideoSize('16:9'), [1280, 720]);
assert.deepStrictEqual(audioVideoSize('weird'), [1280, 720], 'unknown aspect falls back to landscape');
assert.strictEqual(safeHexColor('#AbCdEf', '#111111'), '#AbCdEf');
assert.strictEqual(safeHexColor('red; rm -rf', '#111111'), '#111111', 'anything but #RRGGBB is replaced, never passed to ffmpeg');
assert.strictEqual(safeHexColor(undefined, '#111111'), '#111111');
console.log('videoClip tests passed');
