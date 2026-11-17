'use strict';

// node server/services/liveTv/catalogue.test.js   (no npm script on purpose: it would change package.json). No network: the fetch is faked.

const assert = require('assert');
const { buildCatalogue, filterChannels, getCatalogue, howToWatch, _resetForTests } = require('./catalogue');

const files = {
  channels: [
    { id: 'ABC.au', name: 'ABC News', alt_names: ['ABC News 24'], network: 'ABC', country: 'AU', categories: ['news'], is_nsfw: false, closed: null, website: 'https://abc.net.au' },
    { id: 'Adult.us', name: 'Adult One', country: 'US', categories: ['xxx'], is_nsfw: true },
    { id: 'Taken.uk', name: 'Taken Down', country: 'UK', categories: ['movies'], is_nsfw: false },
    { id: 'Gone.nz', name: 'Gone TV', country: 'NZ', categories: ['general'], is_nsfw: false, closed: '2020-01-01' },
    { id: 'Tele.nz', name: 'Télé Aotearoa', country: 'NZ', categories: ['general', 'news'], is_nsfw: false, website: 'javascript:alert(1)' },
    { id: 'NoStream.au', name: 'No Stream', country: 'AU', categories: ['news'], is_nsfw: false },
  ],
  streams: [
    { channel: 'ABC.au', url: 'http://abc.example/low.m3u8', quality: '360p', labels: [] },
    { channel: 'ABC.au', url: 'https://abc.example/hd.m3u8', quality: '1080p', labels: ['Geo-blocked'] },
    { channel: 'ABC.au', url: 'https://abc.example/sd.m3u8', quality: '576p' },
    { channel: 'ABC.au', url: 'https://abc.example/sd.m3u8', quality: '576p' },
    { channel: 'Adult.us', url: 'https://x.example/a.m3u8' },
    { channel: 'Taken.uk', url: 'https://x.example/t.m3u8' },
    { channel: 'Gone.nz', url: 'https://x.example/g.m3u8' },
    { channel: 'Tele.nz', url: 'https://tele.example/live.m3u8', referrer: 'https://tele.example/' },
    { channel: null, title: 'Mystery', url: 'https://x.example/m.m3u8' },
    { channel: 'ABC.au', url: 'rtmp://abc.example/live' },
  ],
  blocklist: [{ channel: 'Taken.uk', reason: 'dmca', ref: 'x' }],
  countries: [{ code: 'AU', name: 'Australia', flag: 'AU' }, { code: 'NZ', name: 'New Zealand', flag: 'NZ' }, { code: 'US', name: 'United States', flag: 'US' }],
  categories: [{ id: 'news', name: 'News' }, { id: 'general', name: 'General' }, { id: 'xxx', name: 'XXX' }],
};

const cat = buildCatalogue(files, new Date('2026-11-17T00:00:00Z'));
assert.deepStrictEqual(cat.channels.map((c) => c.id), ['ABC.au', 'Tele.nz'], 'adult, blocklisted, closed, stream-less and unknown streams are left out');
const abc = cat.byId.get('ABC.au');
assert.deepStrictEqual(abc.streams.map((s) => s.url), ['https://abc.example/hd.m3u8', 'https://abc.example/sd.m3u8', 'http://abc.example/low.m3u8'],
  'browser links first, best quality first, duplicates and non-web links dropped');
assert.deepStrictEqual(abc.streams.map((s) => s.how), ['browser', 'browser', 'http']);
assert.strictEqual(abc.browserOk, true);
const tele = cat.byId.get('Tele.nz');
assert.strictEqual(tele.streams[0].how, 'headers', 'a link that needs a referrer needs VLC');
assert.strictEqual(tele.browserOk, false);
assert.strictEqual(tele.website, '', 'only web addresses are kept as a website');
assert.deepStrictEqual(cat.countries.map((c) => [c.code, c.count]), [['AU', 1], ['NZ', 1]], 'only countries with channels, with counts');
assert.deepStrictEqual(cat.categories.map((c) => c.id), ['general', 'news'], 'the adult kind does not appear');
assert.strictEqual(howToWatch({ url: 'https://a', user_agent: 'x' }), 'headers');

assert.strictEqual(filterChannels(cat, { country: 'AU' }).total, 1);
assert.strictEqual(filterChannels(cat, { category: 'news' }).total, 2);
assert.strictEqual(filterChannels(cat, { q: 'tele aotearoa' }).channels[0].id, 'Tele.nz', 'search ignores accents');
assert.strictEqual(filterChannels(cat, { q: 'news 24' }).channels[0].id, 'ABC.au', 'other names are searched');
assert.strictEqual(filterChannels(cat, { browserOnly: true }).total, 1);
assert.deepStrictEqual(filterChannels(cat, { ids: ['Tele.nz', 'Missing.xx', 'ABC.au'] }).channels.map((c) => c.id), ['Tele.nz', 'ABC.au'], 'favourites keep their order');
assert.strictEqual(filterChannels(cat, { limit: 1, offset: 1 }).channels[0].id, 'Tele.nz', 'paging');

(async () => {
  // The cached copy: one fetch per day, the old list is kept when a refresh fails.
  _resetForTests();
  let calls = 0; let fail = false; let clock = Date.parse('2026-11-17T00:00:00Z');
  const fetchFile = async (url) => {
    calls += 1;
    if (fail) throw new Error('offline');
    const name = url.split('/').pop().replace('.json', '');
    return { buffer: Buffer.from(JSON.stringify(files[name])) };
  };
  const now = () => clock;
  const first = await getCatalogue({ fetchFile, now });
  assert.strictEqual(first.channels.length, 2);
  assert.strictEqual(calls, 5, 'five files fetched');
  await getCatalogue({ fetchFile, now });
  assert.strictEqual(calls, 5, 'kept for a day');
  clock += 25 * 60 * 60 * 1000; fail = true;
  const stale = await getCatalogue({ fetchFile, now });
  assert.strictEqual(stale, first, 'a failed refresh keeps the old list');
  const callsAfterFail = calls;
  await getCatalogue({ fetchFile, now });
  assert.strictEqual(calls, callsAfterFail, 'a failed source is not asked again for ten minutes');
  _resetForTests();
  await assert.rejects(getCatalogue({ fetchFile, now }), (e) => e.status === 503, 'no list at all is a plain 503');
  console.log('liveTv catalogue tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
