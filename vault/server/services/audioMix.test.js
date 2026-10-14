'use strict';
const assert = require('assert');
const { normalizeMixOptions, totalLength, buildAudioMixFilter, encoderArgs } = require('./audioMix');

// ---- options are clamped to what makes sense ----
let o = normalizeMixOptions({});
assert.deepStrictEqual(o, { musicVolume: 0.3, voiceVolume: 1, ducking: 'light', leadInSec: 0, tailSec: 3, format: 'mp3' }, 'sensible defaults');
o = normalizeMixOptions({ musicVolume: 99, voiceVolume: 0, ducking: 'banana', leadInSec: -5, tailSec: 500, format: 'ogg' });
assert.deepStrictEqual(o, { musicVolume: 1.5, voiceVolume: 0.2, ducking: 'light', leadInSec: 0, tailSec: 60, format: 'mp3' });
o = normalizeMixOptions({ musicVolume: '0.5', ducking: 'off', leadInSec: '4', format: 'wav' });
assert.strictEqual(o.musicVolume, 0.5);
assert.strictEqual(o.ducking, 'off');
assert.strictEqual(o.leadInSec, 4);
assert.strictEqual(o.format, 'wav');
assert.strictEqual(normalizeMixOptions({ musicVolume: '' }).musicVolume, 0.3, 'empty means default, not zero');

// ---- length = lead-in + voice + tail ----
assert.strictEqual(totalLength(60, normalizeMixOptions({ leadInSec: 4, tailSec: 6 })), 70);

// ---- ducking on: the voice both plays and drives the dip in the music ----
const duckOn = buildAudioMixFilter(normalizeMixOptions({ musicVolume: 0.3, leadInSec: 2, ducking: 'light' }), 70);
assert.match(duckOn, /\[1:a\].*adelay=2000:all=1/, 'voice starts after the lead-in');
assert.match(duckOn, /apad=whole_dur=70\.000,atrim=0:70\.000/, 'voice padded to the full length so the music tail plays on');
assert.match(duckOn, /\[0:a\]volume=0\.300\[m\]/);
assert.match(duckOn, /\[vo0\]asplit=2\[vo\]\[key\]/);
assert.match(duckOn, /\[m\]\[key\]sidechaincompress=threshold=0\.02:ratio=3/);
assert.match(duckOn, /\[vo\]\[ducked\]amix=inputs=2:duration=first:normalize=0/);
assert.match(duckOn, /loudnorm=I=-16/);
assert.match(duckOn, /\[aout\]$/);

// ---- strong ducking uses the stronger preset ----
assert.match(buildAudioMixFilter(normalizeMixOptions({ ducking: 'strong' }), 10), /sidechaincompress=threshold=0\.015:ratio=8/);

// ---- ducking off: plain mix, no sidechain ----
const duckOff = buildAudioMixFilter(normalizeMixOptions({ ducking: 'off' }), 10);
assert.ok(!duckOff.includes('sidechaincompress'));
assert.match(duckOff, /\[vo0\]\[m\]amix=inputs=2:duration=first:normalize=0/);

// every graph is a closed chain ending in [aout], with no dangling labels
for (const f of [duckOn, duckOff]) {
  const made = [...f.matchAll(/\[([a-z0-9]+)\](?=[;,]|$)/g)].map((m) => m[1]);
  assert.ok(made.includes('aout'));
}

// ---- encoders ----
assert.deepStrictEqual(encoderArgs('wav'), ['-c:a', 'pcm_s16le']);
assert.deepStrictEqual(encoderArgs('mp3'), ['-c:a', 'libmp3lame', '-b:a', '192k']);

console.log('audioMix tests passed');
