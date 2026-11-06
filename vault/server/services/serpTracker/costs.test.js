'use strict';
// node server/services/serpTracker/costs.test.js   (no database)
const assert = require('node:assert/strict');
const { monthBounds, monthlyCapUsd, DEFAULT_CAP_USD } = require('./costs');

assert.deepEqual(monthBounds('2026-11-06'), { start: '2026-11-01', next: '2026-12-01' });
assert.deepEqual(monthBounds('2026-12-31'), { start: '2026-12-01', next: '2027-01-01' }); // year rolls over
assert.deepEqual(monthBounds('2026-01-15', 1), { start: '2025-12-01', next: '2026-01-01' }); // last month across a year
assert.deepEqual(monthBounds('2026-03-01', 1), { start: '2026-02-01', next: '2026-03-01' });

assert.equal(monthlyCapUsd({}), DEFAULT_CAP_USD);
assert.equal(monthlyCapUsd({ MAX_MONTHLY_SPEND_USD: '' }), 5);
assert.equal(monthlyCapUsd({ MAX_MONTHLY_SPEND_USD: '12.5' }), 12.5);
assert.equal(monthlyCapUsd({ MAX_MONTHLY_SPEND_USD: '0' }), 0); // zero means "spend nothing", not "no cap"
assert.equal(monthlyCapUsd({ MAX_MONTHLY_SPEND_USD: 'abc' }), 5); // a typo falls back to the default, never to no cap
assert.equal(monthlyCapUsd({ MAX_MONTHLY_SPEND_USD: '-3' }), 5);

console.log('costs.test.js: all passed');
