'use strict';
const assert = require('assert');
const { parseTimeRange, parseTime, normalizeVoiceValues, localParse, TOOL_SCHEMAS } = require('./videoVoiceCommand');

const eq = (t, d, exp) => assert.deepStrictEqual(parseTimeRange(t, d), exp, t);

eq('cut from 10 to 25 seconds', 0, { start: 10, end: 25 });
eq('I want to cut from 10 seconds to 25 seconds', 0, { start: 10, end: 25 });
eq('trim from 1:30 to 2:45', 0, { start: 90, end: 165 });
eq('from one minute thirty to two minutes', 0, { start: 90, end: 120 });
eq('from twenty to forty five seconds', 0, { start: 20, end: 45 });
eq('between 5 and 12 seconds', 0, { start: 5, end: 12 });
eq('keep the first 30 seconds', 0, { start: 0, end: 30 });
eq('cut off the last 10 seconds', 60, { start: 0, end: 50 });
eq('keep the last 10 seconds', 60, { start: 50, end: 60 });
eq('start at 5 seconds', 0, { start: 5 });
eq('end at two and a half minutes', 0, { end: 150 });
eq('start at 12 and end at 40', 0, { start: 12, end: 40 });
eq('make it blue', 0, null);

assert.strictEqual(parseTime('1.5 minutes'), 90);
assert.strictEqual(parseTime('1 minute 30'), 90);
assert.strictEqual(parseTime('2:03:04'), 7384);

// validation clamps and drops junk
assert.deepStrictEqual(normalizeVoiceValues('convert', { crf: 99, maxWidth: 'abc', bogus: 1 }), { crf: 35 });
assert.deepStrictEqual(normalizeVoiceValues('reframe', { reframeAspect: '9:16', reframeMode: 'zoom' }), { reframeAspect: '9:16' });
assert.deepStrictEqual(normalizeVoiceValues('clip', { startSec: 30, endSec: 10 }), { startSec: 10, endSec: 30 });
assert.deepStrictEqual(normalizeVoiceValues('export-social', { exportPresets: ['reels', 'x'] }), { exportPresets: ['reels'] });
assert.deepStrictEqual(normalizeVoiceValues('annotate', { textFontColor: 'red' }), {});
assert.deepStrictEqual(normalizeVoiceValues('nope', { a: 1 }), {});

assert.deepStrictEqual(localParse('clip', 'from 2 to 9 seconds', {}), { startSec: 2, endSec: 9 });
assert.deepStrictEqual(localParse('togif', 'from 2 to 9 seconds', {}), { gifStartSec: 2, gifEndSec: 9 });
assert.deepStrictEqual(localParse('trim-audio', 'keep from 1:30 to 2:45', {}), { startSec: 90, endSec: 165 });
assert.deepStrictEqual(normalizeVoiceValues('trim-audio', { mode: 'remove', fadeOutSec: 99, format: 'ogg' }), { mode: 'remove', fadeOutSec: 10 });
assert.deepStrictEqual(normalizeVoiceValues('mix-audio', { musicVolume: 500, ducking: 'strong', format: 'ogg' }), { musicVolume: 150, ducking: 'strong' });
assert.deepStrictEqual(normalizeVoiceValues('extend-ending', { holdSec: 99, fadeOutSec: '3', musicVolume: 20, ducking: 'strong' }), { holdSec: 30, fadeOutSec: 3, musicVolume: 20, ducking: 'strong' });
assert.deepStrictEqual(localParse('thumbnail', 'at 12 seconds', {}), { thumbTime: 12 });
assert.strictEqual(localParse('speed', 'faster', {}), null);

for (const id of ['generate','clip','convert','extract-audio','audio','normalize','togif','export-social','reframe','speed','annotate','end-card','overlay','join','slideshow','caption-studio','trim-audio','saved-library','info','thumbnail']) {
  assert.ok(TOOL_SCHEMAS[id], id);
}
console.log('videoVoiceCommand tests passed');
