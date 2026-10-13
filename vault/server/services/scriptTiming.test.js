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

console.log('scriptTiming tests passed');
