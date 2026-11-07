'use strict';
// node server/services/youtubeTranscript.test.js   (part of npm run test:youtube). No network.
const assert = require('node:assert/strict');
const { parseCaptionSegments, parseCaptionXml, extractVideoId, trackProvenance, pickCaptionTrack } = require('./youtubeTranscript');

// newer format: <p t="ms" d="ms">
const ttml = '<tt><body><div>'
  + '<p t="1500" d="2000">Hello &amp; welcome</p>'
  + '<p t="4000" d="1000"><s>second</s> <s>line</s></p>'
  + '<p t="9000" d="500">   </p>'
  + '<p t="10000">no length</p>'
  + '<p d="500">no start</p>'
  + '</div></body></tt>';
assert.deepEqual(parseCaptionSegments(ttml), [
  { start: 1.5, dur: 2, text: 'Hello & welcome' },
  { start: 4, dur: 1, text: 'second line' },
  { start: 10, dur: 0, text: 'no length' },
], 'times in seconds, entities decoded, empty and untimed lines dropped');

// legacy format: <text start="s" dur="s">
const legacy = '<transcript><text start="0.5" dur="2.1">It&#39;s fine</text><text start="3" dur="1">ok &quot;quoted&quot;</text><text start="5" dur="1">  </text></transcript>';
assert.deepEqual(parseCaptionSegments(legacy), [
  { start: 0.5, dur: 2.1, text: "It's fine" },
  { start: 3, dur: 1, text: 'ok "quoted"' },
]);

// the plain-text form (what pinned URLs and Fetch URL use) is unchanged: the same words, no timing
assert.equal(parseCaptionXml(ttml), 'Hello & welcome second line no length');
assert.equal(parseCaptionXml(legacy), "It's fine ok \"quoted\"");
assert.equal(parseCaptionXml('not captions'), '');
assert.deepEqual(parseCaptionSegments(''), []);

// numeric entities
assert.equal(parseCaptionSegments('<tt><p t="0" d="1">caf&#233; &#x2713;</p></tt>')[0].text, 'café ✓');

assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
// who wrote a caption track: InnerTube marks automatic ones kind "asr" (and a track id starting "a.")
assert.equal(trackProvenance({ kind: 'asr', vssId: 'a.en' }), 'auto');
assert.equal(trackProvenance({ vssId: 'a.en' }), 'auto', 'the id alone is enough');
assert.equal(trackProvenance({ kind: 'asr' }), 'auto', 'the mark alone is enough');
assert.equal(trackProvenance({ vssId: '.en' }), 'manual', 'a track with an id and no mark was written');
assert.equal(trackProvenance({ kind: 'standard' }), 'manual');
assert.equal(trackProvenance({ languageCode: 'en' }), 'unknown', 'neither field: unknown, not a guess');
assert.equal(trackProvenance(null), 'unknown');
assert.equal(trackProvenance('x'), 'unknown');

// which track to read: a written one beats an automatic one, whatever order YouTube lists them in
const auto = (code) => ({ languageCode: code, kind: 'asr', vssId: 'a.' + code });
const written = (code) => ({ languageCode: code, vssId: '.' + code });
assert.deepEqual(pickCaptionTrack([auto('en'), written('en')]), written('en'), 'English written beats English automatic even when the automatic one is listed first');
assert.deepEqual(pickCaptionTrack([written('en'), auto('en')]), written('en'));
assert.deepEqual(pickCaptionTrack([auto('en')]), auto('en'), 'only automatic: it is used (and labelled automatic)');
assert.deepEqual(pickCaptionTrack([written('fr'), auto('en')]), auto('en'), 'English automatic beats French written when no language was asked for');
assert.deepEqual(pickCaptionTrack([written('fr'), written('en'), auto('de')], 'de'), auto('de'), 'the language asked for wins over English');
assert.deepEqual(pickCaptionTrack([auto('de'), written('de'), written('en')], 'de'), written('de'), 'and written beats automatic within it');
assert.deepEqual(pickCaptionTrack([written('fr'), written('de')], 'es'), written('fr'), 'a language that is not there: any written track');
assert.deepEqual(pickCaptionTrack([auto('fr'), auto('de')], 'es'), auto('fr'), 'nothing written: the first');
assert.equal(pickCaptionTrack([], 'en'), null);
assert.equal(pickCaptionTrack(undefined), null);
assert.equal(pickCaptionTrack([null, written('en')]).languageCode, 'en', 'a hole in the list is ignored');


console.log('youtubeTranscript: ok');
