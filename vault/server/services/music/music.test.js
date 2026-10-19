'use strict';

// node server/services/music/music.test.js — pure helpers only (no ffmpeg, DB or network).

const assert = require('assert');
const { MOOD_PRESETS, buildMusicPrompt, parseBpm, INSTRUMENTAL_SUFFIX } = require('./musicPrompts');
const {
  planLoop, fadeTimes, buildFitFilter, buildMixFilter, normalizeMixSettings, normalizeVoiceSettings, DUCKING,
} = require('./musicFit');
const {
  normalizeSpeech, VOICES, GEMINI_VOICES, MAX_TEXT_CHARS, pickVoiceProviderName, createGeminiVoiceProvider,
} = require('./voiceProviders');
const { isReplicateAudioUrl } = require('./musicProviders');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('every preset yields an instrumental-only prompt', () => {
  for (const m of MOOD_PRESETS) {
    const { prompt, mood } = buildMusicPrompt({ mood: m.id });
    assert.strictEqual(mood, m.id);
    assert.ok(prompt.endsWith(INSTRUMENTAL_SUFFIX), m.id);
    assert.ok(/no vocals/.test(prompt));
  }
  assert.strictEqual(MOOD_PRESETS.length, 7);
});

test('custom prompt, preset + extra direction, and BPM', () => {
  const custom = buildMusicPrompt({ mood: 'custom', custom: 'slow dreamy harp', bpm: 70 });
  assert.ok(custom.prompt.startsWith('slow dreamy harp'));
  assert.ok(custom.prompt.includes('70 BPM'));
  assert.strictEqual(custom.mood, 'custom');
  const both = buildMusicPrompt({ mood: 'lofi-chill', custom: 'with rain sounds' });
  assert.ok(both.prompt.includes('lo-fi') && both.prompt.includes('with rain sounds'));
  assert.strictEqual(buildMusicPrompt({ custom: 'just text' }).mood, 'custom');
});

test('missing mood and prompt is rejected; junk is cleaned', () => {
  assert.throws(() => buildMusicPrompt({}), /Pick a mood/);
  assert.throws(() => buildMusicPrompt({ mood: 'nope', custom: '   ' }), /Pick a mood/);
  const { prompt } = buildMusicPrompt({ mood: 'custom', custom: `a\u0000b\n\nc${'x'.repeat(600)}` });
  assert.ok(!/[\u0000-\u001f]/.test(prompt));
  assert.ok(prompt.length < 600);
});

test('parseBpm accepts 40-220 and ignores everything else', () => {
  assert.strictEqual(parseBpm('120'), 120);
  assert.strictEqual(parseBpm(75.4), 75);
  for (const bad of ['', null, undefined, 'fast', 10, 400, -5]) assert.strictEqual(parseBpm(bad), null);
});

test('planLoop: one copy when the clip is long enough', () => {
  assert.deepStrictEqual(planLoop(30, 20), { copies: 1, crossfadeS: 0 });
  assert.deepStrictEqual(planLoop(30, 30), { copies: 1, crossfadeS: 0 });
});

test('planLoop: enough crossfaded copies to cover the video', () => {
  for (const [clip, target] of [[30, 31], [30, 60], [30, 300], [10, 12], [8, 95], [1, 20]]) {
    const { copies, crossfadeS } = planLoop(clip, target);
    const total = copies * clip - (copies - 1) * crossfadeS;
    assert.ok(total >= target - 1e-9, `${clip}->${target}: ${total}`);
    assert.ok(total - target < clip, `${clip}->${target} over-generates by a whole clip`);
    assert.ok(crossfadeS <= clip / 4);
  }
  assert.throws(() => planLoop(0, 10), /unknown/);
});

test('fade times: 0.5s in, 2s out, shrinking only for very short videos', () => {
  assert.deepStrictEqual(fadeTimes(30), { fadeIn: 0.5, fadeOut: 2, fadeOutStart: 28 });
  const tiny = fadeTimes(2);
  assert.ok(tiny.fadeIn < 0.5 && tiny.fadeOut <= 1 && tiny.fadeOutStart >= 0);
});

test('fit filter: crossfade chain, exact trim, fades land on the end', () => {
  const f = buildFitFilter({ copies: 3, crossfadeS: 2, targetS: 70 });
  assert.strictEqual((f.match(/acrossfade/g) || []).length, 2);
  assert.ok(f.includes('atrim=0:70.000'));
  assert.ok(f.includes('afade=t=in:st=0:d=0.500'));
  assert.ok(f.includes('afade=t=out:st=68.000:d=2.000'));
  const one = buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 10 });
  assert.ok(!one.includes('acrossfade'));
});

