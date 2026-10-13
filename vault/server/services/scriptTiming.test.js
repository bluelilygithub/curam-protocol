'use strict';
const assert = require('assert');
const { splitScriptIntoCaptions, weightedTiming, alignChunksToTranscript, timeScript } = require('./scriptTiming');
const { parseSrtLoose } = require('./srtUtils');

// ---- splitting ----
const script = [
  'Welcome to the tour. Today we look at three rooms, starting with the kitchen, then the lounge.',
  '',
  'Thanks for watching!',
].join('\n');
const chunks = splitScriptIntoCaptions(script, { maxWords: 8 });
assert.ok(chunks.length >= 4, 'long sentences are cut into caption-sized pieces');
assert.ok(chunks.every((c) => c.split(/\s+/).length <= 8), 'no caption over the word limit');
assert.strictEqual(chunks[chunks.length - 1], 'Thanks for watching!', 'the last line stays whole');
assert.ok(chunks.includes('Welcome to the tour.'), 'a short sentence is its own caption');
// no one-word orphans from an even split
assert.deepStrictEqual(splitScriptIntoCaptions('one two three four five six seven eight nine ten eleven', { maxWords: 10 }).map((c) => c.split(' ').length), [6, 5]);
assert.deepStrictEqual(splitScriptIntoCaptions('   \n  ', {}), []);

// ---- even (weighted) timing ----
const even = weightedTiming(['Hi.', 'This is a much longer caption than the first one.'], 20);
assert.strictEqual(even.length, 2);
assert.ok(even[1].endMs - even[1].startMs > even[0].endMs - even[0].startMs, 'longer text gets more time');
assert.ok(even[0].startMs >= 0 && even[1].endMs <= 20000, 'inside the media length');
assert.ok(even[0].endMs <= even[1].startMs, 'no overlap');

// ---- speech alignment ----
const spoken = [
  { startMs: 1000, endMs: 4000, text: 'welcome to the tour' },
  { startMs: 4500, endMs: 9000, text: 'today we look at three rooms starting with the kitchen' },
  { startMs: 9500, endMs: 12000, text: 'then the lounge' },
  { startMs: 14000, endMs: 16000, text: 'thanks for watching' },
];
const lines = ['Welcome to the tour.', 'Today we look at three rooms,', 'starting with the kitchen,', 'then the lounge.', 'Thanks for watching!'];
let a = alignChunksToTranscript(lines, spoken, 17);
assert.ok(a.coverage > 0.95);
assert.ok(Math.abs(a.cues[0].startMs - 1000) < 50, 'first caption starts when "welcome" is spoken');
assert.ok(a.cues[4].startMs >= 13900, 'the last caption waits for the speech after the pause');
for (let i = 1; i < a.cues.length; i += 1) assert.ok(a.cues[i].startMs >= a.cues[i - 1].startMs, 'in order');
for (let i = 1; i < a.cues.length; i += 1) assert.ok(a.cues[i - 1].endMs <= a.cues[i].startMs, 'no overlaps');

// a misheard word and an ad-lib do not derail the rest
const messy = [
  { startMs: 1000, endMs: 4000, text: 'welcome to the tower' },
  { startMs: 4500, endMs: 9000, text: 'so um today we look at three rooms starting with the kitchen' },
  { startMs: 9500, endMs: 12000, text: 'then the lounge' },
  { startMs: 14000, endMs: 16000, text: 'thanks for watching' },
];
a = alignChunksToTranscript(lines, messy, 17);
assert.ok(a.coverage > 0.85);
assert.ok(a.cues[4].startMs >= 13900, 'still lands the last caption correctly');

// a caption the speaker skipped is placed between its neighbours rather than lost
a = alignChunksToTranscript(['Welcome to the tour.', 'This sentence was never spoken aloud.', 'Thanks for watching!'], spoken, 17);
assert.strictEqual(a.cues.length, 3);
assert.ok(a.cues[1].startMs >= a.cues[0].startMs && a.cues[1].endMs <= a.cues[2].startMs);

