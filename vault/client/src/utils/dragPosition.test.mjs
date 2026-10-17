// Run: node client/src/utils/dragPosition.test.mjs
// Floating element drag maths: stays on screen, resizes safely, ignores junk saved positions.
import assert from 'node:assert';
import { clampOffset, isDrag, parseOffset, sameOffset, MARGIN } from './dragPosition.mjs';

const view = { width: 1000, height: 800 };
// a 390 x 640 panel resting at the bottom right (20px from the edges)
const panel = { left: 1000 - 20 - 390, top: 800 - 20 - 640, width: 390, height: 640 };

// inside the screen: unchanged
assert.deepStrictEqual(clampOffset({ x: -100, y: -40 }, panel, view), { x: -100, y: -40 });
// dragged off the right/bottom: pulled back to the margin
assert.deepStrictEqual(clampOffset({ x: 500, y: 500 }, panel, view), { x: 20 - MARGIN, y: 20 - MARGIN });
// dragged off the left/top: stops at the margin
assert.deepStrictEqual(clampOffset({ x: -5000, y: -5000 }, panel, view), { x: MARGIN - panel.left, y: MARGIN - panel.top });
// the resting position itself is always valid
assert.deepStrictEqual(clampOffset({ x: 0, y: 0 }, panel, view), { x: 0, y: 0 });

// a window made smaller than the element's saved spot: the offset is pulled back on screen
const small = { width: 600, height: 500 };
const c = clampOffset({ x: -100, y: -100 }, { left: 190, top: -140, width: 390, height: 640 }, small);
assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));

// an element taller than the screen stays pinned to its start edge (never an inverted range)
const tall = clampOffset({ x: 0, y: 300 }, { left: 100, top: 10, width: 100, height: 2000 }, view);
assert.strictEqual(tall.y, MARGIN - 10);

// a small round button
const btn = { left: 1000 - 20 - 48, top: 800 - 20 - 48, width: 48, height: 48 };
const moved = clampOffset({ x: -5000, y: -5000 }, btn, view);
assert.deepStrictEqual(moved, { x: MARGIN - btn.left, y: MARGIN - btn.top });

assert.strictEqual(isDrag(1, 1), false, 'a tiny wobble is still a click');
assert.strictEqual(isDrag(3, 3), true);

assert.deepStrictEqual(parseOffset('{"x":-12.4,"y":30}'), { x: -12, y: 30 });
for (const junk of [null, undefined, '', 'nope', '{"x":"a","y":1}', '{"x":1}', '[]', NaN]) {
  assert.deepStrictEqual(parseOffset(junk), { x: 0, y: 0 }, `junk: ${junk}`);
}
assert.ok(sameOffset({ x: 1, y: 2 }, { x: 1, y: 2 }) && !sameOffset({ x: 1, y: 2 }, { x: 2, y: 2 }));

console.log('dragPosition tests passed');