test('mix filter: ducking uses sidechaincompress, off does not, no-audio skips the voice', () => {
  const strong = buildMixFilter({ hasAudio: true, volume: 0.7, ducking: 'strong' });
  assert.ok(strong.includes('sidechaincompress') && strong.includes('loudnorm=I=-14'));
  assert.ok(strong.includes(`threshold=${DUCKING.strong.threshold}`));
  const off = buildMixFilter({ hasAudio: true, volume: 0.7, ducking: 'off' });
  assert.ok(!off.includes('sidechaincompress') && off.includes('amix'));
  const silent = buildMixFilter({ hasAudio: false, volume: 1, ducking: 'strong' });
  assert.ok(!silent.includes('sidechaincompress') && !silent.includes('[0:a]') && silent.includes('loudnorm'));
  assert.ok(DUCKING.strong.threshold < DUCKING.light.threshold && DUCKING.strong.ratio > DUCKING.light.ratio);
});

test('mix settings are clamped to safe values', () => {
  assert.deepStrictEqual(normalizeMixSettings({}), { volume: 0.7, ducking: 'light' });
  assert.deepStrictEqual(normalizeMixSettings({ volume: '9', ducking: 'rm -rf' }), { volume: 1.5, ducking: 'light' });
  assert.deepStrictEqual(normalizeMixSettings({ volume: -3, ducking: 'off' }), { volume: 0, ducking: 'off' });
  assert.strictEqual(normalizeMixSettings({ volume: 'abc' }).volume, 0.7);
});

test('voiceover mix filter: delayed, padded to length, drives the ducking', () => {
  const voice = { volume: 1.2, startS: 2.5 };
  const ducked = buildMixFilter({ hasAudio: true, volume: 0.7, ducking: 'strong', voice, durationS: 20 });
  assert.ok(ducked.includes('[2:a]') && ducked.includes('adelay=2500:all=1') && ducked.includes('apad=whole_dur=20.000'));
  assert.ok(ducked.includes('volume=1.200') && ducked.includes('loudnorm=I=-14'));
  assert.strictEqual(ducked.match(/sidechaincompress/g).length, 2, 'music and the video sound both dip under the voice');
  assert.ok(ducked.includes(`threshold=${DUCKING.strong.threshold}`) && ducked.includes(`threshold=${DUCKING.light.threshold}`));
  const off = buildMixFilter({ hasAudio: true, volume: 0.7, ducking: 'off', voice, durationS: 20 });
  assert.ok(!off.includes('sidechaincompress') && off.includes('amix=inputs=3'));
  const silent = buildMixFilter({ hasAudio: false, volume: 0.7, ducking: 'light', voice, durationS: 20 });
  assert.ok(!silent.includes('[0:a]') && silent.includes('sidechaincompress') && silent.includes('amix=inputs=2'));
  // no voiceover: unchanged graph, no third input
  assert.ok(!buildMixFilter({ hasAudio: true, volume: 0.7, ducking: 'light', durationS: 20 }).includes('[2:a]'));
});

test('voiceover settings and script are clamped to safe values', () => {
  assert.deepStrictEqual(normalizeVoiceSettings({}, 30), { volume: 1, startS: 0 });
  assert.deepStrictEqual(normalizeVoiceSettings({ voiceVolume: '9', voiceStartS: '999' }, 30), { volume: 2, startS: 29.5 });
  assert.deepStrictEqual(normalizeVoiceSettings({ voiceVolume: -1, voiceStartS: -5 }, 30), { volume: 0, startS: 0 });
  assert.strictEqual(normalizeVoiceSettings({ voiceVolume: 'abc' }, 30).volume, 1);
  const ok = normalizeSpeech({ text: '  Hello   there \n world ', voice: 'bm_george', speed: '1.1' });
  assert.deepStrictEqual(ok, { text: 'Hello there world', voice: 'bm_george', speed: 1.1 });
  assert.strictEqual(normalizeSpeech({ text: 'x', voice: 'not-a-voice', speed: 9 }).voice, VOICES[0].id);
  assert.strictEqual(normalizeSpeech({ text: 'x', speed: 9 }).speed, 1.3);
  assert.throws(() => normalizeSpeech({ text: '   ' }), /what the voice should say/);
  assert.throws(() => normalizeSpeech({ text: 'a'.repeat(MAX_TEXT_CHARS + 1) }), /under/);
});

