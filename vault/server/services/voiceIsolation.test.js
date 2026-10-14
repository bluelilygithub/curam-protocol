'use strict';
const assert = require('assert');
const { pickStems, detectAudioType, quickVoiceArgs, isolateWithModel, remember, recall } = require('./voiceIsolation');

const R = 'https://replicate.delivery/pbxt/abc';

// ---- finding the stems in whatever shape the model returns ----
let s = pickStems({ vocals: `${R}/vocals.wav`, no_vocals: `${R}/no_vocals.wav` });
assert.deepStrictEqual(s, { voice: `${R}/vocals.wav`, music: `${R}/no_vocals.wav` });

s = pickStems({ vocals: `${R}/a.wav`, drums: `${R}/b.wav`, bass: `${R}/c.wav`, other: `${R}/d.wav` });
assert.strictEqual(s.voice, `${R}/a.wav`, 'a four-stem split still finds the voice');

s = pickStems({ output: { files: [{ name: 'vocals', url: `${R}/v.mp3` }, { name: 'accompaniment', url: `${R}/m.mp3` }] } });
assert.deepStrictEqual(s, { voice: `${R}/v.mp3`, music: `${R}/m.mp3` }, 'a {name,url} list is read by the name');
s = pickStems([`${R}/vocals.wav`, `${R}/accompaniment.wav`]);
assert.deepStrictEqual(s, { voice: `${R}/vocals.wav`, music: `${R}/accompaniment.wav` }, 'file names are used when keys say nothing');

assert.deepStrictEqual(pickStems(`${R}/only.wav`), { voice: `${R}/only.wav`, music: null }, 'a single file is the voice');
assert.deepStrictEqual(pickStems([`${R}/only.wav`]), { voice: `${R}/only.wav`, music: null });
assert.deepStrictEqual(pickStems({ vocals: 'https://evil.example.com/x.wav' }), { voice: null, music: null }, 'only Replicate hosts are ever downloaded');
assert.deepStrictEqual(pickStems(null), { voice: null, music: null });
assert.deepStrictEqual(pickStems({ a: `${R}/1.wav`, b: `${R}/2.wav` }), { voice: null, music: null }, 'ambiguous output is not guessed');

// ---- file type from the bytes ----
assert.strictEqual(detectAudioType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])).ext, '.wav');
assert.strictEqual(detectAudioType(Buffer.from('ID3\u0004rest')).ext, '.mp3');
assert.strictEqual(detectAudioType(Buffer.from([0xff, 0xfb, 0x90, 0x00])).ext, '.mp3');
assert.strictEqual(detectAudioType(Buffer.from('fLaC....')).ext, '.flac');
assert.strictEqual(detectAudioType(Buffer.from('OggS....')).ext, '.ogg');
assert.strictEqual(detectAudioType(Buffer.from('???')).mime, 'audio/mpeg', 'unknown bytes default to mp3');

// ---- quick (free) mode is plain ffmpeg ----
const q = quickVoiceArgs('in.mp3', 'out.mp3');
assert.ok(q.includes('-vn'));
assert.match(q[q.indexOf('-af') + 1], /highpass=f=100,lowpass=f=7000,afftdn/);

// ---- inputs are built from the model's own schema, not guessed ----
const { buildModelInput, modelList } = require('./voiceIsolation');
const URL_IN = 'https://api.replicate.com/v1/files/abc';
assert.deepStrictEqual(buildModelInput({ audio: {}, stem: { type: 'string' }, shifts: {} }, URL_IN), { audio: URL_IN, stem: 'vocals' });
assert.deepStrictEqual(buildModelInput({ audio: {}, two_stems: { enum: ['none', 'vocals', 'drums'] } }, URL_IN), { audio: URL_IN, two_stems: 'vocals' });
assert.deepStrictEqual(buildModelInput({ audio: {}, stem: { allOf: [{ enum: ['vocals', 'drums', 'bass'] }] } }, URL_IN), { audio: URL_IN, stem: 'vocals' }, 'enum behind allOf (how Replicate writes it)');
assert.deepStrictEqual(buildModelInput({ audio: {}, model_name: {}, output_format: { enum: ['mp3', 'wav', 'flac'] } }, URL_IN), { audio: URL_IN, output_format: 'mp3' }, 'a small playable format when offered');
assert.deepStrictEqual(buildModelInput({ audio: {}, stem: { enum: ['drums', 'bass'] } }, URL_IN), { audio: URL_IN }, 'a field with no voice choice is left alone');
assert.deepStrictEqual(buildModelInput({}, URL_IN), { audio: URL_IN }, 'no schema -> just the audio');
assert.deepStrictEqual(buildModelInput(null, URL_IN), { audio: URL_IN });
assert.ok(modelList().length >= 2, 'several models are tried');

