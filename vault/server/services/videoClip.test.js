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
console.log('videoClip tests passed');
