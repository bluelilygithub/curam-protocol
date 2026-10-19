import assert from 'node:assert';
import {
  MAX_RECORD_SEC, WARN_RECORD_SEC, pickMimeType, extensionForMime, formatTimer, describeMicError, canRecord,
} from './voiceNoteUtils.mjs';

assert.strictEqual(MAX_RECORD_SEC, 3600);
assert.ok(WARN_RECORD_SEC < MAX_RECORD_SEC);

// the recorder format: best first, nothing supported -> let the browser choose
assert.strictEqual(pickMimeType(() => true), 'audio/webm;codecs=opus');
assert.strictEqual(pickMimeType((t) => t === 'audio/mp4'), 'audio/mp4', 'Safari records mp4');
assert.strictEqual(pickMimeType(() => false), '');
assert.strictEqual(pickMimeType(() => { throw new Error('boom'); }), '', 'a throwing check counts as unsupported');
assert.strictEqual(pickMimeType(null), '');

// file names
assert.strictEqual(extensionForMime('audio/webm;codecs=opus'), 'webm');
assert.strictEqual(extensionForMime('audio/ogg;codecs=opus'), 'ogg');
assert.strictEqual(extensionForMime('audio/mp4'), 'm4a');
assert.strictEqual(extensionForMime('audio/x-m4a'), 'm4a');
assert.strictEqual(extensionForMime(''), 'webm');

// the timer
assert.strictEqual(formatTimer(0), '0:00');
assert.strictEqual(formatTimer(75), '1:15');
assert.strictEqual(formatTimer(599.9), '9:59');
assert.strictEqual(formatTimer(3725), '1:02:05');
assert.strictEqual(formatTimer(-4), '0:00');
assert.strictEqual(formatTimer('x'), '0:00');

// microphone problems in plain words
assert.match(describeMicError({ name: 'NotAllowedError' }), /blocked/);
assert.match(describeMicError({ name: 'NotFoundError' }), /No microphone/);
assert.match(describeMicError({ name: 'NotReadableError' }), /another app/);
assert.match(describeMicError(new Error('weird')), /could not be started/);
assert.match(describeMicError(null), /could not be started/);

// can this browser record at all
assert.strictEqual(canRecord({ MediaRecorder: function MR() {}, navigator: { mediaDevices: { getUserMedia() {} } } }), true);
assert.strictEqual(canRecord({ navigator: { mediaDevices: { getUserMedia() {} } } }), false, 'no MediaRecorder');
assert.strictEqual(canRecord({ MediaRecorder: function MR() {}, navigator: {} }), false, 'no microphone access (for example an insecure page)');
assert.strictEqual(canRecord(undefined), false);

console.log('ok - voice note utils: format choice, timer, microphone messages, browser check');