// ---- AI mode, with the network replaced ----
(async () => {
  const calls = [];
  const deps = {
    upload: async (buf) => { calls.push(['upload', buf.length]); return URL_IN; },
    inputProps: async () => ({ audio: {}, stem: {} }),
    run: async (opts) => { calls.push(['run', opts.model, opts.input]); return { vocals: `${R}/vocals.wav`, no_vocals: `${R}/no_vocals.wav` }; },
    download: async (url) => { calls.push(['download', url]); return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from(url)]); },
  };
  const out = await isolateWithModel({ audio: Buffer.alloc(1000), token: 't', models: ['x/y'], deps });
  assert.strictEqual(out.ext, '.wav');
  assert.strictEqual(out.model, 'x/y');
  assert.ok(out.voice.length && out.music.length, 'both the voice and the music file come back');
  assert.deepStrictEqual(calls.find((c) => c[0] === 'run')[2], { audio: URL_IN, stem: 'vocals' });
  assert.strictEqual(calls.filter((c) => c[0] === 'download').length, 2);

  // the production failure: the first model is broken on its own server -> the next one is tried and works
  const tried = [];
  const libtorch = 'Could not load libtorchcodec. Likely causes: 1. FFmpeg is not properly installed in your environment';
  const fallback = await isolateWithModel({
    audio: Buffer.alloc(10), token: 't', models: ['broken/one', 'good/two'],
    deps: { ...deps, run: async (opts) => { tried.push(opts.model); if (opts.model === 'broken/one') throw new Error(libtorch); return { vocals: `${R}/vocals.wav` }; } },
  });
  assert.deepStrictEqual(tried, ['broken/one', 'good/two']);
  assert.strictEqual(fallback.model, 'good/two');
  assert.strictEqual(fallback.music, null, 'no music file offered by that model: voice still works');

  // a model that "succeeds" with nothing usable also falls through to the next
  const odd = await isolateWithModel({
    audio: Buffer.alloc(10), token: 't', models: ['odd/one', 'good/two'],
    deps: { ...deps, run: async (opts) => (opts.model === 'odd/one' ? { weird: 1 } : { vocals: `${R}/vocals.wav` }) },
  });
  assert.strictEqual(odd.model, 'good/two');

  // every model failing: one plain message, each failure kept for the log
  let all;
  try {
    await isolateWithModel({ audio: Buffer.alloc(10), token: 't', models: ['a/a', 'b/b'], deps: { ...deps, run: async () => { throw new Error(libtorch); } } });
  } catch (e) { all = e; }
  assert.match(all.message, /not working right now/);
  assert.strictEqual(all.failures.length, 2);
  assert.match(all.failures[0], /^a\/a: Could not load libtorchcodec/);

  // a model whose schema cannot be read still gets the audio
  const noSchema = [];
  await isolateWithModel({ audio: Buffer.alloc(10), token: 't', models: ['x/y'], deps: { ...deps, inputProps: async () => { throw new Error('nope'); }, run: async (o) => { noSchema.push(o.input); return { vocals: `${R}/v.wav` }; } } });
  assert.deepStrictEqual(noSchema[0], { audio: URL_IN });

  await assert.rejects(isolateWithModel({ audio: Buffer.alloc(10), token: '', deps }), /not set up on this server/);
  // the music file is a bonus: failing to fetch it must not lose the voice
  const partial = await isolateWithModel({ audio: Buffer.alloc(10), token: 't', models: ['x/y'], deps: { ...deps, download: async (u) => { if (u.includes('no_vocals')) throw new Error('gone'); return Buffer.from('RIFF....WAVE'); } } });
  assert.ok(partial.voice.length && partial.music === null);

  // ---- short-lived results belong to the person who made them ----
  remember('job1', 7, { voice: { buffer: Buffer.from('v') } });
  assert.ok(recall('job1', 7));
  assert.strictEqual(recall('job1', 8), null, 'another user cannot fetch it');
  assert.strictEqual(recall('missing', 7), null);

  console.log('voiceIsolation tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
