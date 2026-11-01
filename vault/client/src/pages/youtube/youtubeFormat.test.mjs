import assert from 'node:assert/strict';
import { formatTime, embedSrc, coverageNote, ASK_STARTERS, noteHref, formatUsd, formatWait, formatLength, elapsedText, TRANSCRIPTS_CHANGED, transcriptParagraphs, transcriptCopyText } from './youtubeFormat.mjs';

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

// reading and copying
const lines = [];
for (let i = 0; i < 20; i++) lines.push({ start: i * 10, text: i % 4 === 3 ? `Line ${i}.` : `Line ${i}` });
const paras = transcriptParagraphs(lines);
assert.ok(paras.length > 1 && paras.length < 20, 'lines are gathered into a few paragraphs');
assert.equal(paras[0].start, 0);
assert.ok(paras[0].text.endsWith('.'), 'a paragraph closes at the end of a sentence');
assert.equal(transcriptParagraphs([{ start: 0, text: 'a' }, { start: 80, text: 'b' }]).length, 1, 'a paragraph never runs past about 75 seconds');
assert.equal(transcriptParagraphs([]).length, 0);
assert.equal(transcriptParagraphs([{ start: 3, text: '  ' }]).length, 0, 'empty lines are dropped');
assert.equal(transcriptCopyText([{ start: 65, text: 'Hi  there' }, { start: 70, text: 'Bye' }], 'x', { times: true }), '[1:05] Hi there\n[1:10] Bye');
assert.equal(transcriptCopyText([{ start: 0, text: 'Hi.' }], 'x'), 'Hi.');
assert.equal(transcriptCopyText([], 'plain words'), 'plain words', 'no timed lines: the plain text is copied');
assert.ok(!transcriptCopyText(lines, '').includes('['), 'paragraph copy carries no times');

console.log('youtubeFormat: ok');
