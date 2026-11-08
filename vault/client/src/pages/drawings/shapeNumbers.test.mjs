// node client/src/pages/drawings/shapeNumbers.test.mjs
import assert from 'node:assert';
import { assignNumbers, isNumber } from './shapeNumbers.mjs';

const N = (id, num) => ({ id, ...(num ? { num } : {}) });
const E = (from, to) => ({ from, to });

assert.ok(isNumber('7') && isNumber('4.1') && isNumber('4.1.2'));
assert.ok(!isNumber('x') && !isNumber('4.') && !isNumber('') && !isNumber(7) && !isNumber('1.2.3.4.5.6'));

// a fresh drawing: 1, 2, 3 in reading order
let g = assignNumbers([N('a'), N('b'), N('c')], [E('a', 'b'), E('b', 'c')]);
assert.deepStrictEqual([...g], [['a', '1'], ['b', '2'], ['c', '3']]);

// a step inserted between 4 and 5 is 4.1; a second one after 4 is 4.2
g = assignNumbers([N('a', '4'), N('x'), N('b', '5')], [E('a', 'x'), E('x', 'b')]);
assert.deepStrictEqual([...g], [['x', '4.1']]);
g = assignNumbers([N('a', '4'), N('x', '4.1'), N('y'), N('b', '5')], [E('a', 'x'), E('x', 'y'), E('y', 'b')]);
assert.deepStrictEqual([...g], [['y', '4.1.1']], 'between 4.1 and 5 it is a sub-number of 4.1');
g = assignNumbers([N('a', '4'), N('x', '4.1'), N('y'), N('b', '5')], [E('a', 'y'), E('y', 'b'), E('a', 'x')]);
assert.deepStrictEqual([...g], [['y', '4.2']], 'the next free sub-number');

// added at the end, at the start, or on its own: the next whole number after the biggest
g = assignNumbers([N('a', '3'), N('b', '12'), N('end')], [E('b', 'end')]);
assert.deepStrictEqual([...g], [['end', '13']], 'at the end');
g = assignNumbers([N('start'), N('a', '1'), N('b', '2')], [E('start', 'a')]);
assert.deepStrictEqual([...g], [['start', '3']], 'at the start (nothing is renumbered)');
g = assignNumbers([N('a', '1'), N('lone')], []);
assert.deepStrictEqual([...g], [['lone', '2']]);

// the biggest number of a sub-numbered box counts: 4.2 means 4 is used
g = assignNumbers([N('a', '9.1'), N('z')], []);
assert.deepStrictEqual([...g], [['z', '10']]);

// numbers of deleted boxes are not reused
g = assignNumbers([N('a', '1'), N('b')], [], ['2', '3']);
assert.deepStrictEqual([...g], [['b', '4']], 'deleted 3 is not handed out again');

// already numbered: nothing to do
assert.strictEqual(assignNumbers([N('a', '1'), N('b', '2')], [E('a', 'b')]).size, 0);

// two new boxes at once get different numbers
g = assignNumbers([N('a', '1'), N('p'), N('q'), N('b', '2')], [E('a', 'p'), E('p', 'b'), E('a', 'q'), E('q', 'b')]);
assert.deepStrictEqual([...g].map(([, v]) => v), ['1.1', '1.2']);

console.log('shapeNumbers tests: all ok');
