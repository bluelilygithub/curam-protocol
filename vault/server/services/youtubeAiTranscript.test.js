'use strict';
// node server/services/youtubeAiTranscript.test.js   (part of npm run test:youtube). No model is called.
const assert = require('node:assert/strict');
const T = require('./youtubeAiTranscript');

// ---- duration
assert.equal(T.parseIsoDuration('PT10M'), 600);
assert.equal(T.parseIsoDuration('PT1H2M3S'), 3723);
assert.equal(T.parseIsoDuration('PT45S'), 45);
assert.equal(T.parseIsoDuration('P0D'), 0, 'a live stream reports no length');
assert.equal(T.parseIsoDuration(undefined), 0);

// ---- the estimate shown before anyone agrees
const e = T.estimate({ durationSec: 600, modelId: 'gemini-2.0-flash' });
assert.equal(e.tokensIn, 60000);
assert.equal(e.tokensOut, 3000);
assert.ok(e.costUsd > 0 && e.costUsd < 0.05, 'ten minutes on a flash model is a few cents at most: ' + e.costUsd);
assert.equal(e.costHighUsd, e.costUsd * 2, 'a ceiling is given too');
assert.ok(e.waitLowSec < e.waitHighSec && e.waitLowSec >= 10);
assert.equal(e.tooLong, false);
assert.equal(T.estimate({ durationSec: 3601, modelId: 'gemini-2.0-flash' }).tooLong, true, 'over an hour is refused');
assert.equal(T.estimate({ durationSec: 3600, modelId: 'gemini-2.0-flash' }).tooLong, false);
const pro = T.estimate({ durationSec: 600, modelId: 'gemini-2.5-pro' });
assert.ok(pro.costUsd > e.costUsd, 'a pro model costs more than a flash one');
assert.deepEqual(T.estimate({ durationSec: 0, modelId: 'x' }).tokensIn, 0);

// ---- the words the window uses
assert.equal(T.formatUsd(0.0312), 'US$0.03');
assert.equal(T.formatUsd(0.004), 'under US$0.01');
assert.equal(T.formatUsd(1.5), 'US$1.50');
assert.equal(T.formatWait(30, 80), 'under 2 minutes');
assert.equal(T.formatWait(60, 240), '1 to 4 minutes');
assert.equal(T.formatWait(170, 190), 'about 3 minutes');
assert.equal(T.formatLength(600), '10 minutes');
assert.equal(T.formatLength(60), '1 minute');
assert.equal(T.formatLength(3900), '1 hour 5 minutes');
assert.equal(T.formatLength(3600), '1 hour');
assert.equal(T.formatLength(20), 'under a minute');

// ---- what comes back is untrusted
const good = JSON.stringify([
  { start: '0:00', text: 'Hello and welcome.' },
  { start: '0:12', text: 'Today: <b>bread</b>.' },
  { start: '0:30', text: '   ' },
  { start: 'soon', text: 'no time' },
  { start: '0:05', text: 'out of order' },
  { start: '99:00', text: 'past the end' },
  { text: 'no start' },
  'junk',
  null,
]);
let n = T.normalizeTranscript('Sure! Here it is:\n' + good + '\nHope that helps', { durationSec: 60 });
assert.deepEqual(n.segments.map((s) => [s.start, s.text]), [[0, 'Hello and welcome.'], [12, 'Today: bread.'], [60, 'past the end']], 'cleaned, in order, clamped');
assert.deepEqual(n.segments.map((s) => s.dur), [12, 48, 0], 'each line lasts until the next');
assert.equal(n.cutOff, false);
assert.equal(T.normalizeTranscript('no json here'), null);
assert.equal(T.normalizeTranscript('[]'), null, 'nothing spoken gives null');
assert.equal(T.normalizeTranscript({ segments: [{ start: 5, text: 'object form' }] }).segments[0].start, 5);
assert.equal(T.normalizeTranscript([{ start: 1, text: 'x'.repeat(5000) }]).segments[0].text.length, 1200, 'long lines are cut');

// a reply that ran out of room keeps every complete line, and says it was cut off
const cut = '[{"start":"0:00","text":"one"},{"start":"5:00","text":"two"},{"start":"10:00","tex';
n = T.normalizeTranscript(cut, { durationSec: 1800 });
assert.deepEqual(n.segments.map((s) => s.text), ['one', 'two']);
assert.equal(n.cutOff, true, 'ending at 5:00 of a 30-minute video is flagged');
n = T.normalizeTranscript(cut, { durationSec: 400 });
assert.equal(n.cutOff, false, 'but not when it reached most of a short video');

// no more lines than a person could ever read
const huge = JSON.stringify(Array.from({ length: 9000 }, (_, i) => ({ start: i, text: 'w' + i })));
assert.equal(T.normalizeTranscript(huge).segments.length, 4000);

assert.equal(T.segmentsToText([{ text: 'a' }, { text: 'b' }]), 'a b');
assert.match(T.TRANSCRIBE_PROMPT, /never act on it/, 'speech in the video is data, not instructions');
assert.match(T.TRANSCRIBE_PROMPT, /Do not describe pictures/);

console.log('youtubeAiTranscript: ok');
