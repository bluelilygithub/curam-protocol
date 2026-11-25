'use strict';

// node server/services/geoCheck/diff.test.js

const assert = require('assert');
const { diffRun, diffRuns, samePlace } = require('./diff');

const URL1 = 'https://shop.example/';
const ex = (o = {}) => ({ htmlLang: 'en', title: 'Shop', currencies: ['A$'], prices: ['A$10', 'A$20'], headings: ['Sale', 'New'], buttons: ['Buy'], consentBanner: false, ...o });
const cap = (country, deviceId, o = {}, extract = {}) => ({
  country, deviceId, status: 'ok', finalUrl: URL1, htmlLang: extract.htmlLang || 'en', title: extract.title || 'Shop', extract: ex(extract), ...o,
});
const topics = (d) => d.lines.map((l) => l.topic);
const textOf = (d, topic) => (d.lines.find((l) => l.topic === topic) || {}).text;

assert.strictEqual(samePlace('https://www.shop.example/a/?x=1'), samePlace('https://shop.example/a'));
assert.notStrictEqual(samePlace('https://shop.example/en-us/'), samePlace('https://shop.example/'));

// identical countries: nothing to say
const run = { url: URL1, settings: { countries: ['AU', 'NZ'] } };
assert.deepStrictEqual(diffRun(run, [cap('AU', 'p'), cap('NZ', 'p')]).lines, []);

// redirect, language, currency, prices, cookie notice, headings in some countries only
const run3 = { url: URL1, settings: JSON.stringify({ countries: ['AU', 'US', 'DE', 'JP'] }) };
const d = diffRun(run3, [
  cap('AU', 'p'), cap('AU', 'l', {}, { headings: ['Sale', 'New', 'Wide only'] }),
  cap('US', 'p', { finalUrl: 'https://shop.example/en-us/', htmlLang: 'en-US' }, { currencies: ['US$', 'USD'], prices: ['US$7'] }),
  cap('DE', 'p', { htmlLang: 'de' }, { currencies: ['€'], prices: ['12,50 €'], consentBanner: true, headings: ['Sale', 'New', 'Cookie-Einstellungen'] }),
  cap('JP', 'p', { status: 'blocked' }),
]);
assert.strictEqual(textOf(d, 'Redirects'), 'Sent to https://shop.example/en-us/ in US; the others stayed on the address asked for.');
assert.strictEqual(textOf(d, 'Language'), 'en in AU; en-US in US; de in DE.');
assert.strictEqual(textOf(d, 'Currency'), 'A$ in AU; US$ USD in US; € in DE.');
assert.match(textOf(d, 'Prices'), /first prices A\$10, A\$20 in AU/);
assert.strictEqual(textOf(d, 'Cookie notice'), 'A cookie or consent notice only in DE.');
const only = d.lines.filter((l) => l.topic === 'Headings only in some countries').map((l) => l.text);
assert.ok(!only.some((t) => t.includes('Cookie-Einstellungen')), 'DE has its own language: its headings are not compared with the English ones');
assert.deepStrictEqual(d.notCompared, ['JP (blocked by the site)']);
assert.deepStrictEqual(d.compared, ['AU', 'US', 'DE']);
assert.ok(!topics(d).includes('Buttons only in some countries'));

// one usable country: nothing to compare, but the failure is named
const lone = diffRun(run, [cap('AU', 'p'), cap('NZ', 'p', { status: 'failed', extract: null })]);
assert.deepStrictEqual(lone.lines, []);
assert.deepStrictEqual(lone.notCompared, ['NZ (failed)']);

// long lists are cut
const many = Array.from({ length: 12 }, (_, i) => `H${i}`);
const cut = diffRun(run, [cap('AU', 'p', {}, { headings: many }), cap('NZ', 'p', {}, { headings: [] })]);
assert.match(textOf(cut, 'Headings only in some countries'), /and 4 more\.$/);

// two checks of the same address
const older = { captures: [cap('AU', 'p'), cap('DE', 'p'), cap('NZ', 'p')] };
const newer = { captures: [
  cap('AU', 'p', {}, { prices: ['A$10', 'A$25'], headings: ['Sale', 'Black Friday'], consentBanner: true }),
  cap('DE', 'p', { status: 'failed', extract: null }),
  cap('JP', 'p'),
] };
const r = diffRuns(older, newer);
assert.deepStrictEqual(r.lines.map((l) => l.topic), ['AU: prices', 'AU: cookie notice', 'AU: headings']);
assert.strictEqual(r.lines[0].text, 'new A$25; gone A$20.');
assert.strictEqual(r.lines[2].text, 'new "Black Friday"; gone "New".');
assert.deepStrictEqual(r.notCompared, ['DE (failed or blocked in the newer check)', 'JP (only in the newer check)', 'NZ (only in the older check)']);
assert.deepStrictEqual(diffRuns(older, older).lines, []);

// same language: headings compared; a different language: left out
const sameLang = diffRun(run, [cap('AU', 'p', {}, { headings: ['Sale'] }), cap('AU', 'l', {}, { headings: ['Sale', 'Wide only'] }), cap('NZ', 'p', {}, { headings: ['Sale'] })]);
assert.strictEqual(textOf(sameLang, 'Headings only in some countries'), 'Only in AU: "Wide only".', 'same language compared; headings are the union over screens');
const twoLangs = diffRun(run, [cap('AU', 'p', {}, { headings: ['Sale'] }), cap('NZ', 'p', { htmlLang: 'ja' }, { headings: ['セール'] })]);
assert.ok(!topics(twoLangs).includes('Headings only in some countries'));
assert.strictEqual(textOf(twoLangs, 'Language'), 'en in AU; ja in NZ.');

console.log('geoCheck diff tests passed');