test('script voice falls back to the chosen provider\'s own first voice', () => {
  assert.strictEqual(normalizeSpeech({ text: 'x', voice: 'af_nicole' }, GEMINI_VOICES).voice, 'Kore');
  assert.strictEqual(normalizeSpeech({ text: 'x', voice: 'Charon' }, GEMINI_VOICES).voice, 'Charon');
});

test('voice backend: forced name wins, fake follows the music fake, else Gemini when it has a key', () => {
  assert.strictEqual(pickVoiceProviderName({ GEMINI_API_KEY: 'k' }), 'gemini');
  assert.strictEqual(pickVoiceProviderName({}), 'replicate');
  assert.strictEqual(pickVoiceProviderName({ GEMINI_API_KEY: 'k', VOICE_PROVIDER: 'replicate' }), 'replicate');
  assert.strictEqual(pickVoiceProviderName({ MUSIC_PROVIDER: 'fake', GEMINI_API_KEY: 'k' }), 'fake');
  assert.strictEqual(pickVoiceProviderName({ VOICE_PROVIDER: 'gemini', MUSIC_PROVIDER: 'fake' }), 'gemini');
});

test('fine-tuned fades and start are made safe; the start delays the music inside the full length', () => {
  const { normalizeFitSettings, buildFitFilter, sceneCutArgs, parseSceneCuts } = require('./musicFit');
  assert.deepStrictEqual(normalizeFitSettings({}, 30), { fadeInS: 0.5, fadeOutS: 2, startS: 0 }, 'blank means the defaults');
  assert.deepStrictEqual(normalizeFitSettings({ fadeInS: '1', fadeOutS: 99, startS: '5' }, 30), { fadeInS: 1, fadeOutS: 12.5, startS: 5 }, 'a fade is never more than half the music');
  assert.deepStrictEqual(normalizeFitSettings({ fadeInS: -3, fadeOutS: 'x', startS: 999 }, 30), { fadeInS: 0, fadeOutS: 0.5, startS: 29 }, 'negative, junk and too-late values are corrected; at least a second of music remains, and its fade fits in it');
  const f = buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 25, fades: {}, startS: 5, totalS: 30 });
  assert.ok(f.includes('adelay=5000:all=1') && f.includes('apad=whole_dur=30.000') && f.endsWith('atrim=0:30.000[fit]'), f);
  assert.ok(!buildFitFilter({ copies: 1, crossfadeS: 0, targetS: 25, fades: {} }).includes('adelay'), 'no start, no delay: the filter is as before');
  assert.ok(sceneCutArgs('v.mp4', 0.4).join(' ').includes("select='gt(scene,0.4)',showinfo"));
  const out = 'frame pts_time:0.2 x pts_time:3.5 y pts_time:3.9 z pts_time:10.123 w pts_time:29.9';
  assert.deepStrictEqual(parseSceneCuts(out, 30), [3.5, 10.12], 'ends and near-duplicates are dropped');
  assert.deepStrictEqual(parseSceneCuts('', 30), []);
});

async function moodChecks() {
  const { normalizeMoodReply, suggestMood, cleanDescription } = require('./moodSuggest');
  assert.deepStrictEqual(normalizeMoodReply('{"mood":"calm-corporate","bpm":96.4,"why":"  Soft and steady.  "}'), { mood: 'calm-corporate', label: 'Calm corporate', bpm: 96, why: 'Soft and steady.' });
  assert.deepStrictEqual(normalizeMoodReply('```json\n{"mood":"suspense","bpm":999}\n```'), { mood: 'suspense', label: 'Suspense', bpm: null, why: '' }, 'a fenced reply works; a silly tempo is dropped');
  assert.strictEqual(normalizeMoodReply('{"mood":"death-metal","bpm":100}'), null, 'an invented mood is refused');
  assert.strictEqual(normalizeMoodReply('not json at all'), null);
  assert.strictEqual(normalizeMoodReply(null), null);
  assert.strictEqual(cleanDescription('  a   calm\n video '), 'a calm video');
  const deps = (text) => ({
    getModels: async () => ({ light: 'light-model' }),
    callModel: async (model, prompt) => { deps.seen = { model, prompt }; return { text, model, inputTokens: 1, outputTokens: 1 }; },
    logUsage: () => {},
  });
  const ok = await suggestMood(1, 'a drone trip across the coast', deps('{"mood":"travel-montage","bpm":110,"why":"Open horizons."}'));
  assert.strictEqual(ok.mood, 'travel-montage');
  assert.strictEqual(deps.seen.model, 'light-model', 'uses the workspace light model, not a hardcoded one');
  assert.match(deps.seen.prompt, /drone trip/);
  await assert.rejects(() => suggestMood(1, 'hi', deps('{}')), /a little about your video/);
  await assert.rejects(() => suggestMood(1, 'a long calm video', deps('{"mood":"nope"}')), /could not pick a mood/);
}

