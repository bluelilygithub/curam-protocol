'use strict';

// node server/services/videoGenerateModels.test.js — pure request-building; no network, DB or ffmpeg.
// Checks the exact Replicate input names each selectable model is sent. They come from each model's
// Replicate API schema; if Replicate changes a schema, this is the file (and buildReplicateInput) to update.

const assert = require('assert');

// videoGenerateService imports db.js (via the model resolver); nothing here touches the database.
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [] }) } } };

const {
  buildReplicateInput, assertModelOptions, resolveModelKey, parseSeed, parseSeedFromLogs, seedanceDuration, VIDEO_MODELS,
} = require('./videoGenerateService');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const expanded = { video_prompt: 'a bottle on a shelf' };
const IMG = 'data:image/jpeg;base64,AAAA';
const END = 'data:image/jpeg;base64,BBBB';

test('Hailuo: first_frame_image only, never seed / last frame / camera_fixed; prompt_optimizer toggles', () => {
  const t2v = buildReplicateInput({ modelKey: 'hailuo', expanded, imageToVideo: false, durationSec: 5, aspect: '16:9' });
  assert.deepStrictEqual(t2v, { prompt: 'a bottle on a shelf', prompt_optimizer: true, duration: 6, resolution: '768p' });
  const i2v = buildReplicateInput({
    modelKey: 'hailuo', expanded, imageToVideo: true, seedImageDataUrl: IMG, endImageDataUrl: END,
    durationSec: 10, seed: 42, cameraFixed: true, promptOptimizer: false,
  });
  assert.strictEqual(i2v.first_frame_image, IMG);
  assert.strictEqual(i2v.prompt_optimizer, false);
  assert.strictEqual(i2v.duration, 10);
  for (const k of ['image', 'last_frame_image', 'seed', 'camera_fixed', 'aspect_ratio']) assert.ok(!(k in i2v), `${k} must not be sent to Hailuo`);
});

test('Seedance text-to-video: aspect_ratio sent, no image keys, no seed unless given', () => {
  const input = buildReplicateInput({ modelKey: 'seedance', expanded, imageToVideo: false, durationSec: 5, aspect: '9:16' });
  assert.deepStrictEqual(input, { prompt: 'a bottle on a shelf', duration: 5, aspect_ratio: '9:16' });
  assert.ok(!('seed' in input) && !('camera_fixed' in input) && !('prompt_optimizer' in input));
});

test('Seedance image-to-video: image + last_frame_image, aspect_ratio omitted (the image decides)', () => {
  const input = buildReplicateInput({
    modelKey: 'seedance', expanded, imageToVideo: true, seedImageDataUrl: IMG, endImageDataUrl: END,
    durationSec: 7, aspect: '16:9', seed: '1234', cameraFixed: true,
  });
  assert.strictEqual(input.image, IMG);
  assert.strictEqual(input.last_frame_image, END);
  assert.strictEqual(input.seed, 1234);
  assert.strictEqual(input.camera_fixed, true);
  assert.strictEqual(input.duration, 7);
  assert.ok(!('aspect_ratio' in input), 'aspect_ratio is ignored with an image, so it is not sent');
  assert.ok(!('first_frame_image' in input));
});

test('Seedance: last frame is never sent without a start image', () => {
  const input = buildReplicateInput({ modelKey: 'seedance', expanded, imageToVideo: false, endImageDataUrl: END, durationSec: 5, aspect: '16:9' });
  assert.ok(!('last_frame_image' in input) && !('image' in input));
});

test('Seedance duration is any whole number 2-12; seed must be a whole number or is left to the provider', () => {
  assert.strictEqual(seedanceDuration(1), 2);
  assert.strictEqual(seedanceDuration(5), 5);
  assert.strictEqual(seedanceDuration(5.6), 6);
  assert.strictEqual(seedanceDuration(99), 12);
  assert.strictEqual(seedanceDuration('abc'), 5);
  assert.strictEqual(parseSeed(''), null);
  assert.strictEqual(parseSeed(null), null);
  assert.strictEqual(parseSeed('abc'), null);
  assert.strictEqual(parseSeed(-3), null);
  assert.strictEqual(parseSeed(1.5), null);
  assert.strictEqual(parseSeed('0'), 0);
  assert.strictEqual(parseSeed(2147483647), 2147483647);
  assert.strictEqual(parseSeed(2147483648), null);
});

test('model key: unknown values fall back to Hailuo; both models are listed with their capabilities', () => {
  assert.strictEqual(resolveModelKey('seedance'), 'seedance');
  assert.strictEqual(resolveModelKey('SEEDANCE'), 'seedance');
  assert.strictEqual(resolveModelKey('evil; drop'), 'hailuo');
  assert.strictEqual(resolveModelKey(undefined), 'hailuo');
  assert.deepStrictEqual(VIDEO_MODELS.hailuo.capabilities, { promptOptimizer: true, endFrame: false, seed: false, cameraFixed: false });
  assert.deepStrictEqual(VIDEO_MODELS.seedance.capabilities, { promptOptimizer: false, endFrame: true, seed: true, cameraFixed: true });
});

test('validation: controls a model lacks are errors, not silently dropped', () => {
  assert.throws(() => assertModelOptions('replicate', { model: 'hailuo', endImage: END, seedImage: IMG }), /no end-frame option/);
  assert.throws(() => assertModelOptions('replicate', { model: 'hailuo', seed: 5 }), /no seed option/);
  assert.throws(() => assertModelOptions('replicate', { model: 'hailuo', cameraFixed: true }), /no camera-fixed option/);
  assert.throws(() => assertModelOptions('replicate', { model: 'seedance', endImage: END }), /needs a starting image/);
  assert.throws(() => assertModelOptions('replicate', { model: 'seedance', endImage: END, seedImage: IMG, seedImageMode: 'suggest' }), /animate it/);
  assert.throws(() => assertModelOptions('fal', { model: 'seedance' }), /Replicate only/);
  assert.strictEqual(assertModelOptions('replicate', { model: 'seedance', endImage: END, seedImage: IMG, seed: 9, cameraFixed: true }), 'seedance');
  assert.strictEqual(assertModelOptions('fal', {}), 'hailuo');
  assert.strictEqual(assertModelOptions('replicate', { model: 'hailuo', seed: '' }), 'hailuo');
});

test('seed used: read from the logs when the provider prints it', () => {
  assert.strictEqual(parseSeedFromLogs('Using seed: 123456789\nrendering'), 123456789);
  assert.strictEqual(parseSeedFromLogs('random_seed=42'), 42);
  assert.strictEqual(parseSeedFromLogs(['step 1', 'seed 77']), 77);
  assert.strictEqual(parseSeedFromLogs('no such thing'), null);
  assert.strictEqual(parseSeedFromLogs(null), null);
});

console.log(`\n${passed} passed`);
