import assert from 'node:assert/strict';
import { formatTime, embedSrc, coverageNote, ASK_STARTERS, noteHref, formatUsd, formatWait, formatLength, elapsedText, TRANSCRIPTS_CHANGED } from './youtubeFormat.mjs';

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

// the confirmation window's words (same as the server's)
assert.equal(formatUsd(0.0312), 'US$0.03');
assert.equal(formatUsd(0.004), 'under US$0.01');
assert.equal(formatUsd(1.5), 'US$1.50');
assert.equal(formatWait(30, 80), 'under 2 minutes');
assert.equal(formatWait(60, 240), '1 to 4 minutes');
assert.equal(formatWait(170, 190), 'about 3 minutes');
assert.equal(formatLength(600), '10 minutes');
assert.equal(formatLength(3900), '1 hour 5 minutes');
assert.equal(formatLength(20), 'under a minute');
assert.equal(elapsedText(83000), '1:23');
assert.equal(elapsedText(5000), '0:05');
assert.equal(elapsedText(-1), '0:00');
assert.equal(typeof TRANSCRIPTS_CHANGED, 'string');

console.log('youtubeFormat: ok');
