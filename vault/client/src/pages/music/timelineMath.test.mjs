import assert from 'node:assert';
import {
  timeFromX, nearestCut, snapTime, clampVoiceStart, clampMusicStart, musicBarLayout, voiceBarLayout,
} from './timelineMath.mjs';

// pixels -> seconds
assert.strictEqual(timeFromX(150, 300, 20), 10);
assert.strictEqual(timeFromX(-40, 300, 20), 0, 'left of the bar is the start');
assert.strictEqual(timeFromX(999, 300, 20), 20, 'right of the bar is the end');
assert.strictEqual(timeFromX(10, 0, 20), 0, 'a bar with no width is harmless');

// snapping
const cuts = [3.2, 8, 8.4, 15];
assert.strictEqual(nearestCut(3.0, cuts), 3.2);
assert.strictEqual(nearestCut(8.3, cuts), 8.4, 'the closest of two');
assert.strictEqual(nearestCut(5, cuts), null, 'nothing close enough');
assert.strictEqual(nearestCut(3.9, cuts, 1), 3.2, 'a wider reach');
assert.strictEqual(nearestCut(3.0, null), null);
assert.strictEqual(snapTime(3.0, cuts), 3.2);
assert.strictEqual(snapTime(3.0, cuts, { enabled: false }), 3.0, 'snapping off leaves the time alone');
assert.strictEqual(snapTime(5, cuts), 5);

// where things may start
assert.strictEqual(clampVoiceStart(-2, 12), 0);
assert.strictEqual(clampVoiceStart(11.9, 12), 11.5, 'leaves half a second');
assert.strictEqual(clampVoiceStart(3.14159, 12), 3.1);
assert.strictEqual(clampVoiceStart(NaN, 12), 0);
assert.strictEqual(clampMusicStart(99, 12), 11, 'leaves a second of music');
assert.strictEqual(clampMusicStart(2.26, 12), 2.3);

// the bars
const m = musicBarLayout(20, { fadeInS: 1, fadeOutS: 4, startS: 5 });
assert.deepStrictEqual([m.startPct, m.widthPct, m.fadeInPct, m.fadeOutPct], [25, 75, 5, 20]);
assert.deepStrictEqual(musicBarLayout(0), { startPct: 0, widthPct: 100, fadeInPct: 0, fadeOutPct: 0 });
assert.strictEqual(musicBarLayout(10, { fadeInS: 99, startS: 8 }).fadeInPct, 20, 'a fade never runs longer than the music');
const v = voiceBarLayout(20, 6, 4);
assert.deepStrictEqual([v.startPct, v.widthPct, v.overrunS], [20, 30, 0]);
const over = voiceBarLayout(20, 10, 15);
assert.deepStrictEqual([over.startPct, over.widthPct, over.overrunS], [75, 25, 5], 'the part past the end is reported, not drawn');
assert.deepStrictEqual(voiceBarLayout(20, 0, 3), { startPct: 0, widthPct: 0, overrunS: 0 }, 'no voice, no bar');

console.log('ok - timeline maths: pixels, snapping, limits, bar layout');
