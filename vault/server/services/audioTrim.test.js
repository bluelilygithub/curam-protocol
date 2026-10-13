'use strict';
const assert = require('assert');
const { planAudioTrim, trimAudioArgs } = require('./videoFfmpeg');

const arg = (args, flag) => args[args.indexOf(flag) + 1];

// ---- keep a part, same file type: a straight copy, no quality loss ----
let p = planAudioTrim({ startSec: 156, endSec: 168, durationSec: 600, inputExt: '.mp3' });
assert.strictEqual(p.copy, true);
assert.strictEqual(p.outExt, '.mp3');
assert.strictEqual(p.resultSec, 12);
let a = trimAudioArgs('in.mp3', 'out.mp3', p);
assert.strictEqual(arg(a, '-ss'), '156');
assert.strictEqual(arg(a, '-t'), '12', 'the end is sent as a length, never -to');
assert.ok(!a.includes('-to'));
assert.strictEqual(arg(a, '-c:a'), 'copy');

// ---- fades need a re-encode, so the file becomes an MP3 ----
p = planAudioTrim({ startSec: 10, endSec: 40, fadeInSec: 2, fadeOutSec: 3, durationSec: 100, inputExt: '.m4a' });
assert.strictEqual(p.copy, false);
assert.strictEqual(p.outExt, '.mp3');
a = trimAudioArgs('in.m4a', 'out.mp3', p);
assert.strictEqual(arg(a, '-af'), 'afade=t=in:st=0:d=2,afade=t=out:st=27:d=3');
assert.strictEqual(arg(a, '-c:a'), 'libmp3lame');

// fades can never be longer than half the result
p = planAudioTrim({ startSec: 0, endSec: 4, fadeInSec: 30, fadeOutSec: 30, durationSec: 100 });
assert.strictEqual(p.fadeIn, 2);
assert.strictEqual(p.fadeOut, 2);

// ---- WAV / MP3 output choices ----
assert.strictEqual(planAudioTrim({ startSec: 1, endSec: 5, format: 'wav', durationSec: 60 }).outExt, '.wav');
assert.strictEqual(trimAudioArgs('i', 'o.wav', planAudioTrim({ startSec: 1, endSec: 5, format: 'wav', durationSec: 60 }))[trimAudioArgs('i', 'o.wav', planAudioTrim({ startSec: 1, endSec: 5, format: 'wav', durationSec: 60 })).indexOf('-c:a') + 1], 'pcm_s16le');
assert.strictEqual(planAudioTrim({ startSec: 1, endSec: 5, format: 'mp3', durationSec: 60, inputExt: '.wav' }).copy, false);

// no end given = to the end of the recording
p = planAudioTrim({ startSec: 30, endSec: '', durationSec: 90 });
assert.strictEqual(p.resultSec, 60);
// an end past the file is clamped to the file
assert.strictEqual(planAudioTrim({ startSec: 30, endSec: 500, durationSec: 90 }).keepTo, 90);

// ---- cut a part OUT ----
p = planAudioTrim({ startSec: 20, endSec: 30, mode: 'remove', durationSec: 100 });
assert.strictEqual(p.cutMiddle, true);
assert.strictEqual(p.resultSec, 90);
assert.strictEqual(p.copy, false, 'joining two pieces needs a re-encode');
a = trimAudioArgs('in.mp3', 'out.mp3', p);
const graph = arg(a, '-filter_complex');
assert.match(graph, /atrim=0:20/);
assert.match(graph, /atrim=start=30/);
assert.match(graph, /concat=n=2:v=0:a=1\[out\]/);
// cutting out the very start or the very end is just keeping the other side (and can still be a copy)
p = planAudioTrim({ startSec: 0, endSec: 30, mode: 'remove', durationSec: 100 });
assert.deepStrictEqual([p.keepFrom, p.keepTo, p.cutMiddle, p.copy], [30, 100, false, true]);
p = planAudioTrim({ startSec: 70, endSec: 100, mode: 'remove', durationSec: 100 });
assert.deepStrictEqual([p.keepFrom, p.keepTo, p.cutMiddle], [0, 70, false]);
// fades land on the joined result
p = planAudioTrim({ startSec: 20, endSec: 30, mode: 'remove', fadeOutSec: 4, durationSec: 100 });
assert.match(arg(trimAudioArgs('i', 'o', p), '-filter_complex'), /concat=n=2:v=0:a=1,afade=t=out:st=86:d=4\[out\]/);

// ---- requests that make no sense are refused in plain words ----
assert.throws(() => planAudioTrim({ startSec: 30, endSec: 10, durationSec: 100 }), /end must be after the start/);
assert.throws(() => planAudioTrim({ startSec: 200, endSec: 300, durationSec: 100 }), /past the end/);
assert.throws(() => planAudioTrim({ startSec: 0, endSec: 100, mode: 'remove', durationSec: 100 }), /whole recording/);
assert.throws(() => planAudioTrim({ startSec: 5, endSec: 9, mode: 'remove', durationSec: 0 }), /how long/);
assert.throws(() => planAudioTrim({ startSec: 5, durationSec: 0 }), /where the part ends/);

console.log('audioTrim tests passed');
