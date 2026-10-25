'use strict';

// Recipes with paid (AI) steps: pricing, the whole-job limit check, and running them with fake AI services (no network, no database).
//   node server/routes/graphics/graphicsPaidRecipes.test.js      (npm run test:graphics-paid-recipes)

const assert = require('assert');
const sharp = require('sharp');

const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../../db', { pool: { query: async () => ({ rows: [] }) } });

const paid = require('../../services/graphicsPaidSteps');
const { startPaidJob } = require('../../middleware/graphicsLimits');
const { runPipeline, PIPELINE_OPS } = require('./enhance');
const recipes = require('../../services/graphicsRecipes');

const dataUrl = (buf, type = 'png') => `data:image/${type};base64,${buf.toString('base64')}`;
const solid = (w, h, bg = { r: 200, g: 60, b: 60, alpha: 1 }) => sharp({ create: { width: w, height: h, channels: 4, background: bg } });

// the prices the single tools quote: background $0.02 each, upscale $0.03 per output megapixel (at least $0.03)
const prices = {
  backgroundUsd: 0.02,
  upscaleUsd: ({ width, height, scale }) => (width && height ? Math.max(0.03, ((width * scale) * (height * scale) / 1e6) * 0.03) : null),
};

(async () => {
  // ── which steps are paid, and how many pictures a call may carry ────────────────────────
  assert.deepStrictEqual(paid.PAID_OPS.slice().sort(), ['removebg', 'upscale']);
  assert.ok(PIPELINE_OPS.includes('removebg') && PIPELINE_OPS.includes('upscale'));
  assert.strictEqual(paid.maxPicturesPerCall([{ op: 'crop' }]), Infinity);
  assert.strictEqual(paid.maxPicturesPerCall([{ op: 'removebg' }]), 8);
  assert.strictEqual(paid.maxPicturesPerCall([{ op: 'removebg' }, { op: 'upscale' }]), 4); // the slowest step decides
  assert.strictEqual(paid.upscaleScaleOf({ scale: 4 }), 4);
  assert.strictEqual(paid.upscaleScaleOf({ scale: 3 }), 2);
  assert.strictEqual(paid.upscaleScaleOf({}), 2);

  // ── pricing ─────────────────────────────────────────────────────────────────────────────
  assert.strictEqual(paid.priceOneRun([{ op: 'crop' }, { op: 'sharpen' }], { width: 1000, height: 1000 }, prices).usd, 0); // free steps cost nothing
  assert.strictEqual(paid.priceOneRun([{ op: 'removebg' }], { width: 1000, height: 1000 }, prices).usd, 0.02);
  const up = paid.priceOneRun([{ op: 'upscale', scale: 2 }], { width: 1000, height: 1000 }, prices); // 4 MP out
  assert.strictEqual(up.usd, 0.12);
  assert.strictEqual(up.outputMp, 4);
  // two upscales compound: 1000px -> 2000 -> 4000 (16 MP): 0.12 + 0.48
  assert.strictEqual(paid.priceOneRun([{ op: 'upscale', scale: 2 }, { op: 'upscale', scale: 2 }], { width: 1000, height: 1000 }, prices).usd, 0.6);
  // size unknown: the price is marked unknown, never guessed as zero
  assert.strictEqual(paid.priceOneRun([{ op: 'upscale' }], { width: 0, height: 0 }, prices).usdKnown, false);
  // a job is the sum over its pictures
  const job = paid.priceJob([{ op: 'removebg' }], [{ width: 10, height: 10 }, { width: 10, height: 10 }, { width: 10, height: 10 }], prices);
  assert.strictEqual(job.usd, 0.06);
  assert.strictEqual(paid.parsePaidList('removebg,upscale:4,bogus').length, 2);
  assert.strictEqual(paid.parsePaidList('upscale:4')[0].scale, 4);
  assert.ok(paid.upscaleTooBig([{ op: 'upscale', scale: 4 }], { width: 6000, height: 6000 }), 'a 576 MP result is refused');
  assert.strictEqual(paid.upscaleTooBig([{ op: 'upscale', scale: 2 }], { width: 1000, height: 1000 }), null);

  // ── a recipe may carry the new steps ────────────────────────────────────────────────────
  const saved = recipes.sanitizeRecipe({ name: 'Product shot', steps: [{ op: 'removebg' }, { op: 'upscale', scale: '4' }, { op: 'crop', aspect: '1:1' }] }, { ops: PIPELINE_OPS, maxSteps: 12 });
  assert.deepStrictEqual(saved.steps[1], { op: 'upscale', scale: 4 });

  // ── the limit is checked for the whole job before it starts ─────────────────────────────
  const poolWith = (spent) => ({ query: async () => ({ rows: [{ spent }] }) });
  process.env.GRAPHICS_DAILY_COST_CAP_USD = '5';
  let r = await startPaidJob(poolWith('1.00'), 901, { totalUsd: 2 });
  assert.ok(r.release, 'under the limit: allowed'); r.release();
  r = await startPaidJob(poolWith('4.50'), 902, { totalUsd: 1 });
  assert.strictEqual(r.refuse.status, 429);
  assert.strictEqual(r.refuse.body.code, 'GRAPHICS_DAILY_CAP_JOB');
  assert.match(r.refuse.body.error, /would cost about \$1\.00, but only \$0\.50/);
  r = await startPaidJob(poolWith('5.00'), 903, { totalUsd: 0.1 });
  assert.strictEqual(r.refuse.body.code, 'GRAPHICS_DAILY_CAP');
  r = await startPaidJob(poolWith('4.99'), 904, { totalUsd: 0 }); // a single tool call: only blocked when the limit is already used up
  assert.ok(r.release); r.release();
  // two jobs at once is the most
  const a = await startPaidJob(poolWith('0'), 905, {});
  const b = await startPaidJob(poolWith('0'), 905, {});
  const c = await startPaidJob(poolWith('0'), 905, {});
  assert.ok(a.release && b.release && c.refuse);
  a.release(); b.release();
  assert.ok((await startPaidJob(poolWith('0'), 905, {})).release, 'a slot frees when a job ends');

  // ── running a recipe with fake AI services ──────────────────────────────────────────────
  const logs = [];
  const calls = [];
  const deps = {
    isLocal: false,
    removeBgLocal: async () => { throw new Error('should not run on the hosted site'); },
    removeBgWithReplicate: async (url) => {
      calls.push('removebg');
      const cut = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0 } } }).png().toBuffer(); // see-through result
      return { model: 'fake/rembg', imageDataUrl: dataUrl(cut) };
    },
    upscaleWithReplicate: async ({ imageDataUrl, scale }) => {
      calls.push(`upscale:${scale}`);
      const meta = await sharp(Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(',') + 1), 'base64')).metadata();
      const big = await solid(meta.width * scale, meta.height * scale).png().toBuffer();
      return { model: 'fake/upscaler', imageDataUrl: dataUrl(big) };
    },
    logImageUsage: (u) => logs.push(u),
  };
  const src = dataUrl(await solid(100, 100).png().toBuffer());

  const out = await runPipeline({ imageDataUrl: src, steps: [{ op: 'removebg' }, { op: 'upscale', scale: 2 }, { op: 'crop', aspect: '1:1' }], format: 'webp', userId: 42, deps });
  assert.deepStrictEqual(calls, ['removebg', 'upscale:2']); // in the order the recipe says
  assert.deepStrictEqual([out.width, out.height, out.format], [200, 200, 'webp']);
  assert.deepStrictEqual(logs.map((l) => [l.userId, l.feature]), [[42, 'graphics_background'], [42, 'graphics_upscale']]); // each AI step is logged to the person
  assert.ok(logs.every((l) => l.costUsd > 0));

  // on a local copy, background removal runs on this machine and is free (nothing logged); upscale says it needs the live site
  const localCalls = [];
  const local = { ...deps, isLocal: true, removeBgLocal: async (buf) => { localCalls.push('local'); return buf; } };
  logs.length = 0;
  await runPipeline({ imageDataUrl: src, steps: [{ op: 'removebg' }], userId: 42, deps: local });
  assert.deepStrictEqual([localCalls.length, logs.length], [1, 0]);
  await assert.rejects(runPipeline({ imageDataUrl: src, steps: [{ op: 'upscale' }], userId: 42, deps: local }), /hosted AI service/);

  // a result that would be too large is refused BEFORE any AI call
  calls.length = 0;
  const huge = dataUrl(await solid(5000, 5000).png().toBuffer());
  await assert.rejects(runPipeline({ imageDataUrl: huge, steps: [{ op: 'removebg' }, { op: 'upscale', scale: 4 }], userId: 42, deps }), /megapixels/);
  assert.deepStrictEqual(calls, [], 'nothing was spent');

  // a failing AI service gives a message, and later steps do not run
  const broken = { ...deps, removeBgWithReplicate: async () => { throw new Error('service down'); } };
  await assert.rejects(runPipeline({ imageDataUrl: src, steps: [{ op: 'removebg' }, { op: 'sharpen' }], userId: 42, deps: broken }), /service down/);

  console.log('graphicsPaidRecipes: ok');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