// ---- the public entry point ----
let r = timeScript(script, { durationSec: 17, transcriptCues: spoken });
assert.strictEqual(r.method, 'speech');
let cues = parseSrtLoose(r.srt);
assert.strictEqual(cues.length, r.captions);
assert.ok(cues[0].startMs >= 900 && cues[0].startMs <= 1100);

r = timeScript(script, { durationSec: 17, transcriptCues: null });
assert.strictEqual(r.method, 'even', 'no speech to listen to -> even spread');
assert.match(r.note, /spread evenly/);

r = timeScript(script, { durationSec: 17, transcriptCues: [{ startMs: 0, endMs: 3000, text: 'completely unrelated words about something else entirely' }] });
assert.strictEqual(r.method, 'even', 'script that does not match the speech falls back, with a warning');
assert.match(r.note, /did not match/);

assert.throws(() => timeScript('   ', { durationSec: 10 }), (e) => e.code === 'SCRIPT_EMPTY');

// ---- times written in the script ----
const { hasTimeMarkers, parseTimedScript } = require('./scriptTiming');
const written = '[00:00 – 00:12]In an era of rapid change, strategy falls short. Organizations need a dynamic system.   [00:12 – 00:30]Enter Strategy in Motion, a proven seven-step framework designed for modern leadership.   [01:14 – 01:30]Transform your leadership approach. Visit margotcairnes.com to learn more. ';
assert.strictEqual(hasTimeMarkers(written), true);
assert.strictEqual(hasTimeMarkers('No times in this one.'), false);
const blocks = parseTimedScript(written);
assert.deepStrictEqual(blocks.map((b) => [b.startMs, b.endMs]), [[0, 12000], [12000, 30000], [74000, 90000]], '1:14 means one minute fourteen');
assert.ok(!/\[/.test(blocks[0].text), 'the markers are not part of the caption text');
// hyphen, "to", single time and hh:mm:ss forms
assert.deepStrictEqual(parseTimedScript('[0:05 - 0:09] a b [0:09 to 0:12] c [0:01:00] d').map((b) => [b.startMs, b.endMs]), [[5000, 9000], [9000, 12000], [60000, null]]);

let t = timeScript(written, { durationSec: 95, transcriptCues: null });
assert.strictEqual(t.method, 'markers');
cues = parseSrtLoose(t.srt);
assert.ok(cues.length >= 5);
assert.ok(cues[0].startMs === 0, 'first caption starts at the first written time');
assert.ok(cues.every((c, i) => i === 0 || c.startMs >= cues[i - 1].endMs - 1), 'in order, no overlap');
const inBlock2 = cues.filter((c) => c.startMs >= 12000 && c.startMs < 30000);
assert.ok(inBlock2.length >= 1 && inBlock2.every((c) => c.endMs <= 30000), 'block 2 captions stay inside 00:12-00:30');
assert.ok(cues.filter((c) => c.startMs >= 74000).every((c) => c.endMs <= 90000), 'the last block stays inside 01:14-01:30');
assert.ok(cues.some((c) => c.startMs >= 74000), 'the gap before 01:14 is left empty, not stretched over');
assert.ok(!cues.some((c) => c.startMs > 30000 && c.startMs < 74000), 'no caption invented inside the gap');
assert.ok(!/\[/.test(t.srt), 'no markers leak into the captions');
// no media length needed, and markers beyond the recording are cut off with a warning
t = timeScript(written, { durationSec: 0 });
assert.strictEqual(t.method, 'markers');
t = timeScript(written, { durationSec: 40 });
assert.match(t.note, /past the end/);
assert.ok(parseSrtLoose(t.srt).every((c) => c.endMs <= 40000));
assert.throws(() => timeScript('[05:00 - 06:00] only way past the end', { durationSec: 40 }), (e) => e.code === 'SCRIPT_TIMES_INVALID');

console.log('scriptTiming tests passed');
