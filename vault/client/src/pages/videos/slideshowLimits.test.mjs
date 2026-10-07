// node client/src/pages/videos/slideshowLimits.test.mjs
import assert from 'node:assert';
import { detectLimits, orderedLimits, SLIDESHOW_LIMITS } from './slideshowLimits.mjs';

const REQUEST = 'I will provide three images of an empty wine fridge cabinet. Two are external, so I want to see views of them like a walk around. The third is shown from the inside and focuses on the racks. I want to see it with some wine bottles and feature a person removing a bottle. I want to illustrate it with external lights on and off. I want some smooth chilled music to accompany it.';

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`); }

test('the real wine-cabinet request trips every limit', () => {
  assert.deepStrictEqual(detectLimits(REQUEST).sort(), SLIDESHOW_LIMITS.map((l) => l.id).sort());
});

test('empty or blank description trips nothing', () => {
  assert.deepStrictEqual(detectLimits(''), []);
  assert.deepStrictEqual(detectLimits('   '), []);
  assert.deepStrictEqual(detectLimits(null), []);
});

test('a description the tool CAN do trips nothing', () => {
  assert.deepStrictEqual(detectLimits('A calm, elegant showcase. Slow zoom, warm tones, soft crossfades, hotel name on the first slide.'), []);
});

test('individual limits are detected on their own', () => {
  assert.deepStrictEqual(detectLimits('add some relaxing jazz'), ['music']);
  assert.deepStrictEqual(detectLimits('a slow walk around the product'), ['views']);
});

test('orderedLimits lists triggered limits first and keeps all of them', () => {
  const out = orderedLimits('some jazz music please');
  assert.strictEqual(out.length, SLIDESHOW_LIMITS.length);
  assert.strictEqual(out[0].id, 'music');
  assert.ok(out[0].triggered && out.slice(1).every((l) => !l.triggered));
});

console.log(`\n${passed} passed`);
