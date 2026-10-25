'use strict';

// node server/services/graphicsTextMetrics.test.js   (npm run test:graphics-text)
const assert = require('assert');
const { measureTextWidth, isBold } = require('./graphicsTextMetrics');

// Arial/Liberation Sans advance widths per 1000 units: H 722, e 556, l 222, o 556 -> "Hello" = 2278.
const hello = measureTextWidth('Hello', 100);
assert.ok(Math.abs(hello - 227.8) < 3, `Hello at 100px should be about 228, got ${hello}`);

// Width follows the letters, not the letter count.
assert.ok(measureTextWidth('WWWWW', 40) > measureTextWidth('iiiii', 40) * 2.5, 'wide letters measure wider than narrow ones');
// Bold is wider than regular for the same text; scales with size.
assert.ok(measureTextWidth('Sale today', 40, 'bold') > measureTextWidth('Sale today', 40, 'normal'));
assert.ok(Math.abs(measureTextWidth('Sale', 80) - 2 * measureTextWidth('Sale', 40)) < 0.5);
// Empty and missing text are zero, never NaN.
assert.strictEqual(measureTextWidth('', 40), 0);
assert.strictEqual(measureTextWidth(undefined, 40), 0);

assert.ok(isBold('bold') && isBold(700) && !isBold('normal') && !isBold(undefined));
console.log('graphicsTextMetrics: ok');
