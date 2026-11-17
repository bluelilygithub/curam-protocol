// node client/src/pages/liveTv/liveTvHelpers.test.mjs   (no npm script on purpose: it would change package.json)
import assert from 'node:assert';
import { pickStream, lastResult, m3uFor, m3uFileName, initials } from './liveTvHelpers.mjs';

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
