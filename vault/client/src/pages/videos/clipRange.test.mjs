import assert from 'node:assert/strict';
import { MIN_GAP, clampStart, clampEnd, nudge, timeFromX, pct, reachedEnd, normalizeRange } from './clipRange.mjs';

// markers cannot cross, leave the video, or sit on top of each other
assert.equal(clampStart(-5, 30), 0);
assert.equal(clampStart(40, 30), 29.9, 'start stops just before the end');
assert.equal(clampStart(12.34, 30), 12.3, 'tenths of a second');
assert.equal(clampEnd(99, 10, 60), 60, 'end stops at the end of the video');
assert.equal(clampEnd(5, 10, 60), 10.1, 'end stops just after the start');
assert.equal(clampEnd(30.06, 10, 60), 30.1);
assert.equal(MIN_GAP, 0.1);

// keyboard steps: 0.1 s, 1 s with Shift; no floating-point dust
assert.equal(nudge(1.2, 1), 1.3);
assert.equal(nudge(1.3, -1), 1.2);
assert.equal(nudge(10, 1, true), 11);
assert.equal(nudge(0.1 + 0.2, 1), 0.4);

// pointer position -> time
const rect = { left: 100, width: 400 };
assert.equal(timeFromX(100, rect, 60), 0);
assert.equal(timeFromX(300, rect, 60), 30);
assert.equal(timeFromX(500, rect, 60), 60);
assert.equal(timeFromX(9999, rect, 60), 60, 'beyond the track is the end');
assert.equal(timeFromX(-50, rect, 60), 0, 'before the track is the start');
assert.equal(timeFromX(200, { left: 0, width: 0 }, 60), 0, 'no layout yet');
assert.equal(timeFromX(200, rect, 0), 0, 'no duration yet');

assert.equal(pct(30, 60), 50);
assert.equal(pct(99, 60), 100);
assert.equal(pct(5, 0), 0);

// previewing the selection stops at the out point
assert.equal(reachedEnd(9.96, 10), true);
assert.equal(reachedEnd(9.5, 10), false);

// the page keeps the end as text; empty means "to the end"
assert.deepEqual(normalizeRange(0, '', 60), { dur: 60, start: 0, end: 60 });
assert.deepEqual(normalizeRange(156, '168', 277), { dur: 277, start: 156, end: 168 });
assert.deepEqual(normalizeRange(10, '5', 60), { dur: 60, start: 10, end: 10.1 }, 'an end before the start is pulled back to just after it');
assert.deepEqual(normalizeRange(10, '999', 60), { dur: 60, start: 10, end: 60 });
assert.deepEqual(normalizeRange(100, '', 60), { dur: 60, start: 59.9, end: 60 }, 'a start past the end is held just inside it, and the end never leaves the video');
assert.deepEqual(normalizeRange(0, '', 0), { dur: 0, start: 0, end: 0.1 }, 'nothing loaded yet');

console.log('clipRange tests passed');
