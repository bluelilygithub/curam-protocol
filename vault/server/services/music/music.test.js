'use strict';

// node server/services/music/music.test.js — pure helpers only (no ffmpeg, DB or network).

const assert = require('assert');
const { MOOD_PRESETS, buildMusicPrompt, parseBpm, INSTRUMENTAL_SUFFIX } = require('./musicPrompts');
const { planLoop, fadeTimes, buildFitFilter, buildMixFilter, normalizeMixSettings, DUCKING } = require('./musicFit');
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

test('only Replicate https hosts are accepted as audio download URLs', () => {
  assert.ok(isReplicateAudioUrl('https://replicate.delivery/pbxt/abc/out.wav'));
  assert.ok(isReplicateAudioUrl('https://pbxt.replicate.delivery/x.wav'));
  for (const bad of ['http://replicate.delivery/x.wav', 'https://evil.com/replicate.delivery', 'https://replicate.delivery.evil.com/x', 'file:///etc/passwd', 'nonsense']) {
    assert.ok(!isReplicateAudioUrl(bad), bad);
  }
});

(async () => {
  const { createReplicateProvider } = require('./musicProviders');
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
      calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
      if (String(url).includes('/predictions') && opts && opts.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'abc', status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/abc' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'abc', status: 'failed', error: 'NSFW or model error' }) };
    };
    await assert.rejects(() => createReplicateProvider().generate({ prompt: 'calm piano', durationS: 99, seed: 7 }), /model error/);
    const sent = calls[0].body.input;
    assert.strictEqual(sent.duration, 30, 'clip length is capped at what MusicGen handles');
    assert.strictEqual(sent.seed, 7);
    assert.strictEqual(sent.output_format, 'wav');
    assert.strictEqual(sent.prompt, 'calm piano');
    passed += 1; console.log('ok - replicate: sends capped duration/seed/wav and surfaces a failed prediction');

    global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ detail: 'Invalid input' }) });
    await assert.rejects(() => createReplicateProvider().generate({ prompt: 'x', durationS: 5, seed: 1 }), /Invalid input/);
    passed += 1; console.log('ok - replicate: API errors are surfaced');
  } finally {
    global.fetch = realFetch;
    if (saved === undefined) delete process.env.REPLICATE_API_TOKEN; else process.env.REPLICATE_API_TOKEN = saved;
  }
  console.log(`\n${passed} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
