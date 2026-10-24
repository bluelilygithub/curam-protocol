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

// ---- choices before recording ----
{
  const { STYLE_CHOICES, KEEP_CHOICES, DEFAULT_PREFS, PREFS_KEY, readPrefs, savePrefs, describeKept, describeRecovered, formatTimer } = await import('./voiceNoteUtils.mjs');
  assert.deepStrictEqual(DEFAULT_PREFS, { style: 'notes', keep: 'no' }, 'by default: written up as notes, audio not kept');
  assert.deepStrictEqual(STYLE_CHOICES.map((c) => c.value), ['notes', 'update', 'todo', 'meeting', 'words']);
  assert.deepStrictEqual(KEEP_CHOICES.map((c) => c.value), ['no', '7d', 'forever']);
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
  const store = mem();
  assert.deepStrictEqual(readPrefs(store), DEFAULT_PREFS, 'nothing saved: the defaults');
  savePrefs(store, { style: 'update', keep: '7d' });
  assert.deepStrictEqual(readPrefs(store), { style: 'update', keep: '7d' }, 'remembered');
  store.setItem(PREFS_KEY, '{"style":"bogus","keep":"always"}');
  assert.deepStrictEqual(readPrefs(store), DEFAULT_PREFS, 'unknown values are ignored, never kept');
  store.setItem(PREFS_KEY, 'not json');
  assert.deepStrictEqual(readPrefs(store), DEFAULT_PREFS);
  assert.deepStrictEqual(readPrefs(null), DEFAULT_PREFS, 'no storage at all is fine');
  assert.doesNotThrow(() => savePrefs({ setItem() { throw new Error('private window'); } }, DEFAULT_PREFS));

  const now = new Date('2026-10-24T02:00:00Z');
  assert.strictEqual(describeKept(null, now), 'Kept until you delete it');
  assert.strictEqual(describeKept(undefined, now), 'Kept until you delete it');
  assert.strictEqual(describeKept('2026-10-31T02:00:00Z', now), 'Kept for 7 more days, then removed');
  assert.strictEqual(describeKept('2026-10-24T20:00:00Z', now), 'Kept for 1 more day, then removed');
  assert.strictEqual(describeKept('2026-10-24T01:00:00Z', now), 'Removed soon');

  const startedAt = new Date(2026, 9, 24, 14, 35).toISOString();
  assert.strictEqual(describeRecovered({ startedAt, elapsed: 192 }, new Date(2026, 9, 24, 16, 0)), '3:12 recorded today at 2:35 pm');
  assert.strictEqual(describeRecovered({ startedAt, elapsed: 192 }, new Date(2026, 9, 26, 9, 0)), '3:12 recorded on 24 Oct at 2:35 pm');
  assert.strictEqual(describeRecovered({ elapsed: 5 }), '0:05 recorded');
  assert.strictEqual(formatTimer(192), '3:12');
  const { describePrefs } = await import('./voiceNoteUtils.mjs');
  assert.strictEqual(describePrefs({ style: 'notes', keep: 'no' }), 'Written up as Notes, audio not kept');
  assert.strictEqual(describePrefs({ style: 'update', keep: '7d' }), 'Written up as Update, audio kept 7 days');
  assert.strictEqual(describePrefs({ style: 'words', keep: 'forever' }), 'Written up as Just my words, audio kept until you delete it');
  assert.strictEqual(describePrefs({ style: 'todo', keep: 'no' }), 'Written up as To-do list, audio not kept');
  assert.strictEqual(describePrefs(null), 'Written up as Notes, audio not kept');
  console.log('ok - voice note choices: defaults keep no audio, remembered per device, wording for kept and unfinished recordings');
}
