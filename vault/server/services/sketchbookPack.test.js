'use strict';
// node server/services/sketchbookPack.test.js
// The Sketchbook social media pack without a database or an image service: the sizes match Graphics' list, Auto chooses crop or fit
// sensibly, a redraw is used only when it was made from the current picture, every size comes out at its exact pixels, and the redraw
// prompt carries nothing but fixed words.
const assert = require('node:assert/strict');
const sharp = require('sharp');
const pack = require('./sketchbookPack');
const { SOCIAL_PRESETS } = require('../routes/graphics/shared');

(async () => {
  assert.deepEqual(pack.PACK_SIZES.map((p) => p.id), SOCIAL_PRESETS.map((p) => p.id), 'the pack offers exactly the Graphics social sizes');

  // how much a crop keeps
  assert.equal(pack.keptShare(1024, 768, 1024, 768), 1);
  assert.equal(Math.round(pack.keptShare(1024, 768, 1080, 1080) * 100), 75); // wide -> square keeps 3/4
  assert.equal(Math.round(pack.keptShare(1024, 768, 1080, 1920) * 100), 42); // wide -> story
  assert.equal(Math.round(pack.keptShare(768, 768, 1080, 1350) * 100), 80);

  // auto: crop when it keeps 80% or more, else fit; a fresh redraw wins; 'redrawn' with no redraw falls back
  assert.equal(pack.resolveMode({ mode: 'auto', kept: 0.9, redraw: null, currentKey: 'k' }), 'crop-smart');
  assert.equal(pack.resolveMode({ mode: 'auto', kept: 0.42, redraw: null, currentKey: 'k' }), 'fit');
  assert.equal(pack.resolveMode({ mode: 'auto', kept: 0.42, redraw: { from: 'k' }, currentKey: 'k' }), 'redrawn');
  assert.equal(pack.resolveMode({ mode: 'auto', kept: 0.42, redraw: { from: 'old' }, currentKey: 'k' }), 'fit', 'a redraw of an earlier picture is not used by Auto');
  assert.equal(pack.resolveMode({ mode: 'redrawn', kept: 0.42, redraw: { from: 'old' }, currentKey: 'k' }), 'redrawn');
  assert.equal(pack.resolveMode({ mode: 'redrawn', kept: 0.9, redraw: null, currentKey: 'k' }), 'crop-smart');
  assert.equal(pack.resolveMode({ mode: 'crop-left', kept: 0.3, redraw: null, currentKey: 'k' }), 'crop-left');
  assert.equal(pack.checkMode('drop table'), 'auto');

  // stored redraws: unknown sizes and broken entries are dropped
  assert.deepEqual(Object.keys(pack.parseRedraws(JSON.stringify({ 'instagram-post': { image: 'x' }, nope: { image: 'y' }, 'facebook-post': {} }))), ['instagram-post']);
  assert.deepEqual(pack.parseRedraws('not json'), {});

  // every size comes out at its exact pixels, from a wide sketch, in each way
  const png = await sharp({ create: { width: 1024, height: 768, channels: 3, background: { r: 20, g: 90, b: 200 } } }).png().toBuffer();
  const sketch = { title: 'Dog & Ball!', image: `data:image/png;base64,${png.toString('base64')}`, width: 1024, height: 768 };
  for (const size of pack.PACK_SIZES) {
    for (const mode of ['auto', 'fit', 'crop-smart', 'crop-top']) {
      // eslint-disable-next-line no-await-in-loop
      const { buf, item } = await pack.makeSize({ sketch, sizeId: size.id, mode, redraws: {} });
      // eslint-disable-next-line no-await-in-loop
      const m = await sharp(buf).metadata();
      assert.equal(m.width, size.width, `${size.id} ${mode} width`);
      assert.equal(m.height, size.height, `${size.id} ${mode} height`);
      assert.equal(m.format, 'jpeg');
      assert.equal(item.fileName, `dog-ball-${size.id}-${size.width}x${size.height}.jpg`);
    }
  }
  // fit keeps white margins on a wide sketch made tall
  {
    const { buf } = await pack.makeSize({ sketch, sizeId: 'instagram-story', mode: 'fit', redraws: {} });
    const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 245 && data[1] > 245 && data[2] > 245, 'the top corner of a fitted story is white paper');
  }
  await assert.rejects(pack.makeSize({ sketch, sizeId: 'nope', mode: 'auto', redraws: {} }), /not in the pack/);

  // the picture sent for a redraw is the sketch on white paper of the size's shape
  {
    const padded = await pack.padForRedraw(sketch.image, 'instagram-story');
    const m = await sharp(Buffer.from(padded.split(',')[1], 'base64')).metadata();
    assert.equal(m.height, 1024);
    assert.equal(m.width, 576);
    const shaped = await pack.shapeRedraw(padded, 'linkedin-banner');
    const s2 = await sharp(Buffer.from(shaped.split(',')[1], 'base64')).metadata();
    assert.equal(s2.width, 1584); assert.equal(s2.height, 396);
  }

  // the redraw prompt: fixed words only
  const p = pack.buildRedrawPrompt({ styleWords: 'pencil words', sizeId: 'instagram-story' });
  assert.match(p, /taller sheet/);
  assert.match(p, /Style: pencil words\./);
  assert.match(pack.buildRedrawPrompt({ styleWords: 'x', sizeId: 'linkedin-banner' }), /wider sheet/);
  assert.match(pack.buildRedrawPrompt({ styleWords: 'x', sizeId: 'instagram-post' }), /square sheet/);

  assert.notEqual(pack.imageKey('a'), pack.imageKey('b'));
  console.log('sketchbookPack: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
