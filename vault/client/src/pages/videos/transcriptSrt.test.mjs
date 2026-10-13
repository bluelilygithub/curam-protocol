import assert from 'node:assert/strict';
import { applyEditedText } from './transcriptSrt.mjs';

const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello thare.\n\n2\n00:00:03,500 --> 00:00:05,000\nSecond line.\n';

// A corrected word keeps the timings.
let r = applyEditedText(srt, 'Hello there.\nSecond line.');
assert.equal(r.applied, true);
assert.equal(r.srt, '1\n00:00:01,000 --> 00:00:03,000\nHello there.\n\n2\n00:00:03,500 --> 00:00:05,000\nSecond line.\n');

// Untouched text returns the original unchanged.
r = applyEditedText(srt, 'Hello thare.\nSecond line.');
assert.deepEqual(r, { srt, applied: true });

// A line added or removed cannot be matched to a timing: keep the original and say so.
r = applyEditedText(srt, 'Hello there. Second line.');
assert.deepEqual(r, { srt, applied: false });
r = applyEditedText(srt, 'a\nb\nc');
assert.equal(r.applied, false);

// Blank lines and CRLF do not matter.
r = applyEditedText(srt.replace(/\n/g, '\r\n'), 'Hello there.\r\n\r\nSecond line.\r\n');
assert.equal(r.applied, true);
assert.ok(r.srt.includes('Hello there.'));
console.log('transcriptSrt tests passed');
