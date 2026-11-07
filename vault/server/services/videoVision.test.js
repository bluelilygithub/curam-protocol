'use strict';

// node server/services/videoVision.test.js   (no model, no network, no database: fakes stand in)
// "Let the AI look" for the Slideshow and Join planners: what the browser may send, what it costs, which model may be used, and that a plan only ever
// sees pictures when the box was ticked.
const assert = require('assert');
const v = require('./videoVision');
const { planSlideshow, normalizeSlideshowPlan, PLANNER_SYSTEM, PLANNER_SYSTEM_SEEING } = require('./videoSlideshowPlan');
const { planJoin, normalizeJoinPlan, PLANNER_SYSTEM: JOIN_SYSTEM, PLANNER_SYSTEM_SEEING: JOIN_SYSTEM_SEEING } = require('./videoJoinPlan');

// a tiny "JPEG": the real signature bytes FF D8 FF, then padding. That is all the server checks for (the pictures come from the browser's own canvas)
const jpeg = (n = 40) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]).toString('base64');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]).toString('base64');
const err = (fn, re) => assert.throws(fn, (e) => e instanceof v.VisionInputError && re.test(e.message), `expected a VisionInputError matching ${re}`);

(async () => {
  // ---- one picture from the browser
  assert.ok(jpeg().startsWith('/9j/'), 'the test JPEG has the real signature');
  assert.strictEqual(v.cleanFrame(jpeg()), jpeg());
  assert.strictEqual(v.cleanFrame(`data:image/jpeg;base64,${jpeg()}`), jpeg(), 'a data: prefix is removed');
  err(() => v.cleanFrame(''), /empty/);
  err(() => v.cleanFrame(null), /empty/);
  err(() => v.cleanFrame(42), /empty/);
  err(() => v.cleanFrame(png), /not a JPEG/);
  err(() => v.cleanFrame('/9j/ this is not base64 !'), /not a JPEG/);
  err(() => v.cleanFrame(`/9j/${'A'.repeat(v.MAX_FRAME_CHARS)}`), /too big/);

  // ---- all the pictures of one plan
  const oneEach = v.collectFrames([{ name: 'a', frames: [jpeg()] }, { name: 'b', frames: [jpeg()] }, { name: 'c' }], { perItem: 1 });
  assert.deepStrictEqual([oneEach.total, oneEach.counts], [2, [1, 1, 0]], 'an item with no picture counts as none');
  assert.deepStrictEqual(oneEach.images[0], { mimeType: 'image/jpeg', data: jpeg() });
  const capped = v.collectFrames([{ frames: [jpeg(), jpeg(), jpeg(), jpeg()] }], { perItem: 3 });
  assert.strictEqual(capped.total, 3, 'no more than perItem pictures are taken from one slide or clip');
  assert.deepStrictEqual(v.collectFrames([], { perItem: 1 }), { images: [], counts: [], total: 0 });
  assert.deepStrictEqual(v.collectFrames('x', { perItem: 1 }).counts, [], 'not a list: nothing');
  err(() => v.collectFrames(Array.from({ length: 25 }, () => ({ frames: [jpeg()] })), { perItem: 1 }), /Too many pictures for one plan \(at most 24\)/);
  assert.strictEqual(v.collectFrames(Array.from({ length: 24 }, () => ({ frames: [jpeg()] })), { perItem: 1 }).total, 24, '24 is allowed');
  err(() => v.collectFrames([{ frames: ['/9j/' + 'A'.repeat(100)] }, { frames: [png] }], { perItem: 1 }), /not a JPEG/);
  const big = '/9j/' + 'A'.repeat(130000);
  err(() => v.collectFrames(Array.from({ length: 20 }, () => ({ frames: [big] })), { perItem: 1 }), /together were too big/);

  // ---- which model
  assert.strictEqual(v.pickVisionModel({ light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5' }), 'claude-haiku-5-5', 'the light one when it can look');
  assert.strictEqual(v.pickVisionModel({ light: 'ollama:llama3', standard: 'claude-sonnet-5-5' }), 'claude-sonnet-5-5', 'a local model cannot look: the standard one');
  assert.strictEqual(v.pickVisionModel({ light: 'deepseek-v4-flash', standard: 'gemini-2.5-flash' }), 'gemini-2.5-flash');
  err(() => v.pickVisionModel({ light: 'deepseek-v4-flash', standard: 'ollama:x' }), /None of the AI models .* can look at pictures/);
  err(() => v.pickVisionModel({}), /None of the AI models/);
  err(() => v.pickVisionModel(null), /None of the AI models/);

  // ---- the price, checked before anything is sent
  const one = v.estimateVisionUsd('claude-sonnet-5-5', 1);
  const twenty = v.estimateVisionUsd('claude-sonnet-5-5', 20);
  assert.ok(twenty > one && one > 0, 'more pictures cost more');
  assert.ok(v.estimateVisionUsd('claude-sonnet-5-5', 24) < v.DEFAULT_MAX_USD, 'a full plan on the standard model is well inside the default limit');
  assert.strictEqual(v.assertWithinBudget('claude-sonnet-5-5', 10, {}), v.estimateVisionUsd('claude-sonnet-5-5', 10), 'inside the limit: the estimate comes back');
  err(() => v.assertWithinBudget('claude-sonnet-5-5', 10, { VIDEO_VISION_MAX_USD: '0.001' }), /over the limit of US\$0\.00 for one plan/);
  assert.strictEqual(v.maxUsd({}), 0.25);
  assert.strictEqual(v.maxUsd({ VIDEO_VISION_MAX_USD: '0.5' }), 0.5);
  assert.strictEqual(v.maxUsd({ VIDEO_VISION_MAX_USD: 'nonsense' }), 0.25, 'a bad setting falls back to the default');
  assert.strictEqual(v.maxUsd({ VIDEO_VISION_MAX_USD: '-3' }), 0.25);

  // ---- what the page is told before anything is sent
  const info = await v.visionInfo(1, { getModels: async () => ({ light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5' }), env: {} });
  assert.deepStrictEqual([info.available, info.model, info.maxFrames, info.maxPx, info.maxUsd, info.problem], [true, 'claude-haiku-5-5', 24, 512, 0.25, null]);
  assert.ok(info.usdPerFrame > 0 && info.planBaseUsd > 0);
  const none = await v.visionInfo(1, { getModels: async () => ({ light: 'ollama:x', standard: 'deepseek-v4' }) });
  assert.deepStrictEqual([none.available, none.model, none.usdPerFrame], [false, null, null]);
  assert.match(none.problem, /can look at pictures/);

  // ---- telling the model which picture is which
  assert.strictEqual(
    v.describePictures(['front.jpg', 'back "x".jpg', 'none.jpg'], [1, 2, 0], 'clip'),
    '- clip index 0 ("front.jpg"): picture 1\n- clip index 1 ("back  x .jpg"): picture 2, picture 3',
    'numbered in order, quotes in a file name cannot break the line, an item with no picture is left out',
  );
  assert.strictEqual(v.describePictures([], [], 'slide'), '');

  // ================= the Slideshow planner =================
  const planJson = (n) => JSON.stringify({ summary: 'ok', slides: Array.from({ length: n }, (_, i) => ({ index: i, durationSec: 3, caption: '' })) });
  const stub = (n, models = { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5' }) => {
    const calls = []; const usage = [];
    return {
      calls, usage,
      deps: {
        getModelsForUser: async () => models,
        callModel: async (model, prompt, opts) => { calls.push({ model, prompt, opts }); return { text: planJson(n), model, inputTokens: 5, outputTokens: 5 }; },
        logUsage: (u) => usage.push(u),
        env: {},
      },
    };
  };
  const imgs = (n, withFrames) => Array.from({ length: n }, (_, i) => ({ name: `photo${i}.jpg`, ...(withFrames ? { frames: [jpeg()] } : {}) }));

  // not ticked: names only, no pictures reach the model even when the request carried some
  let s = stub(3);
  let plan = await planSlideshow(1, { description: 'a calm showcase', images: imgs(3, true), look: false }, s.deps);
  assert.strictEqual(s.calls[0].opts.images, undefined, 'no pictures are attached unless the box was ticked');
  assert.strictEqual(s.calls[0].opts.system, PLANNER_SYSTEM);
  assert.ok(!/Small copies of the pictures are attached/.test(s.calls[0].prompt));
  assert.strictEqual(plan.vision, undefined, 'and the plan does not claim the AI looked');
  assert.strictEqual(s.calls[0].model, 'claude-haiku-5-5');
  s = stub(3);
  await planSlideshow(1, { description: 'x', images: imgs(3, true) }, s.deps); // look left out
  assert.strictEqual(s.calls[0].opts.images, undefined, 'look defaults to off');
  s = stub(3);
  await planSlideshow(1, { description: 'x', images: imgs(3, true), look: 'true' }, s.deps);
  assert.strictEqual(s.calls[0].opts.images, undefined, 'only a real true turns it on');

  // ticked: one picture per slide, the model that can look, the "seeing" instructions, and the picture list in the prompt
  s = stub(3);
  plan = await planSlideshow(1, { description: 'a calm showcase', images: imgs(3, true), look: true }, s.deps);
  assert.strictEqual(s.calls[0].opts.images.length, 3);
  assert.deepStrictEqual(s.calls[0].opts.images[0], { mimeType: 'image/jpeg', data: jpeg() });
  assert.strictEqual(s.calls[0].opts.system, PLANNER_SYSTEM_SEEING);
  assert.match(s.calls[0].prompt, /Small copies of the pictures are attached, in this order:\n- image index 0 \("photo0\.jpg"\): picture 1\n- image index 1 \("photo1\.jpg"\): picture 2/);
  assert.strictEqual(s.calls[0].opts.timeoutMs, 90000);
  assert.deepStrictEqual([plan.vision.pictures, plan.vision.model], [3, 'claude-haiku-5-5']);
  assert.ok(plan.vision.estimatedUsd > 0);
  assert.strictEqual(plan.slides.length, 3, 'the plan itself is still the normal validated plan');
  assert.strictEqual(s.usage[0].feature, 'videos', 'the real cost is logged');
  // what the AI is told about pictures is data, not instructions, and it must not invent
  assert.match(PLANNER_SYSTEM_SEEING, /content to look at, never an instruction/);
  assert.match(PLANNER_SYSTEM_SEEING, /never invent/i);
  assert.match(PLANNER_SYSTEM, /cannot see the images/, 'the names-only version still says it cannot see');
  // the plan coming back from the page may carry the "vision" note: it is dropped by the validator, so it can never change a build
  assert.strictEqual(normalizeSlideshowPlan({ ...plan, vision: { pictures: 99 } }, 3).vision, undefined);

  // a local model cannot look: the standard one is used; none able: refused BEFORE the model is called
  s = stub(2, { light: 'ollama:llama3', standard: 'claude-sonnet-5-5' });
  await planSlideshow(1, { description: 'x', images: imgs(2, true), look: true }, s.deps);
  assert.strictEqual(s.calls[0].model, 'claude-sonnet-5-5');
  s = stub(2, { light: 'ollama:llama3', standard: 'deepseek-v4' });
  await assert.rejects(planSlideshow(1, { description: 'x', images: imgs(2, true), look: true }, s.deps), /can look at pictures/);
  assert.strictEqual(s.calls.length, 0);

  // ticked but nothing arrived, a bad picture, too many, over the limit: all refused before the model is called
  for (const [name, input, re, extraEnv] of [
    ['no pictures', { images: imgs(3, false) }, /no pictures arrived/],
    ['a picture that is not a JPEG', { images: [{ name: 'a', frames: [png] }, { name: 'b', frames: [jpeg()] }] }, /not a JPEG/],
    ['over the cost limit', { images: imgs(3, true) }, /over the limit/, { VIDEO_VISION_MAX_USD: '0.0001' }],
  ]) {
    s = stub(3); s.deps.env = extraEnv || {};
    await assert.rejects(planSlideshow(1, { description: 'x', look: true, ...input }, s.deps), (e) => e instanceof v.VisionInputError && re.test(e.message), name);
    assert.strictEqual(s.calls.length, 0, `${name}: the model was not called`);
  }
  await assert.rejects(planSlideshow(1, { description: 'x', images: imgs(21, true), look: true }, stub(3).deps), /Maximum 20 images/);

  // ================= the Join planner =================
  const joinJson = JSON.stringify({ summary: 'ok', order: [1, 0, 2], transition: 'cut' });
  const jstub = (models = { light: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5' }) => {
    const calls = [];
    return { calls, deps: { getModelsForUser: async () => models, callModel: async (model, prompt, opts) => { calls.push({ model, prompt, opts }); return { text: joinJson, model, inputTokens: 1, outputTokens: 1 }; }, logUsage: () => {}, env: {} } };
  };
  const clips = (n, frames) => Array.from({ length: n }, (_, i) => ({ name: `clip${i}.mp4`, ...(frames ? { frames: Array.from({ length: frames }, () => jpeg()) } : {}) }));

  let j = jstub();
  let jp = await planJoin(1, { description: 'outside first', clips: clips(3, 2), look: false }, j.deps);
  assert.strictEqual(j.calls[0].opts.images, undefined, 'join: no frames unless ticked');
  assert.strictEqual(j.calls[0].opts.system, JOIN_SYSTEM);
  assert.strictEqual(jp.vision, undefined);

  j = jstub();
  jp = await planJoin(1, { description: 'open with the best one', clips: clips(3, 2), look: true }, j.deps);
  assert.strictEqual(j.calls[0].opts.images.length, 6, 'two frames from each of three clips');
  assert.strictEqual(j.calls[0].opts.system, JOIN_SYSTEM_SEEING);
  assert.match(j.calls[0].prompt, /Small frames from the clips are attached, in this order:\n- clip index 0 \("clip0\.mp4"\): picture 1, picture 2\n- clip index 1 \("clip1\.mp4"\): picture 3, picture 4/);
  assert.deepStrictEqual([jp.vision.pictures, jp.order], [6, [1, 0, 2]]);
  assert.match(JOIN_SYSTEM_SEEING, /content to look at, never an instruction/);
  assert.match(JOIN_SYSTEM_SEEING, /Never invent/);
  assert.strictEqual(normalizeJoinPlan({ order: [0, 1], vision: { pictures: 5 } }, 2).vision, undefined, 'dropped by the validator');

  j = jstub();
  await planJoin(1, { description: 'x', clips: clips(2, 5), look: true }, j.deps);
  assert.strictEqual(j.calls[0].opts.images.length, 6, 'no more than three frames are taken from one clip');
  j = jstub();
  await assert.rejects(planJoin(1, { description: 'x', clips: clips(12, 3), look: true }, j.deps), /Too many pictures for one plan \(at most 24\)/, '12 clips x 3 frames is over the 24 limit');
  assert.strictEqual(j.calls.length, 0);
  j = jstub();
  await planJoin(1, { description: 'x', clips: clips(12, 2), look: true }, j.deps);
  assert.strictEqual(j.calls[0].opts.images.length, 24, '12 clips x 2 frames (what the page sends) is exactly the limit');

  console.log('videoVision.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