test('only Replicate https hosts are accepted as audio download URLs', () => {
  assert.ok(isReplicateAudioUrl('https://replicate.delivery/pbxt/abc/out.wav'));
  assert.ok(isReplicateAudioUrl('https://pbxt.replicate.delivery/x.wav'));
  for (const bad of ['http://replicate.delivery/x.wav', 'https://evil.com/replicate.delivery', 'https://replicate.delivery.evil.com/x', 'file:///etc/passwd', 'nonsense']) {
    assert.ok(!isReplicateAudioUrl(bad), bad);
  }
});

async function geminiVoiceChecks() {
  const realFetch = global.fetch;
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const pcm = Buffer.alloc(48000); // 1 s of silence at 24 kHz, 16-bit mono
  let seen = null;
  try {
    global.fetch = async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }] }) };
    };
    const wav = await createGeminiVoiceProvider().speak({ text: 'G\'day mate', voice: 'Kore', speed: 1 });
    assert.ok(seen.url.includes('generateContent'));
    assert.strictEqual(seen.init.headers['x-goog-api-key'], 'test-key'); // key in a header, never the URL
    assert.ok(!seen.url.includes('test-key'));
    const body = JSON.parse(seen.init.body);
    assert.ok(body.contents[0].parts[0].text.includes('Australian accent'));
    assert.ok(body.contents[0].parts[0].text.endsWith('G\'day mate'));
    assert.strictEqual(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
    assert.strictEqual(wav.subarray(0, 4).toString(), 'RIFF');
    assert.strictEqual(wav.length, 44 + pcm.length);

    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) });
    await assert.rejects(() => createGeminiVoiceProvider().speak({ text: 'x', voice: 'Kore', speed: 1 }), /busy or over its limit/);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) });
    await assert.rejects(() => createGeminiVoiceProvider().speak({ text: 'x', voice: 'Kore', speed: 1 }), /returned no audio/);
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(() => createGeminiVoiceProvider().speak({ text: 'x', voice: 'Kore', speed: 1 }), /GEMINI_API_KEY/);
  } finally {
    global.fetch = realFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
  }
}

