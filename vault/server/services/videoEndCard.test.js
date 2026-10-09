'use strict';

const assert = require('assert');
const { normalizeEndCard, layoutEndCard } = require('./videoEndCard');

assert.ok(normalizeEndCard({}).error, 'empty card rejected');
assert.ok(normalizeEndCard({ headline: '   ' }).error, 'blank text rejected');

const spec = normalizeEndCard({
  headline: 'Book today', buttonText: 'Call now', url: 'example.com',
  durationSec: '99', fadeSec: '50', bgColor: 'nope', buttonColor: '#ffffff',
});
assert.strictEqual(spec.durationSec, 15, 'duration clamped');
assert.strictEqual(spec.fadeSec, 7.5, 'fade capped at half the card');
assert.strictEqual(spec.bgColor, '111111', 'bad colour falls back');
assert.strictEqual(spec.buttonTextColor, '000000', 'dark label on light button');

const blocks = layoutEndCard(spec, 1080, 1920);
assert.deepStrictEqual(blocks.map((b) => b.kind), ['headline', 'button', 'url']);
for (let i = 1; i < blocks.length; i += 1) {
  assert.ok(blocks[i].y > blocks[i - 1].y, 'blocks stack top to bottom');
}
const last = blocks[blocks.length - 1];
assert.ok(blocks[0].y >= 0 && last.y + last.height <= 1920, 'stays inside the frame');

const long = layoutEndCard(normalizeEndCard({ headline: 'word '.repeat(20) }), 720, 1280);
assert.ok(long[0].text.includes('\n'), 'long headline wraps');

console.log('videoEndCard tests passed');
