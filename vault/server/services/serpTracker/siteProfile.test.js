'use strict';
// node server/services/serpTracker/siteProfile.test.js   (no database, no network; expected values worked out by hand)
const assert = require('node:assert/strict');
const { validateProfile, normaliseDomain, hostBelongsTo, localDate, isLocalMonday } = require('./siteProfile');

// --- domains
assert.equal(normaliseDomain('https://www.WIWC.com.au/some/page?x=1'), 'wiwc.com.au');
assert.equal(normaliseDomain('www.wiwc.com.au'), 'wiwc.com.au');
assert.equal(normaliseDomain('  Example.COM.au:8080/path '), 'example.com.au');
assert.equal(normaliseDomain('localhost'), '');
assert.equal(normaliseDomain('not a domain'), '');
assert.equal(normaliseDomain(''), '');
assert.equal(normaliseDomain(null), '');

assert.equal(hostBelongsTo('www.wiwc.com.au', 'wiwc.com.au'), true);
assert.equal(hostBelongsTo('shop.wiwc.com.au', 'wiwc.com.au'), true);
assert.equal(hostBelongsTo('notwiwc.com.au', 'wiwc.com.au'), false); // a suffix match on the text must not count
assert.equal(hostBelongsTo('wiwc.com.au.evil.com', 'wiwc.com.au'), false);

// --- a good profile, with defaults filled in
let v = validateProfile({
  domain: 'https://www.wiwc.com.au/',
  brandTerms: ['wiwc', ' WIWC ', 'walk in wine cabinets', ''],
  keywords: [{ term: 'walk in wine cabinets', targetUrl: 'https://www.wiwc.com.au/cabinets/' }, { term: 'wine room cooling' }],
  competitors: [{ domain: 'https://www.rival.com.au', pages: ['https://rival.com.au/a/'] }],
  healthCheckUrls: ['https://www.wiwc.com.au/cabinets/', 'https://www.wiwc.com.au/cabinets/'],
});
assert.equal(v.ok, true, v.errors.join('; '));
assert.equal(v.profile.domain, 'wiwc.com.au');
assert.deepEqual(v.profile.brandTerms, ['wiwc', 'walk in wine cabinets']); // case-insensitive duplicate and blank removed
assert.equal(v.profile.locationName, 'Australia');
assert.equal(v.profile.serpDepth, 100);
assert.deepEqual(v.profile.devices, ['desktop', 'mobile']);
assert.equal(v.profile.timezone, 'Australia/Brisbane');
assert.deepEqual(v.profile.healthCheckUrls, ['https://www.wiwc.com.au/cabinets/']);
assert.equal(v.profile.keywords[0].targetUrl, 'https://www.wiwc.com.au/cabinets/');
assert.equal('targetUrl' in v.profile.keywords[1], false);
assert.deepEqual(v.profile.competitors, [{ domain: 'rival.com.au', pages: ['https://rival.com.au/a/'] }]);

// --- every problem is reported together, in plain words
v = validateProfile({
  domain: 'nope',
  devices: ['tablet'],
  serpDepth: 15,
  timezone: 'Mars/Base',
  keywords: [{ term: 'a' }, { term: 'A' }, { term: '' }, { term: 'b', targetUrl: 'ftp://x' }],
  competitors: [{ domain: 'wiwc.com.au' }, { domain: 'bad' }],
});
assert.equal(v.ok, false);
assert.equal(v.profile, null);
const text = v.errors.join(' | ');
for (const frag of ['Site domain', 'Devices can only be', 'steps of 10', 'not a known time zone', 'listed twice', 'has no words', 'not a web address', 'not a valid web address']) {
  assert.ok(text.includes(frag), `expected an error mentioning "${frag}" in: ${text}`);
}

// --- a target page must be on the site; a competitor page on its competitor
v = validateProfile({ domain: 'wiwc.com.au', keywords: [{ term: 'x', targetUrl: 'https://other.com/' }] });
assert.equal(v.ok, false);
v = validateProfile({ domain: 'wiwc.com.au', competitors: [{ domain: 'rival.com.au', pages: ['https://other.com/p'] }] });
assert.equal(v.ok, false);
v = validateProfile({ domain: 'wiwc.com.au', healthCheckUrls: ['https://other.com/p'] });
assert.equal(v.ok, false);

// --- limits
v = validateProfile({ domain: 'wiwc.com.au', keywords: Array.from({ length: 51 }, (_, i) => ({ term: `kw ${i}` })) });
assert.equal(v.ok, false);
assert.ok(v.errors.some((e) => e.includes('At most 50 keywords')));

// --- junk input never throws
for (const junk of [null, undefined, 5, 'x', [], {}]) assert.equal(validateProfile(junk).ok, false);

// --- Brisbane date (UTC+10, no daylight saving): 20:00 UTC on Thursday 5 Nov 2026 is 06:00 on Friday 6 Nov in Brisbane
const t = new Date('2026-11-05T20:00:00Z');
assert.equal(localDate(t, 'Australia/Brisbane'), '2026-11-06');
assert.equal(localDate(t, 'UTC'), '2026-11-05');
assert.equal(isLocalMonday(t, 'Australia/Brisbane'), false); // Friday
// 20:00 UTC on Sunday 8 Nov 2026 is 06:00 Monday 9 Nov in Brisbane
const sun = new Date('2026-11-08T20:00:00Z');
assert.equal(isLocalMonday(sun, 'Australia/Brisbane'), true);
assert.equal(isLocalMonday(sun, 'UTC'), false);

console.log('siteProfile.test.js: all passed');
