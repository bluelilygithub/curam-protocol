// node client/src/pages/serpTracker/profileForm.test.mjs   (pure; no browser)
import assert from 'node:assert/strict';
import { profileToForm, formToProfile } from './profileForm.mjs';

// empty form gets the defaults
const empty = profileToForm(null);
assert.equal(empty.locationName, 'Australia');
assert.equal(empty.serpDepth, 100);
assert.deepEqual(empty.devices, ['desktop', 'mobile']);
assert.equal(empty.timezone, 'Australia/Brisbane');

// text -> profile
const p = formToProfile({
  ...empty,
  domain: 'www.wiwc.com.au',
  brandTermsText: 'wiwc\n\n  walk in wine cabinets  \n',
  keywordsText: 'walk in wine cabinets | https://www.wiwc.com.au/cabinets/\nwine room cooling\n',
  competitorsText: 'rival.com.au | https://rival.com.au/a/, https://rival.com.au/b/\nother.com.au',
  healthText: 'https://www.wiwc.com.au/\n',
  serpDepth: '50',
});
assert.deepEqual(p.brandTerms, ['wiwc', 'walk in wine cabinets']);
assert.deepEqual(p.keywords, [{ term: 'walk in wine cabinets', targetUrl: 'https://www.wiwc.com.au/cabinets/' }, { term: 'wine room cooling' }]);
assert.deepEqual(p.competitors, [{ domain: 'rival.com.au', pages: ['https://rival.com.au/a/', 'https://rival.com.au/b/'] }, { domain: 'other.com.au', pages: [] }]);
assert.equal(p.serpDepth, 50);

// profile -> text -> profile is stable
const again = formToProfile(profileToForm(p));
assert.deepEqual(again.keywords, p.keywords);
assert.deepEqual(again.competitors, p.competitors);
assert.deepEqual(again.brandTerms, p.brandTerms);
assert.deepEqual(again.healthCheckUrls, p.healthCheckUrls);

console.log('profileForm.test.mjs: all passed');
