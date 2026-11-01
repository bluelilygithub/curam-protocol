import assert from 'node:assert/strict';
import { formatTime, embedSrc, coverageNote, ASK_STARTERS, noteHref } from './youtubeFormat.mjs';

assert.equal(formatTime(0), '0:00');
assert.equal(formatTime(75), '1:15');
assert.equal(formatTime(3725), '1:02:05');
assert.equal(formatTime('x'), '0:00');
assert.equal(formatTime(-9), '0:00');

assert.equal(embedSrc('abc'), 'https://www.youtube.com/embed/abc?rel=0');
assert.equal(embedSrc('abc', 0), 'https://www.youtube.com/embed/abc?rel=0', 'no start at zero, so the video does not autoplay on open');
assert.equal(embedSrc('abc', 75.9), 'https://www.youtube.com/embed/abc?rel=0&start=75&autoplay=1');
assert.equal(embedSrc('abc', 'nope'), 'https://www.youtube.com/embed/abc?rel=0');

assert.equal(coverageNote(false, 100), '');
assert.equal(coverageNote(true, 2520), 'These notes cover the first 42 minutes of a longer video.');
assert.equal(coverageNote(true, 20), 'These notes cover the first 1 minute of a longer video.');

assert.ok(ASK_STARTERS.length >= 3 && ASK_STARTERS.every((q) => q.endsWith('?')));
assert.equal(noteHref(12), '/notes?note=12');

console.log('youtubeFormat: ok');
