'use strict';

// node server/services/presentations/design.test.js — pure composition checks, with owned image bytes stubbed.

const assert = require('node:assert/strict');
const { normalizeDeck } = require('./schema');
const { imageSize, pictureInfo, remixDeck, scoreSlide } = require('./design');
const { cropFor, plan } = require('./layouts');

const ASSET = '/api/presentations/assets/7/cc1e84a9-5497-453c-9ba6-2f9e12dca676.png';

function png(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

async function run() {
  assert.deepEqual(imageSize(png(1200, 800)), { width: 1200, height: 800 }, 'PNG headers give real dimensions');
  assert.equal(imageSize(Buffer.from('not an image')), null, 'unknown bytes are ignored');

  const info = await pictureInfo(ASSET, 7, { readFile: async () => png(1200, 800) });
  assert.equal(info.aspect, 1.5, 'owned pictures are measured without a network call');
  const unknown = await pictureInfo('https://example.org/public.png', 7, { readFile: async () => { throw new Error('no fetch'); } });
  assert.equal(unknown.aspect, 0, 'public URLs are left alone');

  const deck = normalizeDeck({
    title: 'Quarterly plan',
    slides: [
      { id: 's1', layout: 'title', title: 'Quarterly plan', body: 'Where we are going', imageRef: ASSET, notes: 'Opening' },
      { id: 's2', layout: 'picture', title: 'The numbers', bullets: ['42% | Growth', '3x | Speed'], imageRef: ASSET, notes: 'Metrics' },
      { id: 's3', layout: 'bullets', title: 'Roadmap', bullets: ['2026 Q1: Discover', '2026 Q2: Build'], imageRef: ASSET, notes: 'Dates' },
      { id: 's4', layout: 'bullets', title: 'Metrics', bullets: ['42% | Growth', '3x | Speed'], notes: 'Text only' },
      { id: 's5', layout: 'bullets', title: 'Milestones', bullets: ['2026 Q1: Discover', '2026 Q2: Build'], notes: 'Text only' },
    ],
  });
  const wordsBefore = deck.slides.map((s) => [s.title, s.body, s.bullets.join('|'), s.notes].join('~'));
  const result = await remixDeck(deck, { userId: 7, deps: { readFile: async () => png(1200, 800) } });

  assert.deepEqual(result.deck.slides.map((s) => [s.title, s.body, s.bullets.join('|'), s.notes].join('~')), wordsBefore, 'no words change');
  assert.equal(result.deck.slides[0].design.imageRole, 'background', 'a hero picture becomes a background');
  assert.equal(result.deck.slides[0].design.imageSide, 'full');
  assert.equal(result.deck.slides[0].design.imageFit, 'cover');
  assert.ok(result.deck.slides[0].design.scrim >= 0.4, 'background words get a readable scrim');
  assert.equal(result.deck.slides[0].design.imageAspect, 1.5);
  assert.equal(result.deck.slides[1].layout, 'picture', 'a picture with words stays a picture so nothing is dropped');
  assert.equal(result.deck.slides[1].design.imageSide, 'left');
  assert.equal(result.deck.slides[2].layout, 'picture', 'a picture with bullets stays a picture');
  assert.equal(result.deck.slides[2].design.imageSide, 'right', 'sides alternate instead of repeating');
  assert.equal(result.deck.slides[3].layout, 'stats', 'text-only metrics get the big-number layout');
  assert.equal(result.deck.slides[4].layout, 'timeline', 'text-only dated points get the timeline layout');
  assert.ok(result.score > result.previousScore, `composition score improves (${result.previousScore} → ${result.score})`);
  assert.ok(result.improvements.some((n) => n.includes('Slide 4')), 'layout changes are reported');
  assert.ok(scoreSlide(result.deck.slides[1]) > 80, 'remixed slides score well');

  const crop = cropFor(result.deck.slides[1].design, { x: 0, y: 0, w: 30, h: 80 }, 16 / 9);
  assert.ok(crop && crop.w > 0 && crop.h > 0, 'a focal crop is produced for cover images with known bytes');
  assert.ok(crop.w <= 1200 && crop.h <= 800, 'the crop stays inside the source');

  // plan() is the single geometry source: hints must become real picture boxes, crops and scrims there.
  const heroPlan = plan(result.deck.slides[0], { designId: 'paper', aspect: '16:9' });
  assert.equal(heroPlan.images[0].objectPosition, '50% 50%');
  assert.ok(heroPlan.images[0].crop, 'the hero picture carries a focal crop for PPTX');
  assert.ok(heroPlan.shapes.some((shape) => shape.overlay), 'the hero picture gets a scrim above it');
  const leftPlan = plan(result.deck.slides[1], { designId: 'paper', aspect: '16:9' });
  const rightPlan = plan(result.deck.slides[2], { designId: 'paper', aspect: '16:9' });
  const leftWords = leftPlan.boxes.find((box) => box.bullets?.length);
  const rightWords = rightPlan.boxes.find((box) => box.bullets?.length);
  assert.ok(leftWords && leftPlan.images[0].x < leftWords.x, 'left-side pictures sit before the words');
  assert.ok(rightWords && rightPlan.images[0].x > rightWords.x, 'right-side pictures sit after the words');

  const again = await remixDeck(result.deck, { userId: 7, deps: { readFile: async () => png(1200, 800) } });
  assert.deepEqual(again.deck, result.deck, 'the design pass is idempotent');
}

run().then(() => console.log('presentations design tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