// Music jobs without ffmpeg or a network: a fake provider and a fake "fit" step stand in for the real ones.
async function musicJobChecks() {
  const fs = require('fs/promises');
  const path = require('path');
  const J = require('./musicJobs');
  assert.strictEqual(J.normalizeSeed('42'), 42);
  assert.strictEqual(J.normalizeSeed(''), null);
  assert.strictEqual(J.normalizeSeed('1.5'), null);
  assert.strictEqual(J.normalizeSeed(0), null);
  assert.strictEqual(J.normalizeSeed(2 ** 31), null);
  assert.strictEqual(J.normalizeMusicLength('30', 300), 30);
  assert.strictEqual(J.normalizeMusicLength('4', 300), null, 'shorter than the minimum is refused');
  assert.strictEqual(J.normalizeMusicLength('301', 300), null, 'longer than the maximum is refused');
  assert.strictEqual(J.normalizeMusicLength('abc', 300), null);

  const calls = [];
  const provider = { maxClipS: 30, generate: async (a) => { calls.push(a); return Buffer.from('RIFFfake'); } };
  const deps = {
    gate: { run: (f) => f() },
    fit: async (_raw, out, durationS) => { await fs.writeFile(out, `fit ${durationS}`); return { copies: Math.ceil(durationS / 30) }; },
  };
  const job = await J.createJob({
    userId: 7, videoFile: null, durationS: 45, hasAudio: false, seed: 1000,
    promptInfo: { prompt: 'calm piano', mood: 'custom', bpm: null }, providerName: 'fake',
  });
  try {
    assert.strictEqual(job.mode, 'music-only');
    assert.strictEqual(job.videoPath, null);
    assert.deepStrictEqual(job.options.map((o) => o.seed), [1000, 1000 + 7919, 1000 + 2 * 7919], 'a typed seed is the first option\'s seed');
    await J.runJob(job, provider, deps);
    assert.strictEqual(job.status, 'done');
    assert.ok(calls.every((c) => c.durationS === 30 && c.prompt === 'calm piano'), 'clips are capped at the provider\'s limit');
    const pub = J.publicJob(job);
    assert.strictEqual(pub.mode, 'music-only');
    assert.strictEqual(pub.hasVideo, false);
    assert.deepStrictEqual(pub.options.map((o) => [o.status, o.rev, o.loops]), [['ready', 1, 2], ['ready', 1, 2], ['ready', 1, 2]]);

    const before = job.options.map((o) => o.seed);
    await J.regenerateOption(job, provider, 1, { seed: 555, deps });
    assert.strictEqual(job.options[1].seed, 555, 'the seed given is used');
    assert.strictEqual(job.options[1].rev, 2, 'a new version bumps the revision so cached previews are not reused');
    assert.deepStrictEqual([job.options[0].seed, job.options[2].seed], [before[0], before[2]], 'other options are untouched');
    assert.strictEqual(job.status, 'done');
    await assert.rejects(() => J.regenerateOption(job, provider, 9, { deps }), /Unknown option/);

    await J.addOption(job, provider, { deps });
    assert.strictEqual(job.options.length, 4);
    assert.strictEqual(job.options[3].status, 'ready');
    await J.addOption(job, provider, { deps });
    await J.addOption(job, provider, { deps });
    assert.strictEqual(job.options.length, J.MAX_OPTIONS);
    await assert.rejects(() => J.addOption(job, provider, { deps }), /most options/);

    // One failing option never sinks the set, and making it again can recover it.
    const flaky = { maxClipS: 30, generate: async ({ seed }) => { if (seed === 777) throw new Error('model error'); return Buffer.from('x'); } };
    await J.regenerateOption(job, flaky, 0, { seed: 777, deps });
    assert.strictEqual(job.options[0].status, 'failed');
    assert.match(job.options[0].error, /model error/);
    assert.strictEqual(job.status, 'done', 'other options are still ready');
    await J.regenerateOption(job, provider, 0, { seed: 778, deps });
    assert.strictEqual(job.options[0].status, 'ready');
    assert.strictEqual(job.options[0].error, null);

    // Fine-tuning fades / start fits every ready option again from its own clip, with no generation.
    const genCalls = calls.length;
    const fitCalls = [];
    const spyDeps = { gate: deps.gate, fit: async (raw, out, durationS, fades) => { fitCalls.push({ raw: path.basename(raw), fades }); return deps.fit(raw, out, durationS, fades); } };
    const revs = job.options.map((o) => o.rev);
    await J.refitJob(job, { fadeInS: 1, fadeOutS: 4, startS: 5 }, spyDeps);
    assert.strictEqual(calls.length, genCalls, 'no new music is generated');
    assert.strictEqual(fitCalls.length, 6);
    assert.ok(fitCalls.every((c) => c.fades.startS === 5 && /^raw_\d\.wav$/.test(c.raw)), 'each option is fitted from its own clip');
    assert.deepStrictEqual(job.options.map((o) => o.rev), revs.map((r) => r + 1), 'cached previews are not reused');
    assert.deepStrictEqual(J.publicJob(job).fit, { fadeInS: 1, fadeOutS: 4, startS: 5 });
    assert.strictEqual(job.status, 'done');
    // a later new version keeps the settings
    await J.regenerateOption(job, provider, 2, { seed: 9, deps: { gate: deps.gate, fit: async (raw, out, d, fades) => { fitCalls.push({ raw: 'again', fades }); return deps.fit(raw, out, d, fades); } } });
    assert.deepStrictEqual(fitCalls[fitCalls.length - 1].fades, { fadeInS: 1, fadeOutS: 4, startS: 5 }, 'making an option again keeps the fades and start');
  } finally {
    await J.removeJob(job);
  }
}

