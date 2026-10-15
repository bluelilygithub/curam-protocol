import assert from 'node:assert/strict';
import { MIN_GAP, clampStart, clampEnd, nudge, timeFromX, pct, reachedEnd, normalizeRange, clampBlockStart, blockStartFromPointer, MIN_SPAN, clampView, viewAround, zoomView, wholeView, isWhole, viewForSelection, ensureVisible, timeFromXView, pctView, visiblePct, stripTimes, lastFrameTime } from './clipRange.mjs';

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


// ---- a fixed-length block that slides along the video ----
assert.equal(clampBlockStart(20, 12, 60), 20);
assert.equal(clampBlockStart(-5, 12, 60), 0, 'never before the start');
assert.equal(clampBlockStart(55, 12, 60), 48, 'never so late that it runs past the end (60 - 12)');
assert.equal(clampBlockStart(12.34, 12, 60), 12.3, 'tenths of a second');
assert.equal(clampBlockStart(5, 80, 60), 0, 'a block longer than the video stays at the start');
assert.equal(clampBlockStart('x', 12, 60), 0);
// grabbing the block in the middle does not make it jump
assert.equal(blockStartFromPointer(26, 6, 12, 60), 20, 'pointer at 26 s, grabbed 6 s into the block -> starts at 20');
assert.equal(blockStartFromPointer(26, 0, 12, 60), 26);
assert.equal(blockStartFromPointer(3, 6, 12, 60), 0, 'dragged past the start: held at 0');
assert.equal(blockStartFromPointer(100, 6, 12, 60), 48, 'dragged past the end: held so it still fits');
// the length never changes however far it is dragged
for (const pointer of [0, 10, 30, 59, 200]) {
  const st = blockStartFromPointer(pointer, 4, 12, 60);
  assert.ok(st >= 0 && st + 12 <= 60 + 1e-9, `block fits at pointer ${pointer}`);
}


// ---- zooming ----
{
assert.deepStrictEqual(wholeView(100), { start: 0, span: 100 });
assert.ok(isWhole(wholeView(100), 100));
assert.deepStrictEqual(clampView({ start: 90, span: 30 }, 100), { start: 70, span: 30 }, 'a window never runs off the end');
assert.deepStrictEqual(clampView({ start: -5, span: 30 }, 100), { start: 0, span: 30 }, 'or the start');
assert.equal(clampView({ start: 0, span: 0.5 }, 100).span, MIN_SPAN, 'never zoomed in past about 3 seconds');
assert.equal(clampView({ start: 0, span: 500 }, 100).span, 100, 'nor out past the whole video');
assert.equal(clampView({ start: 0, span: 1 }, 2).span, 2, 'a video shorter than the minimum shows all of itself');
assert.deepStrictEqual(clampView({}, 0), { start: 0, span: 0 });
assert.deepStrictEqual(viewAround(50, 20, 100), { start: 40, span: 20 });
assert.deepStrictEqual(viewAround(2, 20, 100), { start: 0, span: 20 }, 'near the start the window stops at 0');
assert.deepStrictEqual(zoomView(wholeView(100), 0.5, 30, 100), { start: 5, span: 50 }, 'zoom in halves the span around the centre');
assert.deepStrictEqual(zoomView({ start: 5, span: 50 }, 2, 30, 100), { start: 0, span: 100 }, 'zoom out back to the whole video');
assert.ok(!isWhole({ start: 5, span: 50 }, 100));
// selection: about three times its length, centred
assert.deepStrictEqual(viewForSelection(40, 50, 100), { start: 30, span: 30 });
assert.equal(viewForSelection(40, 40.5, 100).span, MIN_SPAN, 'a tiny selection still gets a usable window');
// keeping the selection on screen
const v = { start: 20, span: 30 };
assert.deepStrictEqual(ensureVisible(v, 25, 30, 100), v, 'already visible: the window does not move');
assert.deepStrictEqual(ensureVisible(v, 70, 75, 100), { start: 57.5, span: 30 }, 'off screen: centred on the selection');
assert.deepStrictEqual(ensureVisible(v, 0, 40, 100), { start: 0, span: 30 }, 'selection longer than the window: show its start');
// pointer and percent are inverses inside a window
const rect = { left: 100, width: 400 };
const win = { start: 20, span: 40 };
assert.equal(timeFromXView(100, rect, win), 20);
assert.equal(timeFromXView(300, rect, win), 40);
assert.equal(timeFromXView(500, rect, win), 60);
assert.equal(timeFromXView(9999, rect, win), 60, 'beyond the track is held at the edge of the window');
assert.equal(timeFromXView(0, rect, win), 20);
assert.equal(pctView(40, win), 50);
assert.equal(pctView(10, win), -25, 'outside the window: below 0');
assert.equal(pctView(70, win), 125);
// what part of a selection is on screen
assert.deepStrictEqual(visiblePct(30, 50, win), { left: 25, width: 50, clippedLeft: false, clippedRight: false });
assert.deepStrictEqual(visiblePct(10, 30, win), { left: 0, width: 25, clippedLeft: true, clippedRight: false });
assert.deepStrictEqual(visiblePct(50, 80, win), { left: 75, width: 25, clippedLeft: false, clippedRight: true });
assert.equal(visiblePct(0, 10, win), null, 'wholly before the window');
assert.equal(visiblePct(70, 80, win), null, 'wholly after the window');
// the strip: the middle of each tile, and a tile gets smaller as you zoom in
const whole = stripTimes(wholeView(100), 4, 100);
assert.deepStrictEqual(whole, [12.5, 37.5, 62.5, 87.5]);
const zoomed = stripTimes({ start: 40, span: 8 }, 4, 100);
assert.deepStrictEqual(zoomed, [41, 43, 45, 47]);
assert.ok(zoomed[1] - zoomed[0] < whole[1] - whole[0], 'zooming in puts the pictures closer together in time');
assert.ok(Math.max(...stripTimes({ start: 99, span: 1 }, 3, 100)) <= 99.95, 'never asks for a moment past the end');
// the "last frame covered"
assert.equal(lastFrameTime(10, 20), 19.96);
assert.equal(lastFrameTime(10, 10.01), 10, 'never before the start');

}
console.log('clipRange tests passed');
