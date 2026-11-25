'use strict';

// node server/services/geoCheck/countries.test.js

const assert = require('assert');
const { COUNTRIES, DEFAULT_COUNTRIES, countryOf } = require('./countries');

const codes = COUNTRIES.map((c) => c.code);
assert.strictEqual(new Set(codes).size, codes.length, 'country codes are unique');
for (const c of COUNTRIES) {
  assert.ok(/^[A-Z]{2}$/.test(c.code), c.code);
  assert.ok(c.name && /^[a-z]{2}-[A-Z]{2}$/.test(c.locale), `${c.code} locale`);
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: c.timezoneId }), `${c.code} time zone`);
  assert.ok(Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180, `${c.code} coordinates`);
}
assert.deepStrictEqual(DEFAULT_COUNTRIES, ['AU', 'NZ', 'US', 'GB', 'DE', 'JP']);
for (const d of DEFAULT_COUNTRIES) assert.ok(countryOf(d), `default ${d} is in the list`);
assert.strictEqual(countryOf(' nz ').name, 'New Zealand');
assert.strictEqual(countryOf('XX'), null);
assert.strictEqual(countryOf(null), null);

console.log('geoCheck countries tests passed');