(async () => {
  await geminiVoiceChecks();
  await musicJobChecks();
  await moodChecks();
  passed += 1; console.log('ok - mood suggestion: only a known mood, a sane tempo and a short reason survive');
  {
    // a script becomes a WAV through the provider, then the shared conversion (faked here: no ffmpeg needed)
    const { speakToWav } = require('../voiceover');
    const fs = require('fs/promises');
    const spoken = [];
    const provider = { speak: async (a) => { spoken.push(a); return Buffer.from('raw-speech'); } };
    const wav = await speakToWav(provider, { text: 'hello', voice: 'Kore', speed: 1 }, { prepare: async (src, out) => { await fs.writeFile(out, `wav of ${(await fs.readFile(src)).toString()}`); } });
    assert.strictEqual(wav.toString(), 'wav of raw-speech');
    assert.deepStrictEqual(spoken, [{ text: 'hello', voice: 'Kore', speed: 1 }]);
    await assert.rejects(() => speakToWav({ speak: async () => { throw new Error('quota'); } }, { text: 'x' }, { prepare: async () => {} }), /quota/);
    passed += 1; console.log('ok - shared voiceover: script -> provider -> WAV');
  }
  passed += 1; console.log('ok - music jobs: music only, a typed seed, make one again, make another, one failure recovers');
  passed += 1; console.log('ok - Gemini voice: request shape, Australian-accent prompt, WAV result, clear errors');
  const { createReplicateProvider, _clearVersionCache } = require('./musicProviders');
  const realFetch = global.fetch;
  const saved = process.env.REPLICATE_API_TOKEN;
  try {
    delete process.env.REPLICATE_API_TOKEN;
    const p = createReplicateProvider();
    assert.strictEqual(p.describe().configured, false);
    await assert.rejects(() => p.generate({ prompt: 'x', durationS: 10, seed: 1 }), /REPLICATE_API_TOKEN/);
    passed += 1; console.log('ok - replicate: unconfigured token is a clear error');

    process.env.REPLICATE_API_TOKEN = 'test-token';
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null });
      if (String(url) === 'https://api.replicate.com/v1/models/meta/musicgen') {
        return { ok: true, status: 200, json: async () => ({ latest_version: { id: 'ver123' } }) };
      }
      if (String(url) === 'https://api.replicate.com/v1/predictions' && opts && opts.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'abc', status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/abc' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'abc', status: 'failed', error: 'NSFW or model error' }) };
    };
    await assert.rejects(() => createReplicateProvider().generate({ prompt: 'calm piano', durationS: 99, seed: 7 }), /model error/);
    // Community models must be run by version id via /v1/predictions — the /models/{owner}/{name}/predictions
    // endpoint answers 404 "The requested resource could not be found." for them.
    assert.ok(!calls.some((c) => /\/models\/[^/]+\/[^/]+\/predictions/.test(c.url)), 'must not use the official-models endpoint');
    const post = calls.find((c) => c.method === 'POST');
    assert.strictEqual(post.url, 'https://api.replicate.com/v1/predictions');
    assert.strictEqual(post.body.version, 'ver123');
    const sent = post.body.input;
    assert.strictEqual(sent.duration, 30, 'clip length is capped at what MusicGen handles');
    assert.strictEqual(sent.seed, 7);
    assert.strictEqual(sent.output_format, 'wav');
    assert.strictEqual(sent.prompt, 'calm piano');
    passed += 1; console.log('ok - replicate: sends capped duration/seed/wav and surfaces a failed prediction');

    // A second run reuses the looked-up version (no second model lookup).
    calls.length = 0;
    await assert.rejects(() => createReplicateProvider().generate({ prompt: 'x', durationS: 5, seed: 1 }), /model error/);
    assert.ok(!calls.some((c) => c.method === 'GET' && c.url.endsWith('/models/meta/musicgen')), 'version is cached');

    _clearVersionCache();
    global.fetch = async (url) => (String(url).endsWith('/models/meta/musicgen')
      ? { ok: true, status: 200, json: async () => ({ latest_version: { id: 'ver123' } }) }
      : { ok: false, status: 422, json: async () => ({ detail: 'Invalid input' }) });
    await assert.rejects(() => createReplicateProvider().generate({ prompt: 'x', durationS: 5, seed: 1 }), /Invalid input/);
    passed += 1; console.log('ok - replicate: API errors are surfaced');

    _clearVersionCache();
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ detail: 'The requested resource could not be found.' }) });
    await assert.rejects(() => createReplicateProvider().generate({ prompt: 'x', durationS: 5, seed: 1 }), /was not found on Replicate — check MUSIC_REPLICATE_MODEL/);
    passed += 1; console.log('ok - replicate: unknown model gives an actionable message, not the raw 404');
  } finally {
    global.fetch = realFetch;
    if (saved === undefined) delete process.env.REPLICATE_API_TOKEN; else process.env.REPLICATE_API_TOKEN = saved;
  }
  console.log(`\n${passed} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
