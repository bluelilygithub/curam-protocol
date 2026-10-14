'use strict';
const assert = require('assert');
const { normalizeExtendOptions, planExtend, buildExtendArgs } = require('./extendEnding');
const { buildFitFilter, fadeTimes } = require('./music/musicFit');

const arg = (args, flag) => args[args.indexOf(flag) + 1];

// ---- options ----
assert.deepStrictEqual(normalizeExtendOptions({}), { holdSec: 4, fadeOutSec: 4 }, 'the music fades over exactly the held time by default');
assert.deepStrictEqual(normalizeExtendOptions({ holdSec: '6' }), { holdSec: 6, fadeOutSec: 6 });
assert.deepStrictEqual(normalizeExtendOptions({ holdSec: 0, fadeOutSec: -3 }), { holdSec: 1, fadeOutSec: 0 }, 'at least a second; no negative fade');
assert.deepStrictEqual(normalizeExtendOptions({ holdSec: 999, fadeOutSec: 999 }), { holdSec: 30, fadeOutSec: 60 });
assert.strictEqual(normalizeExtendOptions({ holdSec: 5, fadeOutSec: '' }).fadeOutSec, 5, 'empty means default, not zero');
assert.strictEqual(normalizeExtendOptions({ holdSec: 5, fadeOutSec: 0 }).fadeOutSec, 0, 'zero means no fade');

// ---- which sound plan ----
let p = planExtend({ srcSec: 30, hasVideoAudio: true, hasNewAudio: true, options: { holdSec: 5 } });
assert.deepStrictEqual([p.audio, p.total, p.fadeOutSec], ['new', 35, 5], 'music file chosen: plays through the hold and fades over it');
p = planExtend({ srcSec: 30, hasVideoAudio: true, hasNewAudio: false, options: { holdSec: 5 } });
assert.strictEqual(p.audio, 'own');
p = planExtend({ srcSec: 30, hasVideoAudio: false, hasNewAudio: false, options: {} });
assert.strictEqual(p.audio, 'none');
// a fade longer than the piece allows is cut back
assert.strictEqual(planExtend({ srcSec: 4, hasVideoAudio: true, hasNewAudio: true, options: { holdSec: 2, fadeOutSec: 60 } }).fadeOutSec, 3, 'new audio: at most half the piece');
assert.strictEqual(planExtend({ srcSec: 4, hasVideoAudio: true, hasNewAudio: false, options: { holdSec: 2, fadeOutSec: 60 } }).fadeOutSec, 4, "own sound: at most the video's length (it ends there)");

// ---- new audio: the video is held, the (already fitted) audio is used as is ----
let a = buildExtendArgs('in.mp4', 'fit.wav', 'out.mp4', planExtend({ srcSec: 30, hasVideoAudio: true, hasNewAudio: true, options: { holdSec: 5 } }));
assert.deepStrictEqual(a.slice(0, 5), ['-y', '-i', 'in.mp4', '-i', 'fit.wav']);
assert.match(arg(a, '-filter_complex'), /^\[0:v\]tpad=stop_mode=clone:stop_duration=5\.000,format=yuv420p\[v\]$/);
assert.ok(a.includes('1:a'), 'sound comes from the chosen audio');
assert.strictEqual(arg(a, '-t'), '35.000', 'the whole piece is video + hold');
assert.strictEqual(arg(a, '-crf'), '18');
assert.strictEqual(arg(a, '-pix_fmt'), 'yuv420p');
assert.strictEqual(arg(a, '-c:a'), 'aac');

// ---- own sound: faded out where it ends, then silence through the hold ----
a = buildExtendArgs('in.mp4', null, 'out.mp4', planExtend({ srcSec: 30, hasVideoAudio: true, hasNewAudio: false, options: { holdSec: 5, fadeOutSec: 3 } }));
assert.ok(!a.includes('fit.wav') && a.filter((x) => x === '-i').length === 1, 'only the video is an input');
const fc = arg(a, '-filter_complex');
assert.match(fc, /afade=t=out:st=27\.000:d=3\.000/, 'fade ends exactly where the video ends');
assert.match(fc, /apad=whole_dur=35\.000\[a\]/, 'padded with silence through the held frame');
assert.ok(a.includes('[a]'));
// no fade asked for: sound untouched, just padded
a = buildExtendArgs('in.mp4', null, 'out.mp4', planExtend({ srcSec: 30, hasVideoAudio: true, hasNewAudio: false, options: { holdSec: 5, fadeOutSec: 0 } }));
assert.ok(!arg(a, '-filter_complex').includes('afade'));

// ---- silent video, no audio chosen: no audio streams at all ----
a = buildExtendArgs('in.mp4', null, 'out.mp4', planExtend({ srcSec: 10, hasVideoAudio: false, hasNewAudio: false, options: { holdSec: 3 } }));
assert.ok(!a.includes('-c:a') && !a.includes('-map') === false);
assert.ok(!a.includes('[a]') && !a.includes('1:a'));

// ---- the shared music-fit code: custom fades work, defaults are untouched ----
assert.deepStrictEqual(fadeTimes(30), { fadeIn: 0.5, fadeOut: 2, fadeOutStart: 28 }, 'Music page defaults unchanged');
assert.deepStrictEqual(fadeTimes(35, { fadeOutS: 5 }), { fadeIn: 0.5, fadeOut: 5, fadeOutStart: 30 });
assert.strictEqual(fadeTimes(10, { fadeOutS: 99 }).fadeOut, 5, 'never more than half the piece');
assert.strictEqual(fadeTimes(10, { fadeOutS: 0 }).fadeOut, 0);
assert.match(buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 35, fades: { fadeOutS: 5 } }), /afade=t=out:st=30\.000:d=5\.000/);
assert.ok(!buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 35, fades: { fadeOutS: 0 } }).includes('afade=t=out'), 'no zero-length fade (ffmpeg rejects it)');

console.log('extendEnding tests passed');
