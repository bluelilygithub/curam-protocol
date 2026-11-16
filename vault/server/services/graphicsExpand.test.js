// node server/services/graphicsExpand.test.js
// AI fill (Canvas Extend): geometry, refusals, what is sent to the model, and that the original picture comes back
// untouched in the middle. The model is a stub that paints everything red; no network, no cost.
'use strict';

const assert = require('assert');
const sharp = require('sharp');
const { planExpand, checkExpand, expandImage, DEFAULT_PROMPT, OVERLAP } = require('./graphicsExpand');

const px = async (buf, x, y) => {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const fromDataUrl = (u) => Buffer.from(String(u).split(',')[1], 'base64');

(async () => {
  // Geometry: the working canvas fits WORK_MAX, the picture sits where the padding says, nothing is lost to rounding.
  const g = planExpand({ width: 2000, height: 1000, left: 500, right: 500, top: 0, bottom: 1000 });
  assert.strictEqual(g.W, 3000);
  assert.strictEqual(g.H, 2000);
  assert.strictEqual(g.ww, 1024);
  assert.strictEqual(g.wl + g.ow + g.wr, g.ww);
  assert.strictEqual(g.wt + g.oh + g.wb, g.wh);
  assert.strictEqual(g.wt, 0);
  assert.strictEqual(g.keep.y0, 0, 'no overlap on a side that does not grow');
  assert.strictEqual(g.keep.x0, g.wl + OVERLAP);
  assert.strictEqual(g.keep.y1, g.oh - OVERLAP);
  const small = planExpand({ width: 300, height: 200, left: 100 });
  assert.strictEqual(small.s, 1, 'small pictures are not enlarged');
  assert.strictEqual(small.band, OVERLAP);

  // Refusals, before anything is spent.
  assert.throws(() => checkExpand({ width: 100, height: 100, top: 0, right: 0, bottom: 0, left: 0 }), /at least one side/);
  assert.throws(() => checkExpand({ width: 100, height: 100, top: 0, right: 150, bottom: 0, left: 60 }), /twice/);
  assert.throws(() => checkExpand({ width: 6000, height: 6000, top: 0, right: 2000, bottom: 2000, left: 0 }), /megapixels/);
  assert.doesNotThrow(() => checkExpand({ width: 100, height: 100, top: 0, right: 200, bottom: 0, left: 0 }));

  // The whole flow with a stub model.
  const blue = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#0000ff' } }).png().toBuffer();
  let sent = null;
  const stub = async (args) => {
    sent = args;
    const m = await sharp(fromDataUrl(args.imageDataUrl)).metadata();
    // Answer at a different size, as the hosted model may.
    const red = await sharp({ create: { width: m.width + 7, height: m.height + 3, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
    return { imageDataUrl: `data:image/jpeg;base64,${red.toString('base64')}`, seed: 42, image: { endpoint: 'stub' } };
  };
  const r = await expandImage(blue, { left: 100, right: 100 }, { prompt: '', inpaint: stub, seed: 1 });
  assert.strictEqual(r.width, 400);
  assert.strictEqual(r.height, 100);
  assert.strictEqual(r.seed, 42);
  const outMeta = await sharp(r.buffer).metadata();
  assert.strictEqual(outMeta.format, 'jpeg');
  assert.deepStrictEqual([outMeta.width, outMeta.height], [400, 100]);
  const mid = await px(r.buffer, 200, 50);
  assert.ok(mid[2] > 230 && mid[0] < 30, `middle stays the original blue, got ${mid}`);
  const edge = await px(r.buffer, 5, 50);
  assert.ok(edge[0] > 230 && edge[2] < 30, `new space is the model's, got ${edge}`);
  const insideEdge = await px(r.buffer, 100 + OVERLAP * 2, 50);
  assert.ok(insideEdge[2] > 200, `just inside the picture is still the picture, got ${insideEdge}`);

  // What the model was sent: empty prompt becomes the default, the mask is white outside and black in the middle.
  assert.strictEqual(sent.prompt, DEFAULT_PROMPT);
  assert.ok(sent.strength > 0.9);
  const mask = fromDataUrl(sent.maskDataUrl);
  const mm = await sharp(mask).metadata();
  assert.deepStrictEqual([mm.width, mm.height], [400, 100]);
  assert.ok((await px(mask, 3, 50))[0] > 200, 'mask is white in the new space');
  assert.ok((await px(mask, 200, 50))[0] < 30, 'mask is black over the picture');
  assert.ok((await px(mask, 200, 1))[0] < 60, 'top does not grow, so the picture is kept right up to the top edge');
  const guide = fromDataUrl(sent.imageDataUrl);
  const g0 = await px(guide, 3, 50);
  assert.ok(g0[2] > 150, 'new space is pre-filled from the picture (blurred mirror), not grey');

  // A see-through picture is flattened onto white.
  const clear = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const r2 = await expandImage(clear, { top: 20 }, { prompt: 'sky', inpaint: stub });
  assert.ok((await px(r2.buffer, 25, 40))[0] > 230, 'flattened to white');
  assert.strictEqual(sent.prompt, 'sky');

  // A model that returns nothing is an error, not a broken picture.
  await assert.rejects(expandImage(blue, { left: 10 }, { inpaint: async () => ({}) }), /no picture/);

  console.log('graphicsExpand: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
