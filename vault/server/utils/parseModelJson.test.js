'use strict';

// node server/utils/parseModelJson.test.js

const assert = require('assert');
const { parseModelJson } = require('./parseModelJson');

const obj = { overview: 'Tech led.', stocks: [{ symbol: 'NVDA' }], adviceQuality: 'ok' };
assert.deepStrictEqual(parseModelJson(JSON.stringify(obj)), obj, 'plain JSON');
assert.deepStrictEqual(parseModelJson('```json\n' + JSON.stringify(obj) + '\n```'), obj, 'fenced');
// The bug behind empty Shares monthly reviews: a line of prose before an object used to return the inner "stocks" array.
assert.deepStrictEqual(parseModelJson('Here is the review:\n' + JSON.stringify(obj)), obj, 'prose before an object keeps the object');
assert.deepStrictEqual(parseModelJson(JSON.stringify(obj) + '\nHope this helps.'), obj, 'prose after an object');
// Arrays still work when the reply is an array.
assert.deepStrictEqual(parseModelJson('Results:\n[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }], 'prose before an array');
assert.deepStrictEqual(parseModelJson('[1,2] then {broken'), [1, 2], 'falls back to the array when the object will not parse');
assert.deepStrictEqual(parseModelJson('note {not json} and [3]'), [3], 'falls back to the array when the object slice is not JSON');
assert.strictEqual(parseModelJson('no json here'), null);
assert.strictEqual(parseModelJson(''), null);
assert.strictEqual(parseModelJson(null), null);

console.log('parseModelJson.test.js: all passed');
