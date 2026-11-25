'use strict';

// node server/services/geoCheck/exitCheck.test.js

const assert = require('assert');
const { readExitCountry, exitVerdict } = require('./exitCheck');

assert.strictEqual(readExitCountry({ ip: '1.2.3.4', country: 'AU', city: 'Sydney' }), 'AU'); // ipinfo.io
assert.strictEqual(readExitCountry({ country_code: 'nz' }), 'NZ');
assert.strictEqual(readExitCountry({ countryCode: 'US', country: 'United States' }), 'US'); // ip-api shape: code wins over the name
assert.strictEqual(readExitCountry({ location: { country_code: 'DE' } }), 'DE');
assert.strictEqual(readExitCountry({ country: 'Germany' }), null, 'a full name is not a code');
assert.strictEqual(readExitCountry(null), null);
assert.strictEqual(readExitCountry('AU'), null);

assert.deepStrictEqual(exitVerdict('AU', 'AU'), { exitCountry: 'AU', verified: true, label: 'Verified' });
assert.deepStrictEqual(exitVerdict('au', 'US'), { exitCountry: 'US', verified: false, label: 'Unverified: exited from US' });
assert.deepStrictEqual(exitVerdict('AU', null), { exitCountry: null, verified: false, label: 'Unverified: exit not confirmed' });

console.log('geoCheck exitCheck tests passed');
