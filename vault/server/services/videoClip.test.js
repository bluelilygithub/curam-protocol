'use strict';
const assert = require('assert');
const { clipArgs } = require('./videoFfmpeg');

// 02:36 - 02:48 must be a 12 second clip, not 168 seconds (the old "-ss 156 -to 168" bug).
const a = clipArgs('in.mp4', 'out.mp4', { startSec: 156, endSec: 168 });
assert.strictEqual(a[a.indexOf('-ss') + 1], '156');
assert.strictEqual(a[a.indexOf('-t') + 1], '12');
assert.ok(!a.includes('-to'), 'never use -to after an input -ss');
assert.ok(!a.includes('copy'), 'no keyframe-snapping stream copy');

const open = clipArgs('in.mp4', 'out.mp4', { startSec: 30, endSec: '' });
assert.ok(!open.includes('-t'), 'no end = to the end of the file');
assert.strictEqual(clipArgs('i', 'o', { startSec: 0, endSec: 7.25 })[6], '7.25');
assert.throws(() => clipArgs('i', 'o', { startSec: 10, endSec: 10 }), /after Start/);
console.log('videoClip tests passed');
