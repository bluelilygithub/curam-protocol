// node client/src/pages/liveTv/liveTvHelpers.test.mjs   (no npm script on purpose: it would change package.json)
import assert from 'node:assert';
import { pickStream, lastResult, m3uFor, m3uFileName, initials, guideDays, clock, whenText, isOnNow, countryItems } from './liveTvHelpers.mjs';

// ---- country picker items ----
const items = countryItems([{ code: 'AU', name: 'Australia', count: 44 }, { code: 'GB', name: 'United Kingdom', count: 1 }]);
assert.deepStrictEqual(items.map((i) => i.id), ['', 'AU', 'GB'], 'All countries first');
assert.strictEqual(items[0].hint, '45 channels');
assert.strictEqual(items[2].hint, '1 channel');
assert.match(items[2].keywords, /\bgb\b.*\buk\b/, 'code and other names are searchable');
assert.deepStrictEqual(countryItems(null).map((i) => i.id), ['']);

// ---- TV guide helpers (local time) ----
const now = new Date(2026, 10, 17, 19, 45); // Tue 17 Nov 2026, 7:45 pm local
const days = guideDays(now);
assert.deepStrictEqual(days.map((d) => d.label), ['Today', 'Tomorrow', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22', 'Mon 23']);
assert.strictEqual(days[0].from.getHours(), 0);
assert.strictEqual(days[0].to.getTime(), days[1].from.getTime(), 'days follow on');
assert.strictEqual(clock(new Date(2026, 10, 17, 0, 5)), '12:05 am');
assert.strictEqual(clock(new Date(2026, 10, 17, 12, 0)), '12:00 pm');
assert.strictEqual(whenText(new Date(2026, 10, 18, 9, 0), now), 'Tomorrow 9:00 am');
assert.strictEqual(whenText(new Date(2026, 10, 20, 20, 30), now), 'Fri 20 8:30 pm');
assert.ok(isOnNow({ start: new Date(2026, 10, 17, 19, 30), stop: new Date(2026, 10, 17, 20, 0) }, now));
assert.ok(!isOnNow({ start: new Date(2026, 10, 17, 20, 0), stop: new Date(2026, 10, 17, 20, 30) }, now));

const ch = (streams) => ({ name: 'Télé One', streams });
const a = { url: 'https://a/1.m3u8', how: 'browser', lastPlay: { ok: false } };
const b = { url: 'https://a/2.m3u8', how: 'browser', lastPlay: null };
const c = { url: 'https://a/3.m3u8', how: 'browser', lastPlay: { ok: true } };
const v = { url: 'http://a/4.m3u8', how: 'http' };

assert.strictEqual(pickStream(ch([a, b, c])), c, 'one that played last time comes first');
assert.strictEqual(pickStream(ch([a, b])), b, 'then one that has not failed');
assert.strictEqual(pickStream(ch([a])), a, 'then the first browser link');
assert.strictEqual(pickStream(ch([v])), v, 'a VLC-only channel still gets its link');
assert.strictEqual(pickStream(ch([])), null);

assert.strictEqual(lastResult(ch([a, c])), 'ok');
assert.strictEqual(lastResult(ch([a])), 'failed');
assert.strictEqual(lastResult(ch([b])), null);

const file = m3uFor({ name: 'Bad\nName' }, { url: 'https://x/live.m3u8', referrer: 'https://x/', userAgent: 'Agent 1' });
assert.strictEqual(file, '#EXTM3U\n#EXTINF:-1,Bad Name\n#EXTVLCOPT:http-referrer=https://x/\n#EXTVLCOPT:http-user-agent=Agent 1\nhttps://x/live.m3u8\n');
assert.strictEqual(m3uFor({ name: 'A' }, { url: 'https://x/a' }), '#EXTM3U\n#EXTINF:-1,A\nhttps://x/a\n');
assert.strictEqual(m3uFileName({ name: 'Télé One HD!' }), 'tele-one-hd.m3u');
assert.strictEqual(initials('ABC News 24'), 'AN');
assert.strictEqual(initials('!!'), 'TV');
console.log('liveTv helper tests passed');
