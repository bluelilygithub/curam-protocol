import assert from 'node:assert/strict';
import { nextFocusIndex, createDialogStack, FOCUSABLE_SELECTOR } from './dialogFocus.mjs';

// Tab wraps from the last to the first, Shift+Tab from the first to the last, otherwise the browser moves on its own.
assert.equal(nextFocusIndex(3, 2, false), 0);
assert.equal(nextFocusIndex(3, 0, true), 2);
assert.equal(nextFocusIndex(3, 1, false), null);
assert.equal(nextFocusIndex(3, 1, true), null);
// Focus outside the dialog is pulled back in.
assert.equal(nextFocusIndex(3, -1, false), 0);
assert.equal(nextFocusIndex(3, -1, true), 2);
// A dialog with one control keeps focus on it; one with none leaves Tab alone (the panel itself holds focus).
assert.equal(nextFocusIndex(1, 0, false), 0);
assert.equal(nextFocusIndex(1, 0, true), 0);
assert.equal(nextFocusIndex(0, -1, false), null);

// Only the newest dialog owns Escape.
const stack = createDialogStack();
stack.push('a');
stack.push('b');
assert.equal(stack.isTop('b'), true);
assert.equal(stack.isTop('a'), false);
stack.remove('b');
assert.equal(stack.isTop('a'), true);
stack.remove('a');
stack.remove('missing');
assert.equal(stack.size, 0);
assert.equal(stack.isTop('a'), false);

assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'));
console.log('dialogFocus: ok');
