'use strict';
// node server/services/youtubeFollows.test.js   (part of npm run test:youtube). The database parts are checked against a real database in the
// smoke test described in docs/youtube-agent.md; here only the pure rules, with no network and no database.
const assert = require('node:assert/strict');
const F = require('./youtubeFollows');

// ---- channel ids and their uploads playlist
const CH = 'UC' + 'a'.repeat(22);
assert.equal(F.uploadsPlaylistId(CH), 'UU' + 'a'.repeat(22));
assert.equal(F.uploadsPlaylistId('UCshort'), null);
assert.equal(F.uploadsPlaylistId('PL' + 'a'.repeat(22)), null, 'only channel ids');
assert.equal(F.uploadsPlaylistId(undefined), null);

// ---- what the page may ask to follow
assert.deepEqual(F.validateFollow({ kind: 'channel', channelId: CH, channelTitle: '  Baker Ben  ' }),
  { ok: true, value: { kind: 'channel', channelId: CH, channelTitle: 'Baker Ben', query: null, sortOrder: null, duration: null } });
assert.equal(F.validateFollow({ kind: 'channel', channelId: 'nope' }).ok, false);
assert.equal(F.validateFollow({ kind: 'channel', channelId: CH }).value.channelTitle, 'Channel', 'a missing name gets a plain one');
const s = F.validateFollow({ kind: 'search', query: '  sourdough   starter ', order: 'bogus', duration: 'long' });
assert.deepEqual(s.value, { kind: 'search', channelId: null, channelTitle: null, query: 'sourdough starter', sortOrder: 'date', duration: 'long' }, 'spaces tidied, a bad sort falls back to newest');
assert.equal(F.validateFollow({ kind: 'search', query: 'x' }).ok, false);
assert.equal(F.validateFollow({ kind: 'search', query: 'x'.repeat(101) }).ok, false);
assert.equal(F.validateFollow({ kind: 'playlist' }).ok, false);
assert.equal(F.validateFollow(null).ok, false);

// ---- when a follow is due
const now = new Date('2026-11-02T12:00:00Z');
const ago = (h) => new Date(now.getTime() - h * 3600 * 1000);
assert.equal(F.dueForCheck({ kind: 'channel', lastCheckedAt: null }, now), true, 'never checked is due');
assert.equal(F.dueForCheck({ kind: 'channel', lastCheckedAt: ago(4) }, now), false);
assert.equal(F.dueForCheck({ kind: 'channel', lastCheckedAt: ago(5) }, now), true);
assert.equal(F.dueForCheck({ kind: 'search', lastCheckedAt: ago(19) }, now), false, 'searches cost 100 units, so about once a day');
assert.equal(F.dueForCheck({ kind: 'search', lastCheckedAt: ago(20) }, now), true);
assert.equal(F.dueForCheck({ kind: 'channel', lastCheckedAt: ago(0.5) }, now, { minGapMs: 5 * 60 * 1000 }), true, 'a manual check uses a short gap');
assert.equal(F.LIMITS.channel, 30);
assert.equal(F.LIMITS.search, 5);

// ---- which items are new
const item = (id, title, at, extra = {}) => ({ snippet: { title, channelTitle: 'Baker Ben', publishedAt: at, resourceId: { videoId: id }, thumbnails: { medium: { url: 'http://t/' + id } }, ...extra } });
const searchItem = (id, title, at) => ({ id: { videoId: id }, snippet: { title, channelTitle: 'C', publishedAt: at, thumbnails: { default: { url: 'http://d/' + id } } } });
const got = F.newVideosFrom([
  item('aaaaaaaaaaa', 'Old one', '2026-10-01T00:00:00Z'),
  item('bbbbbbbbbbb', 'Newer', '2026-11-01T00:00:00Z'),
  item('ccccccccccc', 'Private video', '2026-11-02T00:00:00Z'),
  item('ddddddddddd', 'Deleted video', '2026-11-02T00:00:00Z'),
  item('bbbbbbbbbbb', 'Newer (duplicate)', '2026-11-01T00:00:00Z'),
  { snippet: { title: 'No id' } },
  null,
  searchItem('eeeeeeeeeee', 'From a search', '2026-11-02T06:00:00Z'),
], new Set(['aaaaaaaaaaa']));
assert.deepEqual(got.map((v) => v.videoId), ['eeeeeeeeeee', 'bbbbbbbbbbb'], 'known, private, deleted, duplicate and id-less items dropped; newest first');
assert.equal(got[1].thumbnail, 'http://t/bbbbbbbbbbb');
assert.equal(got[0].thumbnail, 'http://d/eeeeeeeeeee', 'a search item has its own shape');
assert.deepEqual(F.newVideosFrom([], new Set()), []);
assert.deepEqual(F.newVideosFrom(undefined), []);

console.log('youtubeFollows: ok');
