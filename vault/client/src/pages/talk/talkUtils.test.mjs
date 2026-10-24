// node client/src/pages/talk/talkUtils.test.mjs   (part of npm run test:notes)
import assert from 'node:assert';
import { toSpeakable, splitForSpeech, isIOS, readPrefs, savePrefs, PREFS_KEY, stateLabel } from './talkUtils.mjs';

// what the voice says
assert.strictEqual(toSpeakable('About **$120** a metre, installed.'), 'About $120 a metre, installed.');
assert.strictEqual(toSpeakable('See [the quote](https://example.com/q?id=1) and https://example.com/other today.'), 'See the quote and a link today.');
assert.strictEqual(toSpeakable('## Plan\n- measure up\n- order the oak\n1. call Sam'), 'Plan. measure up. order the oak. call Sam');
assert.strictEqual(toSpeakable('Use `npm run build` first.\n```js\nconsole.log(1)\n```\nThen go.'), 'Use npm run build first. Then go.');
assert.ok(!toSpeakable('| Item | Qty |\n| --- | --- |\n| Nails | 4 |').includes('|'), 'a table is read as words, not pipes');
assert.ok(!toSpeakable('| Item | Qty |\n| --- | --- |\n| Nails | 4 |').includes('---'));
assert.strictEqual(toSpeakable('> a quote\n\nLast line'), 'a quote. Last line');
assert.strictEqual(toSpeakable(''), '');
assert.strictEqual(toSpeakable(null), '');

// pieces
assert.deepStrictEqual(splitForSpeech('One. Two! Three?'), ['One. Two! Three?']);
assert.deepStrictEqual(splitForSpeech('A short one. Another short one.', 20), ['A short one.', 'Another short one.']);
const long = 'This is a rather long sentence that goes on, and on, and on, with several commas and plenty of words to cut up somewhere sensible.';
const parts = splitForSpeech(long, 50);
assert.ok(parts.length >= 3 && parts.every((p) => p.length <= 50), 'every piece fits');
assert.strictEqual(parts.join(' ').replace(/\s+/g, ' '), long, 'nothing is lost');
assert.deepStrictEqual(splitForSpeech('   '), []);
assert.deepStrictEqual(splitForSpeech('no end punctuation here'), ['no end punctuation here']);

// iPhone detection
assert.strictEqual(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit' }), true);
assert.strictEqual(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true, 'an iPad that says Mac');
assert.strictEqual(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), false);
assert.strictEqual(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' }), false);
assert.strictEqual(isIOS(null), false);

// remembered switches
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
const s = mem();
assert.deepStrictEqual(readPrefs(s, false), { readAloud: true, autoListen: true, useNotes: false }, 'notes stay off until switched on');
assert.deepStrictEqual(readPrefs(s, true), { readAloud: true, autoListen: false, useNotes: false }, 'an iPhone cannot listen again by itself');
savePrefs(s, { readAloud: false, autoListen: true, useNotes: true });
assert.deepStrictEqual(readPrefs(s, true), { readAloud: false, autoListen: true, useNotes: true });
s.setItem(PREFS_KEY, '{"readAloud":"yes","useNotes":1}');
assert.deepStrictEqual(readPrefs(s, false), { readAloud: true, autoListen: true, useNotes: false }, 'only true or false counts');
s.setItem(PREFS_KEY, 'junk');
assert.deepStrictEqual(readPrefs(s, false), { readAloud: true, autoListen: true, useNotes: false });
assert.deepStrictEqual(readPrefs(null, false), { readAloud: true, autoListen: true, useNotes: false });

// wording
assert.strictEqual(stateLabel('idle', { autoListen: false }), 'Tap to talk');
assert.strictEqual(stateLabel('idle', { autoListen: true }), 'Tap to start talking');
assert.strictEqual(stateLabel('speaking'), 'Speaking… tap to interrupt');
assert.match(stateLabel('idle', { supported: false }), /cannot listen/);

console.log('ok - talk helpers: spoken text, pieces, iPhone check, remembered switches, wording');
