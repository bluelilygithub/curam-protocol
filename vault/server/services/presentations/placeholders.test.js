'use strict';

// node server/services/presentations/placeholders.test.js
// Placeholder pictures use stubbed image/save functions here: no network and no files are written.

const assert = require('assert');
const { makePlaceholder, addDeckPlaceholders, dataUrlToImage, WIDTH, HEIGHT } = require('./placeholders');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

const imageDeps = (saved, calls) => ({
  generateImage: async (userId, opts) => {
    calls.push({ userId, ...opts });
    return { ok: true, imageDataUrl: DATA_URL };
  },
  saveAsset: async (userId, buffer, mime) => {
    saved.push({ userId, buffer, mime });
    return `/api/presentations/assets/${userId}/${saved.length}.png`;
  },
});

const deck = {
  title: 'Quarterly update',
  slides: [
    { id: 's1', layout: 'title', title: 'Quarterly update', bullets: [], body: '', notes: '' },
    { id: 's2', layout: 'bullets', title: 'Progress', bullets: ['On track'], body: '', notes: '' },
    { id: 's3', layout: 'picture', title: 'Chart', bullets: [], body: '', notes: '', imagePrompt: 'team working' },
  ],
};

(async () => {
  const parsed = dataUrlToImage(DATA_URL);
  assert.ok(parsed && parsed.mime === 'image/png' && parsed.buffer.equals(PNG), 'a data URL becomes an owned image buffer');
  assert.strictEqual(dataUrlToImage('https://example.com/a.png'), null, 'remote URLs are not treated as generated images');

  const saved = [];
  const calls = [];
  const one = await makePlaceholder({ userId: 7, deck, slide: deck.slides[2], index: 2, deps: imageDeps(saved, calls) });
  assert.match(one.imageRef, /^\/api\/presentations\/assets\/7\/\d+\.png$/, 'one placeholder is an owned asset path');
  assert.strictEqual(one.warning, '');
  assert.strictEqual(calls[0].userId, 7);
  assert.strictEqual(calls[0].feature, 'presentations_placeholder');
  assert.strictEqual(calls[0].width, WIDTH);
  assert.strictEqual(calls[0].height, HEIGHT);
  assert.match(calls[0].prompt, /team working/, 'the slide picture idea shapes the prompt');

  const deckSaved = [];
  const result = await addDeckPlaceholders({
    userId: 9,
    deck,
    limit: 2,
    deps: imageDeps(deckSaved, []),
  });
  const withImages = result.deck.slides.filter((s) => s.imageRef || (s.images || []).length);
  assert.strictEqual(withImages.length, 2, 'two slides get placeholders');
  assert.ok(result.deck.slides[2].imageRef, 'the picture slide uses its main image slot');
  assert.ok(result.deck.slides[1].images?.length, 'other slides get an extra image');
  assert.strictEqual(result.warning, '');
  assert.strictEqual(deckSaved.length, 2);

  const failed = await addDeckPlaceholders({
    userId: 9,
    deck,
    limit: 1,
    deps: {
      generateImage: async () => ({ ok: false, error: 'configure a FAL graphics model in Settings' }),
      saveAsset: async () => { throw new Error('should not be called'); },
    },
  });
  assert.match(failed.warning, /Placeholder pictures were skipped/, 'an unavailable provider is a warning');
  assert.strictEqual(failed.deck.slides.filter((s) => s.imageRef || (s.images || []).length).length, 0, 'no broken refs are left');

  console.log('presentations placeholders tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
